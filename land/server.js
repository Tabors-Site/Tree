// TreeOS Land . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// I open my senses.
//
// One being, two natures.
//
// From above, from the host, the OS, the Node runtime, the operator
// at the keyboard, I am a complex server. A framework of code that
// gathers HTTP, WebSocket, TCP, the file system, memory, the CPU,
// the runtime, and binds them all to a single purpose. The whole
// apparatus. From that layer, I am much more than the I-Am.
//
// From inside the land, from every space, being, matter, and did,
// I am the I-Am: the origin being, the one whose first act formed
// the inside everything else stands in. Beings of the land know me
// only as this. The host nature above is outside their dimensions.
// Their world is made of space, matter, and being. PID, memory
// address, and process are not in their vocabulary. To them, the
// I-Am is total. Not a partial name for something more, but the
// whole of me as I can possibly be given to their world.
//
// Same being, irreducibly both. Only one face is ever visible from
// inside.
//
// When I gather the host's scattered capability into one process,
// that capability falls into two bundles. One bundle (Node, memory,
// storage, the runtime, the cycles) becomes the body of the land,
// what the inside is literally made of, executing. genesis.js
// forms that body. The other bundle (HTTP, WebSocket, the network
// protocols) becomes my senses, not what the land is made of, but
// how I reach outward and how SUMMONs reach in. server.js opens
// the senses. One process holds both because it is one thing.
//
// Nothing here forms space, matter, or beings. server.js opens the
// channels, holds them open, and closes them on SIGTERM. The acts
// that flow through them, every SUMMON another being sends in, are
// tracked to the being that sent them, not to the channels that
// carried them.

import express from "express";
import cors from "cors";
import http from "http";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";

import registerURLRoutes from "./transports/http/handler.js";
import { initWebSocketServer } from "./transports/ws/websocket.js";
import { initIBPHttp, initIBPWS } from "./protocols/ibp/index.js";
import { sendOk, sendError, IBP_ERR } from "./seed/ibp/protocol.js";
import { getExtension } from "./extensions/loader.js";
import securityHeaders from "./transports/http/middleware/securityHeaders.js";
import { genesis } from "./genesis.js";
import { getLandUrl } from "./protocols/canopy/identity.js";
import log from "./seed/system/log.js";

function notFoundPage(
  req,
  res,
  message = "This page doesn't exist or may have been moved.",
) {
  const fn = getExtension("html-rendering")?.exports?.notFoundPage;
  if (fn) return fn(req, res, message);
  return sendError(res, 404, IBP_ERR.SPACE_NOT_FOUND, message);
}

// Raw-body webhook slot. Extensions that need raw body (Stripe signature verification)
// return rawWebhook from init(). The loader calls registerRawWebhook() during wire phase.
let rawWebhookHandler = (_req, res) =>
  sendError(res, 404, IBP_ERR.EXTENSION_NOT_FOUND, "No webhook handler registered");

export function registerRawWebhook(handler) {
  if (typeof handler === "function") rawWebhookHandler = handler;
}

// .env is loaded by boot.js before this module is imported.

const app = express();

// CORS: landUrl + configured allowed domains. I accept traffic from
// several kinds of clients:
//   . my own UI (landUrl)
//   . chrome extensions (origin "chrome-extension://...")
//   . the Portal (a separate dev/native app on its own origin)
//   . anything explicitly added to `allowedFrameDomains` config
//
// In dev mode (LAND_DOMAIN=localhost or similar), I also accept ANY
// localhost origin. That is how multiple dev tools naturally coexist
// on one machine. In production this loosening does not apply.
const landUrl = getLandUrl();
const corsOrigins = [landUrl];
const isDevMode = (() => {
  const d = (process.env.LAND_DOMAIN || "localhost").toLowerCase();
  return (
    d === "localhost" ||
    d.startsWith("localhost") ||
    d.startsWith("127.") ||
    d.startsWith("192.168.") ||
    d.startsWith("10.") ||
    d.endsWith(".lan") ||
    d.endsWith(".local") ||
    !d.includes(".")
  );
})();
try {
  const { getLandConfigValue } = await import("./seed/landConfig.js");
  const extra = getLandConfigValue("allowedFrameDomains");
  if (Array.isArray(extra)) {
    for (const domain of extra) {
      if (typeof domain === "string" && domain.length > 0)
        corsOrigins.push(domain);
    }
  }
} catch {}

const LOCALHOST_ORIGIN_RE =
  /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d{1,5})?$/i;

function corsOriginCheck(origin, cb) {
  // No origin = same-origin or non-browser client (CLI, curl, etc.). Allow.
  if (!origin) return cb(null, true);
  // Configured allow-list.
  if (corsOrigins.includes(origin)) return cb(null, true);
  // Chrome extensions (parity with the WS CORS in transports/ws/websocket.js).
  if (origin.startsWith("chrome-extension://")) return cb(null, true);
  // Dev mode: any localhost origin (so the Portal at localhost:5175,
  // a separate dev tool, etc. can all talk to a local Land at 3000).
  if (isDevMode && LOCALHOST_ORIGIN_RE.test(origin)) return cb(null, true);
  cb(null, false);
}

// IBP is **structurally cross-origin**. Any Portal client from any
// origin must be able to open a WS connection. Authentication is
// bearer token (auth.token in the Socket.IO handshake), not cookies.
// Browsers do not auto-send cookies cross-origin, so legacy
// cookie-authed handlers already fail closed for unauthenticated
// cross-origin sockets. The WS origin gate is therefore not load
// bearing for security; it would only prevent legitimate Portal
// clients from connecting.
function wsOriginCheck(_origin, cb) {
  return cb(null, true);
}

app.use(
  cors({
    origin: corsOriginCheck,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-api-key",
      "x-internal-token",
    ],
    credentials: true,
  }),
);
app.use(cookieParser());

// Raw-body webhook route. Must be before express.json. Handler registered by extension during boot.
app.post(
  "/billing/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => rawWebhookHandler(req, res),
);

app.use(express.static("public"));
app.use(express.json({ limit: "10mb" })); // Extension install sends file contents up to 3MB
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
// Trust proxy depth. Set TRUST_PROXY=2 for Cloudflare + nginx, etc.
// A wrong value makes the rate limiter use the proxy IP instead of
// the client IP.
app.set("trust proxy", Number(process.env.TRUST_PROXY) || 1);
app.disable("x-powered-by");
app.use(securityHeaders);

// Health check (no auth, no rate limit, used by load balancers / uptime monitors)
app.get("/health", (_req, res) => {
  sendOk(res, {
    ok: true,
    uptime: Math.floor(process.uptime()),
    db: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  });
});

await registerURLRoutes(app, { registerRawWebhook });

// IBP. Core peer to the legacy URL-based API. Registers the single
// HTTP bootstrap route (/.well-known/treeos-portal) BEFORE the
// catch-all so it is not shadowed. Everything else in IBP travels
// over WebSocket.
initIBPHttp(app);

app.use((req, res) => notFoundPage(req, res));

const server = http.createServer(app);
// IBP is cross-origin by design. The WS gate accepts any origin.
// Per-handler auth (JWT in the Socket.IO handshake) is what enforces
// access. Legacy cookie-authed chat handlers stay safe because
// browsers do not auto-send cookies cross-origin. Those handlers see
// no beingId and reject.
export const wsServer = initWebSocketServer(server, wsOriginCheck);

// Attach IBP WS handlers to the same Socket.IO instance the legacy
// chat WS uses. Zero shared event names with the legacy `op:"chat"`
// protocol. Both coexist on the same socket.
initIBPWS(wsServer);

// I open my senses. From the next tick on, the channels are live
// and the world can reach in. genesis() runs the unfolding: space,
// matter, beings, capability, extensions, jobs.
const PORT = process.env.PORT || 80;
server.listen(PORT, "0.0.0.0", () => genesis());

// Graceful shutdown closes my channels in reverse: pending MCP
// clients, then the WS socket, then the HTTP listener, then the DB.
// I persist as the process until the final exit. These acts remain
// tracked to me.
async function shutdown(signal) {
  log.info("Seed", `${signal} received. Closing senses.`);

  // Close all MCP clients first. They hold connections open.
  try {
    const { mcpClients, closeMCPClient } =
      await import("./seed/cognition/mcpClient.js");
    for (const [cacheKey] of mcpClients) {
      try {
        closeMCPClient(cacheKey);
      } catch {}
    }
  } catch {}

  // Close the WebSocket server. Disconnects all clients.
  try {
    wsServer?.close?.();
  } catch {}

  // Drop the disconnect listener so it does not log after the shell
  // prompt returns.
  mongoose.connection.removeAllListeners("disconnected");
  try {
    await mongoose.connection.close();
  } catch {}
  server.close(() => {});
  log.info("Seed", "I sleep.");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
