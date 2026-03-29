/**
 * Scout Core
 *
 * Five search strategies running in parallel. Triangulation scoring
 * across semantic, structural, memory, codebook, and profile dimensions.
 * AI synthesis of converged findings.
 *
 * Uses OrchestratorRuntime for abort, locking, and step tracking.
 */

import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import Note from "../../seed/models/note.js";
import { CONTENT_TYPE } from "../../seed/protocol.js";
import { OrchestratorRuntime } from "../../seed/orchestrators/runtime.js";

let LLM_PRIORITY;
try {
  ({ LLM_PRIORITY } = await import("../../seed/llm/conversation.js"));
} catch {
  LLM_PRIORITY = { INTERACTIVE: 2 };
}

let _getExtension = null;
let _metadata = null;

export function setServices(core) {
  // Lazy import of extension loader to avoid circular deps at load time
  import("../loader.js").then(m => { _getExtension = m.getExtension; }).catch(() => {});
  _metadata = core.metadata;
}

function getExtension(name) {
  return _getExtension ? _getExtension(name) : null;
}

// ─────────────────────────────────────────────────────────────────────────
// STRATEGY 1: SEMANTIC SEARCH
// ─────────────────────────────────────────────────────────────────────────

async function searchSemantic(query, rootId, userId, opts) {
  const embed = getExtension("embed");
  if (!embed?.exports?.findSimilar || !embed?.exports?.generateEmbedding) {
    return { strategy: "semantic", findings: [], skipped: true, reason: "embed not installed" };
  }

  let queryVector;
  try {
    queryVector = await embed.exports.generateEmbedding(query, userId);
  } catch {
    return { strategy: "semantic", findings: [], skipped: true, reason: "embedding failed" };
  }
  if (!queryVector) return { strategy: "semantic", findings: [], skipped: true, reason: "no vector returned" };

  try {
    const similar = await embed.exports.findSimilar(queryVector, rootId, {
      similarityThreshold: opts.similarityThreshold || 0.7,
      maxResults: opts.maxFindingsPerStrategy || 10,
    });

    return {
      strategy: "semantic",
      findings: (similar || []).map(s => ({
        noteId: s.noteId || null,
        nodeId: s.nodeId,
        nodeName: s.nodeName || "",
        snippet: (s.snippet || s.content || "").slice(0, 200),
        score: s.similarity || s.score || 0,
      })),
    };
  } catch (err) {
    log.debug("Scout", `Semantic search failed: ${err.message}`);
    return { strategy: "semantic", findings: [], skipped: true, reason: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// STRATEGY 2: STRUCTURAL SEARCH
// ─────────────────────────────────────────────────────────────────────────

async function searchStructural(query, nodeId, rootId, opts) {
  try {
    // Search the ENTIRE tree, not just local neighborhood
    const allNodes = await Node.find({
      $or: [{ rootOwner: rootId }, { _id: rootId }],
    }).select("_id name").lean();

    if (!allNodes.length) return { strategy: "structural", findings: [] };

    const nodeIds = allNodes.map(n => n._id);
    const nodeNames = new Map();
    for (const n of allNodes) nodeNames.set(n._id.toString(), n.name);

    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    if (queryWords.length === 0) return { strategy: "structural", findings: [] };

    // Pre-filter in MongoDB with regex so we don't pull every note in the tree
    const escaped = queryWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const regexPattern = escaped.join("|");

    const notes = await Note.find({
      nodeId: { $in: nodeIds },
      contentType: CONTENT_TYPE.TEXT,
      content: { $regex: regexPattern, $options: "i" },
    }).sort({ createdAt: -1 }).limit(50).select("_id content nodeId createdAt").lean();

    return {
      strategy: "structural",
      findings: notes
        .map(n => {
          const content = (n.content || "").toLowerCase();
          const matches = queryWords.filter(w => content.includes(w)).length;
          return {
            noteId: String(n._id),
            nodeId: String(n.nodeId),
            nodeName: nodeNames.get(String(n.nodeId)) || "",
            snippet: (n.content || "").slice(0, 200),
            score: matches / queryWords.length,
          };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, opts.maxFindingsPerStrategy || 10),
    };
  } catch (err) {
    log.debug("Scout", `Structural search failed: ${err.message}`);
    return { strategy: "structural", findings: [] };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// STRATEGY 3: MEMORY SEARCH
// ─────────────────────────────────────────────────────────────────────────

async function searchMemory(nodeId, query, opts) {
  const longMemory = getExtension("long-memory");
  if (!longMemory?.exports?.getConnections) {
    return { strategy: "memory", findings: [], skipped: true, reason: "long-memory not installed" };
  }

  try {
    const connections = await longMemory.exports.getConnections(nodeId);
    if (!connections || connections.length === 0) {
      return { strategy: "memory", findings: [] };
    }

    const connectedIds = connections.slice(0, 10).map(c => c.nodeId || c.targetId || c);
    const notes = await Note.find({
      nodeId: { $in: connectedIds },
      contentType: CONTENT_TYPE.TEXT,
    }).sort({ createdAt: -1 }).limit(opts.maxFindingsPerStrategy || 10).select("_id content nodeId").lean();

    // Node name lookup
    const nodeNames = new Map();
    const nodeDocs = await Node.find({ _id: { $in: connectedIds } }).select("_id name").lean();
    for (const n of nodeDocs) nodeNames.set(n._id.toString(), n.name);

    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

    return {
      strategy: "memory",
      findings: notes
        .map(n => {
          const content = (n.content || "").toLowerCase();
          const matches = queryWords.filter(w => content.includes(w)).length;
          return {
            noteId: String(n._id),
            nodeId: String(n.nodeId),
            nodeName: nodeNames.get(String(n.nodeId)) || "",
            snippet: (n.content || "").slice(0, 200),
            score: matches > 0 ? (matches / queryWords.length) * 0.8 : 0.1,
          };
        })
        .filter(f => f.score > 0),
    };
  } catch (err) {
    log.debug("Scout", `Memory search failed: ${err.message}`);
    return { strategy: "memory", findings: [], skipped: true, reason: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// STRATEGY 4: CODEBOOK SEARCH
// ─────────────────────────────────────────────────────────────────────────

async function searchCodebook(nodeId, userId, query, opts) {
  const codebook = getExtension("codebook");
  if (!codebook?.exports?.getDictionary) {
    return { strategy: "codebook", findings: [], skipped: true, reason: "codebook not installed" };
  }

  try {
    const dictionary = await codebook.exports.getDictionary(nodeId, userId);
    if (!dictionary || Object.keys(dictionary).length === 0) {
      return { strategy: "codebook", findings: [] };
    }

    const queryWords = query.toLowerCase().split(/\s+/);
    const expansions = [];

    for (const [shorthand, meaning] of Object.entries(dictionary)) {
      const meaningLower = (meaning || "").toLowerCase();
      const shortLower = shorthand.toLowerCase();
      if (queryWords.some(w => meaningLower.includes(w) || shortLower.includes(w))) {
        expansions.push({ shorthand, meaning, score: 0.6 });
      }
    }

    return {
      strategy: "codebook",
      findings: expansions.map(e => ({
        noteId: null,
        nodeId: String(nodeId),
        nodeName: "",
        snippet: `Codebook: "${e.shorthand}" = "${e.meaning}"`,
        score: e.score,
      })),
    };
  } catch (err) {
    log.debug("Scout", `Codebook search failed: ${err.message}`);
    return { strategy: "codebook", findings: [], skipped: true, reason: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// STRATEGY 5: PROFILE SEARCH
// ─────────────────────────────────────────────────────────────────────────

async function searchProfile(userId, query, opts) {
  const inverseTree = getExtension("inverse-tree");
  if (!inverseTree?.exports?.getInverseData) {
    return { strategy: "profile", findings: [], skipped: true, reason: "inverse-tree not installed", profileWeights: {} };
  }

  try {
    const data = await inverseTree.exports.getInverseData(userId);
    const profile = data?.profile;
    if (!profile) return { strategy: "profile", findings: [], profileWeights: {} };

    return {
      strategy: "profile",
      findings: [],
      profileWeights: profile.topics || profile.interests || {},
      activeHours: profile.activeHours || null,
    };
  } catch (err) {
    log.debug("Scout", `Profile search failed: ${err.message}`);
    return { strategy: "profile", findings: [], skipped: true, reason: err.message, profileWeights: {} };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// TRIANGULATION + SYNTHESIS
// ─────────────────────────────────────────────────────────────────────────

function emptyResult(query) {
  return {
    query,
    angles: [],
    strategiesUsed: [],
    strategiesSkipped: [],
    findings: [],
    synthesis: "No findings. The tree has no data matching this query.",
    confidence: 0,
    citations: [],
    gaps: ["No data found for this query"],
    scoutedAt: new Date().toISOString(),
  };
}

/**
 * Run a full scout from a starting node.
 *
 * @param {string} nodeId - starting position
 * @param {string} query - what to find
 * @param {string} userId
 * @param {string} username
 * @param {object} opts - { rootId, similarityThreshold, maxFindingsPerAngle, maxScoutHistory }
 */
export async function runScout(nodeId, query, userId, username, opts = {}) {
  const rt = new OrchestratorRuntime({
    rootId: opts.rootId || nodeId,
    userId,
    username: username || "system",
    visitorId: `scout:${userId}:${nodeId}:${Date.now()}`,
    sessionType: "SCOUT",
    description: `Scouting: ${query}`,
    modeKeyForLlm: "tree:scout",
    lockNamespace: "scout",
    lockKey: `scout:${nodeId}`,
    llmPriority: LLM_PRIORITY?.INTERACTIVE || 2,
  });

  const ok = await rt.init(query);
  if (!ok) {
    return { error: "Scout already running at this node" };
  }

  try {
    // Step 1: Decompose query into search angles
    let angles = null;
    try {
      const result = await rt.runStep("tree:scout", {
        prompt: `Decompose this research question into 3-5 independent search angles. Each angle should find different relevant information.

Query: "${query}"

Return ONLY JSON:
{ "angles": ["angle 1 description", "angle 2", ...] }`,
      });
      angles = result?.parsed;
    } catch (err) {
      log.debug("Scout", `Angle decomposition failed: ${err.message}`);
    }

    if (!angles?.angles) {
      // Fallback: use query as the single angle
      angles = { angles: [query] };
    }

    rt.trackStep("tree:scout", {
      input: { phase: "decompose", query },
      output: { angleCount: angles.angles.length },
      startTime: Date.now(),
      endTime: Date.now(),
    });

    if (rt.aborted) {
      rt.setError("Scout cancelled", "tree:scout");
      return { error: "Scout cancelled" };
    }

    // Step 2: Run all five strategies in parallel
    const rootId = opts.rootId || nodeId;
    const strategyOpts = {
      similarityThreshold: opts.similarityThreshold || 0.7,
      maxFindingsPerStrategy: opts.maxFindingsPerAngle || 10,
    };

    const startStrategies = Date.now();
    const [semantic, structural, memory, codebook, profile] = await Promise.all([
      searchSemantic(query, rootId, userId, strategyOpts),
      searchStructural(query, nodeId, rootId, strategyOpts),
      searchMemory(nodeId, query, strategyOpts),
      searchCodebook(nodeId, userId, query, strategyOpts),
      searchProfile(userId, query, strategyOpts),
    ]);

    const allStrategies = [semantic, structural, memory, codebook, profile];

    rt.trackStep("tree:scout", {
      input: { phase: "strategies", strategiesRun: 5 },
      output: {
        semantic: semantic.findings.length,
        structural: structural.findings.length,
        memory: memory.findings.length,
        codebook: codebook.findings.length,
        skipped: allStrategies.filter(s => s.skipped).map(s => s.strategy),
      },
      startTime: startStrategies,
      endTime: Date.now(),
    });

    if (rt.aborted) {
      rt.setError("Scout cancelled", "tree:scout");
      return { error: "Scout cancelled" };
    }

    // Step 3: Convergence scoring
    // Merge all findings, deduplicate by noteId, merge strategy lists
    const allFindings = [
      ...semantic.findings.map(f => ({ ...f, strategies: ["semantic"] })),
      ...structural.findings.map(f => ({ ...f, strategies: ["structural"] })),
      ...memory.findings.map(f => ({ ...f, strategies: ["memory"] })),
      ...codebook.findings.map(f => ({ ...f, strategies: ["codebook"] })),
    ];

    const findingMap = new Map();
    for (const f of allFindings) {
      const key = f.noteId || `${f.nodeId}:${(f.snippet || "").slice(0, 50)}`;
      if (findingMap.has(key)) {
        const existing = findingMap.get(key);
        existing.strategies = [...new Set([...existing.strategies, ...f.strategies])];
        existing.score = Math.max(existing.score, f.score);
      } else {
        findingMap.set(key, { ...f });
      }
    }

    // Apply convergence: more strategies = higher score
    const contentStrategyCount = 4; // semantic, structural, memory, codebook
    const scored = [...findingMap.values()].map(f => {
      const convergence = f.strategies.length / contentStrategyCount;
      f.finalScore = convergence * 0.4 + f.score * 0.6;
      return f;
    }).sort((a, b) => b.finalScore - a.finalScore);

    // Apply profile weights if available
    const profileWeights = profile.profileWeights || {};
    if (Object.keys(profileWeights).length > 0) {
      for (const f of scored) {
        const snippet = (f.snippet || "").toLowerCase();
        for (const [topic, weight] of Object.entries(profileWeights)) {
          if (snippet.includes(topic.toLowerCase())) {
            f.finalScore *= (1 + (weight || 0) * 0.1);
          }
        }
      }
      scored.sort((a, b) => b.finalScore - a.finalScore);
    }

    if (rt.aborted) {
      rt.setError("Scout cancelled", "tree:scout");
      return { error: "Scout cancelled" };
    }

    // Step 4: AI synthesis
    const top = scored.slice(0, opts.maxFindingsPerAngle || 10);

    const usedStrategies = allStrategies.filter(s => !s.skipped).map(s => s.strategy);
    const synthesisPrompt = `Original query: "${query}"

Search angles: ${JSON.stringify(angles.angles)}

Findings from ${usedStrategies.length} search strategies (${scored.length} total, showing top ${top.length}):

${top.map(f => `[${f.strategies.join("+")}] score=${f.finalScore.toFixed(2)} node="${f.nodeName}" snippet="${f.snippet}"`).join("\n")}

${codebook.findings.length > 0 ? `\nCodebook terms found: ${codebook.findings.map(f => f.snippet).join(", ")}` : ""}

Synthesize findings into a direct answer. Cite specific node names. Name any gaps.

Return JSON:
{ "synthesis": "your answer here", "confidence": 0.0-1.0, "citations": ["nodeName1", "nodeName2"], "gaps": ["what is missing"] }`;

    let synthesis = null;
    let rawSynthesis = null;
    try {
      const result = await rt.runStep("tree:scout", {
        prompt: synthesisPrompt,
      });
      synthesis = result?.parsed;
      rawSynthesis = result?.raw?.content || result?.raw || null;
    } catch (err) {
      log.debug("Scout", `Synthesis failed: ${err.message}`);
    }

    // Step 5: Build result
    const answer = synthesis?.synthesis
      || (typeof rawSynthesis === "string" && rawSynthesis.length > 0 ? rawSynthesis : null)
      || (top.length > 0
        ? `Found ${top.length} results but synthesis failed. Top match: "${top[0].snippet}" (${top[0].nodeName})`
        : "No findings. The tree has no data matching this query.");

    const result = {
      query,
      answer,
      angles: angles.angles,
      strategiesUsed: usedStrategies,
      strategiesSkipped: allStrategies
        .filter(s => s.skipped)
        .map(s => ({ strategy: s.strategy, reason: s.reason })),
      findings: top,
      synthesis: answer,
      confidence: synthesis?.confidence || 0,
      citations: synthesis?.citations || [],
      gaps: synthesis?.gaps || [],
      scoutedAt: new Date().toISOString(),
    };

    // Write to metadata for history and gap accumulation
    try {
      const node = await Node.findById(nodeId);
      if (node) {
        const meta = _metadata.getExtMeta(node, "scout") || {};
        const history = meta.history || [];
        history.unshift({
          query,
          confidence: result.confidence,
          gapCount: result.gaps.length,
          strategiesUsed: result.strategiesUsed.length,
          findingsCount: top.length,
          scoutedAt: result.scoutedAt,
        });
        meta.history = history.slice(0, opts.maxScoutHistory || 20);
        // Accumulate gaps (deduped)
        const existingGaps = new Set(meta.gaps || []);
        for (const g of result.gaps) existingGaps.add(g);
        meta.gaps = [...existingGaps].slice(0, 50);
        await _metadata.setExtMeta(node, "scout", meta);
      }
    } catch (err) {
      log.debug("Scout", `Failed to write scout metadata: ${err.message}`);
    }

    rt.setResult(answer, "tree:scout");
    return result;

  } catch (err) {
    rt.setError(err.message, "tree:scout");
    throw err;
  } finally {
    await rt.cleanup();
  }
}

// ─────────────────────────────────────────────────────────────────────────
// HISTORY + GAPS ACCESS
// ─────────────────────────────────────────────────────────────────────────

export async function getScoutHistory(nodeId) {
  const node = await Node.findById(nodeId).select("metadata").lean();
  if (!node) return [];
  const meta = node.metadata instanceof Map
    ? node.metadata.get("scout") || {}
    : node.metadata?.scout || {};
  return meta.history || [];
}

export async function getScoutGaps(nodeId) {
  const node = await Node.findById(nodeId).select("metadata").lean();
  if (!node) return [];
  const meta = node.metadata instanceof Map
    ? node.metadata.get("scout") || {}
    : node.metadata?.scout || {};
  return meta.gaps || [];
}
