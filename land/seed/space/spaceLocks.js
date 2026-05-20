// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
/**
 * Space Locks
 *
 * Short-lived in-memory locks for structural mutations.
 * Not orchestrator locks (30min TTL for pipelines).
 * These are seconds. Scoped to one structural operation.
 *
 * Three tiers of tree operations:
 *   Tier 1: Reads. Fully concurrent. Zero locks. Zero overhead.
 *   Tier 2: Scoped writes (setExtMeta, addNote). Concurrent across namespaces. No locks.
 *   Tier 3: Structural mutations (move, delete, ownership). Lock the affected space(s).
 *
 * Only tier 3 touches this module. Everything else runs free.
 *
 * Multi-space operations (updateParentRelationship touches 3 spaces) acquire
 * locks in sorted order to prevent deadlock. If any acquisition fails,
 * all already-acquired locks are released.
 *
 * TTL auto-expires stale locks from crashed operations. Integrity check
 * on next boot repairs any partial structural mutation.
 */

import log from "../system/log.js";
import { getLandConfigValue } from "../landConfig.js";

const locks = new Map(); // spaceId -> { sessionId, acquiredAt }

function LOCK_TIMEOUT_MS() {
  return Number(getLandConfigValue("spaceLockTimeoutMs")) || 30000;
}

function LOCK_WAIT_MS() {
  return Number(getLandConfigValue("spaceLockWaitMs")) || 5000;
}

function isExpired(lock) {
  return Date.now() - lock.acquiredAt > LOCK_TIMEOUT_MS();
}

/**
 * Acquire a structural lock on a space.
 * Waits up to LOCK_WAIT_MS if held by another session.
 * Auto-steals expired locks.
 *
 * @param {string} spaceId
 * @param {string} [sessionId] - who is acquiring
 * @returns {Promise<boolean>} true if acquired
 */
export async function acquireSpaceLock(spaceId, sessionId) {
  if (!spaceId) return true; // null spaceId = nothing to lock

  const existing = locks.get(spaceId);

  // Already held by this session
  if (existing && existing.sessionId === sessionId && !isExpired(existing)) {
    existing.acquiredAt = Date.now(); // renew
    return true;
  }

  // Expired lock, steal it
  if (existing && isExpired(existing)) {
    log.debug("SpaceLocks", `Expired lock on ${spaceId} (held by ${existing.sessionId}), stealing`);
    locks.delete(spaceId);
  }

  // Free, acquire immediately
  if (!locks.has(spaceId)) {
    locks.set(spaceId, { sessionId: sessionId || null, acquiredAt: Date.now() });
    return true;
  }

  // Held by another session. Poll until free or timeout.
  const deadline = Date.now() + LOCK_WAIT_MS();
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 100));

    const current = locks.get(spaceId);
    if (!current || isExpired(current)) {
      locks.set(spaceId, { sessionId: sessionId || null, acquiredAt: Date.now() });
      return true;
    }
    if (current.sessionId === sessionId) {
      return true; // acquired by our session in the meantime
    }
  }

  log.debug("SpaceLocks", `Lock timeout on ${spaceId} (held by ${locks.get(spaceId)?.sessionId})`);
  return false;
}

/**
 * Release a structural lock.
 * Only releases if owned by the given sessionId (or if no sessionId specified).
 */
export function releaseSpaceLock(spaceId, sessionId) {
  if (!spaceId) return;
  const lock = locks.get(spaceId);
  if (!lock) return;
  // Reject release if the lock has an owner and the caller doesn't match.
  // Null callers cannot release owned locks. Only TTL expiry can.
  if (lock.sessionId && (!sessionId || lock.sessionId !== sessionId)) return;
  locks.delete(spaceId);
}

/**
 * Acquire locks on multiple spaces in sorted order (deadlock prevention).
 * If any acquisition fails, all already-acquired locks are released.
 *
 * @param {string[]} spaceIds
 * @param {string} [sessionId]
 * @returns {Promise<boolean>}
 */
export async function acquireMultiple(spaceIds, sessionId) {
  const sorted = [...new Set(spaceIds.filter(Boolean))].sort();
  const acquired = [];

  for (const id of sorted) {
    const ok = await acquireSpaceLock(id, sessionId);
    if (!ok) {
      for (const a of acquired) releaseSpaceLock(a, sessionId);
      return false;
    }
    acquired.push(id);
  }
  return true;
}

/**
 * Release locks on multiple spaces.
 */
export function releaseMultiple(spaceIds, sessionId) {
  for (const id of spaceIds) {
    if (id) releaseSpaceLock(id, sessionId);
  }
}

/**
 * Check if a space has an active structural lock.
 */
export function isSpaceLocked(spaceId) {
  const lock = locks.get(spaceId);
  if (!lock) return false;
  if (isExpired(lock)) {
    locks.delete(spaceId);
    return false;
  }
  return true;
}

/**
 * Get lock stats (for diagnostics / pulse).
 */
export function getLockStats() {
  let active = 0;
  const now = Date.now();
  for (const [, lock] of locks) {
    if (now - lock.acquiredAt <= LOCK_TIMEOUT_MS()) active++;
  }
  return { active, total: locks.size };
}

// Periodic sweep for expired locks
const _sweepTimer = setInterval(() => {
  const now = Date.now();
  const timeout = LOCK_TIMEOUT_MS();
  for (const [id, lock] of locks) {
    if (now - lock.acquiredAt > timeout) locks.delete(id);
  }
}, 60000);
if (_sweepTimer.unref) _sweepTimer.unref();
