/**
 * Routing Index
 *
 * In-memory cache of all nodes with metadata.modes.respond set.
 * Replaces per-message DB queries in localClassify with one Map scan.
 * Rebuilt on boot and after structural/mode changes.
 */

import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import { getModeOwner } from "../../seed/tree/extensionScope.js";
import { getClassifierHintsForMode, getVocabularyForExtension } from "../loader.js";

// Map<rootId, Map<extName, { nodeId, name, path, mode, hints, vocab }>>
const _indices = new Map();

// ─────────────────────────────────────────────────────────────────────────
// WEIGHTED SCORING
// ─────────────────────────────────────────────────────────────────────────
//
// Score a message against an extension's vocabulary. Nouns are the strongest
// domain signal, verbs are medium, adjectives are soft. Returns both the
// numeric score and the matched pattern strings per part of speech for
// debugger visibility and per-POS logging.
//
//   nouns     * 3  = domain-specific things (protein, bench press, dollars)
//   verbs     * 2  = actions (ate, ran, paid)
//   adjectives * 1 = states/qualities (hungry, sore, fastest)

const POS_WEIGHTS = { nouns: 3, verbs: 2, adjectives: 1 };
const LOCALITY_MULTIPLIER = 4; // 4x bonus when user is inside the extension's subtree

// Minimum final score (after locality) required to commit to an extension.
// Below this, the match is too weak to confidently route away from converse.
//
// Score math for common cases:
//   1 noun alone (no locality)            = 3   -> rejected (single weak word)
//   1 verb alone (no locality)            = 2   -> rejected
//   1 adjective alone (no locality)       = 1   -> rejected
//   1 noun + 1 verb (no locality)         = 5   -> accepted
//   2 nouns (no locality)                 = 6   -> accepted
//   1 noun with locality (user at ext)    = 12  -> accepted
//   1 verb with locality                  = 8   -> accepted
//   1 adjective with locality             = 4   -> accepted (just barely)
//
// This threshold is the key filter that eliminates cross-domain hijacks:
// stray words that match an extension's vocabulary but aren't actually
// about that domain. "Bill" as an exercise name, "cost" in a sentence
// about reps, "bench" mentioned casually in finance — all correctly
// fall through to converse when the user isn't at the matching extension.
const MIN_ROUTING_SCORE = 4;

function scoreExtensionMatch(message, vocab) {
  const matches = { verbs: [], nouns: [], adjectives: [] };
  if (!vocab) return { score: 0, matches };

  for (const re of vocab.nouns || []) {
    try {
      const m = re.exec(message);
      if (m) matches.nouns.push(m[0]);
    } catch {}
  }
  for (const re of vocab.verbs || []) {
    try {
      const m = re.exec(message);
      if (m) matches.verbs.push(m[0]);
    } catch {}
  }
  for (const re of vocab.adjectives || []) {
    try {
      const m = re.exec(message);
      if (m) matches.adjectives.push(m[0]);
    } catch {}
  }
  const score =
    matches.nouns.length * POS_WEIGHTS.nouns +
    matches.verbs.length * POS_WEIGHTS.verbs +
    matches.adjectives.length * POS_WEIGHTS.adjectives;
  return { score, matches };
}

function scoreToConfidence(score) {
  // Map raw score to [0.5, 1.0]. Score 0 -> 0.5. Score 12+ -> 1.0.
  return Math.min(1.0, 0.5 + score / 12);
}

function isLocalityMatch(currentPath, entryPath) {
  if (!currentPath || !entryPath) return false;
  return currentPath === entryPath || currentPath.startsWith(entryPath + "/");
}

function pathDepth(p) {
  if (!p) return 0;
  return (p.match(/\//g) || []).length;
}

// ─────────────────────────────────────────────────────────────────────────
// PATH RESOLUTION
// ─────────────────────────────────────────────────────────────────────────

async function buildPathString(nodeId) {
  const parts = [];
  let current = await Node.findById(nodeId).select("name parent rootOwner").lean();
  let depth = 0;
  while (current && depth < 20) {
    parts.unshift(current.name || String(current._id));
    if (current.rootOwner || !current.parent) break;
    current = await Node.findById(current.parent).select("name parent rootOwner").lean();
    depth++;
  }
  return "/" + parts.join("/");
}

// ─────────────────────────────────────────────────────────────────────────
// REBUILD
// ─────────────────────────────────────────────────────────────────────────

export async function rebuildIndexForRoot(rootId) {
  const rid = String(rootId);
  try {
    // Find all nodes in this tree with modes set (including root itself)
    const nodes = await Node.find({
      $or: [
        { _id: rootId },
        { rootOwner: rootId },          // root's direct info
        { parent: { $exists: true } },  // children (filtered below)
      ],
      "metadata.modes": { $exists: true },
    }).select("_id name parent rootOwner metadata.modes").lean();

    // Filter to only nodes that belong to this tree
    // Root node: _id === rootId
    // Other nodes: walk parent chain to verify (expensive, so use a cheaper approach)
    // Actually, rootOwner is only on root nodes. For children, we need a different query.
    // Let's use a simpler approach: get all descendants of rootId.

    const index = new Map();

    // Check root itself
    const root = await Node.findById(rootId).select("_id name metadata.modes").lean();
    if (root) {
      const modes = root.metadata instanceof Map ? root.metadata.get("modes") : root.metadata?.modes;
      if (modes?.respond) {
        const owner = getModeOwner(modes.respond);
        if (owner) {
          const hints = getClassifierHintsForMode(modes.respond) || [];
          const vocab = getVocabularyForExtension(owner);
          index.set(owner, {
            nodeId: rid,
            name: root.name,
            path: "/" + (root.name || rid),
            mode: modes.respond,
            hints,
            vocab,
          });
        }
      }
    }

    // Find all descendants with modes set (BFS from root children)
    const descendants = await findDescendantsWithModes(rootId);
    for (const node of descendants) {
      const modes = node.metadata instanceof Map ? node.metadata.get("modes") : node.metadata?.modes;
      const modeKey = modes?.respond;
      if (!modeKey) continue;

      const owner = getModeOwner(modeKey);
      if (!owner) continue;
      if (index.has(owner)) continue; // first (shallowest) wins

      const hints = getClassifierHintsForMode(modeKey) || [];
      const vocab = getVocabularyForExtension(owner);
      const path = await buildPathString(node._id);

      index.set(owner, {
        nodeId: String(node._id),
        name: node.name,
        path,
        mode: modeKey,
        hints,
        vocab,
      });
    }

    // Also include confined extensions that are ext-allowed at the tree root.
    // These don't scaffold nodes or set modes.respond, but they're active here.
    // Spatial scoping from the kernel already propagates the allow down the
    // tree, so `ext-allow code-forge` at a root gives every node below it
    // routing access to forge-ship without per-node markup.
    try {
      const { getConfinedExtensions, isExtensionBlockedAtNode, getModesOwnedBy } = await import("../../seed/tree/extensionScope.js");
      const { getExtensionManifest, flattenVocabulary } = await import("../loader.js");
      for (const extName of getConfinedExtensions()) {
        if (index.has(extName)) continue;
        if (await isExtensionBlockedAtNode(extName, rid)) continue;
        const manifest = getExtensionManifest(extName);
        const hints = flattenVocabulary(manifest);
        if (hints.length === 0) continue;
        const modes = getModesOwnedBy(extName);
        const defaultMode = modes.find(m => m.endsWith("-ship") || m.endsWith("-agent") || m.endsWith("-tell") || m.endsWith("-log") || m.endsWith("-browse")) || modes[0];
        if (!defaultMode) continue;
        const vocab = getVocabularyForExtension(extName);
        index.set(extName, {
          nodeId: rid,
          name: extName,
          path: "/" + (root?.name || rid),
          mode: defaultMode,
          hints,
          vocab,
        });
      }
    } catch {}

    _indices.set(rid, index);
    if (index.size > 0) {
      log.debug("RoutingIndex", `Built index for ${root?.name || rid}: ${index.size} extensions`);
    }
  } catch (err) {
    log.debug("RoutingIndex", `Failed to build index for ${rid}: ${err.message}`);
  }
}

async function findDescendantsWithModes(rootId) {
  // BFS: walk children level by level, collect nodes with modes set
  const results = [];
  let currentLevel = [String(rootId)];
  let depth = 0;

  while (currentLevel.length > 0 && depth < 10) {
    const children = await Node.find({
      parent: { $in: currentLevel },
    }).select("_id name parent metadata.modes children").lean();

    const nextLevel = [];
    for (const child of children) {
      const modes = child.metadata instanceof Map ? child.metadata.get("modes") : child.metadata?.modes;
      if (modes?.respond) results.push(child);
      if (child.children?.length > 0) nextLevel.push(String(child._id));
    }
    currentLevel = nextLevel;
    depth++;
  }

  return results;
}

export async function rebuildAll() {
  // Tree roots = direct children of land root, excluding system nodes
  const landRoot = await Node.findOne({ systemRole: "land-root" }).select("_id").lean();
  if (!landRoot) return;
  const roots = await Node.find({
    parent: landRoot._id,
    systemRole: null,
  }).select("_id").lean();

  for (const root of roots) {
    await rebuildIndexForRoot(root._id);
  }
  log.debug("RoutingIndex", `Indexed ${_indices.size} trees`);
}

// ─────────────────────────────────────────────────────────────────────────
// QUERY
// ─────────────────────────────────────────────────────────────────────────

/**
 * Query the routing index for a message at a position.
 * Returns { mode, targetNodeId, confidence } or null.
 */
export function queryIndex(rootId, message, currentPath, personalVocabAll = null) {
  // Backward-compat thin wrapper around queryIndexScored. Returns only the
  // winner in the old shape so existing callers that don't need POS data work.
  const scored = queryIndexScored(rootId, message, currentPath, personalVocabAll);
  if (!scored?.winner) return null;
  return {
    mode: scored.winner.mode,
    targetNodeId: scored.winner.targetNodeId,
    confidence: scored.winner.confidence,
  };
}

/**
 * Scored routing query with position-weighted matching.
 *
 * Scores every indexed extension against the message by part of speech
 * (nouns 3x, verbs 2x, adjectives 1x). Extensions whose subtree contains
 * the user's current position get a 4x locality bonus, so being AT an
 * extension dominates routing unless another extension has an overwhelmingly
 * strong cross-domain match.
 *
 * Returns:
 *   {
 *     winner: { extName, mode, targetNodeId, score, confidence, matches, locality }
 *           | null,
 *     all: [<same shape>...]  // sorted descending by score, for chain detection
 *   }
 *
 * Returns null if nothing scored above zero.
 */
export function queryIndexScored(rootId, message, currentPath, personalVocabAll = null) {
  const index = _indices.get(String(rootId));
  if (!index || index.size === 0) return null;

  const scored = [];
  for (const [extName, entry] of index) {
    // 1. Score the entry's authored + learned vocab (manifest + sidecar file)
    const { score: rawScore, matches } = scoreExtensionMatch(message, entry.vocab);

    // 2. Score this user's personal vocab for this extension, if provided.
    //    Personal patterns are tagged with "*" suffix in the matches output
    //    so the grammar debugger can show which words came from personal layer.
    let personalScore = 0;
    let personalMatches = null;
    if (personalVocabAll && personalVocabAll[extName]) {
      const result = scoreExtensionMatch(message, personalVocabAll[extName]);
      personalScore = result.score;
      if (result.score > 0) {
        personalMatches = result.matches;
        for (const w of result.matches.nouns) matches.nouns.push(`${w}*`);
        for (const w of result.matches.verbs) matches.verbs.push(`${w}*`);
        for (const w of result.matches.adjectives) matches.adjectives.push(`${w}*`);
      }
    }

    const totalRaw = rawScore + personalScore;
    if (totalRaw === 0) continue;

    // Locality bonus: user is AT or INSIDE this extension's subtree
    const locality = isLocalityMatch(currentPath, entry.path);
    const finalScore = locality ? totalRaw * LOCALITY_MULTIPLIER : totalRaw;

    scored.push({
      extName,
      mode: entry.mode,
      targetNodeId: entry.nodeId,
      score: finalScore,
      rawScore: totalRaw,
      personalScore,
      personalMatches,
      confidence: scoreToConfidence(finalScore),
      matches,
      locality,
      path: entry.path,
    });
  }

  if (scored.length === 0) return null;

  // Sort by score descending, then by path depth descending (more specific wins ties)
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return pathDepth(b.path) - pathDepth(a.path);
  });

  // Apply minimum score threshold to prevent cross-domain hijacks.
  // Return the full scored list either way so callers that want to see
  // ALL candidates (like grammar debugger, chain detection) still can,
  // but `winner` is null when the top match isn't strong enough. The
  // orchestrator checks `winner` to decide "commit to an extension" —
  // null means fall through to converse.
  const topScore = scored[0].score;
  const winner = topScore >= MIN_ROUTING_SCORE ? scored[0] : null;

  return { winner, all: scored, thresholdMin: MIN_ROUTING_SCORE };
}

/**
 * Query the routing index for ALL extensions that match a message.
 * Used by the orchestrator to detect multi-extension chains.
 * Returns an array of scored matches sorted descending by score.
 * Includes the POS match details for per-domain logging.
 */
export function queryAllMatches(rootId, message, currentPath, personalVocabAll = null) {
  const scored = queryIndexScored(rootId, message, currentPath, personalVocabAll);
  if (!scored) return [];
  // Shape matches what existing callers expect (extName, mode, targetNodeId)
  // with extra fields (score, matches, locality) they can ignore or use.
  return scored.all.map(s => ({
    extName: s.extName,
    mode: s.mode,
    targetNodeId: s.targetNodeId,
    score: s.score,
    confidence: s.confidence,
    matches: s.matches,
    locality: s.locality,
  }));
}

/**
 * Get the raw index for a root. Used by the go extension for cross-tree search.
 */
export function getIndexForRoot(rootId) {
  return _indices.get(String(rootId)) || null;
}

/**
 * Get all indexed roots.
 */
export function getAllIndexedRoots() {
  return [..._indices.keys()];
}

/**
 * Invalidate a root's index. Called on structural changes.
 */
export function invalidateRoot(rootId) {
  _indices.delete(String(rootId));
}
