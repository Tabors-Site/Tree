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
 */

import { getLandConfigValue } from "../landConfig.js";

let LOCK_TTL_MS = 30 * 60 * 1000; // 30 minutes
let LOCK_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Read lock config from land config. Called from startup after config loads.
 */
export function initLockConfig() {
  LOCK_TTL_MS            = Number(getLandConfigValue("orchestratorLockTtlMs"))  || LOCK_TTL_MS;
  LOCK_SWEEP_INTERVAL_MS = Number(getLandConfigValue("lockSweepInterval"))      || LOCK_SWEEP_INTERVAL_MS;
  startSweep(); // Restart sweep with configured interval
}

// Map<namespace, Map<key, timestamp>>
const locks = new Map();

export function acquireLock(namespace, key) {
  if (!locks.has(namespace)) locks.set(namespace, new Map());
  const map = locks.get(namespace);
  const existing = map.get(key);
  if (existing && (Date.now() - existing) < LOCK_TTL_MS) return false;
  map.set(key, Date.now());
  return true;
}

export function releaseLock(namespace, key) {
  const map = locks.get(namespace);
  if (map) map.delete(key);
}

export function isLocked(namespace, key) {
  const map = locks.get(namespace);
  if (!map) return false;
  const ts = map.get(key);
  if (!ts) return false;
  if ((Date.now() - ts) >= LOCK_TTL_MS) {
    map.delete(key); // expired
    return false;
  }
  return true;
}

// Periodic sweep: clean expired locks
let _sweepTimer = null;

function startSweep() {
  if (_sweepTimer) clearInterval(_sweepTimer);
  _sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [ns, map] of locks) {
      for (const [key, ts] of map) {
        if ((now - ts) >= LOCK_TTL_MS) map.delete(key);
      }
      if (map.size === 0) locks.delete(ns);
    }
  }, LOCK_SWEEP_INTERVAL_MS);
  if (_sweepTimer.unref) _sweepTimer.unref();
}

// Start with defaults; initLockConfig() restarts with configured values
startSweep();

export { startSweep };
