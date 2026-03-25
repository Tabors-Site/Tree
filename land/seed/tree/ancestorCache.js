// TreeOS Seed . AGPL-3.0 . https://treeos.ai
/**
 * Ancestor Path Cache
 *
 * One shared cache for the kernel's hottest path: walking parent chains.
 * Six resolution chains (extension scope, tool scope, mode, LLM, auth, ownership)
 * all walk the same parent hierarchy. Without caching, a tree 20 nodes deep
 * with all six traversals means 120 database queries before the AI does anything.
 *
 * With caching, one walk serves all six. Shared ancestors are shared entries.
 * The cache stores structural and configuration data that changes rarely:
 * metadata, systemRole, rootOwner, contributors, parent. It does NOT store
 * notes, note content, or user-specific permission decisions.
 *
 * Invalidation:
 *   moveNode / deleteNode:  invalidateAll() (rare operations, full clear)
 *   setExtMeta / setOwner:  invalidateNode(nodeId) + all entries containing it
 *   addContributor:         invalidateNode(nodeId) only
 *
 * Consistency within one message: snapshotAncestors() returns a frozen copy.
 * The conversation loop snapshots once at message start. All resolution chains
 * for that message read from the snapshot. One message, one consistent view.
 */

import log from "../log.js";
import Node from "../models/node.js";
import { getLandConfigValue } from "../landConfig.js";
import { ERR } from "../protocol.js";

// ── Cache storage ──

const _cache = new Map(); // nodeId -> { ancestors: [...], cachedAt: number }

// Stats for observability (pulse extension reads these)
let _hits = 0;
let _misses = 0;
let _invalidations = 0;

// Fields to cache per ancestor node. These are what the six resolution chains read.
const ANCESTOR_FIELDS = "metadata parent systemRole rootOwner contributors";

function getTTL() {
  const configured = getLandConfigValue("ancestorCacheTTL");
  if (configured && typeof configured === "number" && configured > 0) return configured;
  return 30000; // 30 seconds default
}

// ── Core functions ──

/**
 * Get the ancestor chain from a node to root.
 * Returns cached chain if fresh, otherwise walks from DB and caches.
 *
 * Each ancestor is a lean object with: _id, metadata, parent, systemRole, rootOwner, contributors.
 * The array is ordered from the node itself to root (or the last non-system node).
 *
 * @param {string} nodeId
 * @returns {Promise<Array<object>|null>} null if the starting node doesn't exist
 */
export async function getAncestorChain(nodeId) {
  if (!nodeId) return null;
  const id = String(nodeId);

  // Check cache
  const cached = _cache.get(id);
  if (cached && (Date.now() - cached.cachedAt) < getTTL()) {
    _hits++;
    return cached.ancestors;
  }

  // Cache miss. Walk from DB.
  _misses++;
  const ancestors = await walkFromDb(id);
  if (!ancestors) return null;

  // Cache the result
  _cache.set(id, { ancestors, cachedAt: Date.now() });

  // Also cache sub-paths for shared ancestors.
  // If the chain is [C, B, A, root], also cache B -> [B, A, root] and A -> [A, root].
  for (let i = 1; i < ancestors.length; i++) {
    const subId = String(ancestors[i]._id);
    if (!_cache.has(subId) || (Date.now() - _cache.get(subId).cachedAt) >= getTTL()) {
      _cache.set(subId, { ancestors: ancestors.slice(i), cachedAt: Date.now() });
    }
  }

  return ancestors;
}

/**
 * Walk the parent chain from the database.
 * Returns null if the starting node doesn't exist.
 */
async function walkFromDb(nodeId) {
  const ancestors = [];
  let cursor = nodeId;
  const visited = new Set();
  const MAX_DEPTH = 100;

  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    if (ancestors.length > MAX_DEPTH) break;

    // Check if this ancestor is already cached (shared path optimization)
    const cachedAncestor = _cache.get(String(cursor));
    if (cachedAncestor && (Date.now() - cachedAncestor.cachedAt) < getTTL()) {
      // Splice the cached tail onto our chain
      ancestors.push(...cachedAncestor.ancestors);
      _hits++;
      return ancestors;
    }

    const n = await Node.findById(cursor).select(ANCESTOR_FIELDS).lean();
    if (!n) {
      // Node not found. Return what we have if any, null if starting node.
      return ancestors.length > 0 ? ancestors : null;
    }

    // Normalize metadata to plain object for consistent access
    const meta = n.metadata instanceof Map ? Object.fromEntries(n.metadata) : (n.metadata || {});
    ancestors.push({
      _id: String(n._id),
      metadata: meta,
      parent: n.parent ? String(n.parent) : null,
      systemRole: n.systemRole || null,
      rootOwner: n.rootOwner ? String(n.rootOwner) : null,
      contributors: (n.contributors || []).map(String),
    });

    // Stop at system nodes (they're the boundary)
    if (n.systemRole) break;

    cursor = n.parent;
  }

  return ancestors.length > 0 ? ancestors : null;
}

/**
 * Snapshot the ancestor chain for conversation loop consistency.
 * Returns a frozen deep copy. All resolution chains for one message
 * read from this snapshot. The live cache can change underneath.
 *
 * @param {string} nodeId
 * @returns {Promise<Array<object>|null>}
 */
export async function snapshotAncestors(nodeId) {
  const chain = await getAncestorChain(nodeId);
  if (!chain) return null;
  // Deep copy: metadata objects are plain (not Maps), so JSON roundtrip works.
  return JSON.parse(JSON.stringify(chain));
}

// ── Resolution helpers ──
// These replace the direct DB walks in resolution chain functions.

/**
 * Resolve extension scope from a cached ancestor chain.
 * Returns { blocked: Set<string>, restricted: Map<string, string> }.
 *
 * @param {Array<object>} ancestors - from getAncestorChain or snapshotAncestors
 */
export function resolveExtensionScopeFromChain(ancestors) {
  const blocked = new Set();
  const restricted = new Map();

  for (const node of ancestors) {
    if (node.systemRole) break;
    const extConfig = node.metadata?.extensions;
    if (extConfig?.blocked && Array.isArray(extConfig.blocked)) {
      for (const name of extConfig.blocked) blocked.add(name);
    }
    if (extConfig?.restricted && typeof extConfig.restricted === "object") {
      for (const [name, access] of Object.entries(extConfig.restricted)) {
        if (!blocked.has(name) && !restricted.has(name)) {
          restricted.set(name, access);
        }
      }
    }
  }

  for (const name of blocked) restricted.delete(name);
  return { blocked, restricted };
}

/**
 * Resolve tree access from a cached ancestor chain.
 * Returns the same shape as resolveTreeAccess().
 *
 * @param {string} startNodeId - the node being accessed
 * @param {string} userId - the user requesting access
 * @param {Array<object>} ancestors - from getAncestorChain or snapshotAncestors
 */
export function resolveTreeAccessFromChain(startNodeId, userId, ancestors) {
  if (!ancestors || ancestors.length === 0) {
    return { ok: false, error: ERR.NODE_NOT_FOUND, message: "Node not found." };
  }

  let isContributor = false;
  let ownerNode = null;

  for (const node of ancestors) {
    if (node.systemRole) {
      return { ok: false, error: ERR.INVALID_TREE, message: "Invalid tree: reached system node boundary" };
    }

    // Accumulate contributors
    if (!isContributor && userId && node.contributors?.some(id => id === userId)) {
      isContributor = true;
    }

    // First rootOwner found is the ownership boundary
    if (node.rootOwner && node.rootOwner !== "SYSTEM") {
      ownerNode = node;
      break;
    }
  }

  if (!ownerNode) {
    return { ok: false, error: ERR.INVALID_TREE, message: "Invalid tree: no rootOwner found" };
  }

  const isOwner = !!(userId && ownerNode.rootOwner === userId);

  // Circuit breaker: tripped trees deny write access
  const circuit = ownerNode.metadata?.circuit;
  const isTripped = !!(circuit?.tripped);

  return {
    ok: true,
    rootId: ownerNode._id,
    isRoot: ownerNode._id === startNodeId,
    isOwner,
    isContributor,
    isTripped,
    canWrite: (isOwner || isContributor) && !isTripped,
  };
}

// ── Invalidation ──

/**
 * Invalidate a specific node and all cache entries that contain it as an ancestor.
 */
export function invalidateNode(nodeId) {
  const id = String(nodeId);
  _invalidations++;

  // Remove direct entry
  _cache.delete(id);

  // Remove any entry whose ancestors array contains this node
  for (const [key, entry] of _cache) {
    if (entry.ancestors.some(a => a._id === id)) {
      _cache.delete(key);
    }
  }
}

/**
 * Full cache clear. Used for moveNode (rare) and deleteNode.
 */
export function invalidateAll() {
  _invalidations++;
  _cache.clear();
}

/**
 * Get cache statistics for observability.
 */
export function getCacheStats() {
  return {
    size: _cache.size,
    hits: _hits,
    misses: _misses,
    invalidations: _invalidations,
    hitRate: (_hits + _misses) > 0
      ? Math.round((_hits / (_hits + _misses)) * 100)
      : 0,
  };
}

// ── Periodic cleanup ──
// Remove entries older than 2x TTL every 4x TTL. Prevents memory leak.

const _cleanupInterval = setInterval(() => {
  const ttl = getTTL();
  const cutoff = Date.now() - (ttl * 2);
  for (const [key, entry] of _cache) {
    if (entry.cachedAt < cutoff) _cache.delete(key);
  }
}, getTTL() * 4);

if (_cleanupInterval.unref) _cleanupInterval.unref();
