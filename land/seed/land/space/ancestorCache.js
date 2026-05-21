// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The parent-chain cache. My hottest path.
//
// Every resolution chain I run walks the same path: a space, then its
// parent, then its parent, up to a seed-space boundary. Stance
// authorization walks it. Extension scope walks it. Tool scope walks
// it. LLM connection, LLM config, the descriptor's per-position
// derivers — all the same walk. A tree 20 spaces deep without
// caching means dozens of database queries before any being acts.
//
// I cache the walk once and let every chain read from it. Shared
// ancestors are shared entries; one snapshot serves a whole
// conversation turn. The cache holds only what changes rarely —
// qualities, seedSpace, rootOwner, contributors, parent. It does
// NOT hold Matter content or per-caller permission decisions. Those
// belong to the call.
//
// Invalidation. Three patterns, scaled to how often each fires:
//   moveSpace / deleteSpace    → invalidateAll() (rare, full clear)
//   setQuality / setOwner      → invalidateSpace(spaceId) plus every
//                                cached chain that contains it
//   addContributor             → invalidateSpace(spaceId) only
//
// Consistency within one turn. snapshotAncestors() returns a deep
// copy. The conversation loop snapshots once at turn start; every
// resolution chain that turn reads from the same snapshot. The live
// cache may change underneath; the snapshot does not.
//
// Safety:
//   - Cache capped at MAX_ENTRIES; LRU eviction on overflow.
//   - Invalidation snapshots keys before deletion (no iterate-and-delete).
//   - TTL read once per operation for consistency.
//   - Stats reset before counter overflow.

import log from "../../system/log.js";
import Space from "../../models/space.js";
import { getLandConfigValue } from "../../landConfig.js";
import { IBP_ERR } from "../../ibp/protocol.js";
import { I_AM } from "./seedSpaces.js";

// ── Cache storage ──

const _cache = new Map(); // spaceId -> { ancestors: [...], cachedAt: number }
function MAX_ENTRIES() {
  return Number(getLandConfigValue("ancestorCacheMaxEntries")) || 50000;
}
function MAX_DEPTH() {
  return Math.max(
    10,
    Math.min(Number(getLandConfigValue("ancestorCacheMaxDepth")) || 100, 500),
  );
}
const STATS_RESET = 1_000_000_000; // reset counters before overflow

// Stats for observability (pulse extension reads these)
let _hits = 0;
let _misses = 0;
let _invalidations = 0;
let _evictions = 0;

// Fields to cache per ancestor space. These are what the resolution chains read.
// name included for buildPathString (avoids 50 sequential DB queries on deep trees).
const ANCESTOR_FIELDS =
  "name qualities parent seedSpace rootOwner contributors";

function getTTL() {
  const configured = getLandConfigValue("ancestorCacheTTL");
  if (configured && typeof configured === "number" && configured > 0)
    return configured;
  return 30000; // 30 seconds default
}

// ── Core functions ──

/**
 * Get the ancestor chain from a space to root.
 * Returns cached chain if fresh, otherwise walks from DB and caches.
 *
 * Each ancestor is a lean object with: _id, qualities, parent, seedSpace, rootOwner, contributors.
 * The array is ordered from the space itself to root (or the last non-land seed space).
 *
 * @param {string} spaceId
 * @returns {Promise<Array<object>|null>} null if the starting space doesn't exist
 */
export async function getAncestorChain(spaceId) {
  if (!spaceId) return null;
  const id = String(spaceId);
  const ttl = getTTL();

  // Check cache
  const cached = _cache.get(id);
  if (cached && Date.now() - cached.cachedAt < ttl) {
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
 * Returns null if the starting space doesn't exist.
 */
async function walkFromDb(spaceId, ttl) {
  const ancestors = [];
  let cursor = spaceId;
  const visited = new Set();

  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    if (ancestors.length > MAX_DEPTH()) {
      log.warn(
        "AncestorCache",
        `Chain depth exceeded ${MAX_DEPTH()} for ${spaceId}. Possible circular ref.`,
      );
      break;
    }

    // Check if this ancestor is already cached (shared path optimization)
    const cachedAncestor = _cache.get(String(cursor));
    if (cachedAncestor && Date.now() - cachedAncestor.cachedAt < ttl) {
      // Validate the cached tail before splicing
      if (
        Array.isArray(cachedAncestor.ancestors) &&
        cachedAncestor.ancestors.length > 0 &&
        cachedAncestor.ancestors[0]._id
      ) {
        ancestors.push(...cachedAncestor.ancestors);
        _hits++;
        return ancestors;
      }
      // Invalid cached data. Evict and continue from DB.
      _cache.delete(String(cursor));
    }

    const n = await Space.findById(cursor).select(ANCESTOR_FIELDS).lean();
    if (!n) {
      // Space not found. Return what we have if any, null if starting space.
      return ancestors.length > 0 ? ancestors : null;
    }

    // Normalize qualities to plain object for consistent access
    const quals =
      n.qualities instanceof Map
        ? Object.fromEntries(n.qualities)
        : n.qualities || {};
    ancestors.push({
      _id: String(n._id),
      name: n.name || null,
      qualities: quals,
      parent: n.parent ? String(n.parent) : null,
      seedSpace: n.seedSpace || null,
      rootOwner: n.rootOwner ? String(n.rootOwner) : null,
      contributors: (n.contributors || []).map(String),
    });

    // Stop at land seed spaces (they're the boundary)
    if (n.seedSpace) break;

    cursor = n.parent;
  }

  return ancestors.length > 0 ? ancestors : null;
}

/**
 * Snapshot the ancestor chain for conversation loop consistency.
 * Returns a deep copy. All resolution chains for one message
 * read from this snapshot. The live cache can change underneath.
 *
 * @param {string} spaceId
 * @returns {Promise<Array<object>|null>}
 */
export async function snapshotAncestors(spaceId) {
  const chain = await getAncestorChain(spaceId);
  if (!chain) return null;
  // Deep copy: qualities objects are plain (not Maps), so JSON roundtrip works.
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
  for (const space of ancestors) {
    if (space.seedSpace) break;
    const extConfig = space.qualities?.extensions;
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
 * Returns the same shape as resolveSpaceAccess().
 *
 * @param {string} startNodeId - the space being accessed
 * @param {string} beingId - the being requesting access
 * @param {Array<object>} ancestors - from getAncestorChain or snapshotAncestors
 */
export function resolveSpaceAccessFromChain(startNodeId, beingId, ancestors) {
  if (!ancestors || ancestors.length === 0) {
    return {
      ok: false,
      error: IBP_ERR.SPACE_NOT_FOUND,
      message: "Space not found.",
    };
  }

  let isContributor = false;
  let ownerNode = null;

  for (const space of ancestors) {
    if (space.seedSpace) {
      // SOURCE is a traversable system tree (live mirror of
      // land/extensions + land/seed, see code-workspace/source.js).
      // Treat .source itself as the root of its subtree so everything
      // beneath it is navigable. Read-only by default — canWrite is
      // gated on the code-workspace writeMode quality at the tool
      // handler level, not here.
      if (space.seedSpace === "source") {
        ownerNode = space;
        break;
      }
      // Every other seed role is an impassable boundary.
      return {
        ok: false,
        error: IBP_ERR.INVALID_TREE,
        message: "Invalid tree: reached land seed space boundary",
      };
    }

    // Accumulate contributors
    if (
      !isContributor &&
      beingId &&
      space.contributors?.some((id) => id === beingId)
    ) {
      isContributor = true;
    }

    // First rootOwner found is the ownership boundary
    if (space.rootOwner && space.rootOwner !== I_AM) {
      ownerNode = space;
      break;
    }
  }

  if (!ownerNode) {
    return {
      ok: false,
      error: IBP_ERR.INVALID_TREE,
      message: "Invalid tree: no rootOwner found",
    };
  }

  // .source is a land-owned system tree. Everyone on the land can read it.
  // Writes are gated elsewhere (code-workspace write-mode check).
  if (ownerNode.seedSpace === "source") {
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

  const isOwner = !!(beingId && ownerNode.rootOwner === beingId);

  // Circuit breaker: tripped trees deny write access
  const circuit = ownerNode.qualities?.circuit;
  const isTripped = !!circuit?.tripped;

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
 * Invalidate a specific space and all cache entries that contain it as an ancestor.
 * Snapshots keys before deletion to avoid iterate-and-delete.
 */
export function invalidateSpace(spaceId) {
  const id = String(spaceId);
  _invalidations++;

  // Remove direct entry
  _cache.delete(id);

  // Snapshot keys then check each. Safe against concurrent modification.
  const keys = [..._cache.keys()];
  for (const key of keys) {
    const entry = _cache.get(key);
    if (entry && entry.ancestors.some((a) => a._id === id)) {
      _cache.delete(key);
    }
  }
}

/**
 * Full cache clear. Used by moveSpace and deleteSpace (rare).
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
    hitRate:
      _hits + _misses > 0 ? Math.round((_hits / (_hits + _misses)) * 100) : 0,
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
    const cutoff = Date.now() - currentTtl * 2;
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
      log.debug(
        "AncestorCache",
        `Cleanup: ${swept} expired entries removed. ${_cache.size} remain.`,
      );
    }
    scheduleCleanup(); // re-schedule with potentially updated TTL
  }, ttl * 4);
  if (_cleanupTimer.unref) _cleanupTimer.unref();
}

scheduleCleanup();
