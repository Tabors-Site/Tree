/**
 * Central in-memory lock manager for orchestrator pipelines.
 * Prevents concurrent execution of the same pipeline on the same resource.
 *
 * Namespaces isolate lock scopes (e.g. "drain", "cleanup-reorg", "understand").
 * Keys are typically rootId or runId.
 */

const locks = new Map();

export function acquireLock(namespace, key) {
  if (!locks.has(namespace)) locks.set(namespace, new Set());
  const set = locks.get(namespace);
  if (set.has(key)) return false;
  set.add(key);
  return true;
}

export function releaseLock(namespace, key) {
  const set = locks.get(namespace);
  if (set) set.delete(key);
}

export function isLocked(namespace, key) {
  return locks.get(namespace)?.has(key) || false;
}
