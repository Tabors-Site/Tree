/**
 * Trace Core
 *
 * Follow one concept through the entire tree chronologically.
 * Multi-step pipeline: search across all branches, then AI synthesis.
 * Uses OrchestratorRuntime for abort, locking, and step tracking.
 */

import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import Note from "../../seed/models/note.js";
import { CONTENT_TYPE } from "../../seed/protocol.js";
import { getDescendantIds } from "../../seed/tree/treeFetch.js";
import { OrchestratorRuntime } from "../../seed/orchestrators/runtime.js";

let _metadata = null;
export function configure({ metadata }) { _metadata = metadata; }

let LLM_PRIORITY;
try {
  ({ LLM_PRIORITY } = await import("../../seed/ws/conversation.js"));
} catch {
  LLM_PRIORITY = { INTERACTIVE: 2 };
}

// ─────────────────────────────────────────────────────────────────────────
// SEARCH
// ─────────────────────────────────────────────────────────────────────────

/**
 * Expand query words using codebook dictionary entries if available.
 */
async function expandQuery(query, nodeId, userId) {
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

  try {
    const { getExtension } = await import("../loader.js");
    const codebook = getExtension("codebook");
    if (!codebook?.exports?.getDictionary) return queryWords;

    const dictionary = await codebook.exports.getDictionary(nodeId, userId);
    if (!dictionary || Object.keys(dictionary).length === 0) return queryWords;

    const expanded = new Set(queryWords);
    for (const [shorthand, meaning] of Object.entries(dictionary)) {
      const shortLower = shorthand.toLowerCase();
      const meaningLower = (meaning || "").toLowerCase();
      // If any query word matches a shorthand or its meaning, expand with the other
      if (queryWords.some(w => shortLower.includes(w) || meaningLower.includes(w))) {
        // Add words from the meaning
        meaningLower.split(/\s+/).filter(w => w.length > 2).forEach(w => expanded.add(w));
        expanded.add(shortLower);
      }
    }

    return [...expanded];
  } catch {
    return queryWords;
  }
}

/**
 * Find all notes matching the query across the entire tree, chronologically.
 */
async function searchNotes(rootId, queryWords, opts = {}) {
  // Get all node IDs in this tree
  const descendantIds = await getDescendantIds(rootId, { maxResults: 10000 });
  const allIds = [rootId, ...descendantIds];

  // Build filter
  const noteQuery = {
    nodeId: { $in: allIds },
    contentType: CONTENT_TYPE.TEXT,
  };
  if (opts.since) noteQuery.createdAt = { $gte: opts.since };
  if (opts.userId) noteQuery.userId = opts.userId;

  const notes = await Note.find(noteQuery)
    .select("_id nodeId content createdAt userId")
    .sort({ createdAt: 1 }) // chronological
    .lean();

  // Score each note
  const matches = [];
  const minScore = opts.minScore || 0.3;

  for (const n of notes) {
    const content = (n.content || "").toLowerCase();
    const matchCount = queryWords.filter(w => content.includes(w)).length;
    if (matchCount === 0) continue;
    const score = matchCount / queryWords.length;
    if (score < minScore) continue;

    matches.push({
      noteId: String(n._id),
      nodeId: String(n.nodeId),
      content: n.content.slice(0, 300),
      date: n.createdAt,
      userId: n.userId,
      score,
    });
  }

  return matches;
}

/**
 * Run semantic search if embed is available and merge results.
 */
async function addSemanticResults(matches, rootId, query, userId) {
  try {
    const { getExtension } = await import("../loader.js");
    const embed = getExtension("embed");
    if (!embed?.exports?.findSimilar || !embed?.exports?.generateEmbedding) return matches;

    const queryVector = await embed.exports.generateEmbedding(query, userId);
    if (!queryVector) return matches;

    const similar = await embed.exports.findSimilar(queryVector, rootId, {
      similarityThreshold: 0.7,
      maxResults: 50,
    });

    if (!similar || similar.length === 0) return matches;

    // Merge: add semantic results not already in text matches
    const existingNotes = new Set(matches.map(m => m.noteId));
    for (const s of similar) {
      const noteId = s.noteId || null;
      if (noteId && existingNotes.has(noteId)) {
        // Boost existing match score
        const existing = matches.find(m => m.noteId === noteId);
        if (existing) existing.score = Math.min(existing.score + 0.2, 1.0);
      } else {
        matches.push({
          noteId: noteId || `embed:${s.nodeId}`,
          nodeId: s.nodeId,
          content: (s.snippet || s.content || "").slice(0, 300),
          date: s.date || null,
          userId: s.userId || null,
          score: s.similarity || 0.7,
        });
      }
    }

    // Re-sort chronologically (semantic results may not have dates)
    matches.sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(a.date) - new Date(b.date);
    });

    return matches;
  } catch (err) {
    log.debug("Trace", `Semantic search failed: ${err.message}`);
    return matches;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// MAIN PIPELINE
// ─────────────────────────────────────────────────────────────────────────

/**
 * Trace a concept through the entire tree chronologically.
 *
 * @param {string} rootId - tree root
 * @param {string} query - concept to trace
 * @param {string} userId
 * @param {string} username
 * @param {object} opts - { since, minScore, maxResults }
 */
export async function runTrace(rootId, query, userId, username, opts = {}) {
  const rt = new OrchestratorRuntime({
    rootId,
    userId,
    username: username || "system",
    visitorId: `trace:${userId}:${rootId}:${Date.now()}`,
    sessionType: "TRACE",
    description: `Tracing: ${query}`,
    modeKeyForLlm: "tree:trace",
    lockNamespace: "trace",
    lockKey: `trace:${rootId}`,
    llmPriority: LLM_PRIORITY?.INTERACTIVE || 2,
  });

  const ok = await rt.init("Starting trace");
  if (!ok) {
    return { error: "Trace already running on this tree" };
  }

  try {
    // Step 1: Expand query with codebook
    const queryWords = await expandQuery(query, rootId, userId);

    rt.trackStep("tree:trace", {
      input: { phase: "expand-query", originalQuery: query },
      output: { expandedWords: queryWords.length },
      startTime: Date.now(),
      endTime: Date.now(),
    });

    if (rt.aborted) {
      rt.setError("Trace cancelled", "tree:trace");
      return { error: "Trace cancelled" };
    }

    // Step 2: Search all notes chronologically
    const startSearch = Date.now();
    let matches = await searchNotes(rootId, queryWords, {
      since: opts.since ? new Date(opts.since) : null,
      userId: opts.filterUserId || null,
      minScore: opts.minScore || 0.3,
    });

    // Add semantic results if embed is available
    matches = await addSemanticResults(matches, rootId, query, userId);

    // Cap results
    const maxResults = opts.maxResults || 100;
    if (matches.length > maxResults) {
      matches = matches.slice(0, maxResults);
    }

    rt.trackStep("tree:trace", {
      input: { phase: "search", queryWords: queryWords.length },
      output: { matchCount: matches.length },
      startTime: startSearch,
      endTime: Date.now(),
    });

    if (matches.length === 0) {
      rt.setResult("No matches found", "tree:trace");
      return {
        query,
        matches: 0,
        origin: null,
        touchpoints: [],
        currentState: "No notes found referencing this concept.",
        unresolved: [],
        threadLength: null,
        crossBranch: false,
      };
    }

    if (rt.aborted) {
      rt.setError("Trace cancelled", "tree:trace");
      return { error: "Trace cancelled" };
    }

    // Step 3: Enrich with node names
    const nodeIds = [...new Set(matches.map(m => m.nodeId))];
    const nodes = await Node.find({ _id: { $in: nodeIds } }).select("_id name parent").lean();
    const nodeMap = new Map(nodes.map(n => [String(n._id), n]));

    for (const m of matches) {
      const node = nodeMap.get(m.nodeId);
      m.nodeName = node?.name || "unknown";
    }

    // Detect if thread crosses branches (different parent chains)
    const parentSet = new Set(nodes.map(n => n.parent ? String(n.parent) : null).filter(Boolean));
    const crossBranch = parentSet.size > 1;

    // Step 4: AI synthesis via runStep
    const threadText = matches
      .map(m => {
        const dateStr = m.date ? new Date(m.date).toISOString().slice(0, 10) : "unknown";
        return `[${dateStr}] ${m.nodeName}: "${m.content}"`;
      })
      .join("\n");

    let parsed = null;
    try {
      const result = await rt.runStep("tree:trace", {
        prompt: `Trace the thread "${query}" through this tree.

${matches.length} notes found across ${nodeIds.length} nodes, chronologically:

${threadText}

Trace how this concept evolved. Where did it start? How did it change at each stop? What's the current state? What's unresolved?

Return ONLY JSON:
{
  "origin": { "nodeId": "...", "nodeName": "...", "date": "...", "summary": "..." },
  "touchpoints": [{ "nodeId": "...", "nodeName": "...", "date": "...", "what": "..." }],
  "currentState": "where this thread stands now",
  "unresolved": ["open questions or incomplete work"],
  "threadLength": "timespan from first to last",
  "crossBranch": ${crossBranch}
}`,
      });
      parsed = result?.parsed;
    } catch (err) {
      log.debug("Trace", `Synthesis failed: ${err.message}`);
    }

    // Step 5: Build result
    const traceResult = {
      query,
      matches: matches.length,
      nodesVisited: nodeIds.length,
      origin: parsed?.origin || { nodeId: matches[0]?.nodeId, nodeName: matches[0]?.nodeName, date: matches[0]?.date, summary: "First occurrence" },
      touchpoints: parsed?.touchpoints || matches.slice(0, 20).map(m => ({ nodeId: m.nodeId, nodeName: m.nodeName, date: m.date, what: m.content.slice(0, 100) })),
      currentState: parsed?.currentState || "See touchpoints for chronological thread.",
      unresolved: parsed?.unresolved || [],
      threadLength: parsed?.threadLength || null,
      crossBranch,
      tracedAt: new Date().toISOString(),
    };

    // Write to metadata for working memory
    try {
      const rootNode = await Node.findById(rootId);
      if (rootNode) {
        const meta = _metadata.getExtMeta(rootNode, "trace") || {};
        const history = meta.history || [];
        history.unshift({
          query,
          matches: matches.length,
          nodesVisited: nodeIds.length,
          crossBranch,
          tracedAt: traceResult.tracedAt,
        });
        meta.history = history.slice(0, 10);
        meta.lastTrace = traceResult;
        await _metadata.setExtMeta(rootNode, "trace", meta);
      }
    } catch (err) {
      log.debug("Trace", `Failed to write trace metadata: ${err.message}`);
    }

    rt.setResult("Trace complete", "tree:trace");
    return traceResult;

  } catch (err) {
    rt.setError(err.message, "tree:trace");
    throw err;
  } finally {
    await rt.cleanup();
  }
}

// ─────────────────────────────────────────────────────────────────────────
// MAP ACCESS
// ─────────────────────────────────────────────────────────────────────────

export async function getTraceMap(nodeId) {
  const node = await Node.findById(nodeId).select("metadata").lean();
  if (!node) return null;
  const meta = node.metadata instanceof Map
    ? node.metadata.get("trace") || {}
    : node.metadata?.trace || {};
  return meta.lastTrace || null;
}
