// Per-stance inner-face subscription registry.
//
// Sits alongside live.js. live.js indexes per-space subscribers (the
// position descriptor channel). This file indexes per-stance inner
// face subscribers: when a being's fold reads a reel and a fact
// later lands on that reel, the sub gets a refold + push.
//
// What changes vs live.js.
//   . Subscriptions key off weave (the reels the fold actually read),
//     not spaceId. The same being at the same position with a
//     different role produces a different weave, so a role flip
//     properly drops the old subscription and replaces it on refold.
//   . Push payload is the canonical inner face shape (orientation +
//     role + position + capabilities + blocks + weave). Portal
//     reads it through the existing IBP envelope under a new SEE
//     push kind.
//   . Atomic weave rotation. When the server refolds, the sub's
//     weave is REPLACED, not mutated in place; the reverse index
//     drops the prior reelKeys and indexes the new ones inside the
//     same critical section so an arriving fact can never race a
//     half-rotated set.
//
// LLMs and scripts do NOT subscribe to inner-face changes. They
// snapshot at fold and trust the existing chain CAS + reel-head
// locks for seal-time conflicts (per the doctrine in innerFace.md).
// This registry is purely the human portal's reactive channel.

import log from "../../seed/seedReality/log.js";
import { IBP_EVENT } from "./events.js";
import { reelKey } from "../../seed/present/stamper/2-fold/weave.js";

// subId -> { socket, beingId, branch, weave, faceSeq }
const _subs = new Map();

// reelKeyStr -> Set<subId>
const _reelIndex = new Map();

// socket.id -> Set<subId>
const _socketSubs = new Map();

let _nextSubId = 1;
function _mintSubId() {
  return `if_${_nextSubId++}`;
}

/**
 * Register an inner-face subscription for one stance.
 *
 * Calling subscribe a second time on the same socket+stance returns
 * the existing subId; the subId is sticky across pushes so the
 * portal sees a stable subscription handle while the indexed weave
 * rotates.
 *
 * @param {Socket} socket
 * @param {{ beingId: string, branch: string }} stance
 * @param {object} face . the canonical inner face shape with weave
 * @returns {string|null} subscription id, or null if inputs malformed
 */
export function subscribeInnerFace(socket, { beingId, branch } = {}, face) {
  if (!socket || !beingId || !branch) return null;
  // Re-subscribe pattern: a stance may already have a sub on this
  // socket. Rotate its weave rather than mint a new id.
  const existing = _findStanceSub(socket, beingId, branch);
  if (existing) {
    _rotateWeave(existing, face);
    return existing.subId;
  }
  const subId = _mintSubId();
  const sub = {
    subId,
    socket,
    beingId: String(beingId),
    branch:  String(branch),
    weave:   [],
    faceSeq: 0,
  };
  _subs.set(subId, sub);
  _rotateWeave(sub, face);

  let mine = _socketSubs.get(socket.id);
  if (!mine) {
    mine = new Set();
    _socketSubs.set(socket.id, mine);
    socket.once("disconnect", () => cleanupSocketInnerFace(socket));
  }
  mine.add(subId);

  return subId;
}

/**
 * Drop a subscription. Idempotent.
 */
export function unsubscribeInnerFace(socket, subId) {
  if (!socket || !subId) return;
  const sub = _subs.get(subId);
  if (!sub) return;
  if (sub.socket !== socket && sub.socket?.id !== socket.id) return;
  _dropReelIndex(sub);
  _subs.delete(subId);
  const mine = _socketSubs.get(socket.id);
  if (mine) {
    mine.delete(subId);
    if (mine.size === 0) _socketSubs.delete(socket.id);
  }
}

export function cleanupSocketInnerFace(socket) {
  if (!socket) return;
  const mine = _socketSubs.get(socket.id);
  if (!mine) return;
  for (const subId of mine) {
    const sub = _subs.get(subId);
    if (sub) {
      _dropReelIndex(sub);
      _subs.delete(subId);
    }
  }
  _socketSubs.delete(socket.id);
}

/**
 * Look up subscribers indexed against a reel key. Returns the set of
 * subIds (possibly empty). Callers should coalesce by subId before
 * dispatching a refold so a single act touching N of a sub's reels
 * triggers ONE refold, not N.
 */
export function getSubscribersForReel(key) {
  if (typeof key !== "string" || !key) return new Set();
  const bucket = _reelIndex.get(key);
  return bucket ? new Set(bucket) : new Set();
}

/**
 * Resolve a subId to its current subscription record. Used by the
 * refold dispatcher to read beingId / branch / socket without poking
 * at internal state.
 */
export function getInnerFaceSub(subId) {
  return _subs.get(subId) || null;
}

/**
 * Replace a subscription's weave atomically. Removes the prior
 * reelKeys from the reverse index, copies in the new weave, and
 * registers the new keys. Used both at subscribe time (initial
 * indexing) and after each refold push (rotation).
 *
 * Atomic with respect to dispatch: the reverse index drops and adds
 * inside one synchronous critical section. A fact arriving during
 * the rotation either sees the prior reelKeys (and queues a refold
 * the sub already received) or the new reelKeys (and queues the next
 * refold).
 */
function _rotateWeave(sub, face) {
  _dropReelIndex(sub);
  const nextWeave = Array.isArray(face?.weave) ? face.weave.slice() : [];
  sub.weave = nextWeave;
  for (const entry of nextWeave) {
    const key = reelKey(entry);
    if (!key) continue;
    let bucket = _reelIndex.get(key);
    if (!bucket) {
      bucket = new Set();
      _reelIndex.set(key, bucket);
    }
    bucket.add(sub.subId);
  }
}

function _dropReelIndex(sub) {
  if (!sub || !Array.isArray(sub.weave)) return;
  for (const entry of sub.weave) {
    const key = reelKey(entry);
    if (!key) continue;
    const bucket = _reelIndex.get(key);
    if (!bucket) continue;
    bucket.delete(sub.subId);
    if (bucket.size === 0) _reelIndex.delete(key);
  }
}

function _findStanceSub(socket, beingId, branch) {
  const mine = _socketSubs.get(socket.id);
  if (!mine) return null;
  for (const subId of mine) {
    const sub = _subs.get(subId);
    if (!sub) continue;
    if (sub.beingId === String(beingId) && sub.branch === String(branch)) {
      return sub;
    }
  }
  return null;
}

/**
 * Emit one inner-face push to the subscriber's socket. Mirrors the
 * envelope shape live.js's _pushSee uses so the portal client's
 * existing SEE-routing path reaches a new kind without a new
 * protocol surface. Skips if the socket has dropped.
 */
export function emitInnerFace(socket, face) {
  if (!socket || !face) return;
  if (!socket.connected) return;
  // Mirror the wire shape live.js's _pushSee uses so the portal
  // client's existing SEE-routing path (kind / spaceId / data) reaches
  // the new "inner-face" kind without a new top-level surface. The
  // face rides in `data` because that is what the client routes; no
  // spaceId because an inner-face is per-stance, not per-space.
  const envelope = {
    verb:    "see",
    payload: { kind: "inner-face", spaceId: null, data: face },
  };
  try {
    socket.emit(IBP_EVENT, envelope);
  } catch (err) {
    log.warn("InnerFaceLive", `push inner-face to socket ${socket.id} failed: ${err.message}`);
  }
}

/**
 * Apply a new face to a subscription: rotate the weave index and
 * bump faceSeq. Returns the post-rotate subscription record (with
 * fresh faceSeq) so the dispatcher can wire it into the push
 * envelope when debugging is on.
 */
export function applyRefold(subId, face) {
  const sub = _subs.get(subId);
  if (!sub) return null;
  _rotateWeave(sub, face);
  sub.faceSeq += 1;
  return sub;
}

// Diagnostics. Kept narrow on purpose; tests + the portal admin view
// read these to confirm the registry is alive.

export function getInnerFaceStats() {
  return {
    subscriptions: _subs.size,
    indexedReels:  _reelIndex.size,
    sockets:       _socketSubs.size,
  };
}
