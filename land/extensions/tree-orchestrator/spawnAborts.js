// Per-user spawn abort registry.
//
// Fire-and-forget spawns (governing-hire-planner, governing-dispatch-
// execution, etc.) start background chains AFTER the user's request
// has already returned. The kernel's per-request AbortController
// (socket._chatAbort) is reset to null the moment the request
// finishes, which leaves the background spawn with NO live cancel
// signal. The stop button becomes a no-op for any work in flight;
// the user has no way to halt a misfired build short of killing the
// server.
//
// This module is the cancellation surface for that gap. Every spawn
// registers an AbortController under its userId; settle paths
// unregister; the kernel's cancelRequest handler iterates and
// aborts every controller currently registered for the user.
//
// The shape is deliberately user-keyed (not socket-keyed): the user
// has one identity but possibly many open sockets (web tab, CLI,
// mobile sheet). A single stop press should halt everything they
// started.
//
// Architectural note (Pass 2): scope-keyed cancellation (stop only
// at a particular Ruler subtree, not user-wide) is a future
// refinement. For now, "stop everything I started" matches what
// the user means when they hit the button during a runaway build.

import log from "../../seed/log.js";

const _registry = new Map(); // userId → Set<AbortController>

/**
 * Register a controller against a user. Returns an unregister
 * function the caller binds to its settle path. Idempotent against
 * double-register of the same controller.
 */
export function registerSpawnAbort(userId, controller, label = "spawn") {
  if (!userId || !controller) return () => {};
  const key = String(userId);
  if (!_registry.has(key)) _registry.set(key, new Set());
  const slot = _registry.get(key);
  slot.add(controller);
  return () => {
    try {
      const s = _registry.get(key);
      if (s) {
        s.delete(controller);
        if (s.size === 0) _registry.delete(key);
      }
    } catch (err) {
      log.debug("SpawnAborts", `unregister(${label}) skipped: ${err.message}`);
    }
  };
}

/**
 * Abort every spawn registered to a user. Returns the count of
 * controllers that were active so the caller can log accurately.
 */
export function abortAllForUser(userId) {
  if (!userId) return 0;
  const key = String(userId);
  const slot = _registry.get(key);
  if (!slot || slot.size === 0) return 0;
  let aborted = 0;
  for (const controller of slot) {
    try {
      controller.abort();
      aborted++;
    } catch (err) {
      log.debug("SpawnAborts", `abort skipped: ${err.message}`);
    }
  }
  _registry.delete(key);
  if (aborted > 0) {
    log.info("SpawnAborts",
      `🛑 Aborted ${aborted} background spawn${aborted === 1 ? "" : "s"} for user ${key.slice(0, 8)}`);
  }
  return aborted;
}

/**
 * Diagnostic: count active spawns for a user (or globally).
 */
export function activeSpawnCount(userId = null) {
  if (userId) {
    const slot = _registry.get(String(userId));
    return slot ? slot.size : 0;
  }
  let n = 0;
  for (const s of _registry.values()) n += s.size;
  return n;
}
