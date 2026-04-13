// TreeOS Seed . AGPL-3.0 . https://treeos.ai
/**
 * Ancestor Path Cache
 *
 * One shared cache for the kernel's hottest path: walking parent chains.
 * Five resolution chains (extension scope, tool scope, mode, LLM connection, LLM config)
 * plus auth and ownership all walk the same parent hierarchy. Without caching,
 * a tree 20 nodes deep means dozens of database queries before the AI does anything.
 *
 * With caching, one walk serves all chains. Shared ancestors are shared entries.
 * The cache stores structural and configuration data that changes rarely:
 * metadata, systemRole, rootOwner, contributors, parent. It does NOT store
 * notes, note content, or user-specific permission decisions.
 *
 * Invalidation:
 *   moveNode / deleteNode:  invalidateAll() (rare operations, full clear)
 *   setExtMeta / setOwner:  invalidateNode(nodeId) + all entries containing it
 *   addContributor:         invalidateNode(nodeId) only
 *
 * Consistency within one message: snapshotAncestors() returns a deep copy.
 * The conversation loop snapshots once at message start. All resolution chains
 * for that message read from the snapshot. One message, one consistent view.
 *
 * Safety:
 *   - Cache capped at MAX_ENTRIES. LRU eviction on overflow.
 *   - Invalidation snapshots keys before deletion (no iterate-and-delete).
 *   - TTL read once per operation for consistency.
 *   - Stats reset at 1B to prevent overflow.
 */

import log from "../log.js";
import Node from "../models/node.js";
import { getLandConfigValue } from "../landConfig.js";
import { ERR, SYSTEM_OWNER } from "../protocol.js";

// ── Cache storage ──

const _cache = new Map(); // nodeId -> { ancestors: [...], cachedAt: number }
function MAX_ENTRIES() { return Number(getLandConfigValue("ancestorCacheMaxEntries")) || 50000; }
function MAX_DEPTH() { return Math.max(10, Math.min(Number(getLandConfigValue("ancestorCacheMaxDepth")) || 100, 500)); }
const STATS_RESET = 1_000_000_000; // reset counters before overflow

// Stats for observability (pulse extension reads these)
let _hits = 0;
let _misses = 0;
let _invalidations = 0;
let _evictions = 0;

// Fields to cache per ancestor node. These are what the resolution chains read.
// name included for buildPathString (avoids 50 sequential DB queries on deep trees).
const ANCESTOR_FIELDS = "name metadata parent systemRole rootOwner contributors";

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
  const ttl = getTTL();

  // Check cache
  const cached = _cache.get(id);
  if (cached && (Date.now() - cached.cachedAt) < ttl) {
    _hits++;
    return cached.ancestors;
  }

  // Cache miss. Walk from DB.
  _misses++;
  const ancestors = await walkFromDb(id, ttl);
  if (!ancestors) return null;

  // Cache the result (with eviction if at capacity)
  cacheEntry(id, ancestors);

  // Also cache sub-paths for shared ancestors.
  // If the chain is [C, B, A, root], also cache B -> [B, A, root] and A -> [A, root].
  // Cap sub-path caching to avoid flooding from deep chains.
  const maxSubPaths = Math.min(ancestors.length - 1, 10);
  for (let i = 1; i <= maxSubPaths; i++) {
    const subId = String(ancestors[i]._id);
    if (!_cache.has(subId)) {
      cacheEntry(subId, ancestors.slice(i));
    }
  }

  return ancestors;
}

/**
 * Cache an entry with LRU eviction on overflow.
 */
function cacheEntry(id, ancestors) {
  // Evict oldest entries if at capacity
  if (_cache.size >= MAX_ENTRIES() && !_cache.has(id)) {
    // Delete the first (oldest) entry. Map preserves insertion order.
    const oldest = _cache.keys().next().value;
    _cache.delete(oldest);
    _evictions++;
  }
  _cache.set(id, { ancestors, cachedAt: Date.now() });
}

/**
 * Walk the parent chain from the database.
 * Returns null if the starting node doesn't exist.
 */
async function walkFromDb(nodeId, ttl) {
  const ancestors = [];
  let cursor = nodeId;
  const visited = new Set();

  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    if (ancestors.length > MAX_DEPTH()) {
      log.warn("AncestorCache", `Chain depth exceeded ${MAX_DEPTH()} for ${nodeId}. Possible circular ref.`);
      break;
    }

    // Check if this ancestor is already cached (shared path optimization)
    const cachedAncestor = _cache.get(String(cursor));
    if (cachedAncestor && (Date.now() - cachedAncestor.cachedAt) < ttl) {
      // Validate the cached tail before splicing
      if (Array.isArray(cachedAncestor.ancestors) && cachedAncestor.ancestors.length > 0 && cachedAncestor.ancestors[0]._id) {
        ancestors.push(...cachedAncestor.ancestors);
        _hits++;
        return ancestors;
      }
      // Invalid cached data. Evict and continue from DB.
      _cache.delete(String(cursor));
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
      name: n.name || null,
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
 * Returns a deep copy. All resolution chains for one message
 * read from this snapshot. The live cache can change underneath.
 *
 * @param {string} nodeId
 * @returns {Promise<Array<object>|null>}
 */
export async function snapshotAncestors(nodeId) {
  const chain = await getAncestorChain(nodeId);
  if (!chain) return null;
  // Deep copy: metadata objects are plain (not Maps), so JSON roundtrip works.
  // Lean documents from Mongoose are pure JSON-safe objects.
  return JSON.parse(JSON.stringify(chain));
}

// ── Resolution helpers ──
// These replace the direct DB walks in resolution chain functions.

/**
 * Resolve extension scope from a cached ancestor chain.
 * Returns { blocked: Set<string>, restricted: Map<string, string>, allowed: Set<string> }.
 *
 * Two modes:
 * - Global extensions: active unless found in blocked[] walking up.
 * - Confined extensions: inactive unless found in allowed[] walking up.
 *   If not allowed, added to blocked set so all downstream checks work.
 *   If allowed but also blocked further down, blocked wins.
 *
 * @param {Array<object>} ancestors - from getAncestorChain or snapshotAncestors
 * @param {Set<string>} [confinedExtensions] - set of extension names with scope: "confined"
 */
export function resolveExtensionScopeFromChain(ancestors, confinedExtensions) {
  const blocked = new Set();
  const restricted = new Map();
  const allowed = new Set();

  // First pass: accumulate blocked[], restricted{}, and allowed[]
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
    if (extConfig?.allowed && Array.isArray(extConfig.allowed)) {
      for (const name of extConfig.allowed) allowed.add(name);
    }
  }

  // Second pass: confined extensions not in allowed[] are blocked
  if (confinedExtensions && confinedExtensions.size > 0) {
    for (const name of confinedExtensions) {
      if (!allowed.has(name)) {
        blocked.add(name);
      }
    }
  }

  for (const name of blocked) restricted.delete(name);
  return { blocked, restricted, allowed };
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
      // SOURCE is a traversable system tree (live mirror of
      // land/extensions + land/seed, see code-workspace/source.js).
      // Treat .source itself as the root of its subtree so everything
      // beneath it is navigable. Read-only by default — canWrite is
      // gated on the code-workspace writeMode metadata at the tool
      // handler level, not here.
      if (node.systemRole === "source") {
        ownerNode = node;
        break;
      }
      // Every other system role is an impassable boundary.
      return { ok: false, error: ERR.INVALID_TREE, message: "Invalid tree: reached system node boundary" };
    }

    // Accumulate contributors
    if (!isContributor && userId && node.contributors?.some(id => id === userId)) {
      isContributor = true;
    }

    // First rootOwner found is the ownership boundary
    if (node.rootOwner && node.rootOwner !== SYSTEM_OWNER) {
      ownerNode = node;
      break;
    }
  }

  if (!ownerNode) {
    return { ok: false, error: ERR.INVALID_TREE, message: "Invalid tree: no rootOwner found" };
  }

  // .source is a land-owned system tree. Everyone on the land can read it.
  // Writes are gated elsewhere (code-workspace write-mode check).
  if (ownerNode.systemRole === "source") {
    return {
      ok: true,
      rootId: ownerNode._id,
      isRoot: ownerNode._id === startNodeId,
      isOwner: false,
      isContributor: false,
      isTripped: false,
      canWrite: false,
    };
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
 * Snapshots keys before deletion to avoid iterate-and-delete.
 */
export function invalidateNode(nodeId) {
  const id = String(nodeId);
  _invalidations++;

  // Remove direct entry
  _cache.delete(id);

  // Snapshot keys then check each. Safe against concurrent modification.
  const keys = [..._cache.keys()];
  for (const key of keys) {
    const entry = _cache.get(key);
    if (entry && entry.ancestors.some(a => a._id === id)) {
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
  // Reset counters before they overflow
  if (_hits > STATS_RESET || _misses > STATS_RESET) {
    _hits = 0;
    _misses = 0;
  }

  return {
    size: _cache.size,
    maxSize: MAX_ENTRIES(),
    hits: _hits,
    misses: _misses,
    invalidations: _invalidations,
    evictions: _evictions,
    hitRate: (_hits + _misses) > 0
      ? Math.round((_hits / (_hits + _misses)) * 100)
      : 0,
  };
}

// ── Periodic cleanup ──
// Remove entries older than 2x TTL. Self-adjusting: re-schedules with
// current TTL each time, so runtime config changes take effect.

let _cleanupTimer = null;

function scheduleCleanup() {
  const ttl = getTTL();
  _cleanupTimer = setTimeout(() => {
    const currentTtl = getTTL();
    const cutoff = Date.now() - (currentTtl * 2);
    // Snapshot keys before deletion
    const keys = [..._cache.keys()];
    let swept = 0;
    for (const key of keys) {
      const entry = _cache.get(key);
      if (entry && entry.cachedAt < cutoff) {
        _cache.delete(key);
        swept++;
      }
    }
    if (swept > 0) {
      log.debug("AncestorCache", `Cleanup: ${swept} expired entries removed. ${_cache.size} remain.`);
    }
    scheduleCleanup(); // re-schedule with potentially updated TTL
  }, ttl * 4);
  if (_cleanupTimer.unref) _cleanupTimer.unref();
}

scheduleCleanup();
