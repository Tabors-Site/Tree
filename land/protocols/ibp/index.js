// IBP (Inter-Being Protocol) — boot entry point.
//
// IBP is core, peer to seed/, transports/, extensions/. It carries IBP
// Addresses as its native address primitive. IBP is the Land's second
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
// Both must be called for IBP to be fully alive on a Land.

import log from "../../seed/system/log.js";
import { registerIbpBootstrap } from "./bootstrap-route.js";
import { attachIbpHandlers } from "./protocol.js";
import { hooks } from "../../seed/system/hooks.js";
import Space from "../../seed/models/space.js";
import { emitPositionInvalidate } from "./live.js";
import { emitToSubscribers } from "../../seed/cognition/subscriptions.js";
import { startTickLoop as startScheduleTick } from "../../seed/cognition/wakeSchedule.js";

// Kernel-signal-to-live-emit bridge. When kernel events touch data that
// the Position Description reads, invalidate subscribers so they refetch.
// First cut: invalidate. Patch-based diffs come later as an optimization.
const PLACEMENT_NAMESPACES = new Set(["position", "scenes", "models", "inbox"]);

let _hooksWired = false;
function wireLiveHooks() {
  if (_hooksWired) return;
  _hooksWired = true;

  // Placement metadata changed on a node: invalidate the node's own
  // descriptor and its parent's (which lists this node as a child).
  hooks.register("afterMetadataWrite", async ({ spaceId, extName }) => {
    if (!spaceId || !PLACEMENT_NAMESPACES.has(extName)) return;
    emitPositionInvalidate(spaceId, `metadata:${extName}`);
    try {
      const n = await Space.findById(spaceId).select("parent").lean();
      if (n?.parent) emitPositionInvalidate(n.parent, `child-metadata:${extName}`);
    } catch { /* defensive */ }
  }, "ibp-live");

  // Structural changes: new/removed/moved children change the parent's
  // descriptor. Matter writes change the affected position's content.
  hooks.register("afterSpaceCreate", async ({ node }) => {
    if (node?.parent) emitPositionInvalidate(node.parent, "child-created");
  }, "ibp-live");
  hooks.register("afterSpaceDelete", async ({ node }) => {
    if (node?.parent) emitPositionInvalidate(node.parent, "child-deleted");
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
  hooks.register("afterMetadataWrite", (payload) => emitToSubscribers("afterMetadataWrite", payload), "ibp-subscriptions");

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
export { parseFromSocket, parseWithContext, format, canonical, getLandDomain } from "../../seed/ibp/address.js";
export { resolveStance } from "../../seed/ibp/resolver.js";
export { buildDescriptor } from "../../seed/ibp/descriptor.js";
export { buildDiscovery, IBP_PROTOCOL_VERSION } from "../../seed/ibp/discovery.js";
export { DESCRIPTOR_VERSION } from "../../seed/ibp/descriptor.js";
export { IbpError, IBP_ERR, isIbpError } from "../../seed/ibp/errors.js";
// Inbox primitives that role templates need (cancel sweeps, etc.). Append
// and read are deliberately not re-exported — only SUMMON should write
// the inbox; role templates either let the scheduler consume entries or
// emit follow-up SUMMONs.
export { cancelByRootCorrelation, pickNextEntry } from "../../seed/cognition/inbox.js";
// Scheduler controls that role templates may invoke when interpreting
// cancel SUMMONs or when coordinating with other beings.
export { wake, abortCurrent, getCurrentRootCorrelation, getStats as getSchedulerStats } from "../../seed/cognition/scheduler.js";
// Reply aggregation pattern for fanout (Foreman → Workers, etc.).
export { aggregate } from "../../seed/cognition/replyAggregator.js";
// Subscription registry — extensions declare DO-trigger interest so
// their beings get summoned when matching substrate writes happen.
export {
  subscribe,
  unsubscribe,
  unsubscribeAllForBeing,
  getMatchingSubscribers,
  emitToSubscribers,
  getStats as getSubscriptionStats,
} from "../../seed/cognition/subscriptions.js";
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
} from "../../seed/cognition/wakeSchedule.js";
