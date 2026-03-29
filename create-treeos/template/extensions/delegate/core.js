/**
 * Delegate Core
 *
 * Matches stuck work to available humans. No LLM calls.
 * Pure data analysis: evolution activity, competence maps,
 * contributor lists, inverse-tree profiles.
 */

import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import User from "../../seed/models/user.js";
import { getDescendantIds } from "../../seed/tree/treeFetch.js";
import { v4 as uuidv4 } from "uuid";

let _metadata = null;
export function configure({ metadata }) { _metadata = metadata; }

const DEFAULTS = {
  stalledDays: 14,            // days of inactivity before a node is considered stalled
  maxSuggestionsPerCycle: 10, // cap per tree per cycle
  maxSuggestionsPerNode: 3,   // cap per node
  suggestionTTLDays: 30,      // auto-expire old suggestions
};

function getConfig(rootMeta) {
  const cfg = rootMeta?.delegate || {};
  return { ...DEFAULTS, ...cfg };
}

// ─────────────────────────────────────────────────────────────────────────
// STALLED NODE DETECTION
// ─────────────────────────────────────────────────────────────────────────

/**
 * Find nodes in the tree that are stalled: had activity before but none recently.
 */
async function findStalledNodes(rootId, stalledDays) {
  const descendantIds = await getDescendantIds(rootId, { maxResults: 5000 });
  const allIds = [rootId, ...descendantIds];

  const cutoff = new Date(Date.now() - stalledDays * 86400000);
  const stalledNodes = [];

  // Batch load nodes with evolution metadata
  const nodes = await Node.find({
    _id: { $in: allIds },
    status: { $nin: ["trimmed", "completed"] },
  }).select("_id name type parent children metadata").lean();

  for (const node of nodes) {
    if (!node.children || node.children.length === 0) continue; // skip leaves, focus on branches
    const meta = node.metadata instanceof Map
      ? Object.fromEntries(node.metadata)
      : (node.metadata || {});

    const evo = meta.evolution;
    if (!evo?.lastActivity) continue; // never had activity, not stalled

    const lastActivity = new Date(evo.lastActivity);
    if (lastActivity >= cutoff) continue; // still active

    // This node had activity but went silent
    stalledNodes.push({
      nodeId: String(node._id),
      nodeName: node.name,
      type: node.type,
      lastActivity: evo.lastActivity,
      daysSilent: Math.round((Date.now() - lastActivity.getTime()) / 86400000),
      notesWritten: evo.notesWritten || 0,
      childCount: node.children.length,
    });
  }

  return stalledNodes.sort((a, b) => b.daysSilent - a.daysSilent);
}

// ─────────────────────────────────────────────────────────────────────────
// CONTRIBUTOR SCORING
// ─────────────────────────────────────────────────────────────────────────

/**
 * Score contributors for a stalled node based on available signals.
 * Returns sorted array of { userId, username, score, reasons }.
 */
async function scoreContributors(stalledNode, rootId, contributors) {
  if (!contributors || contributors.length === 0) return [];

  const scored = [];

  for (const userId of contributors) {
    const user = await User.findById(userId).select("_id username metadata").lean();
    if (!user) continue;

    let score = 0;
    const reasons = [];
    const userMeta = user.metadata instanceof Map
      ? Object.fromEntries(user.metadata)
      : (user.metadata || {});

    // Signal 1: Evolution activity. Is this user active in the tree recently?
    try {
      const { getExtension } = await import("../loader.js");
      const evoExt = getExtension("evolution");
      if (evoExt?.exports?.calculateFitness) {
        // Check if user has recent activity near the stalled node
        const parentNode = await Node.findById(stalledNode.nodeId).select("parent").lean();
        if (parentNode?.parent) {
          const siblings = await Node.find({ parent: parentNode.parent })
            .select("_id metadata").lean();
          for (const sib of siblings) {
            const sibMeta = sib.metadata instanceof Map
              ? sib.metadata.get("evolution")
              : sib.metadata?.evolution;
            if (sibMeta?.lastActivity) {
              const age = Date.now() - new Date(sibMeta.lastActivity).getTime();
              if (age < 7 * 86400000) { // active in last week on a sibling
                score += 0.3;
                reasons.push("active on sibling branch");
                break;
              }
            }
          }
        }
      }
    } catch {}

    // Signal 2: Competence. Does this user have competence on related topics?
    try {
      const { getExtension } = await import("../loader.js");
      const compExt = getExtension("competence");
      if (compExt?.exports?.getCompetence) {
        const comp = await compExt.exports.getCompetence(stalledNode.nodeId);
        if (comp?.strongTopics?.length > 0) {
          // Check if the stalled node's name or type matches strong topics
          const nodeName = (stalledNode.nodeName || "").toLowerCase();
          const match = comp.strongTopics.some(t => nodeName.includes(t.toLowerCase()));
          if (match) {
            score += 0.25;
            reasons.push("competence match on node topic");
          }
        }
      }
    } catch {}

    // Signal 3: Inverse-tree profile. Does this user's profile show interest in this area?
    try {
      const { getExtension } = await import("../loader.js");
      const invExt = getExtension("inverse-tree");
      if (invExt?.exports?.getInverseData) {
        const data = await invExt.exports.getInverseData(userId);
        const profile = data?.profile;
        if (profile?.topics) {
          const nodeName = (stalledNode.nodeName || "").toLowerCase();
          for (const [topic, weight] of Object.entries(profile.topics)) {
            if (nodeName.includes(topic.toLowerCase())) {
              score += 0.2 * (weight || 1);
              reasons.push(`profile interest: ${topic}`);
              break;
            }
          }
        }
      }
    } catch {}

    // Signal 4: Recency. How recently has this user been active anywhere in the tree?
    try {
      const nav = userMeta.nav;
      if (nav?.recentRoots) {
        const visitedThisTree = nav.recentRoots.find(r => r.rootId === rootId);
        if (visitedThisTree) {
          const age = Date.now() - new Date(visitedThisTree.lastVisitedAt).getTime();
          if (age < 3 * 86400000) {
            score += 0.15;
            reasons.push("visited this tree recently");
          }
        }
      }
    } catch {}

    if (score > 0) {
      scored.push({
        userId: String(user._id),
        username: user.username,
        score: Math.min(score, 1.0),
        reasons,
      });
    }
  }

  return scored.sort((a, b) => b.score - a.score);
}

// ─────────────────────────────────────────────────────────────────────────
// SUGGESTION GENERATION
// ─────────────────────────────────────────────────────────────────────────

/**
 * Generate delegate suggestions for a tree.
 * Finds stalled nodes, scores contributors, writes suggestions to metadata.
 */
export async function generateSuggestions(rootId) {
  const root = await Node.findById(rootId).select("_id metadata contributors rootOwner").lean();
  if (!root) return [];

  const rootMeta = root.metadata instanceof Map
    ? Object.fromEntries(root.metadata)
    : (root.metadata || {});
  const config = getConfig(rootMeta);

  // Get all contributors (owner + contributors)
  const contributors = [
    ...(root.rootOwner ? [root.rootOwner.toString()] : []),
    ...(root.contributors || []).map(c => c.toString()),
  ];
  const uniqueContributors = [...new Set(contributors)];

  if (uniqueContributors.length < 2) return []; // no one to delegate to

  // Find stalled nodes
  const stalled = await findStalledNodes(rootId, config.stalledDays);
  if (stalled.length === 0) return [];

  const suggestions = [];
  const existingMeta = rootMeta.delegate || {};
  const existingSuggestions = existingMeta.suggestions || [];
  const existingNodeIds = new Set(existingSuggestions.map(s => s.nodeId));

  for (const node of stalled.slice(0, config.maxSuggestionsPerCycle)) {
    // Skip if already has a pending suggestion
    if (existingNodeIds.has(node.nodeId)) continue;

    // Score contributors for this node
    const scored = await scoreContributors(node, rootId, uniqueContributors);
    if (scored.length === 0) continue;

    const best = scored[0];

    suggestions.push({
      id: uuidv4(),
      nodeId: node.nodeId,
      nodeName: node.nodeName,
      daysSilent: node.daysSilent,
      suggestedUserId: best.userId,
      suggestedUsername: best.username,
      score: best.score,
      reasons: best.reasons,
      status: "pending", // pending, accepted, dismissed
      createdAt: new Date().toISOString(),
    });
  }

  if (suggestions.length === 0) return [];

  // Write to root metadata
  const rootDoc = await Node.findById(rootId);
  if (rootDoc) {
    const meta = _metadata.getExtMeta(rootDoc, "delegate") || {};
    const all = [...(meta.suggestions || []), ...suggestions];

    // Expire old suggestions
    const ttlCutoff = Date.now() - config.suggestionTTLDays * 86400000;
    meta.suggestions = all
      .filter(s => new Date(s.createdAt).getTime() > ttlCutoff)
      .slice(0, 50); // hard cap

    await _metadata.setExtMeta(rootDoc, "delegate", meta);
  }

  return suggestions;
}

// ─────────────────────────────────────────────────────────────────────────
// SUGGESTION MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get pending suggestions for a tree.
 */
export async function getSuggestions(rootId, userId) {
  const root = await Node.findById(rootId).select("metadata").lean();
  if (!root) return [];

  const meta = root.metadata instanceof Map
    ? root.metadata.get("delegate") || {}
    : root.metadata?.delegate || {};

  const suggestions = meta.suggestions || [];

  // If userId provided, filter to suggestions for this user
  if (userId) {
    return suggestions.filter(s => s.status === "pending" && s.suggestedUserId === userId);
  }
  return suggestions.filter(s => s.status === "pending");
}

/**
 * Dismiss a suggestion.
 */
export async function dismissSuggestion(rootId, suggestionId, userId) {
  const root = await Node.findById(rootId);
  if (!root) return null;

  const meta = _metadata.getExtMeta(root, "delegate") || {};
  const suggestions = meta.suggestions || [];
  const suggestion = suggestions.find(s => s.id === suggestionId);
  if (!suggestion) return null;

  suggestion.status = "dismissed";
  suggestion.dismissedBy = userId;
  suggestion.dismissedAt = new Date().toISOString();

  await _metadata.setExtMeta(root, "delegate", meta);
  return suggestion;
}

/**
 * Accept a suggestion.
 */
export async function acceptSuggestion(rootId, suggestionId, userId) {
  const root = await Node.findById(rootId);
  if (!root) return null;

  const meta = _metadata.getExtMeta(root, "delegate") || {};
  const suggestions = meta.suggestions || [];
  const suggestion = suggestions.find(s => s.id === suggestionId);
  if (!suggestion) return null;

  suggestion.status = "accepted";
  suggestion.acceptedBy = userId;
  suggestion.acceptedAt = new Date().toISOString();

  await _metadata.setExtMeta(root, "delegate", meta);
  return suggestion;
}

/**
 * Get suggestions relevant to the current position for enrichContext injection.
 * Returns suggestions where the user is the suggested person AND
 * the stalled node is nearby (same parent, sibling, or child).
 */
export async function getNearbySuggestions(nodeId, userId, rootId) {
  if (!userId || !rootId) return [];

  const root = await Node.findById(rootId).select("metadata").lean();
  if (!root) return [];

  const meta = root.metadata instanceof Map
    ? root.metadata.get("delegate") || {}
    : root.metadata?.delegate || {};

  const pending = (meta.suggestions || []).filter(
    s => s.status === "pending" && s.suggestedUserId === userId
  );

  if (pending.length === 0) return [];

  // Check if any stalled nodes are near the current position
  const node = await Node.findById(nodeId).select("parent children").lean();
  if (!node) return [];

  const nearbyIds = new Set([
    nodeId,
    ...(node.parent ? [node.parent.toString()] : []),
    ...(node.children || []).map(c => c.toString()),
  ]);

  // Also include siblings
  if (node.parent) {
    const parent = await Node.findById(node.parent).select("children").lean();
    if (parent?.children) {
      for (const c of parent.children) nearbyIds.add(c.toString());
    }
  }

  return pending.filter(s => nearbyIds.has(s.nodeId));
}
