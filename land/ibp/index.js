// IBP (Inter-Being Protocol) — boot entry point.
//
// IBP is core, peer to seed/, routes/, extensions/. It carries Portal
// Addresses as its native address primitive. IBP is the Land's second
// protocol surface alongside the legacy HTTP API.
//
// Boot ordering (called from server.js):
//   1. initIBPHttp(app) . BEFORE the catch-all 404 handler. Registers the
//      single bootstrap route GET /.well-known/treeos-portal.
//   2. initIBPWS(io)   . AFTER initWebSocketServer() returns the io.
//      Attaches portal:* event handlers onto every authenticated socket.
//
// Both must be called for IBP to be fully alive on a Land.

import log from "../seed/log.js";
import { registerPortalBootstrap } from "./bootstrap-route.js";
import { attachPortalHandlers } from "./protocol.js";
import { hooks } from "../seed/hooks.js";
import Node from "../seed/models/node.js";
import { emitPositionInvalidate } from "./live.js";
import { emitToSubscribers } from "./subscriptions.js";
import { startTickLoop as startScheduleTick } from "./schedule.js";

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
  hooks.register("afterMetadataWrite", async ({ nodeId, extName }) => {
    if (!nodeId || !PLACEMENT_NAMESPACES.has(extName)) return;
    emitPositionInvalidate(nodeId, `metadata:${extName}`);
    try {
      const n = await Node.findById(nodeId).select("parent").lean();
      if (n?.parent) emitPositionInvalidate(n.parent, `child-metadata:${extName}`);
    } catch { /* defensive */ }
  }, "portal-live");

  // Structural changes: new/removed/moved children change the parent's
  // descriptor. Status changes change the child's own descriptor.
  hooks.register("afterNodeCreate", async ({ node }) => {
    if (node?.parent) emitPositionInvalidate(node.parent, "child-created");
  }, "portal-live");
  hooks.register("afterNodeDelete", async ({ node }) => {
    if (node?.parent) emitPositionInvalidate(node.parent, "child-deleted");
  }, "portal-live");
  hooks.register("afterStatusChange", async ({ nodeId }) => {
    if (nodeId) emitPositionInvalidate(nodeId, "status-changed");
  }, "portal-live");
  hooks.register("afterArtifact", async ({ nodeId }) => {
    if (nodeId) emitPositionInvalidate(nodeId, "note-changed");
  }, "portal-live");

  // Chainstep state changes: every tool call shifts the "activity" field
  // for the being whose chainstep just ran. Invalidate the bound nodeId
  // so subscribers re-fetch and see the new activity entry.
  hooks.register("afterToolCall", async ({ nodeId, toolName }) => {
    if (nodeId) emitPositionInvalidate(nodeId, `tool:${toolName || "unknown"}`);
  }, "portal-live");

  // DO-trigger fan-out. The three substrate write events fan out
  // through the subscription registry: any being subscribed to one of
  // these events whose scope covers the affected position gets a
  // SUMMON in its inbox with intent="do-trigger". The receiving
  // being's role template interprets the trigger content and decides
  // whether to act. This is the universal bridge between Mode 2
  // (anonymous code emitting DOs) and Mode 1 (beings reacting to
  // substrate changes through summons).
  hooks.register("afterArtifact",      (payload) => emitToSubscribers("afterArtifact",      payload), "portal-subscriptions");
  hooks.register("afterStatusChange",  (payload) => emitToSubscribers("afterStatusChange",  payload), "portal-subscriptions");
  hooks.register("afterMetadataWrite", (payload) => emitToSubscribers("afterMetadataWrite", payload), "portal-subscriptions");

  log.info("IBP", "live SEE hooks wired (afterMetadataWrite, afterNode*, afterStatusChange, afterNote, afterToolCall); DO-trigger subscriptions wired (afterArtifact, afterStatusChange, afterMetadataWrite)");
}

/**
 * Register the single HTTP bootstrap route.
 * Call from server.js after registerURLRoutes(app), before the 404 catch-all.
 */
export function initIBPHttp(app) {
  registerPortalBootstrap(app);
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
  attachPortalHandlers(io);
  // Start the schedule tick loop. Beings that have declared a wake
  // cadence get scheduled-wake SUMMONs emitted on their interval.
  // The loop is process-singleton and unref'd; nothing to do at
  // server shutdown beyond letting the process exit.
  startScheduleTick();
}

// Re-exports for convenience — anything that wants to USE the Portal
// primitives (e.g. eventually emit portal:event frames from within a Speak
// handler) can import them through this module.
export { parseFromSocket, parseWithContext, format, canonical, getLandDomain } from "./address.js";
export { resolveStance } from "./resolver.js";
export { buildDescriptor } from "./descriptor.js";
export { buildDiscovery, PORTAL_PROTOCOL_VERSION, DESCRIPTOR_VERSION } from "./discovery.js";
export { PortalError, PORTAL_ERR, isPortalError } from "./errors.js";
// Inbox primitives that role templates need (cancel sweeps, etc.). Append
// and read are deliberately not re-exported — only SUMMON should write
// the inbox; role templates either let the scheduler consume entries or
// emit follow-up SUMMONs.
export { cancelByRootCorrelation, pickNextEntry } from "./inbox.js";
// Scheduler controls that role templates may invoke when interpreting
// cancel SUMMONs or when coordinating with other beings.
export { wake, abortCurrent, getCurrentRootCorrelation, getStats as getSchedulerStats } from "./scheduler.js";
// Reply aggregation pattern for fanout (Foreman → Workers, etc.).
export { aggregate } from "./replyAggregator.js";
// Subscription registry — extensions declare DO-trigger interest so
// their beings get summoned when matching substrate writes happen.
export {
  subscribe,
  unsubscribe,
  unsubscribeAllForBeing,
  getMatchingSubscribers,
  emitToSubscribers,
  getStats as getSubscriptionStats,
} from "./subscriptions.js";
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
} from "./schedule.js";
