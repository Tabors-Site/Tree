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
// qualities, heavenSpace, members, parent. It does
// NOT hold Matter content or per-caller permission decisions. Those
// belong to the call.
//
// Invalidation. Two patterns, scaled to how often each fires:
//   moveSpace / deleteSpace    → invalidateAll() (rare, full clear)
//   setQuality / setOwner      → invalidateSpace(spaceId) plus every
//                                cached chain that contains it
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

import log from "../../seedReality/log.js";
import { getInternalConfigValue } from "../../internalConfig.js";
import { IBP_ERR } from "../../ibp/protocol.js";
import { I_AM } from "../being/seedBeings.js";

// ── Cache storage ──

// Cache key is `${branch}:${spaceId}` so each branch holds its own
// view of every chain. Branches that haven't reparented anything still
// pay one lineage walk to populate the first time, then hit cache.
const _cache = new Map(); // "branch:spaceId" -> { ancestors: [...], cachedAt: number }
function _cacheKey(branch, spaceId) {
  return `${String(branch || "0")}:${String(spaceId)}`;
}
function MAX_ENTRIES() {
  return Number(getInternalConfigValue("ancestorCacheMaxEntries")) || 50000;
}
function MAX_DEPTH() {
  return Math.max(
    10,
    Math.min(Number(getInternalConfigValue("ancestorCacheMaxDepth")) || 100, 500),
  );
}
const STATS_RESET = 1_000_000_000; // reset counters before overflow

// Stats for observability (pulse extension reads these)
let _hits = 0;
let _misses = 0;
let _invalidations = 0;
let _evictions = 0;

function getTTL() {
  const configured = getInternalConfigValue("ancestorCacheTTL");
  if (configured && typeof configured === "number" && configured > 0)
    return configured;
  return 30000; // 30 seconds default
}

// ── Core functions ──

/**
 * Get the ancestor chain from a space to root, on a given branch.
 * Returns cached chain if fresh, otherwise walks from DB and caches.
 *
 * Each ancestor is a lean object with: _id, qualities, parent,
 * heavenSpace, members. The array is ordered from the
 * space itself to root (or the last non-place heaven space).
 *
 * Branch-aware: each branch holds its own cached view of every chain.
 * The walk uses `loadOrFold` so branches that haven't reparented an
 * ancestor inherit main's value transparently; branches that HAVE
 * reparented see their divergent parent. Reads on a fresh branch pay
 * one lineage walk per ancestor the first time, then hit cache.
 *
 * Branch is REQUIRED . no default. A missing branch arg falls
 * through to assertBranch in loadOrFold which throws loud, so silent
 * main-bias on a branched caller surfaces as a test failure or
 * runtime error rather than a quietly-wrong chain.
 *
 * @param {string} spaceId
 * @param {string} branch
 * @returns {Promise<Array<object>|null>} null if the starting space doesn't exist on this branch
 */
export async function getAncestorChain(spaceId, branch) {
  if (!spaceId) return null;
  const id = String(spaceId);
  const ttl = getTTL();
  const key = _cacheKey(branch, id);

  // Check cache
  const cached = _cache.get(key);
  if (cached && Date.now() - cached.cachedAt < ttl) {
    _hits++;
    return cached.ancestors;
  }

  // Cache miss. Walk from DB.
  _misses++;
  const ancestors = await walkFromDb(id, ttl, branch);
  if (!ancestors) return null;

  // Cache the result (with eviction if at capacity)
  cacheEntry(key, ancestors);

  // Also cache sub-paths for shared ancestors on this branch.
  // If the chain is [C, B, A, root], also cache B -> [B, A, root] and A -> [A, root].
  // Cap sub-path caching to avoid flooding from deep chains.
  const maxSubPaths = Math.min(ancestors.length - 1, 10);
  for (let i = 1; i <= maxSubPaths; i++) {
    const subKey = _cacheKey(branch, ancestors[i]._id);
    if (!_cache.has(subKey)) {
      cacheEntry(subKey, ancestors.slice(i));
    }
  }

  return ancestors;
}

/**
 * Cache an entry with LRU eviction on overflow.
 * key is the full `branch:spaceId` cache key.
 */
function cacheEntry(key, ancestors) {
  // Evict oldest entries if at capacity
  if (_cache.size >= MAX_ENTRIES() && !_cache.has(key)) {
    // Delete the first (oldest) entry. Map preserves insertion order.
    const oldest = _cache.keys().next().value;
    _cache.delete(oldest);
    _evictions++;
  }
  _cache.set(key, { ancestors, cachedAt: Date.now() });
}

/**
 * Walk the parent chain from the database on the given branch.
 * Returns null if the starting space doesn't exist.
 */
async function walkFromDb(spaceId, ttl, branch) {
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

    // Check if this ancestor is already cached on THIS branch (shared
    // path optimization). Each branch's cache entry is keyed
    // separately so divergent reparents on one branch don't bleed
    // into another's cached chain.
    const subKey = _cacheKey(branch, cursor);
    const cachedAncestor = _cache.get(subKey);
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
      _cache.delete(subKey);
    }

    // loadOrFold (not loadProjection): on a branch where this
    // ancestor hasn't been touched, the slot is inherited from main
    // (or the nearest parent branch with a divergent fact). Bare
    // loadProjection would return null for any inherited ancestor
    // and the walk would stop at the deepest branch-divergent space,
    // returning a truncated chain. loadOrFold walks the lineage so
    // the branch sees its full effective ancestry.
    const { loadOrFold } = await import("../projections.js");
    const _slot = await loadOrFold("space", cursor, branch);
    const n = _slot ? {
      _id: _slot.id,
      name: _slot.state?.name,
      qualities: _slot.state?.qualities,
      parent: _slot.state?.parent || null,
      heavenSpace: _slot.state?.heavenSpace,
      members: _slot.state?.members,
    } : null;
    if (!n) {
      // Space not found. Return what we have if any, null if starting space.
      return ancestors.length > 0 ? ancestors : null;
    }

    // Normalize qualities to plain object for consistent access
    const quals =
      n.qualities instanceof Map
        ? Object.fromEntries(n.qualities)
        : n.qualities || {};
    // Normalize the members map for the access walker. Mongoose Maps
    // serialize to plain objects in lean reads, but hydrated docs
    // hand back actual Maps; the walker reads plain objects.
    const mem = (() => {
      const m = n.members;
      if (!m) return {};
      if (m instanceof Map) {
        const out = {};
        for (const [k, v] of m.entries()) out[k] = Array.isArray(v) ? v.map(String) : [];
        return out;
      }
      if (typeof m === "object") {
        const out = {};
        for (const k of Object.keys(m)) {
          if (Array.isArray(m[k])) out[k] = m[k].map(String);
        }
        return out;
      }
      return {};
    })();
    ancestors.push({
      _id: String(n._id),
      name: n.name || null,
      qualities: quals,
      parent: n.parent,
      heavenSpace: n.heavenSpace || null,
      members: mem,
    });

    // Continue past any intermediate heaven space. The loop ends
    // naturally when we reach the place root (parent === null) so
    // every chain walk reaches the place root's qualities. The
    // role-walk authorize (seed/RolesAreAuth.md) uses this chain to
    // find role specs (qualities.roles[name]) by walking up from a
    // grant's anchor; stopping the walk at a heaven space would
    // silently strip foundational roles hosted on the place root
    // whenever a write targets `.config`, `.tools`, etc.
    //
    // Consumers that DO want a per-domain boundary (e.g.
    // resolveExtensionScopeFromChain for extension blocked/allowed
    // walks) carry their own break on `heavenSpace` over the returned
    // chain; that boundary stays where it belongs, at the consumer,
    // not at the walker.
    cursor = n.parent;
  }

  return ancestors.length > 0 ? ancestors : null;
}

/**
 * Snapshot the ancestor chain for conversation loop consistency.
 * Returns a deep copy. All resolution chains for one message read
 * from this snapshot. The live cache can change underneath.
 *
 * Branch is REQUIRED . see getAncestorChain.
 *
 * @param {string} spaceId
 * @param {string} branch
 * @returns {Promise<Array<object>|null>}
 */
export async function snapshotAncestors(spaceId, branch) {
  const chain = await getAncestorChain(spaceId, branch);
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
    if (space.heavenSpace) break;
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
 *
 * Reads each space's `members` map. Under RolesAreAuth (seed/RolesAreAuth.md)
 * the role-walk gates verb calls; this helper surfaces only the
 * baseline ownership + membership signals that descriptor enrichment
 * and circuit-breaker code consult directly. Authorize itself does
 * NOT consume this — it walks `qualities.rolesGranted` against
 * `qualities.roles[<name>]` instead.
 *
 * Returns:
 *
 *   ok, rootId, isRoot
 *   isOwner            singleton owner class match on the closest
 *                      space that has one (the ownership boundary)
 *   isAngel            (heaven path only) member of heaven's angel class
 *                      — for the legacy bridge while role-grant
 *                      migration finishes
 *   memberClasses      [string] union of every class the being is in
 *                      across the walked chain (owner + operator-
 *                      authored classes). Useful for display/enrichment.
 *   isTripped          circuit-breaker on the ownership boundary
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

  const memberClasses = new Set();
  const idStr = beingId ? String(beingId) : null;

  // Each `space.members` is normalized to a plain { className: [ids] }
  // object during the chain snapshot (snapshotAncestors / loadOrFold
  // produces lean rows; Mongoose Maps serialize to plain objects).
  // Collect every class this being belongs to as we walk.
  const accumulateMemberships = (space) => {
    if (!idStr) return;
    const m = readMembers(space);
    for (const [className, list] of Object.entries(m)) {
      if (Array.isArray(list) && list.some((id) => String(id) === idStr)) {
        memberClasses.add(className);
      }
    }
  };

  // ── Heaven path ────────────────────────────────────────────────
  // Any space whose chain passes through heaven (heaven itself or any
  // Tier-3 heaven space beneath it) uses heaven's members map: I_AM
  // is the singleton owner (immutable). The angel ROLE (granted at
  // heaven, per RolesAreAuth) is the operator-authority shape; this
  // chain function exposes legacy `angel` class membership for any
  // remaining checks, but new code reads role grants directly.
  const heavenSpace = ancestors.find((s) => s.heavenSpace === "heaven");
  if (heavenSpace) {
    accumulateMemberships(heavenSpace);
    const ownerId = getOwnerId(heavenSpace);
    const isHeavenOwner = !!(idStr && ownerId && String(ownerId) === idStr);
    const isAngel = memberClasses.has("angel");
    return {
      ok: true,
      rootId: heavenSpace._id,
      isRoot: heavenSpace._id === startNodeId,
      isOwner: isHeavenOwner,
      isAngel,
      memberClasses: Array.from(memberClasses),
      isTripped: false,
    };
  }

  // ── User-tree path (everything else) ───────────────────────────
  let ownerNode = null;

  for (const space of ancestors) {
    accumulateMemberships(space);

    if (space.heavenSpace) {
      // SOURCE is a traversable system tree (live mirror of
      // reality/extensions + reality/seed, see code-workspace/source.js).
      // Treat .source itself as the root of its subtree so everything
      // beneath it is navigable. Read-only by default — hasAccess is
      // gated on the code-workspace writeMode quality at the tool
      // handler level, not here.
      if (space.heavenSpace === "source") {
        ownerNode = space;
        break;
      }
      // Any other unexpected heaven space in a non-heaven chain is a
      // structural error — non-heaven chains shouldn't reach one.
      return {
        ok: false,
        error: IBP_ERR.INVALID_TREE,
        message: "Invalid tree: reached place heaven space boundary",
      };
    }

    // First space with a non-I_AM owner is the ownership boundary
    const ownerId = getOwnerId(space);
    if (ownerId && ownerId !== I_AM) {
      ownerNode = space;
      break;
    }
  }

  if (!ownerNode) {
    return {
      ok: false,
      error: IBP_ERR.INVALID_TREE,
      message: "Invalid tree: no owner found",
    };
  }

  // .source is a reality-wide system tree. Everyone on the reality
  // can read it; writes are gated elsewhere.
  if (ownerNode.heavenSpace === "source") {
    return {
      ok: true,
      rootId: ownerNode._id,
      isRoot: ownerNode._id === startNodeId,
      isOwner: false,
      memberClasses: Array.from(memberClasses),
      isTripped: false,
    };
  }

  const ownerId = getOwnerId(ownerNode);
  const isOwner = !!(idStr && ownerId && String(ownerId) === idStr);

  // Circuit breaker: tripped trees deny write access
  const circuit = ownerNode.qualities?.circuit;
  const isTripped = !!circuit?.tripped;

  return {
    ok: true,
    rootId: ownerNode._id,
    isRoot: ownerNode._id === startNodeId,
    isOwner,
    memberClasses: Array.from(memberClasses),
    isTripped,
  };
}

// Normalize the members map off a lean ancestor row. Mongoose Maps
// serialize to plain objects on lean reads but we defend against
// raw-Map shapes in case a caller passes a hydrated doc.
function readMembers(space) {
  const m = space?.members;
  if (!m) return {};
  if (m instanceof Map) {
    const out = {};
    for (const [k, v] of m.entries()) out[k] = Array.isArray(v) ? v : [];
    return out;
  }
  if (typeof m === "object") return m;
  return {};
}

function getOwnerId(space) {
  const m = readMembers(space);
  const list = m.owner;
  return Array.isArray(list) && list.length > 0 ? list[0] : null;
}

// ── Invalidation ──

/**
 * Invalidate a specific space and all cache entries that contain it
 * as an ancestor. Snapshots keys before deletion to avoid
 * iterate-and-delete.
 *
 * Branch defaults to null = invalidate the space across ALL branches.
 * Pass an explicit branch to scope eviction to one branch's view (used
 * by branch-scoped writes that only affect their own divergent chain).
 * For most writes (set-space on main, or any tree-shape change on a
 * specific branch), the safe default is "evict everywhere" . the cost
 * is one rebuild on next read, and the alternative is stale entries
 * across branches that share the un-rewritten ancestor.
 */
export function invalidateSpace(spaceId, branch = null) {
  const id = String(spaceId);
  _invalidations++;

  // Snapshot keys then check each. Safe against concurrent modification.
  const keys = [..._cache.keys()];
  for (const key of keys) {
    // Key shape "branch:spaceId" . parse to compare.
    const sepIdx = key.indexOf(":");
    const keyBranch = sepIdx >= 0 ? key.slice(0, sepIdx) : "0";
    if (branch != null && keyBranch !== String(branch)) continue;
    const keySpaceId = sepIdx >= 0 ? key.slice(sepIdx + 1) : key;
    // Direct hit on this space, or any cached chain that contains it.
    if (keySpaceId === id) {
      _cache.delete(key);
      continue;
    }
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
