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

const LOCK_TTL_MS = 30 * 60 * 1000; // 30 minutes

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

// Periodic sweep: clean expired locks every 5 minutes
const _sweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [ns, map] of locks) {
    for (const [key, ts] of map) {
      if ((now - ts) >= LOCK_TTL_MS) map.delete(key);
    }
    if (map.size === 0) locks.delete(ns);
  }
}, 5 * 60 * 1000);
if (_sweepTimer.unref) _sweepTimer.unref();
