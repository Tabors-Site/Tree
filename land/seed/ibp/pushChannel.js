// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Push channel. How I reach the speaker without being asked.
//
// Most of IBP is request/response: a SEE / DO / SUMMON / BE comes
// in, I answer. The push channel is the other direction. When I
// SUMMON a being whose client is connected, or when a SEE-subscribed
// position changes underneath them, I have to push to that client
// without waiting for them to ask. This file is how.
//
// Layering inversion. I never import from transports — that would
// violate the layering rule (transports → protocols → seed; never
// the other way). Each transport that can deliver pushes calls
// `setPushChannel({...})` at boot to register its emitter; I expose
// the registered channel through proxy functions. When no transport
// has registered (CLI-only run, tests, dry-boot), every proxy
// no-ops and getIO / getHttpServer return null — callers that try
// to push just see "nothing happened" without crashing.
//
// Same inversion pattern as the schedule emitter (see
// seed/cognition/wakeSchedule.js setScheduleEmitter).

import log from "../system/log.js";

// The single wire event name for all IBP traffic in both directions
// (see [[project_ibp_summon_unified_event]], [[project_ibp_wire_shape]]).
// Seed declares it here — the push channel is the seed-side wire
// boundary — so callers don't reach across into protocols/. The
// protocol-side adapter (protocols/ibp/protocol.js) declares the same
// string for its incoming `socket.on(...)` listener; the duplication
// is deliberate — "ibp" is the wire stability boundary and lives at
// both ends.
export const IBP_EVENT = "ibp";

let _channel = null;

const NOOP_CHANNEL = Object.freeze({
  emitToBeing:             () => {},
  emitToBeingRoom:         () => {},
  emitNavigate:            () => {},
  getIO:                   () => null,
  getHttpServer:           () => null,
  registerSocketHandler:   () => {},
  unregisterSocketHandler: () => {},
});

/**
 * Register the push channel for this land. Called once per transport
 * at boot. Re-registration overwrites; a transport that hot-reloads
 * should clear via `resetPushChannel()` first.
 *
 * @param {object} impl
 * @param {Function} impl.emitToBeing      (beingId, event, data) => void  — fanout to every auth-tracked socket the being holds
 * @param {Function} impl.emitToBeingRoom  (beingId, event, data) => void  — broadcast to the being's socket-room
 * @param {Function} impl.emitNavigate     ({ beingId, url, replace }) => void
 * @param {Function} impl.getIO        () => io | null
 * @param {Function} impl.getHttpServer () => httpServer | null
 * @param {Function} impl.registerSocketHandler   (event, handler) => void
 * @param {Function} impl.unregisterSocketHandler (event) => void
 */
export function setPushChannel(impl) {
  if (!impl || typeof impl !== "object") {
    log.warn("PushChannel", "setPushChannel: implementation object is required");
    return;
  }
  _channel = impl;
  log.verbose("PushChannel", "push channel registered");
}

export function resetPushChannel() {
  _channel = null;
}

export function hasPushChannel() {
  return _channel !== null;
}

// ────────────────────────────────────────────────────────────────
// Proxies — seed-side callers reach the registered channel through
// these. Each delegates to the implementation or no-ops when nothing
// has been registered yet.
// ────────────────────────────────────────────────────────────────

export function emitToBeing(beingId, event, data) {
  return (_channel || NOOP_CHANNEL).emitToBeing(beingId, event, data);
}

export function emitToBeingRoom(beingId, event, data) {
  return (_channel || NOOP_CHANNEL).emitToBeingRoom(beingId, event, data);
}

/**
 * Push an IBP envelope to every socket the being has joined. The
 * canonical seed-side push for SUMMON replies / out-of-band inbox
 * arrivals: kernel callers describe the envelope, the channel handles
 * the wire event name.
 */
export function pushIbp(beingId, envelope) {
  return (_channel || NOOP_CHANNEL).emitToBeingRoom(beingId, IBP_EVENT, envelope);
}

export function emitNavigate(args) {
  return (_channel || NOOP_CHANNEL).emitNavigate(args);
}

export function getIO() {
  return (_channel || NOOP_CHANNEL).getIO();
}

export function getHttpServer() {
  return (_channel || NOOP_CHANNEL).getHttpServer();
}

export function registerSocketHandler(event, handler) {
  return (_channel || NOOP_CHANNEL).registerSocketHandler(event, handler);
}

export function unregisterSocketHandler(event) {
  return (_channel || NOOP_CHANNEL).unregisterSocketHandler(event);
}
