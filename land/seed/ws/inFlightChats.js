// TreeOS Seed . AGPL-3.0 . https://treeos.ai

// Registry of running LLM chat turns keyed by the stable per-zone
// session key (user:userId:zone:anchor:device, the same key
// buildUserAiSessionKey produces for tree/home/land sessions).
//
// Why this exists: socket.id changes on every reconnect. Without a
// stable handle, a refreshed browser starts a brand-new socket whose
// emit callbacks point at a different controller than the in-flight
// LLM call's callbacks. Either the chat dies on disconnect (current
// behavior) or its events emit into a void (worse). This registry
// gives the chat a stable home that survives socket churn:
//
//   1. The chat handler `registerInFlight(stableKey, abort, socketId)`
//      when it starts the LLM call, so the abort controller is reachable
//      by the cancelRequest path even after the socket dies.
//   2. The streaming callbacks call `recordEvent(stableKey, evt, data)`
//      every time they emit, capturing a tail of recent activity.
//   3. On disconnect, `detachSocket(stableKey, socketId)` is called.
//      If no socket re-attaches within the orphan TTL, the abort fires
//      and the entry is dropped.
//   4. On reconnect, the new socket calls `attachSocket(stableKey, id)`
//      and replays `entry.buffer` to render the running log.
//
// The buffer is bounded (MAX_BUFFER) and the entry has a TTL after
// the last socket detaches (ORPHAN_TTL_MS). Server restarts drop
// everything (in-process map); persisted Chat history is unaffected.

import log from "../log.js";
import { getLandConfigValue } from "../landConfig.js";
import { endSession } from "./sessionRegistry.js";

const inFlight = new Map();
const orphanTimers = new Map();

const DEFAULT_MAX_BUFFER = 100;
const DEFAULT_ORPHAN_TTL_MS = 60_000;

// Buffer cap and orphan TTL are tunable via landConfig. Defaults are
// sane for a single-user dashboard; large-fanout deployments may want
// a bigger buffer or shorter TTL. Hard floors/ceilings keep accidental
// misconfig from wedging the kernel.
function maxBuffer() {
  const v = Number(getLandConfigValue("inFlightChatBufferCap")) || DEFAULT_MAX_BUFFER;
  return Math.max(10, Math.min(v, 1000));
}
function orphanTtlMs() {
  const v = Number(getLandConfigValue("inFlightChatOrphanTtlMs")) || DEFAULT_ORPHAN_TTL_MS;
  return Math.max(5_000, Math.min(v, 600_000));
}

/**
 * Register an in-flight chat for a stable session key. Called once
 * at the start of the LLM call. If a prior entry exists (same key,
 * e.g. the previous turn's cleanup raced with this turn's start),
 * the new abort controller replaces the old one. The session-registry
 * session is NOT ended on clear by default — it belongs to the socket
 * lifecycle, not the chat. The disconnect handler calls
 * `deferSessionEnd` to opt this entry into ending its session when
 * the chat finishes (the catch-up for the disconnect's skipped
 * endSession).
 */
export function registerInFlight(stableKey, abort, socket) {
  if (!stableKey || !abort) return null;
  cancelOrphan(stableKey);
  const existing = inFlight.get(stableKey);
  const entry = existing || {
    abort,
    sockets: new Set(),
    deferredSessionId: null,
    buffer: [],
    lastTouch: Date.now(),
  };
  entry.abort = abort;
  if (socket) entry.sockets.add(socket);
  entry.lastTouch = Date.now();
  inFlight.set(stableKey, entry);
  return entry;
}

/**
 * Mark a session-registry session for end-on-clear. Called from the
 * disconnect handler when it skips endSession because the chat is
 * still running. When the chat completes (clearInFlight) or its
 * orphan timer fires, we end the session as the deferred catch-up.
 */
export function deferSessionEnd(stableKey, sessionId) {
  if (!stableKey || !sessionId) return;
  const entry = inFlight.get(stableKey);
  if (!entry) return;
  entry.deferredSessionId = sessionId;
}

/**
 * Bind a socket to an existing in-flight chat. Called from
 * getAvailableModes when a reconnecting socket lands on a URL whose
 * stable key matches a running chat. Returns the entry (with buffer)
 * for replay, or null if no such chat exists. Stores the socket
 * reference directly so the streaming tee can iterate cached
 * references instead of looking up by id on every emit.
 */
export function attachSocket(stableKey, socket) {
  if (!stableKey || !socket) return null;
  const entry = inFlight.get(stableKey);
  if (!entry) return null;
  cancelOrphan(stableKey);
  entry.sockets.add(socket);
  entry.lastTouch = Date.now();
  return entry;
}

/**
 * Detach a socket. If this was the last socket attached to the entry,
 * schedule an orphan timer; if no other socket re-attaches in time the
 * abort fires and the entry is removed.
 */
export function detachSocket(stableKey, socket) {
  if (!stableKey || !socket) return;
  const entry = inFlight.get(stableKey);
  if (!entry) return;
  entry.sockets.delete(socket);
  entry.lastTouch = Date.now();
  if (entry.sockets.size === 0) scheduleOrphan(stableKey);
}

/**
 * Append a streaming event to the entry's ring buffer. Older events
 * past the configured cap are evicted. Silent no-op when no in-flight
 * chat exists for the key (callers are streaming callbacks that don't
 * know if registration succeeded).
 */
export function recordEvent(stableKey, event, data) {
  if (!stableKey || !event) return;
  const entry = inFlight.get(stableKey);
  if (!entry) return;
  entry.buffer.push({ event, data, ts: Date.now() });
  const cap = maxBuffer();
  if (entry.buffer.length > cap) {
    entry.buffer.splice(0, entry.buffer.length - cap);
  }
  entry.lastTouch = Date.now();
}

/**
 * Look up the current in-flight entry. Used by:
 *   - the chat handler's tee to find which sockets to emit to;
 *   - getAvailableModes to decide whether to replay on reconnect;
 *   - cancelRequest re-attach so the Stop button still works after refresh.
 */
export function getInFlight(stableKey) {
  if (!stableKey) return null;
  return inFlight.get(stableKey) || null;
}

/**
 * Remove the entry. Called from the chat handler's `finally` block
 * when the LLM call completes naturally (success or error). Does NOT
 * abort — completion is the natural end. Cancels any pending orphan
 * timer. Also ends the deferred session-registry session that the
 * disconnect handler skipped to keep the chat alive — without this,
 * the session leaks until the registry's idle sweep reaps it.
 */
export function clearInFlight(stableKey) {
  if (!stableKey) return;
  cancelOrphan(stableKey);
  const entry = inFlight.get(stableKey);
  inFlight.delete(stableKey);
  if (entry?.deferredSessionId) {
    try { endSession(entry.deferredSessionId); } catch {}
  }
}

function scheduleOrphan(stableKey) {
  cancelOrphan(stableKey);
  const t = setTimeout(() => {
    orphanTimers.delete(stableKey);
    const entry = inFlight.get(stableKey);
    if (!entry) return;
    if (entry.sockets.size > 0) return; // re-attached just before we fired
    log.info("WS", `🪦 orphan in-flight chat aborted (${stableKey})`);
    try {
      entry.abort?.abort?.();
    } catch {}
    inFlight.delete(stableKey);
    if (entry.deferredSessionId) {
      try { endSession(entry.deferredSessionId); } catch {}
    }
  }, orphanTtlMs());
  orphanTimers.set(stableKey, t);
}

function cancelOrphan(stableKey) {
  const t = orphanTimers.get(stableKey);
  if (t) {
    clearTimeout(t);
    orphanTimers.delete(stableKey);
  }
}
