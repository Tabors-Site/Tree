// IBP (Inter-Being Protocol) — boot entry point.
//
// IBP is core, peer to seed/, transports/, extensions/. It carries IBP
// Addresses as its native address primitive. IBP is the Place's second
// protocol surface alongside the legacy HTTP API.
//
// Boot ordering (called from server.js):
//   1. initIBPHttp(app) . BEFORE the catch-all 404 handler. Registers the
//      single bootstrap route GET /.well-known/treeos-portal. (The route
//      name is a stable public contract from the Portal client era; the
//      payload it returns is the IBP discovery descriptor.)
//   2. initIBPWS(io)   . AFTER initWebSocketServer() returns the io.
//      Attaches ibp:* event handlers onto every authenticated socket.
//
// Both must be called for IBP to be fully alive on a Place.

import log from "../../seed/seedReality/log.js";
import { registerIbpBootstrap } from "./bootstrap-route.js";
import { attachIbpHandlers } from "./protocol.js";
import { attachNameSession } from "./nameSession.js";
import { hooks } from "../../seed/hooks.js";
import Space from "../../seed/materials/space/space.js";
import { emitPositionInvalidate, emitPositionDelta } from "./live.js";
import { registerFactPush } from "./factPush.js";
import { emitToSubscribers } from "../../seed/present/wakes/subscriptions.js";
import { startTickLoop as startScheduleTick } from "../../seed/present/wakes/wakeSchedule.js";

// Seed-signal-to-live-emit bridge. When seed events touch data that
// the Position Description reads, invalidate subscribers so they refetch.
// First cut: invalidate. Patch-based diffs come later as an optimization.

let _hooksWired = false;
export function wireLiveHooks() {
  if (_hooksWired) return;
  _hooksWired = true;

  // Quality write on a being/space/matter: invalidate the affected
  // space's descriptor (and its parent, which lists this space as a
  // child when the target is a space). The descriptor always exposes
  // qualities; any write to qualities.<ns> may change what subscribers
  // see, so no namespace gate. Listeners that don't care about a
  // specific event are free to skip — the cost is one descriptor
  // re-fetch by clients with a live subscription, bounded by their
  // own debounce in handleDescriptorEvent.
  hooks.register("afterQualityWrite", async ({ spaceId, ns, target, branch }) => {
    if (!spaceId) return;
    emitPositionInvalidate(spaceId, `qualities:${ns}`);
    if (target?.kind === "space") {
      try {
        const { loadProjection } = await import("../../seed/materials/projections.js");
        const slot = await loadProjection("space", target.id, branch || "0");
        if (slot?.state?.parent) emitPositionInvalidate(slot.state.parent, `child-metadata:${ns}`);
      } catch { /* defensive */ }
    }
  }, "ibp-live");

  // PositionProjection deltas. Skinny push: just (beingId, x, y, seq)
  // for the affected space. Clients map beingId to a mesh, apply the
  // coord with lastMoveSeq ordering. The fat-path invalidate below
  // still fires for the same write through afterFieldWrite — that
  // remains the catch-up path for clients that missed a delta. The
  // delta is the latency optimization.
  hooks.register("afterPositionUpdate", async (payload) => {
    if (!payload?.spaceId) return;
    emitPositionDelta(payload.spaceId, {
      beingId:     payload.beingId,
      x:           payload.x,
      y:           payload.y,
      ...(payload.z !== undefined ? { z: payload.z } : {}),
      lastMoveSeq: payload.lastMoveSeq,
    });
  }, "ibp-live");

  // Non-qualities scalar writes (size, name, type, parent, position, ...).
  // The descriptor surfaces these on beings/matters/spaces, so any
  // change should invalidate live subscribers.
  //
  // `coord` is the exception. The PositionProjection fold pushes a
  // skinny per-being delta on every coord write (see
  // emitPositionDelta above) and the portal applies that delta in
  // place — no descriptor rebuild. Firing a full invalidate on top
  // of every coord write would force a debounced refetch of the
  // whole descriptor 10x/sec while a human walks, destroying and
  // recreating every mesh in the scene. The delta is the
  // authoritative live path for coord; invalidate covers fields
  // the delta doesn't carry.
  hooks.register("afterFieldWrite", async ({ spaceId, field, target, branch }) => {
    if (!spaceId) return;
    // Skip coord ONLY for being writes . set-being:coord has its own
    // lightweight emitPositionDelta path (see afterPositionUpdate
    // above) so an extra invalidate would force a debounced full
    // descriptor refetch 10x/sec while a human walks. For space and
    // matter coord changes, there's no delta path . the parent
    // descriptor must be invalidated so the portal repaints the
    // child at its new cell. Without this, moving a space or matter
    // succeeds at the substrate but the visual stays at the old cell.
    if (field === "coord" && target?.kind === "being") return;
    emitPositionInvalidate(spaceId, `field:${field}`);
    if (target?.kind === "space") {
      try {
        const { loadProjection } = await import("../../seed/materials/projections.js");
        const slot = await loadProjection("space", target.id, branch || "0");
        if (slot?.state?.parent) emitPositionInvalidate(slot.state.parent, `child-field:${field}`);
      } catch { /* defensive */ }
    }
  }, "ibp-live");

  // Structural changes: new/removed/moved children change the parent's
  // descriptor. Matter writes change the affected position's content.
  hooks.register("afterSpaceCreate", async ({ space }) => {
    if (space?.parent) emitPositionInvalidate(space.parent, "child-created");
  }, "ibp-live");
  hooks.register("afterSpaceDelete", async ({ space }) => {
    if (space?.parent) emitPositionInvalidate(space.parent, "child-deleted");
  }, "ibp-live");
  hooks.register("afterMatter", async ({ spaceId }) => {
    if (spaceId) emitPositionInvalidate(spaceId, "matter-changed");
  }, "ibp-live");

  // Chainstep state changes: every tool call shifts the "activity" field
  // for the being whose chainstep just ran. Invalidate the bound spaceId
  // so subscribers re-fetch and see the new activity entry.
  hooks.register("afterToolCall", async ({ spaceId, toolName }) => {
    if (spaceId) emitPositionInvalidate(spaceId, `tool:${toolName || "unknown"}`);
  }, "ibp-live");

  // Act seal: the being's activity flips from "acting" to "said" (the
  // endMessage prose). Without this fire the bubble keeps showing the
  // last fact's action(params) signature until the next moment's tool
  // call triggers a refetch. Invalidate the being's current space so
  // the descriptor's sealed-fallback path lands the spoken text above
  // the mesh.
  hooks.register("afterAct", async ({ beingOut }) => {
    if (!beingOut) return;
    try {
      const b = await (await import("../../seed/materials/being/being.js")).default
        .findById(beingOut).select("position homeSpace").lean();
      const sId = b?.position || b?.homeSpace;
      if (sId) emitPositionInvalidate(String(sId), "act-sealed");
    } catch { /* descriptor refresh is best-effort */ }
  }, "ibp-live");

  // Stamper live loop (./factory/present). Every sealed act nudges
  // the actor's stamper-space subscribers — the synthetic space's
  // address.spaceId IS the subscription key — plus the present
  // listing (recent-actors order shifts). Cost with no subscribers:
  // one Map lookup per seal. The protocols→seed direction holds:
  // seed fires the hook, this side listens (the factPush inversion).
  let _factoryPresentIdCache = null;
  hooks.register("afterAct", async ({ beingIn }) => {
    if (!beingIn) return;
    try {
      emitPositionInvalidate(`stamper:${beingIn}`, "act-sealed");
      if (_factoryPresentIdCache === null) {
        const { getFactoryPresentSpaceId } =
          await import("../../seed/materials/space/factory.js");
        _factoryPresentIdCache = (await getFactoryPresentSpaceId()) || false;
      }
      if (_factoryPresentIdCache) {
        emitPositionInvalidate(_factoryPresentIdCache, "act-sealed");
      }
    } catch { /* stamper refresh is best-effort */ }
  }, "ibp-live-stamper");

  // DO-trigger fan-out. The three substrate write events fan out
  // through the subscription registry: any being subscribed to one of
  // these events whose scope covers the affected position gets a
  // SUMMON in its inbox with intent="do-trigger". The receiving
  // being's role template interprets the trigger content and decides
  // whether to act. This is the universal bridge between Mode 2
  // (anonymous code emitting DOs) and Mode 1 (beings reacting to
  // substrate changes through summons).
  hooks.register("afterMatter",        (payload) => emitToSubscribers("afterMatter",        payload), "ibp-subscriptions");
  hooks.register("afterQualityWrite", (payload) => emitToSubscribers("afterQualityWrite", payload), "ibp-subscriptions");

  log.info("IBP", "live SEE hooks wired (afterMetadataWrite, afterSpace*, afterMatter, afterToolCall); DO-trigger subscriptions wired (afterMatter, afterMetadataWrite)");
}

/**
 * Register the single HTTP bootstrap route.
 * Call from server.js after registerURLRoutes(app), before the 404 catch-all.
 */
export function initIBPHttp(app) {
  registerIbpBootstrap(app);
  log.info("IBP", "IBP HTTP bootstrap registered at /.well-known/treeos-portal");
}

/**
 * Attach IBP WS handlers to the Socket.IO server.
 * Call from server.js after initWebSocketServer() returns the io.
 */
export function initIBPWS(io) {
  if (!io) {
    log.error("IBP", "initIBPWS called without io instance");
    return;
  }
  wireLiveHooks();
  // Rung-3 fact-arrival push. Installs a cross-cutting handler at the
  // fold boundary that emits a SEE/fact envelope on every do:* fact
  // landing on a being or matter. Portals listening live see the
  // envelope alongside position deltas and drive their per-character
  // AnimationMixer + Web Audio renderers off it.
  registerFactPush();
  attachIbpHandlers(io);
  // Pre-world NAME channel: declare / login / logout / whoami for a
  // connection with no being yet (the Name Form at the bare realityDomain).
  attachNameSession(io);
  // Rehydrate runtime state. Both subscriptions and schedules now
  // fold from the fact chain. Each walker reads its action's facts
  // (subscription-registered/cancelled, wake-scheduled/cancelled)
  // across every live branch, threads them through reel-lineage,
  // and materializes one runtime entry per (id, branch) pair.
  // Without this, every server restart wipes every being's standing
  // attention and cadence — extensions planted before the restart
  // silently stop responding.
  //
  // Fire before startScheduleTick so the tick loop sees the
  // restored entries on its first sweep. Async — the few hundred-ms
  // catch-up window after boot is acceptable.
  (async () => {
    try {
      const [{ rehydrateFromFacts: rehydrateSubs }, { rehydrateFromFacts: rehydrateSchedules }] =
        await Promise.all([
          import("../../seed/present/wakes/subscriptions.js"),
          import("../../seed/present/wakes/wakeSchedule.js"),
        ]);
      await Promise.all([rehydrateSubs(), rehydrateSchedules()]);
    } catch (err) {
      log.warn("IBP", `rehydrate at boot failed: ${err.message}`);
    }
  })();
  // Start the schedule tick loop. Beings that have declared a wake
  // cadence get scheduled-wake SUMMONs emitted on their interval.
  // The loop is process-singleton and unref'd; nothing to do at
  // server shutdown beyond letting the process exit.
  startScheduleTick();
}

// Re-exports for convenience — anything that wants to USE the IBP
// primitives (e.g. eventually emit ibp:event frames from within a Speak
// handler) can import them through this module.
export { parseFromSocket, parseWithContext, format, canonical, getRealityDomain } from "../../seed/ibp/address.js";
export { resolveStance } from "../../seed/ibp/resolver.js";
export { buildPlaceDescriptor, buildDiscovery, DESCRIPTOR_VERSION, IBP_PROTOCOL_VERSION } from "../../seed/ibp/descriptor.js";
export { IbpError, IBP_ERR, isIbpError } from "../../seed/ibp/protocol.js";
// Scheduler observability only. Mutators like `wake`, `abortCurrent`,
// and the cancel sweeps are NOT re-exported: they let callers fabricate
// or sever work without an envelope, breaking the audit chain. The
// right way to wake a being is to SUMMON them; the right way to cut a
// sub-tree is to SUMMON `<reality>/./threads/<id>` (priority HUMAN for
// out-of-band interrupt).
export { getCurrentRootCorrelation, getStats as getSchedulerStats } from "../../seed/present/intake/scheduler.js";
// Reply aggregation pattern for fanout (Foreman → Workers, etc.).
export { aggregate } from "../../seed/present/replies.js";
// Subscription registry — extensions declare DO-trigger interest so
// their beings get summoned when matching substrate writes happen.
export {
  subscribe,
  unsubscribe,
  unsubscribeAllForBeing,
  getMatchingSubscribers,
  emitToSubscribers,
  getStats as getSubscriptionStats,
} from "../../seed/present/wakes/subscriptions.js";
// Schedule registry — extensions declare wake cadences so their
// beings get scheduled-wake SUMMONs on intervals. Default emitter is
// Mode 2 (@system sender); embodied flavor swaps via setEmitter.
export {
  schedule,
  unschedule,
  unscheduleAllForBeing,
  setEmitter as setScheduleEmitter,
  resetEmitter as resetScheduleEmitter,
  getStats as getScheduleStats,
} from "../../seed/present/wakes/wakeSchedule.js";
