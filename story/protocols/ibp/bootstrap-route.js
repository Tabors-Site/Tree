// IBP (Inter-Being Protocol) HTTP bootstrap.
//
// One HTTP route. The Portal client uses this to discover where to open
// its WebSocket connection before it has one. Everything else in IBP
// travels over WebSocket.
//
// GET /.well-known/treeos-portal → { ws, protocolVersion, story, timezone }
//
// The response is intentionally minimal: just enough information for the
// client to open a socket. Full capability discovery (zones, beings,
// supported actions, version negotiation) moves to `see <story>/.discovery`
// once the socket is open.
//
// CORS: this endpoint is **structurally cross-origin**. Any Portal client
// from any origin must be able to fetch it; that is the whole point of a
// discovery surface. We set `Access-Control-Allow-Origin: *` explicitly
// on this route, overriding whatever the global CORS policy is. The
// response carries no credentials and no secrets; it is the IBP equivalent
// of DNS — a public lookup.

import cors from "cors";
import { getStoryDomain } from "../../seed/ibp/address.js";
import { IBP_PROTOCOL_VERSION } from "../../seed/ibp/descriptor.js";
import { getStoryUrl } from "../../seed/storyIdentity.js";
import { getStoryConfigValue } from "../../seed/storyConfig.js";

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
export function registerIbpBootstrap(app) {
  app.options("/.well-known/treeos-portal", bootstrapCors);
  app.get("/.well-known/treeos-portal", bootstrapCors, (_req, res) => {
    const storyUrl = getStoryUrl();
    const wsUrl = storyUrl.replace(/^http/, "ws");
    res.json({
      ws: wsUrl,
      protocolVersion: IBP_PROTOCOL_VERSION,
      story: getStoryDomain(),
      timezone: getStoryConfigValue("timezone") || null,
    });
  });
}
