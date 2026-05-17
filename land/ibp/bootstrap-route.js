// IBP (Inter-Being Protocol) HTTP bootstrap.
//
// One HTTP route. The Portal client uses this to discover where to open
// its WebSocket connection before it has one. Everything else in IBP
// travels over WebSocket.
//
// GET /.well-known/treeos-portal → { ws, protocolVersion, land }
//
// The response is intentionally minimal: just enough information for the
// client to open a socket. Full capability discovery (zones, embodiments,
// supported actions, version negotiation) moves to `see <land>/.discovery`
// once the socket is open.
//
// CORS: this endpoint is **structurally cross-origin**. Any Portal client
// from any origin must be able to fetch it; that is the whole point of a
// discovery surface. We set `Access-Control-Allow-Origin: *` explicitly
// on this route, overriding whatever the global CORS policy is. The
// response carries no credentials and no secrets; it is the IBP equivalent
// of DNS — a public lookup.

import cors from "cors";
import { getLandDomain } from "./address.js";
import { PORTAL_PROTOCOL_VERSION } from "./discovery.js";
import { getLandUrl } from "../canopy/identity.js";
import { getLandConfigValue } from "../seed/landConfig.js";

// Permissive route-level CORS just for the bootstrap. Wins over the
// global cors() middleware on this specific route.
const bootstrapCors = cors({
  origin: "*",
  methods: ["GET", "HEAD", "OPTIONS"],
  credentials: false,
  maxAge: 86400, // cache the preflight for a day
});

/**
 * Register the bootstrap HTTP route on the Express app.
 * MUST be called BEFORE the catch-all 404 handler in server.js.
 */
export function registerPortalBootstrap(app) {
  app.options("/.well-known/treeos-portal", bootstrapCors);
  app.get("/.well-known/treeos-portal", bootstrapCors, (_req, res) => {
    const landUrl = getLandUrl();
    const wsUrl = landUrl.replace(/^http/, "ws");
    res.json({
      ws: wsUrl,
      protocolVersion: PORTAL_PROTOCOL_VERSION,
      land: getLandDomain(),
      timezone: getLandConfigValue("timezone") || null,
    });
  });
}
