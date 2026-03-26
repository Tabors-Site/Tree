/**
 * Embed Core
 *
 * Vector embeddings for notes. Two storage modes:
 * - Internal: vectors in MongoDB on the Note document metadata
 * - External: vectors in a dedicated vector store (Pinecone, Qdrant, etc.)
 *
 * Cosine similarity search across the full tree.
 */

import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import Note from "../../seed/models/note.js";
import { SYSTEM_ROLE, CONTENT_TYPE } from "../../seed/protocol.js";
import { getDescendantIds } from "../../seed/tree/treeFetch.js";

let _getClientForUser = null;
export function setServices(services) {
  _getClientForUser = services.getClientForUser;
}

// ─────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────

const DEFAULTS = {
  embeddingModel: null,
  embeddingDimensions: 1536,
  similarityThreshold: 0.75,
  maxRelatedNotes: 10,
  vectorStore: "internal",
  maxContentChars: 8000,
};

export async function getEmbedConfig() {
  const configNode = await Node.findOne({ systemRole: SYSTEM_ROLE.CONFIG }).select("metadata").lean();
  if (!configNode) return { ...DEFAULTS };
  const meta = configNode.metadata instanceof Map
    ? configNode.metadata.get("embed") || {}
    : configNode.metadata?.embed || {};
  return { ...DEFAULTS, ...meta };
}

// ─────────────────────────────────────────────────────────────────────────
// EMBEDDING
// ─────────────────────────────────────────────────────────────────────────

/**
 * Generate a vector embedding for text content.
 * Uses the land's LLM connection with OpenAI-compatible embeddings endpoint.
 */
export async function generateEmbedding(text, userId) {
  if (!_getClientForUser) throw new Error("LLM service not available");
  if (!text || text.trim().length === 0) return null;

  const config = await getEmbedConfig();
  const content = text.slice(0, config.maxContentChars);

  // Resolve the embedding client. Use the configured embedding model slot,
  // or fall back to the user's default LLM.
  const { client, model } = await _getClientForUser(userId, config.embeddingModel || "main");
  if (!client) throw new Error("No LLM connection available for embedding");

  try {
    const response = await client.embeddings.create({
      model: model || "text-embedding-3-small",
      input: content,
    });

    if (!response?.data?.[0]?.embedding) {
      throw new Error("Embedding response missing data");
    }

    return response.data[0].embedding;
  } catch (err) {
    // Some endpoints don't support embeddings. Log and return null, don't crash.
    if (err.status === 404 || err.message?.includes("not found")) {
      log.debug("Embed", `Embedding endpoint not available: ${err.message}`);
      return null;
    }
    throw err;
  }
}

/**
 * Store a vector on a note's metadata.
 */
export async function storeVector(noteId, vector) {
  await Note.findByIdAndUpdate(noteId, {
    $set: {
      "metadata.embed.vector": vector,
      "metadata.embed.embeddedAt": new Date().toISOString(),
    },
  });
}

/**
 * Embed a single note. Returns the vector or null.
 */
export async function embedNote(noteId, userId) {
  const note = await Note.findById(noteId).select("content contentType").lean();
  if (!note || note.contentType !== CONTENT_TYPE.TEXT || !note.content) return null;

  const vector = await generateEmbedding(note.content, userId);
  if (!vector) return null;

  await storeVector(noteId, vector);
  return vector;
}

// ─────────────────────────────────────────────────────────────────────────
// SIMILARITY SEARCH
// ─────────────────────────────────────────────────────────────────────────

/**
 * Cosine similarity between two vectors.
 */
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Build a scoped set of node IDs for search.
 *
 * Default scope: the current node's parent subtree plus sibling branches
 * plus the tree root's direct children. Covers the most likely related
 * content without loading every note on the land.
 *
 * At 50K notes with 1536-dim vectors, a full tree scan loads ~300MB.
 * Scoped search keeps memory bounded to the subtree size.
 *
 * @param {string} nodeId - the search origin
 * @param {string} rootId - the tree root
 * @param {boolean} searchAll - if true, search the entire tree
 * @returns {string[]} node IDs to include in the search
 */
async function buildSearchScope(nodeId, rootId, searchAll) {
  if (searchAll) {
    return getDescendantIds(rootId);
  }

  const scopeIds = new Set();

  // 1. Walk up to find the nearest ancestor 2 levels above current position
  //    (parent's parent). Search that entire subtree.
  let cursor = nodeId;
  let depth = 0;
  const maxUp = 2;

  while (cursor && depth < maxUp) {
    const n = await Node.findById(cursor).select("parent").lean();
    if (!n || !n.parent) break;
    cursor = n.parent.toString();
    depth++;
  }

  // cursor is now the scoping ancestor (grandparent or as high as we got)
  const subtreeIds = await getDescendantIds(cursor);
  for (const id of subtreeIds) scopeIds.add(id);

  // 2. Add the tree root's direct children (top-level branches)
  //    so cross-branch discovery still works for major topics
  const root = await Node.findById(rootId).select("children").lean();
  if (root?.children) {
    for (const childId of root.children) {
      scopeIds.add(childId.toString());
      // And their direct children (one level deep into each branch)
      const branch = await Node.findById(childId).select("children").lean();
      if (branch?.children) {
        for (const grandchild of branch.children) {
          scopeIds.add(grandchild.toString());
        }
      }
    }
  }

  return [...scopeIds];
}

/**
 * Find notes semantically similar to a query vector.
 * Scoped search: only loads vectors from relevant subtree, not the entire land.
 *
 * @param {number[]} queryVector
 * @param {string} rootId - tree root
 * @param {object} opts - { threshold, maxResults, excludeNoteIds, nodeId, searchAll }
 * @returns {Array<{ noteId, nodeId, nodeName, similarity, snippet }>}
 */
export async function findSimilar(queryVector, rootId, opts = {}) {
  const config = await getEmbedConfig();
  const threshold = opts.threshold || config.similarityThreshold;
  const maxResults = opts.maxResults || config.maxRelatedNotes;
  const excludeIds = new Set(opts.excludeNoteIds || []);

  // Build the scoped node set
  const nodeIds = await buildSearchScope(opts.nodeId || rootId, rootId, opts.searchAll || false);

  // Load embedded notes only from scoped nodes
  const notes = await Note.find({
    nodeId: { $in: nodeIds },
    contentType: CONTENT_TYPE.TEXT,
    "metadata.embed.vector": { $exists: true },
  })
    .select("_id nodeId content metadata")
    .lean();

  // Score each note
  const scored = [];
  for (const note of notes) {
    if (excludeIds.has(note._id)) continue;

    const noteVector = note.metadata instanceof Map
      ? note.metadata.get("embed")?.vector
      : note.metadata?.embed?.vector;

    if (!noteVector) continue;

    const similarity = cosineSimilarity(queryVector, noteVector);
    if (similarity >= threshold) {
      scored.push({
        noteId: note._id,
        nodeId: note.nodeId,
        similarity: Math.round(similarity * 1000) / 1000,
        snippet: note.content.slice(0, 200),
      });
    }
  }

  // Sort by similarity descending, cap results
  scored.sort((a, b) => b.similarity - a.similarity);
  const results = scored.slice(0, maxResults);

  // Resolve node names
  for (const r of results) {
    const node = await Node.findById(r.nodeId).select("name").lean();
    r.nodeName = node?.name || r.nodeId;
  }

  return results;
}

/**
 * Find notes related to a specific node's content.
 * Scoped to the node's local neighborhood by default.
 * Pass searchAll: true for land-wide.
 */
export async function findRelatedAtNode(nodeId, userId, rootId, searchAll = false) {
  // Get the most recent note at this node
  const note = await Note.findOne({
    nodeId,
    contentType: CONTENT_TYPE.TEXT,
  })
    .sort({ createdAt: -1 })
    .select("_id content metadata")
    .lean();

  if (!note || !note.content) return [];

  // Use existing vector or generate one
  let queryVector = note.metadata instanceof Map
    ? note.metadata.get("embed")?.vector
    : note.metadata?.embed?.vector;

  if (!queryVector) {
    queryVector = await generateEmbedding(note.content, userId);
    if (!queryVector) return [];
  }

  // Find the tree root if not provided
  if (!rootId) {
    try {
      const { resolveRootNode } = await import("../../seed/tree/treeFetch.js");
      const root = await resolveRootNode(nodeId);
      rootId = root?._id;
    } catch {}
  }

  if (!rootId) return [];

  return findSimilar(queryVector, rootId, {
    excludeNoteIds: [note._id],
    nodeId,
    searchAll,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// STATUS
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get embedding coverage stats.
 */
export async function getEmbedStatus() {
  const totalNotes = await Note.countDocuments({ contentType: CONTENT_TYPE.TEXT });
  const embeddedNotes = await Note.countDocuments({
    contentType: CONTENT_TYPE.TEXT,
    "metadata.embed.vector": { $exists: true },
  });

  const coverage = totalNotes > 0 ? Math.round((embeddedNotes / totalNotes) * 1000) / 10 : 0;

  return {
    totalTextNotes: totalNotes,
    embeddedNotes,
    coveragePercent: coverage,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// REBUILD
// ─────────────────────────────────────────────────────────────────────────

/**
 * Re-embed all text notes. For use after changing embedding model.
 * Processes in batches, yields progress.
 */
export async function rebuildEmbeddings(userId, onProgress) {
  const notes = await Note.find({ contentType: CONTENT_TYPE.TEXT })
    .select("_id content")
    .lean();

  let embedded = 0;
  let failed = 0;

  for (const note of notes) {
    if (!note.content || note.content.trim().length === 0) continue;

    try {
      const vector = await generateEmbedding(note.content, userId);
      if (vector) {
        await storeVector(note._id, vector);
        embedded++;
      } else {
        failed++;
      }
    } catch (err) {
      failed++;
      log.debug("Embed", `Rebuild failed for note ${note._id}: ${err.message}`);
    }

    if (onProgress && (embedded + failed) % 50 === 0) {
      onProgress({ embedded, failed, total: notes.length });
    }
  }

  log.verbose("Embed", `Rebuild complete: ${embedded} embedded, ${failed} failed out of ${notes.length}`);
  return { embedded, failed, total: notes.length };
}
