// TreeOS Seed . AGPL-3.0 . https://treeos.ai
/**
 * Central in-memory lock manager for orchestrator pipelines.
 * Prevents concurrent execution of the same pipeline on the same resource.
 *
 * Namespaces isolate lock scopes (e.g. "drain", "cleanup-reorg", "understand").
 * Keys are typically rootId or runId.
 *
 * Locks have a TTL (default 30 minutes). If a runtime crashes between
 * acquire and release, the lock expires automatically. A periodic sweep
 * cleans up expired entries.
 *
 * Each lock tracks its owner (userId or processId) so only the acquirer
 * can release it. Locks can be renewed to prevent expiry during long
 * operations. A hard cap prevents unbounded memory growth.
 */

import log from "../log.js";
import { getLandConfigValue } from "../landConfig.js";

let LOCK_TTL_MS = 30 * 60 * 1000; // 30 minutes
let LOCK_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_LOCKS = 10000; // hard cap across all namespaces

/**
 * Read lock config from land config. Called from startup after config loads.
 */
export function initLockConfig() {
  const ttl = Number(getLandConfigValue("orchestratorLockTtlMs"));
  const sweep = Number(getLandConfigValue("lockSweepInterval"));
  if (ttl > 0) LOCK_TTL_MS = Math.max(60000, Math.min(ttl, 86400000)); // 1m to 24h
  if (sweep > 0) LOCK_SWEEP_INTERVAL_MS = Math.max(10000, Math.min(sweep, 3600000)); // 10s to 1h
  startSweep();
}

// Map<namespace, Map<key, { acquiredAt, renewedAt, owner, reason }>>
const locks = new Map();

// Total lock count (maintained to avoid iterating all namespaces for cap check)
let _totalLocks = 0;
function decTotal() { _totalLocks = Math.max(0, _totalLocks - 1); }

/**
 * Acquire a lock. Returns true if acquired, false if already held.
 *
 * @param {string} namespace - lock scope (e.g. "understand", "drain")
 * @param {string} key - resource identifier (e.g. rootId, runId)
 * @param {object} [opts]
 * @param {string} [opts.owner] - who is acquiring (userId, sessionId, etc.)
 * @param {string} [opts.reason] - why (for debugging/logging)
 * @returns {boolean} true if lock acquired
 */
export function acquireLock(namespace, key, opts = {}) {
  if (!namespace || typeof namespace !== "string") return false;
  if (!key || typeof key !== "string") return false;

  if (!locks.has(namespace)) locks.set(namespace, new Map());
  const map = locks.get(namespace);
  const existing = map.get(key);
  const now = Date.now();

  if (existing && (now - existing.renewedAt) < LOCK_TTL_MS) {
    return false; // actively held
  }

  // Expired lock being replaced
  if (existing) {
    log.debug("Locks", `Expired lock replaced: ${namespace}:${key} (held by ${existing.owner || "unknown"} for ${Math.round((now - existing.acquiredAt) / 1000)}s)`);
  }

  // Hard cap
  if (!existing && _totalLocks >= MAX_LOCKS) {
    log.warn("Locks", `Lock cap reached (${MAX_LOCKS}). Rejecting ${namespace}:${key}`);
    return false;
  }

  map.set(key, {
    acquiredAt: now,
    renewedAt: now,
    owner: opts.owner || null,
    reason: opts.reason || null,
  });

  if (!existing) _totalLocks++;
  return true;
}

/**
 * Release a lock. Only the owner can release (if owner was set on acquire).
 * Returns true if released, false if not found or not the owner.
 *
 * @param {string} namespace
 * @param {string} key
 * @param {string} [owner] - must match the acquirer's owner
 */
export function releaseLock(namespace, key, owner) {
  const map = locks.get(namespace);
  if (!map) return false;

  const existing = map.get(key);
  if (!existing) return false;

  // Owner check: if the lock has an owner, the caller MUST provide the matching owner.
  // Passing no owner when the lock has one = rejected. This prevents accidental release
  // by code that doesn't know the owner (e.g., a different pipeline).
  if (existing.owner) {
    if (!owner || existing.owner !== owner) {
      log.warn("Locks", `Release rejected: ${namespace}:${key} owned by ${existing.owner}, attempted by ${owner || "no-owner"}`);
      return false;
    }
  }

  map.delete(key);
  decTotal();
  if (map.size === 0) locks.delete(namespace);
  return true;
}

/**
 * Force-release a lock regardless of owner. Admin use only.
 * Returns true if released, false if not found.
 */
export function forceReleaseLock(namespace, key) {
  const map = locks.get(namespace);
  if (!map) return false;

  const existing = map.get(key);
  if (!existing) return false;

  log.warn("Locks", `Force-released: ${namespace}:${key} (owner: ${existing.owner || "none"}, held ${Math.round((Date.now() - existing.acquiredAt) / 1000)}s)`);
  map.delete(key);
  decTotal();
  if (map.size === 0) locks.delete(namespace);
  return true;
}

/**
 * Renew a lock's TTL. Call periodically during long operations to prevent expiry.
 * Only the owner can renew.
 *
 * @param {string} namespace
 * @param {string} key
 * @param {string} [owner] - must match the acquirer's owner
 * @returns {boolean} true if renewed
 */
export function renewLock(namespace, key, owner) {
  const map = locks.get(namespace);
  if (!map) return false;

  const existing = map.get(key);
  if (!existing) return false;

  // Expired locks cannot be renewed (must re-acquire)
  if ((Date.now() - existing.renewedAt) >= LOCK_TTL_MS) return false;

  // Owner check: if lock has an owner, caller must provide matching owner
  if (existing.owner && (!owner || existing.owner !== owner)) return false;

  existing.renewedAt = Date.now();
  return true;
}

/**
 * Check if a lock is currently held.
 */
export function isLocked(namespace, key) {
  const map = locks.get(namespace);
  if (!map) return false;

  const entry = map.get(key);
  if (!entry) return false;

  // Read-only check. Expired locks return false but are not deleted here.
  // The periodic sweep handles cleanup. Readers should never mutate state.
  if ((Date.now() - entry.renewedAt) >= LOCK_TTL_MS) return false;

  return true;
}

/**
 * Get info about a lock (for debugging and admin endpoints).
 */
export function getLockInfo(namespace, key) {
  const map = locks.get(namespace);
  if (!map) return null;

  const entry = map.get(key);
  if (!entry) return null;

  const now = Date.now();
  if ((now - entry.renewedAt) >= LOCK_TTL_MS) return null;

  return {
    namespace,
    key,
    owner: entry.owner,
    reason: entry.reason,
    acquiredAt: new Date(entry.acquiredAt).toISOString(),
    renewedAt: new Date(entry.renewedAt).toISOString(),
    ageMs: now - entry.acquiredAt,
    ttlRemainingMs: LOCK_TTL_MS - (now - entry.renewedAt),
  };
}

/**
 * List all active locks (for debugging and admin endpoints).
 */
export function listLocks() {
  const result = [];
  const now = Date.now();

  for (const [ns, map] of locks) {
    for (const [key, entry] of map) {
      if ((now - entry.renewedAt) < LOCK_TTL_MS) {
        result.push({
          namespace: ns,
          key,
          owner: entry.owner,
          reason: entry.reason,
          ageMs: now - entry.acquiredAt,
          ttlRemainingMs: LOCK_TTL_MS - (now - entry.renewedAt),
        });
      }
    }
  }

  return result;
}

// ── Periodic sweep: clean expired locks ──

let _sweepTimer = null;

function startSweep() {
  if (_sweepTimer) clearInterval(_sweepTimer);
  _sweepTimer = setInterval(() => {
    const now = Date.now();
    let swept = 0;

    for (const [ns, map] of locks) {
      for (const [key, entry] of map) {
        if ((now - entry.renewedAt) >= LOCK_TTL_MS) {
          map.delete(key);
          decTotal();
          swept++;
        }
      }
      if (map.size === 0) locks.delete(ns);
    }

    if (swept > 0) {
      log.debug("Locks", `Sweep: ${swept} expired lock(s) removed. ${_totalLocks} active.`);
    }
  }, LOCK_SWEEP_INTERVAL_MS);
  if (_sweepTimer.unref) _sweepTimer.unref();
}

// Start with defaults; initLockConfig() restarts with configured values
startSweep();

export { startSweep };
