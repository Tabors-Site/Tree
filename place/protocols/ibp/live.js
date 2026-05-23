// Live SEE substrate.
//
// Holds the per-socket subscription registry and exposes emitters that
// push descriptor updates to subscribers. Subscriptions are keyed by
// spaceId — the leaf space of the addressed Position. When seed state
// changes (metadata writes, space create/delete, status changes, note
// writes), call the emitters and live SEE subscribers see the update.
//
// Subscription cleanup is automatic on socket disconnect: we stash the
// socket's subscription set on the socket itself and prune on the
// `disconnect` event.

import log from "../../seed/system/log.js";
import { IBP_EVENT, SEE_PUSH } from "./events.js";

// spaceId -> Set<socket>
const _subscribers = new Map();

// socket.id -> Set<spaceId>   (so we can clean up on disconnect)
const _socketSubs = new Map();

/**
 * Register a subscription. The socket will receive descriptor events
 * for the given spaceId until disconnect or explicit unsubscribe.
 *
 * @param {Socket} socket
 * @param {string} spaceId  the leaf space of the addressed position
 */
export function subscribePosition(socket, spaceId) {
  if (!socket || !spaceId) return;
  const key = String(spaceId);
  let bucket = _subscribers.get(key);
  if (!bucket) {
    bucket = new Set();
    _subscribers.set(key, bucket);
  }
  bucket.add(socket);

  let mine = _socketSubs.get(socket.id);
  if (!mine) {
    mine = new Set();
    _socketSubs.set(socket.id, mine);
    socket.once("disconnect", () => cleanupSocket(socket));
  }
  mine.add(key);
}

/**
 * Drop a subscription. Idempotent.
 */
export function unsubscribePosition(socket, spaceId) {
  if (!socket || !spaceId) return;
  const key = String(spaceId);
  const bucket = _subscribers.get(key);
  if (bucket) {
    bucket.delete(socket);
    if (bucket.size === 0) _subscribers.delete(key);
  }
  const mine = _socketSubs.get(socket.id);
  if (mine) {
    mine.delete(key);
    if (mine.size === 0) _socketSubs.delete(socket.id);
  }
}

function cleanupSocket(socket) {
  const mine = _socketSubs.get(socket.id);
  if (!mine) return;
  for (const key of mine) {
    const bucket = _subscribers.get(key);
    if (bucket) {
      bucket.delete(socket);
      if (bucket.size === 0) _subscribers.delete(key);
    }
  }
  _socketSubs.delete(socket.id);
}

// ─────────────────────────────────────────────────────────────────────
// Emitters
// ─────────────────────────────────────────────────────────────────────
//
// All three live-SEE pushes ride the unified `ibp` event with
// `{ verb: "see", payload: { kind, spaceId, data } }`. The kind tag
// distinguishes patch vs replace vs invalidate; the client routes by
// envelope.verb and payload.kind.

/**
 * Emit an RFC 6902 patch to all subscribers of a position. Patches are
 * an optimization; today's path uses an invalidate to let the client
 * re-fetch via SEE, which keeps the substrate simple.
 */
export function emitPositionPatch(spaceId, patch) {
  _pushSee(spaceId, SEE_PUSH.PATCH, patch);
}

/**
 * Emit a full descriptor replace. Cheaper for the server than computing
 * a precise patch; heavier on the wire.
 */
export function emitPositionReplace(spaceId, descriptor) {
  _pushSee(spaceId, SEE_PUSH.REPLACE, descriptor);
}

/**
 * Tell subscribers to drop and re-fetch. Use as a fallback when patches
 * are too expensive or state has changed too much to diff.
 */
export function emitPositionInvalidate(spaceId, reason) {
  _pushSee(spaceId, SEE_PUSH.INVALIDATE, { reason });
}

function _pushSee(spaceId, kind, data) {
  if (!spaceId) return;
  const bucket = _subscribers.get(String(spaceId));
  if (!bucket || bucket.size === 0) return;
  const envelope = {
    verb:    "see",
    payload: { kind, spaceId: String(spaceId), data },
  };
  for (const socket of bucket) {
    try {
      if (socket.connected) socket.emit(IBP_EVENT, envelope);
    } catch (err) {
      log.warn("Live", `push see/${kind} to socket ${socket.id} failed: ${err.message}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Diagnostics
// ─────────────────────────────────────────────────────────────────────

export function getSubscriberCount(spaceId) {
  return _subscribers.get(String(spaceId))?.size || 0;
}

export function getTotalSubscriptions() {
  let n = 0;
  for (const s of _subscribers.values()) n += s.size;
  return n;
}
