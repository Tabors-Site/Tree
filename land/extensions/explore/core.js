/**
 * Explore Core
 *
 * Five phases:
 * 1. Structure scan: tree skeleton, no notes
 * 2. Metadata probe: scores from evolution, memory, codebook, embed, contradiction
 * 3. Targeted note sampling: read only top candidates
 * 4. Iterative drill: deepen or backtrack based on confidence
 * 5. Map assembly: what's where, what was found, what wasn't
 */

import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import Note from "../../seed/models/note.js";
import { CONTENT_TYPE, SYSTEM_ROLE } from "../../seed/protocol.js";
import { parseJsonSafe } from "../../seed/orchestrators/helpers.js";

let _runChat = null;
export function setRunChat(fn) { _runChat = fn; }

// ─────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────

const DEFAULTS = {
  maxIterations: 5,
  maxNotesPerSample: 5,
  confidenceThreshold: 0.8,
  structureScanDepth: 6,
  maxCandidatesPerIteration: 5,
  maxTokensPerExplore: 5000,
};

export async function getExploreConfig() {
  const configNode = await Node.findOne({ systemRole: SYSTEM_ROLE.CONFIG }).select("metadata").lean();
  if (!configNode) return { ...DEFAULTS };
  const meta = configNode.metadata instanceof Map
    ? configNode.metadata.get("explore") || {}
    : configNode.metadata?.explore || {};
  return { ...DEFAULTS, ...meta };
}

// ─────────────────────────────────────────────────────────────────────────
// PHASE 1: STRUCTURE SCAN
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build a lightweight tree skeleton. Names, types, child counts, depths.
 * No note content. No metadata beyond what's needed for scoring.
 */
async function structureScan(nodeId, maxDepth) {
  const nodes = [];

  async function walk(id, depth, path) {
    if (depth > maxDepth) return;

    const node = await Node.findById(id)
      .select("_id name type status children metadata")
      .lean();
    if (!node || node.status === "trimmed") return;

    const meta = node.metadata instanceof Map
      ? Object.fromEntries(node.metadata)
      : (node.metadata || {});

    nodes.push({
      nodeId: node._id,
      name: node.name,
      type: node.type || null,
      status: node.status,
      childCount: (node.children || []).length,
      depth,
      path,
      // Quick metadata signals (no DB calls, just read what's already loaded)
      hasEvolution: !!(meta.evolution?.notesWritten || meta.evolution?.visits),
      hasMemory: !!(meta.memory?.totalInteractions),
      hasCodebook: !!meta.codebook,
      hasEmbed: !!meta.embed,
      hasContradictions: Array.isArray(meta.contradictions) && meta.contradictions.some(c => c.status === "active"),
      hasCascade: !!meta.cascade?.enabled,
      dormancyDays: meta.evolution?.lastActivity
        ? Math.round((Date.now() - new Date(meta.evolution.lastActivity).getTime()) / 86400000)
        : null,
    });

    if (node.children) {
      for (const childId of node.children) {
        await walk(childId.toString(), depth + 1, `${path}/${node.name}`);
      }
    }
  }

  await walk(nodeId, 0, "");
  return nodes;
}

// ─────────────────────────────────────────────────────────────────────────
// PHASE 2: METADATA PROBE + SCORING
// ─────────────────────────────────────────────────────────────────────────

/**
 * Score candidates based on query relevance using structure + metadata signals.
 * No LLM calls. No note reads. Just signal analysis.
 */
async function scoreCandidate(candidate, query, queryVector) {
  let score = 0;
  const signals = [];

  // Name match (strong structural hint, not dominant)
  // When embed is installed, semantic similarity is the strongest signal.
  // When embed is absent, name match naturally becomes dominant because embed contributes zero.
  const nameLower = (candidate.name || "").toLowerCase();
  const queryWords = query.toLowerCase().split(/\s+/);
  const nameMatches = queryWords.filter(w => nameLower.includes(w)).length;
  if (nameMatches > 0) {
    const nameScore = nameMatches / queryWords.length;
    score += nameScore * 0.25;
    signals.push(`name match (${nameMatches}/${queryWords.length} words)`);
  }

  // Activity signal from evolution
  if (candidate.hasEvolution && candidate.dormancyDays !== null) {
    if (candidate.dormancyDays < 7) {
      score += 0.1;
      signals.push("active (last 7 days)");
    } else if (candidate.dormancyDays < 30) {
      score += 0.05;
      signals.push("recent (last 30 days)");
    }
    // Dormant nodes get slightly deprioritized but not excluded
  }

  // Memory connections (node is connected to other relevant nodes)
  if (candidate.hasMemory) {
    score += 0.08;
    signals.push("has cascade connections");
  }

  // Codebook presence (rich interaction history)
  if (candidate.hasCodebook) {
    score += 0.1;
    signals.push("has codebook");
  }

  // Embed similarity (if both query and candidate have vectors)
  if (candidate.hasEmbed && queryVector) {
    try {
      const { getExtension } = await import("../loader.js");
      const embedExt = getExtension("embed");
      if (embedExt?.exports?.findSimilar) {
        // Get the note vector for this candidate
        const note = await Note.findOne({
          nodeId: candidate.nodeId,
          contentType: CONTENT_TYPE.TEXT,
          "metadata.embed.vector": { $exists: true },
        }).sort({ createdAt: -1 }).select("metadata").lean();

        if (note) {
          const vec = note.metadata instanceof Map
            ? note.metadata.get("embed")?.vector
            : note.metadata?.embed?.vector;
          if (vec && queryVector) {
            let dot = 0, normA = 0, normB = 0;
            for (let i = 0; i < Math.min(vec.length, queryVector.length); i++) {
              dot += vec[i] * queryVector[i];
              normA += vec[i] * vec[i];
              normB += queryVector[i] * queryVector[i];
            }
            const sim = Math.sqrt(normA) * Math.sqrt(normB) > 0
              ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
            if (sim > 0.7) {
              score += sim * 0.3;
              signals.push(`embed similarity ${(sim * 100).toFixed(0)}%`);
            }
          }
        }
      }
    } catch (err) {
      log.debug("Explore", "Embed similarity lookup failed:", err.message);
    }
  }

  // Contradictions (signals active debate)
  if (candidate.hasContradictions) {
    score += 0.05;
    signals.push("has active contradictions");
  }

  // Child count (branches with more structure are more likely to contain what you need)
  if (candidate.childCount > 0) {
    score += Math.min(candidate.childCount / 20, 0.05);
  }

  return { ...candidate, score: Math.min(score, 1.0), signals };
}

// ─────────────────────────────────────────────────────────────────────────
// PHASE 3: TARGETED NOTE SAMPLING
// ─────────────────────────────────────────────────────────────────────────

/**
 * Read recent notes from top candidates. Capped per node.
 */
async function sampleNotes(candidates, maxPerNode) {
  const samples = [];

  for (const candidate of candidates) {
    const notes = await Note.find({
      nodeId: candidate.nodeId,
      contentType: CONTENT_TYPE.TEXT,
    })
      .sort({ createdAt: -1 })
      .limit(maxPerNode)
      .select("_id content createdAt")
      .lean();

    if (notes.length > 0) {
      samples.push({
        nodeId: candidate.nodeId,
        nodeName: candidate.name,
        path: candidate.path,
        score: candidate.score,
        signals: candidate.signals,
        notes: notes.map(n => ({
          content: n.content.slice(0, 500),
          date: n.createdAt,
        })),
      });
    }
  }

  return samples;
}

// ─────────────────────────────────────────────────────────────────────────
// PHASE 4: AI EVALUATION
// ─────────────────────────────────────────────────────────────────────────

/**
 * Ask the AI to evaluate sampled notes against the query.
 * Returns findings, confidence, and drill recommendations.
 */
async function evaluateSamples(query, samples, rootId, userId) {
  if (!_runChat || samples.length === 0) return null;

  const sampleText = samples.map(s =>
    `Node: "${s.nodeName}" (path: ${s.path}, score: ${s.score})\n` +
    `Signals: ${s.signals.join(", ")}\n` +
    `Notes (${s.notes.length}):\n` +
    s.notes.map((n, i) => `  [${i + 1}] ${n.content}`).join("\n")
  ).join("\n\n");

  const prompt =
    `You are exploring a tree branch to find information.\n\n` +
    `Query: "${query}"\n\n` +
    `Sampled nodes:\n${sampleText}\n\n` +
    `Evaluate these samples. Return JSON:\n` +
    `{\n` +
    `  "findings": [\n` +
    `    { "nodeId": "...", "nodeName": "...", "relevance": 0.0-1.0, "summary": "what was found", "keyFindings": ["..."] }\n` +
    `  ],\n` +
    `  "confidence": 0.0-1.0,\n` +
    `  "drillInto": ["nodeId to explore deeper"],\n` +
    `  "gaps": ["what information is still missing"]\n` +
    `}`;

  try {
    const { answer } = await _runChat({
      userId,
      username: "system",
      message: prompt,
      mode: "tree:respond",
      rootId,
    });

    if (!answer) return null;
    return parseJsonSafe(answer);
  } catch (err) {
    log.debug("Explore", `Evaluation failed: ${err.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// MAIN EXPLORATION LOOP
// ─────────────────────────────────────────────────────────────────────────

/**
 * Run a full exploration from a starting node.
 *
 * @param {string} nodeId - starting position
 * @param {string} query - what to find
 * @param {string} userId
 * @param {object} opts - { deep, signal }
 */
export async function runExplore(nodeId, query, userId, opts = {}) {
  const config = await getExploreConfig();
  const maxIterations = opts.deep ? config.maxIterations * 2 : config.maxIterations;
  const threshold = opts.deep ? config.confidenceThreshold * 0.7 : config.confidenceThreshold;

  // Find root for runChat
  let rootId = null;
  try {
    const { resolveRootNode } = await import("../../seed/tree/treeFetch.js");
    const root = await resolveRootNode(nodeId);
    rootId = root?._id;
  } catch (err) {
    log.debug("Explore", "Root resolution failed:", err.message);
  }

  // Get query vector if embed is available
  let queryVector = null;
  try {
    const { getExtension } = await import("../loader.js");
    const embedExt = getExtension("embed");
    if (embedExt?.exports?.generateEmbedding) {
      queryVector = await embedExt.exports.generateEmbedding(query, userId);
    }
  } catch (err) {
    log.debug("Explore", "Query vector generation failed:", err.message);
  }

  // Phase 1: Structure scan
  const allNodes = await structureScan(nodeId, config.structureScanDepth);
  if (allNodes.length === 0) {
    return emptyMap(nodeId, query);
  }

  // Phase 2: Score all candidates
  const scored = [];
  for (const node of allNodes) {
    if (node.depth === 0) continue; // skip the root itself
    const result = await scoreCandidate(node, query, queryVector);
    scored.push(result);
  }
  scored.sort((a, b) => b.score - a.score);

  // Iterative exploration loop
  const explored = new Map();
  const allFindings = [];
  let confidence = 0;
  let totalNotesRead = 0;
  let iteration = 0;
  let candidates = scored.slice(0, config.maxCandidatesPerIteration);

  while (iteration < maxIterations && confidence < threshold && candidates.length > 0) {
    iteration++;

    // Phase 3: Sample notes from candidates
    const samples = await sampleNotes(
      candidates.filter(c => !explored.has(c.nodeId)),
      config.maxNotesPerSample,
    );

    for (const s of samples) {
      explored.set(s.nodeId, true);
      totalNotesRead += s.notes.length;
    }

    if (samples.length === 0) break;

    // Phase 4: AI evaluation
    const evaluation = await evaluateSamples(query, samples, rootId, userId);
    if (!evaluation) break;

    // Collect findings
    if (Array.isArray(evaluation.findings)) {
      for (const f of evaluation.findings) {
        if (f && f.nodeId) allFindings.push(f);
      }
    }

    confidence = evaluation.confidence || 0;

    // Determine next candidates (drill recommendations)
    if (Array.isArray(evaluation.drillInto) && confidence < threshold) {
      candidates = [];
      for (const drillId of evaluation.drillInto) {
        // Find children of the drill target
        const drillNode = await Node.findById(drillId).select("children").lean();
        if (!drillNode?.children) continue;
        for (const childId of drillNode.children) {
          const childStr = childId.toString();
          if (explored.has(childStr)) continue;
          const child = scored.find(s => s.nodeId === childStr);
          if (child) candidates.push(child);
          else {
            // Node not in initial scan, add with base score
            const node = await Node.findById(childStr).select("_id name type status children").lean();
            if (node) candidates.push({ nodeId: childStr, name: node.name, type: node.type, score: 0.3, signals: ["drill target"], path: "", childCount: (node.children || []).length, depth: 0 });
          }
        }
      }
    } else {
      break;
    }
  }

  // Phase 5: Assemble map
  const totalNotes = await Note.countDocuments({
    nodeId: { $in: allNodes.map(n => n.nodeId) },
    contentType: CONTENT_TYPE.TEXT,
  });

  const map = {
    query,
    rootNode: allNodes[0]?.name || nodeId,
    nodesExplored: explored.size,
    notesRead: totalNotesRead,
    totalNotesInBranch: totalNotes,
    coverage: totalNotes > 0 ? `${((totalNotesRead / totalNotes) * 100).toFixed(2)}%` : "0%",
    iterations: iteration,
    map: allFindings.sort((a, b) => (b.relevance || 0) - (a.relevance || 0)),
    unexplored: scored
      .filter(s => !explored.has(s.nodeId) && s.score > 0.1)
      .slice(0, 10)
      .map(s => ({ nodeId: s.nodeId, name: s.name, score: s.score, reason: s.signals.join(", ") || "Low relevance" })),
    gaps: allFindings.length > 0 && Array.isArray(allFindings[allFindings.length - 1]?.gaps)
      ? allFindings[allFindings.length - 1].gaps
      : [],
    confidence,
  };

  // Write map to metadata for next explore
  await Node.findByIdAndUpdate(nodeId, {
    $set: {
      "metadata.explore.lastMap": map,
      "metadata.explore.lastQuery": query,
      "metadata.explore.lastExplored": new Date().toISOString(),
    },
  });

  return map;
}

function emptyMap(nodeId, query) {
  return {
    query,
    rootNode: nodeId,
    nodesExplored: 0,
    notesRead: 0,
    totalNotesInBranch: 0,
    coverage: "0%",
    iterations: 0,
    map: [],
    unexplored: [],
    gaps: ["No nodes found below this position"],
    confidence: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// MAP ACCESS
// ─────────────────────────────────────────────────────────────────────────

export async function getExploreMap(nodeId) {
  const node = await Node.findById(nodeId).select("metadata").lean();
  if (!node) return null;
  const meta = node.metadata instanceof Map
    ? node.metadata.get("explore") || {}
    : node.metadata?.explore || {};
  return meta.lastMap || null;
}

export async function getExploreGaps(nodeId) {
  const map = await getExploreMap(nodeId);
  if (!map) return { gaps: [], unexplored: [] };
  return { gaps: map.gaps || [], unexplored: map.unexplored || [] };
}
