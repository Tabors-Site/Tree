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
import { hooks } from "../../seed/hooks.js";
import Space from "../../seed/materials/space/space.js";
import { emitPositionInvalidate } from "./live.js";
import { emitToSubscribers } from "../../seed/present/wakes/subscriptions.js";
import { startTickLoop as startScheduleTick } from "../../seed/present/wakes/wakeSchedule.js";

// Seed-signal-to-live-emit bridge. When seed events touch data that
// the Position Description reads, invalidate subscribers so they refetch.
// First cut: invalidate. Patch-based diffs come later as an optimization.

let _hooksWired = false;
function wireLiveHooks() {
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
  hooks.register("afterQualityWrite", async ({ spaceId, ns, target }) => {
    if (!spaceId) return;
    emitPositionInvalidate(spaceId, `qualities:${ns}`);
    // For space-target writes, also invalidate the parent (which lists
    // this space as a child with its own qualities surfaced).
    if (target?.kind === "space") {
      try {
        const s = await Space.findById(target.id).select("parent").lean();
        if (s?.parent) emitPositionInvalidate(s.parent, `child-metadata:${ns}`);
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
  attachIbpHandlers(io);
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
// sub-tree is to SUMMON `<reality>/.threads/<id>` (priority HUMAN for
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
