/**
 * Evolution Core
 *
 * Tracks structural fitness metrics per node. Runs periodic analysis
 * to discover patterns in how the tree grows and which shapes succeed.
 */

import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import Note from "../../seed/models/note.js";
import { SYSTEM_ROLE, NODE_STATUS, CONTENT_TYPE } from "../../seed/protocol.js";
import { getDescendantIds } from "../../seed/tree/treeFetch.js";
import { parseJsonSafe } from "../../seed/orchestrators/helpers.js";

let _runChat = null;
let _metadata = null;
export function setRunChat(fn) { _runChat = fn; }
export function setMetadata(m) { _metadata = m; }

// ─────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────

const DEFAULTS = {
  analysisIntervalMs: 6 * 60 * 60 * 1000,  // 6 hours
  dormancyThresholdDays: 30,
  maxPatternsPerTree: 20,
  minActivityForAnalysis: 10,
};

export async function getEvolutionConfig() {
  const configNode = await Node.findOne({ systemRole: SYSTEM_ROLE.CONFIG }).select("metadata").lean();
  if (!configNode) return { ...DEFAULTS };
  const meta = configNode.metadata instanceof Map
    ? configNode.metadata.get("evolution") || {}
    : configNode.metadata?.evolution || {};
  return { ...DEFAULTS, ...meta };
}

// ─────────────────────────────────────────────────────────────────────────
// METRIC RECORDING (lightweight, per-hook)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Bump a metric counter on a node. Atomic $inc.
 */
export async function bumpMetric(nodeId, metric, amount = 1) {
  await _metadata.incExtMeta(nodeId, "evolution", metric, amount);
  await _metadata.batchSetExtMeta(nodeId, "evolution", { lastActivity: new Date().toISOString() });
}

/**
 * Record a navigation visit.
 */
export async function recordVisit(nodeId) {
  await _metadata.incExtMeta(nodeId, "evolution", "visits", 1);
  await _metadata.batchSetExtMeta(nodeId, "evolution", { lastVisited: new Date().toISOString() });
}

// ─────────────────────────────────────────────────────────────────────────
// FITNESS CALCULATION
// ─────────────────────────────────────────────────────────────────────────

/**
 * Calculate fitness metrics for a node.
 * Reads raw counters from metadata.evolution plus note/child counts.
 */
export async function calculateFitness(nodeId) {
  const node = await Node.findById(nodeId)
    .select("name type status children dateCreated metadata")
    .lean();
  if (!node) return null;

  const meta = node.metadata instanceof Map
    ? Object.fromEntries(node.metadata)
    : (node.metadata || {});
  const evo = meta.evolution || {};

  const ageMs = Date.now() - new Date(node.dateCreated).getTime();
  const ageWeeks = Math.max(1, ageMs / (7 * 24 * 60 * 60 * 1000));
  const ageDays = Math.max(1, ageMs / (24 * 60 * 60 * 1000));

  // Note count
  const noteCount = await Note.countDocuments({ nodeId, contentType: CONTENT_TYPE.TEXT });

  // Dormancy
  const lastActivity = evo.lastActivity ? new Date(evo.lastActivity).getTime() : new Date(node.dateCreated).getTime();
  const dormancyDays = Math.round((Date.now() - lastActivity) / (24 * 60 * 60 * 1000));

  // Codebook density (if codebook data exists)
  let codebookScore = 0;
  if (meta.codebook) {
    for (const [uid, data] of Object.entries(meta.codebook)) {
      if (data?.dictionary) codebookScore += Object.keys(data.dictionary).length;
    }
  }

  return {
    nodeId,
    nodeName: node.name,
    nodeType: node.type,
    status: node.status,
    ageWeeks: Math.round(ageWeeks * 10) / 10,
    activityScore: Math.round((noteCount / ageWeeks) * 10) / 10,
    cascadeScore: (evo.cascadesOriginated || 0) + (evo.cascadesReceived || 0),
    revisitScore: evo.visits || 0,
    growthScore: (node.children || []).length,
    codebookScore,
    dormancyDays,
    noteCount,
    childCount: (node.children || []).length,
    depth: evo.depth || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// TREE-WIDE ANALYSIS
// ─────────────────────────────────────────────────────────────────────────

/**
 * Run a full analysis pass on a tree. Calculates fitness for every node,
 * identifies dormant branches, and asks the AI to discover structural patterns.
 */
export async function analyzeTree(rootId, userId, username) {
  const nodeIds = await getDescendantIds(rootId);
  const config = await getEvolutionConfig();

  // Calculate fitness for every node
  const fitnessMap = [];
  const dormant = [];

  for (const nid of nodeIds) {
    const fitness = await calculateFitness(nid);
    if (!fitness) continue;
    fitnessMap.push(fitness);

    if (fitness.dormancyDays >= config.dormancyThresholdDays && fitness.status === NODE_STATUS.ACTIVE) {
      dormant.push(fitness);
    }
  }

  // Build a structural summary for the AI
  const typeCounts = {};
  const depthBuckets = {};
  const statusCounts = {};
  let totalNotes = 0;
  let totalCascade = 0;
  let totalVisits = 0;
  let avgChildren = 0;

  for (const f of fitnessMap) {
    typeCounts[f.nodeType || "untyped"] = (typeCounts[f.nodeType || "untyped"] || 0) + 1;
    statusCounts[f.status || "active"] = (statusCounts[f.status || "active"] || 0) + 1;
    totalNotes += f.noteCount;
    totalCascade += f.cascadeScore;
    totalVisits += f.revisitScore;
    avgChildren += f.childCount;
  }
  avgChildren = fitnessMap.length > 0 ? Math.round((avgChildren / fitnessMap.length) * 10) / 10 : 0;

  // Top performers and worst performers
  const byActivity = [...fitnessMap].sort((a, b) => b.activityScore - a.activityScore);
  const topPerformers = byActivity.slice(0, 5).map((f) =>
    `"${f.nodeName}" (type: ${f.nodeType || "none"}, activity: ${f.activityScore}/wk, children: ${f.childCount}, cascade: ${f.cascadeScore})`,
  );
  const bottomPerformers = byActivity.filter((f) => f.status === NODE_STATUS.ACTIVE).slice(-5).map((f) =>
    `"${f.nodeName}" (type: ${f.nodeType || "none"}, activity: ${f.activityScore}/wk, dormant: ${f.dormancyDays}d)`,
  );

  // Ask AI to discover patterns
  let patterns = [];
  if (_runChat && fitnessMap.length >= 5) {
    try {
      const prompt =
        `You are analyzing a tree's structural evolution to discover patterns.\n\n` +
        `Tree stats: ${fitnessMap.length} nodes, ${totalNotes} total notes, ${totalCascade} cascade events, ${totalVisits} visits\n` +
        `Node types: ${JSON.stringify(typeCounts)}\n` +
        `Status distribution: ${JSON.stringify(statusCounts)}\n` +
        `Average children per node: ${avgChildren}\n` +
        `Dormant nodes (${config.dormancyThresholdDays}+ days inactive): ${dormant.length}\n\n` +
        `Top active nodes:\n${topPerformers.join("\n")}\n\n` +
        `Least active nodes:\n${bottomPerformers.join("\n")}\n\n` +
        `Full node fitness data (${Math.min(fitnessMap.length, 50)} nodes):\n` +
        `${JSON.stringify(fitnessMap.slice(0, 50).map((f) => ({
          name: f.nodeName, type: f.nodeType, status: f.status,
          activity: f.activityScore, cascade: f.cascadeScore, visits: f.revisitScore,
          children: f.childCount, dormancy: f.dormancyDays, codebook: f.codebookScore,
        })), null, 0)}\n\n` +
        `Discover structural patterns. What node types, branching factors, depths, and configurations ` +
        `correlate with high activity? What structures go dormant? What works for this specific tree?\n\n` +
        `Return JSON array of pattern objects:\n` +
        `[{ "pattern": "description of what works or fails", "evidence": "the data that supports it", "suggestion": "actionable recommendation" }]\n` +
        `Maximum ${config.maxPatternsPerTree} patterns. Be specific. Use numbers.`;

      const { answer } = await _runChat({
        userId,
        username: username || "system",
        message: prompt,
        mode: "tree:respond",
        rootId,
      });

      if (answer) {
        const parsed = parseJsonSafe(answer);
        if (Array.isArray(parsed)) {
          patterns = parsed
            .filter((p) => p && typeof p.pattern === "string")
            .slice(0, config.maxPatternsPerTree)
            .map((p) => ({
              pattern: p.pattern,
              evidence: p.evidence || null,
              suggestion: p.suggestion || null,
              discoveredAt: new Date().toISOString(),
            }));
        }
      }
    } catch (err) {
      log.warn("Evolution", `Pattern analysis failed: ${err.message}`);
    }
  }

  // Write patterns to the tree root
  if (patterns.length > 0) {
    await Node.findByIdAndUpdate(rootId, {
      $set: {
        "metadata.evolution.patterns": patterns,
        "metadata.evolution.lastAnalysis": new Date().toISOString(),
      },
    });
  }

  return {
    totalNodes: fitnessMap.length,
    dormantCount: dormant.length,
    patternsDiscovered: patterns.length,
    patterns,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// READERS
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get evolution patterns for a tree root.
 */
export async function getPatterns(rootId) {
  const root = await Node.findById(rootId).select("metadata").lean();
  if (!root) return [];
  const meta = root.metadata instanceof Map
    ? root.metadata.get("evolution") || {}
    : root.metadata?.evolution || {};
  return meta.patterns || [];
}

/**
 * Get dormant branches for a tree.
 */
export async function getDormant(rootId) {
  const config = await getEvolutionConfig();
  const nodeIds = await getDescendantIds(rootId);
  const dormant = [];

  for (const nid of nodeIds) {
    const fitness = await calculateFitness(nid);
    if (!fitness) continue;
    if (fitness.dormancyDays >= config.dormancyThresholdDays && fitness.status === NODE_STATUS.ACTIVE) {
      dormant.push(fitness);
    }
  }

  return dormant.sort((a, b) => b.dormancyDays - a.dormancyDays);
}
