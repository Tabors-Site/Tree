// Portal Protocol HTTP bootstrap.
//
// One HTTP route. The Portal client uses this to discover where to open
// its WebSocket connection before it has one. Everything else in the
// Portal Protocol travels over WebSocket.
//
// GET /.well-known/treeos-portal → { ws, protocolVersion, land }
//
// The response is intentionally minimal: just enough information for the
// client to open a socket. Full capability discovery (zones, embodiments,
// supported actions, version negotiation) moves to `see <land>/.discovery`
// once the socket is open.

import { getLandDomain } from "./address.js";
import { PORTAL_PROTOCOL_VERSION } from "./discovery.js";
import { getLandUrl } from "../canopy/identity.js";

/**
 * Register the bootstrap HTTP route on the Express app.
 * MUST be called BEFORE the catch-all 404 handler in server.js.
 */
export function registerPortalBootstrap(app) {
  app.get("/.well-known/treeos-portal", (_req, res) => {
    const landUrl = getLandUrl();
    const wsUrl = landUrl.replace(/^http/, "ws");
    res.json({
      ws: wsUrl,
      protocolVersion: PORTAL_PROTOCOL_VERSION,
      land: getLandDomain(),
    });
  });
}
