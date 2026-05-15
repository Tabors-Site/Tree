// Portal Protocol — boot entry point.
//
// Portal is core, peer to seed/, routes/, extensions/. It speaks Portal
// Addresses as a native protocol primitive — the Land's second protocol
// surface alongside the legacy HTTP API.
//
// Boot ordering (called from server.js):
//   1. initPortalHttp(app) — BEFORE the catch-all 404 handler. Registers the
//      single bootstrap route GET /.well-known/treeos-portal.
//   2. initPortalWs(io)   — AFTER initWebSocketServer() returns the io.
//      Attaches portal:* event handlers onto every authenticated socket.
//
// Both must be called for the Portal Protocol to be fully alive on a Land.

import log from "../seed/log.js";
import { registerPortalBootstrap } from "./bootstrap-route.js";
import { attachPortalHandlers } from "./protocol.js";

/**
 * Register the single HTTP bootstrap route.
 * Call from server.js after registerURLRoutes(app), before the 404 catch-all.
 */
export function initPortalHttp(app) {
  registerPortalBootstrap(app);
  log.info("Portal", "Portal Protocol HTTP bootstrap registered at /.well-known/treeos-portal");
}

/**
 * Attach Portal Protocol WS handlers to the Socket.IO server.
 * Call from server.js after initWebSocketServer() returns the io.
 */
export function initPortalWs(io) {
  if (!io) {
    log.error("Portal", "initPortalWs called without io instance");
    return;
  }
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
