// Rung-3 fact-arrival push.
//
// Sits alongside the position-delta path in live.js. Where position
// deltas push skinny coord updates so a portal can lerp meshes, fact
// pushes tell a portal "a fact just landed on this entity" so the
// portal can drive its per-character THREE.AnimationMixer.
//
// Doctrine (locked):
//   . One .glb per character. Multiple named animation clips inside.
//     Motion is continuous skeletal interpolation driven by an
//     AnimationMixer the portal owns. Per-state .glb files swapped
//     on arrival (Option B) is rejected outright; do not build that
//     path here.
//   . Envelope shape:
//        { verb: "see",
//          payload: { kind: "fact", spaceId, data: { targetKind, targetId, action } } }
//   . Push reuses the existing per-space subscriber bucket via
//     emitPositionDelta's sibling _pushSee. We import the same
//     emitter so we share the bucket and the IBP_EVENT wire name.
//   . This cut dispatches to the TARGET entity only. Cross-entity
//     reactions (a dancer swaying when a tick targets the drum) are
//     a rung-3.5 follow-up, not here.
//   . Conflict rule lives portal-side: on rapid facts the mixer plays
//     clips via .reset().play() . interrupt mid-clip, do NOT queue.
//     One-shot clips set LoopOnce and fade back to looping idle on
//     the 'finished' event. Sound is parallel to animation, start(0),
//     no scheduling. The server side here just emits; it doesn't
//     reason about timing.
//
// The drummer already stamps action "harmony:tick" targeting matter
// (the drum). Payload {n, at}. The `at:` timestamp is NOT consumed
// in this cut . post-MVP polish.

import log from "../../seed/seedStory/log.js";
import Being from "../../seed/materials/being/being.js";
import Matter from "../../seed/materials/matter/matter.js";
import { registerCrossCuttingHandler } from "../../seed/present/stamper/2-fold/foldEngine.js";
import { emitPositionDelta } from "./live.js";
import { IBP_EVENT } from "./events.js";

// We need to push a SEE/fact envelope through the same per-space
// subscriber bucket emitPositionDelta uses. live.js doesn't export
// the bucket directly; instead we route through a tiny shim that
// reuses live.js by reaching its push surface. The cleanest path is
// to call _pushSee . but that's module-private. So we mirror the
// envelope shape and rely on Socket.IO's `emit` already happening
// inside live.js for position deltas. Here we want a sibling kind.
//
// To keep the bucket single-source-of-truth, we expose a thin
// emitter from this module that calls into live.js's existing
// emitPositionDelta-style fan-out by re-importing the registry it
// owns. live.js's _subscribers map is module-scoped, so the safest
// integration is for live.js to expose a generic _pushSee . but
// that's a separate edit. For now we add `emitFactArrival` here
// that calls the same Socket.IO emit path by leaning on the
// subscriber-iteration helper already in live.js: it pushes
// position deltas to every socket subscribed to spaceId, so we
// shape a parallel envelope and let _pushSee carry it.
//
// If live.js exports `_pushSee` or a generic `emitSee(spaceId, kind, data)`
// later, swap the inner call to that. Until then we proxy through
// emitPositionDelta with a sentinel shape would mis-tag the kind;
// instead we publish a sibling exported emitter live.js will gain.
//
// For this cut: import the generic `emitSee` if live.js exports it;
// otherwise fall back to invoking emitPositionDelta with a marker
// kind would corrupt the SEE_PUSH enum, so we do NOT do that. The
// minimal change is a one-line export added to live.js named
// `emitSeeKind(spaceId, kind, data)`. This file calls it when
// present and warns once if it's missing.

// Lazy lookup of the generic emitter so this module loads even
// before live.js gains the export. If the export is missing we
// log once at register time so the integrator notices.
let _emitSeeKind = null;
async function _loadEmitter() {
  if (_emitSeeKind !== null) return _emitSeeKind;
  try {
    const live = await import("./live.js");
    if (typeof live.emitSeeKind === "function") {
      _emitSeeKind = live.emitSeeKind;
    } else {
      // Soft fallback: build our own emit using whatever surface
      // live.js exposes. emitPositionDelta is wired to the same
      // bucket but locks the kind to SEE_PUSH.POSITION, so we
      // cannot use it for fact pushes without corrupting the
      // delta path. Stub the emitter and warn loudly.
      _emitSeeKind = false;
      log.warn(
        "FactPush",
        "live.js does not export emitSeeKind(spaceId,kind,data); fact arrival pushes are no-ops until added",
      );
    }
  } catch (err) {
    _emitSeeKind = false;
    log.warn("FactPush", `failed to load live.js emitter: ${err.message}`);
  }
  return _emitSeeKind;
}

// Actions we never push. These are substrate-mechanical writes . the
// dispatcher would walk every loaded entity per fact and find no
// mapping for any of them, burning a round-trip + envelope + walk
// per write for nothing. Semantic actions (extension-defined names
// like "harmony:tick", "harmony:walk", "harmony:step") still push
// normally and drive animation + sound.
//
// `set-being`, `set-matter`, `set-space` fire on EVERY field write,
// including the high-frequency `coord` updates the portal emits at
// 100 ms cadence while a user walks. Without this skip, walking
// across a scene with N loaded entities generates 10 N dispatcher
// iterations per second . pure overhead since no render block ever
// maps animations off a substrate field write.
//
// `set-render` itself would invite the portal to re-render-into-
// existence as the render block updates. Re-render lands through
// the descriptor refetch path anyway, not here.
const _SKIP_ACTIONS = new Set([
  "set-render",
  "set-being",
  "set-matter",
  "set-space",
]);

/**
 * Resolve the spaceId a target entity currently lives at.
 * . being.kind="being" . Being.position (falls back to homeSpace if null)
 * . target.kind="matter" . Matter.spaceId
 * Returns null when the target cannot be located (deleted, malformed).
 */
async function _resolveSpaceId(targetKind, targetId, history = "0") {
  if (!targetKind || !targetId) return null;
  try {
    const { loadProjection } = await import("../../seed/materials/projections.js");
    if (targetKind === "being") {
      const slot = await loadProjection("being", targetId, history);
      if (!slot) return null;
      return slot.position || slot.state?.homeSpace || null;
    }
    if (targetKind === "matter") {
      const slot = await loadProjection("matter", targetId, history);
      if (!slot) return null;
      return slot.state?.spaceId || null;
    }
  } catch (err) {
    log.warn("FactPush", `resolve spaceId failed (${targetKind}:${targetId}): ${err.message}`);
  }
  return null;
}

/**
 * Cross-cutting handler. Fires after the reducer applies each fact
 * in the fold loop. Must be idempotent . the same fact may be
 * dispatched again on rebuild or a re-fold catch-up. Emitting an
 * extra `see/fact` envelope on a re-dispatch is harmless: the
 * portal's mixer just plays the clip again, which is the right
 * behavior (the user effectively re-observes the moment).
 */
async function _handleFact(fact, _type, _id) {
  if (!fact) return;
  const targetKind = fact?.of?.kind;
  const targetId   = fact?.of?.id;
  if (!targetKind || !targetId) return;
  if (targetKind !== "being" && targetKind !== "matter") return;

  const action = fact?.act;
  if (!action) return;
  if (_SKIP_ACTIONS.has(action)) return;

  // Forward the fact's `at:` timestamp when the emitting op stamped one
  // (harmony's tick op carries `params.at = ISO`). The portal ignores
  // it in the rung-3 first cut, but landing it on the envelope now
  // means rhythm-precise scheduling can plug into Web Audio's
  // currentTime later without re-shipping server code.
  const at = (fact?.params && typeof fact.params.at === "string") ? fact.params.at : null;

  const spaceId = await _resolveSpaceId(targetKind, targetId, fact?.history || "0");
  if (!spaceId) return;

  const emit = await _loadEmitter();
  if (!emit) return;

  try {
    emit(String(spaceId), "fact", {
      targetKind,
      targetId: String(targetId),
      action,
      ...(at ? { at } : {}),
    });
  } catch (err) {
    log.warn("FactPush", `emit failed for ${targetKind}:${targetId} action=${action}: ${err.message}`);
  }
}

/**
 * Install the fact-arrival cross-cutting handler. Call once at
 * boot, alongside the afterPositionUpdate hook registration in
 * story/protocols/ibp/index.js.
 *
 * Idempotent only within a single process: each call appends a new
 * handler. Callers should invoke exactly once.
 */
let _registered = false;
export function registerFactPush() {
  if (_registered) {
    log.warn("FactPush", "registerFactPush() called more than once; ignoring");
    return;
  }
  _registered = true;
  registerCrossCuttingHandler(_handleFact);
  log.info("FactPush", "rung-3 fact-arrival push handler registered");
}

export default registerFactPush;
