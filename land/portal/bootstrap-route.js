// Portal Protocol HTTP bootstrap.
//
// One — and only one — HTTP route. The Portal client uses this to discover
// where to open its WebSocket connection before it has one. Everything else
// in the Portal Protocol travels over WS.
//
// GET /.well-known/treeos-portal → { ws, version, capabilities, ... }
//
// The same shape is also reachable via `portal:discover` on the WS connection.
// After the client connects, this HTTP route is never needed again.

import { buildDiscovery } from "./discovery.js";

/**
 * Register the bootstrap HTTP route on the Express app.
 * MUST be called BEFORE the catch-all 404 handler in server.js.
 */
export function registerPortalBootstrap(app) {
  app.get("/.well-known/treeos-portal", (_req, res) => {
    res.json(buildDiscovery());
  });
}
