/**
 * Explore Core
 *
 * Five phases:
 * 1. Structure scan: tree skeleton, no notes
 * 2. Metadata probe: scores from evolution, memory, codebook, embed, contradiction
 * 3. Targeted note sampling: read only top candidates
 * 4. Iterative drill: deepen or backtrack based on confidence
 * 5. Map assembly: what's where, what was found, what wasn't
 *
 * Uses OrchestratorRuntime for abort support, locking, and step tracking.
 * Follows understanding's pipeline pattern: init(), trackStep(), runStep(), cleanup().
 */

import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import Note from "../../seed/models/note.js";
import { CONTENT_TYPE, SYSTEM_ROLE } from "../../seed/protocol.js";
import { OrchestratorRuntime } from "../../seed/orchestrators/runtime.js";

let LLM_PRIORITY;
try {
  ({ LLM_PRIORITY } = await import("../../seed/llm/conversation.js"));
} catch {
  LLM_PRIORITY = { INTERACTIVE: 2 };
}

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
 * explored map is checked to skip already-sampled nodes.
 */
async function sampleNotes(candidates, explored, maxPerNode) {
  const samples = [];

  for (const candidate of candidates) {
    if (explored.has(candidate.nodeId)) continue;

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
// EVAL PROMPT BUILDER
// ─────────────────────────────────────────────────────────────────────────

function buildEvalPrompt(query, samples, previousFindings) {
  let prompt = `Query: "${query}"\n\nSampled notes:\n`;
  for (const s of samples) {
    prompt += `\n--- ${s.nodeName} (${s.nodeId}) ---\n`;
    prompt += `Path: ${s.path}, Score: ${s.score}\n`;
    prompt += `Signals: ${s.signals.join(", ")}\n`;
    for (const note of s.notes) {
      prompt += `${note.content}\n`;
    }
  }
  if (previousFindings.length > 0) {
    prompt += `\nPrevious findings (do not repeat, build on these):\n`;
    prompt += JSON.stringify(previousFindings.map(f => ({ nodeId: f.nodeId, summary: f.summary })), null, 2);
  }
  prompt += `\n\nEvaluate these notes against the query. Return JSON with findings, confidence, drillInto, gaps.`;
  return prompt;
}

// ─────────────────────────────────────────────────────────────────────────
// MAIN EXPLORATION LOOP
// ─────────────────────────────────────────────────────────────────────────

/**
 * Run a full exploration from a starting node.
 * Creates its own OrchestratorRuntime for abort, locking, and step tracking.
 *
 * @param {string} nodeId - starting position
 * @param {string} query - what to find
 * @param {string} userId
 * @param {string} username
 * @param {object} opts - { deep, rootId }
 */
export async function runExplore(nodeId, query, userId, username, opts = {}) {
  const config = await getExploreConfig();
  const maxIterations = opts.deep ? config.maxIterations * 2 : config.maxIterations;
  const threshold = opts.deep ? config.confidenceThreshold * 0.7 : config.confidenceThreshold;

  // Find root for the runtime
  let rootId = opts.rootId || null;
  if (!rootId) {
    try {
      const { resolveRootNode } = await import("../../seed/tree/treeFetch.js");
      const root = await resolveRootNode(nodeId);
      rootId = root?._id;
    } catch (err) {
      log.debug("Explore", "Root resolution failed:", err.message);
    }
  }

  // Create runtime. Explore is a standalone pipeline, not part of the user's session.
  const rt = new OrchestratorRuntime({
    rootId: rootId || nodeId,
    userId,
    username: username || "system",
    visitorId: `explore:${userId}:${nodeId}:${Date.now()}`,
    sessionType: "EXPLORE",
    description: `Exploring: ${query}`,
    modeKeyForLlm: "tree:explore",
    lockNamespace: "explore",
    lockKey: `explore:${nodeId}`,
    llmPriority: LLM_PRIORITY?.INTERACTIVE || 2,
  });

  const ok = await rt.init(query);
  if (!ok) {
    return { error: "Exploration already in progress at this node" };
  }

  try {
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

    // ── Phase 1: Structure scan (no LLM) ─────────────────────────────────
    const startScan = Date.now();
    const allNodes = await structureScan(nodeId, config.structureScanDepth);
    rt.trackStep("tree:explore", {
      input: { phase: "structure-scan", nodeId, depth: config.structureScanDepth },
      output: { candidateCount: allNodes.length },
      startTime: startScan,
      endTime: Date.now(),
    });

    if (allNodes.length === 0) {
      rt.setResult("No nodes found", "tree:explore");
      return emptyMap(nodeId, query);
    }

    if (rt.aborted) {
      rt.setError("Exploration cancelled", "tree:explore");
      return { error: "Exploration cancelled" };
    }

    // ── Phase 2: Score all candidates (no LLM) ──────────────────────────
    const startProbe = Date.now();
    const scored = [];
    for (const node of allNodes) {
      if (node.depth === 0) continue; // skip the root itself
      const result = await scoreCandidate(node, query, queryVector);
      scored.push(result);
    }
    scored.sort((a, b) => b.score - a.score);

    rt.trackStep("tree:explore", {
      input: { phase: "metadata-probe", candidates: scored.length },
      output: { topScore: scored[0]?.score || 0 },
      startTime: startProbe,
      endTime: Date.now(),
    });

    if (rt.aborted) {
      rt.setError("Exploration cancelled", "tree:explore");
      return { error: "Exploration cancelled" };
    }

    // ── Phase 3-4: Sample + Evaluate loop ────────────────────────────────
    const explored = new Map();
    const allFindings = [];
    let allGaps = [];
    let confidence = 0;
    let totalNotesRead = 0;
    let iteration = 0;
    let candidates = scored.slice(0, config.maxCandidatesPerIteration);

    while (iteration < maxIterations && confidence < threshold && candidates.length > 0) {
      if (rt.aborted) {
        rt.setError("Exploration cancelled", "tree:explore");
        return { error: "Exploration cancelled" };
      }
      iteration++;

      // Phase 3: Sample notes (no LLM)
      const samples = await sampleNotes(candidates, explored, config.maxNotesPerSample);

      for (const s of samples) {
        explored.set(s.nodeId, true);
        totalNotesRead += s.notes.length;
      }

      if (samples.length === 0) break;

      // Phase 4: Evaluate (LLM call through runStep)
      const evalPrompt = buildEvalPrompt(query, samples, allFindings);

      let parsed = null;
      try {
        const result = await rt.runStep("tree:explore", {
          prompt: evalPrompt,
        });
        parsed = result?.parsed || null;
      } catch (err) {
        log.debug("Explore", `Evaluation step failed: ${err.message}`);
        break;
      }

      if (!parsed || !parsed.findings) {
        // LLM returned unparseable response, use what we have
        break;
      }

      // Collect findings
      if (Array.isArray(parsed.findings)) {
        for (const f of parsed.findings) {
          if (f && f.nodeId) allFindings.push(f);
        }
      }

      confidence = parsed.confidence || 0;
      if (Array.isArray(parsed.gaps)) {
        allGaps = [...allGaps, ...parsed.gaps];
      }

      // Prepare next iteration candidates from drillInto
      if (Array.isArray(parsed.drillInto) && parsed.drillInto.length > 0 && confidence < threshold) {
        candidates = [];
        for (const drillId of parsed.drillInto) {
          const drillNode = await Node.findById(drillId).select("children").lean();
          if (!drillNode?.children) continue;
          for (const childId of drillNode.children) {
            const childStr = childId.toString();
            if (explored.has(childStr)) continue;
            const child = scored.find(s => s.nodeId === childStr);
            if (child) {
              candidates.push(child);
            } else {
              // Node not in initial scan, add with base score
              const node = await Node.findById(childStr).select("_id name type status children").lean();
              if (node) {
                candidates.push({
                  nodeId: childStr, name: node.name, type: node.type,
                  score: 0.3, signals: ["drill target"], path: "",
                  childCount: (node.children || []).length, depth: 0,
                });
              }
            }
          }
        }
      } else {
        break;
      }
    }

    // ── Phase 5: Assemble map ────────────────────────────────────────────
    const totalNotes = await Note.countDocuments({
      nodeId: { $in: allNodes.map(n => n.nodeId) },
      contentType: CONTENT_TYPE.TEXT,
    });

    const coverageStr = totalNotes > 0 ? `${((totalNotesRead / totalNotes) * 100).toFixed(2)}%` : "0%";
    const map = {
      query,
      answer: `Explored ${explored.size} nodes under ${allNodes[0]?.name || nodeId}, read ${totalNotesRead} of ${totalNotes} notes (${coverageStr} coverage). Found ${allFindings.length} relevant items.${allGaps.length > 0 ? ` Gaps: ${allGaps.slice(0, 3).join("; ")}.` : ""}`,
      rootNode: allNodes[0]?.name || nodeId,
      nodesExplored: explored.size,
      notesRead: totalNotesRead,
      totalNotesInBranch: totalNotes,
      coverage: coverageStr,
      iterations: iteration,
      map: allFindings.sort((a, b) => (b.relevance || 0) - (a.relevance || 0)),
      unexplored: scored
        .filter(s => !explored.has(s.nodeId) && s.score > 0.1)
        .slice(0, 10)
        .map(s => ({ nodeId: s.nodeId, name: s.name, score: s.score, reason: s.signals.join(", ") || "Low relevance" })),
      gaps: allGaps.length > 0 ? allGaps : [],
      confidence,
    };

    // Write map to metadata for working memory
    await Node.findByIdAndUpdate(nodeId, {
      $set: {
        "metadata.explore.lastMap": map,
        "metadata.explore.lastQuery": query,
        "metadata.explore.lastExplored": new Date().toISOString(),
      },
    });

    rt.setResult(`Explored ${explored.size} nodes, read ${totalNotesRead} notes. Coverage: ${map.coverage}. ${map.gaps.length > 0 ? `Gaps: ${map.gaps.slice(0, 3).join("; ")}` : "No gaps found."}`, "tree:explore");
    return map;

  } catch (err) {
    rt.setError(err.message, "tree:explore");
    throw err;
  } finally {
    await rt.cleanup();
  }
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
