// IBP (Inter-Being Protocol) — boot entry point.
//
// IBP is core, peer to seed/, routes/, extensions/. It carries Portal
// Addresses as its native address primitive. IBP is the Land's second
// protocol surface alongside the legacy HTTP API.
//
// Boot ordering (called from server.js):
//   1. initPortalHttp(app) . BEFORE the catch-all 404 handler. Registers the
//      single bootstrap route GET /.well-known/treeos-portal.
//   2. initPortalWs(io)   . AFTER initWebSocketServer() returns the io.
//      Attaches portal:* event handlers onto every authenticated socket.
//
// Both must be called for IBP to be fully alive on a Land.

import log from "../seed/log.js";
import { registerPortalBootstrap } from "./bootstrap-route.js";
import { attachPortalHandlers } from "./protocol.js";
import { hooks } from "../seed/hooks.js";
import Node from "../seed/models/node.js";
import { emitPositionInvalidate } from "./live.js";

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

  log.info("Portal", "live SEE hooks wired (afterMetadataWrite, afterNode*, afterStatusChange, afterNote, afterToolCall)");
}

/**
 * Register the single HTTP bootstrap route.
 * Call from server.js after registerURLRoutes(app), before the 404 catch-all.
 */
export function initPortalHttp(app) {
  registerPortalBootstrap(app);
  log.info("Portal", "IBP HTTP bootstrap registered at /.well-known/treeos-portal");
}

/**
 * Attach IBP WS handlers to the Socket.IO server.
 * Call from server.js after initWebSocketServer() returns the io.
 */
export function initPortalWs(io) {
  if (!io) {
    log.error("Portal", "initPortalWs called without io instance");
    return;
  }
  wireLiveHooks();
  attachPortalHandlers(io);
}

// Re-exports for convenience — anything that wants to USE the Portal
// primitives (e.g. eventually emit portal:event frames from within a Speak
// handler) can import them through this module.
export { parseFromSocket, parseWithContext, format, canonical, getLandDomain } from "./address.js";
export { resolveStance } from "./resolver.js";
export { buildDescriptor } from "./descriptor.js";
export { buildDiscovery, PORTAL_PROTOCOL_VERSION, DESCRIPTOR_VERSION } from "./discovery.js";
export { PortalError, PORTAL_ERR, isPortalError } from "./errors.js";
