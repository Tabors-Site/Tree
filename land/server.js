import express from "express";
import cors from "cors";
import http from "http";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";

import registerURLRoutes from "./routes/handler.js";
import { initWebSocketServer } from "./seed/ws/websocket.js";
import { initPortalHttp, initPortalWs } from "./portal/index.js";
import { sendOk, sendError, ERR } from "./seed/protocol.js";
import { getExtension } from "./extensions/loader.js";
import securityHeaders from "./seed/middleware/securityHeaders.js";
import { onListen } from "./startup.js";
import { getLandUrl } from "./canopy/identity.js";
import log from "./seed/log.js";

function notFoundPage(req, res, message = "This page doesn't exist or may have been moved.") {
  const fn = getExtension("html-rendering")?.exports?.notFoundPage;
  if (fn) return fn(req, res, message);
  return sendError(res, 404, ERR.NODE_NOT_FOUND, message);
}

// Raw-body webhook slot. Extensions that need raw body (Stripe signature verification)
// return rawWebhook from init(). The loader calls registerRawWebhook() during wire phase.
let rawWebhookHandler = (_req, res) => sendError(res, 404, ERR.EXTENSION_NOT_FOUND, "No webhook handler registered");

export function registerRawWebhook(handler) {
  if (typeof handler === "function") rawWebhookHandler = handler;
}

// .env is loaded by boot.js before this module is imported.

const app = express();

// CORS: landUrl + configured allowed domains. The Land is a first-class
// server that accepts traffic from multiple kinds of clients:
//   - Its own UI (landUrl)
//   - Chrome extensions (origin "chrome-extension://...")
//   - The Portal (a separate dev/native app on its own origin)
//   - Anything explicitly added to `allowedFrameDomains` config
//
// In dev mode (LAND_DOMAIN=localhost or similar), we also allow ANY
// localhost origin — that's how multiple dev tools naturally coexist on
// one machine. In production this loosening doesn't apply.
const landUrl = getLandUrl();
const corsOrigins = [landUrl];
const isDevMode = (() => {
  const d = (process.env.LAND_DOMAIN || "localhost").toLowerCase();
  return d === "localhost" || d.startsWith("localhost") || d.startsWith("127.") || d.startsWith("192.168.") || d.startsWith("10.") || d.endsWith(".lan") || d.endsWith(".local") || !d.includes(".");
})();
try {
  const { getLandConfigValue } = await import("./seed/landConfig.js");
  const extra = getLandConfigValue("allowedFrameDomains");
  if (Array.isArray(extra)) {
    for (const domain of extra) {
      if (typeof domain === "string" && domain.length > 0) corsOrigins.push(domain);
    }
  }
} catch {}

const LOCALHOST_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d{1,5})?$/i;

function corsOriginCheck(origin, cb) {
  // No origin = same-origin or non-browser client (CLI, curl, etc.). Allow.
  if (!origin) return cb(null, true);
  // Configured allow-list.
  if (corsOrigins.includes(origin)) return cb(null, true);
  // Chrome extensions (parity with the WS CORS in seed/ws/websocket.js).
  if (origin.startsWith("chrome-extension://")) return cb(null, true);
  // Dev mode: any localhost origin (so the Portal at localhost:5175,
  // a separate dev tool, etc. can all talk to a local Land at 3000).
  if (isDevMode && LOCALHOST_ORIGIN_RE.test(origin)) return cb(null, true);
  cb(null, false);
}

// IBP is **structurally cross-origin**. Any Portal client from any origin
// must be able to open a WS connection. Authentication is bearer-token
// (auth.token in the Socket.IO handshake), not cookies; browsers do not
// auto-send cookies cross-origin, so legacy cookie-authed handlers
// already fail closed for unauthenticated cross-origin sockets. The WS
// origin gate is therefore not load-bearing for security; it would only
// prevent legitimate Portal clients from connecting.
function wsOriginCheck(_origin, cb) {
  return cb(null, true);
}

app.use(
  cors({
    origin: corsOriginCheck,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-api-key", "x-internal-token"],
    credentials: true,
  }),
);
app.use(cookieParser());

// Raw-body webhook route. Must be before express.json. Handler registered by extension during boot.
app.post("/billing/webhook", express.raw({ type: "application/json" }), (req, res) => rawWebhookHandler(req, res));

app.use(express.static("public"));
app.use(express.json({ limit: "10mb" })); // Extension install sends file contents up to 3MB
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
// Trust proxy depth. Set TRUST_PROXY=2 for Cloudflare + nginx, etc.
// Wrong value = rate limiter uses proxy IP instead of client IP.
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

// Portal Protocol — core peer to the legacy URL-based API. Registers the
// single HTTP bootstrap route (/.well-known/treeos-portal) BEFORE the
// catch-all so it isn't shadowed. Everything else in the Portal Protocol
// travels over WebSocket; see land/portal/.
initPortalHttp(app);

app.use((req, res) => notFoundPage(req, res));

const server = http.createServer(app);
// IBP is cross-origin by design. The WS gate accepts any origin; per-handler
// auth (JWT in the Socket.IO handshake) is what enforces access. Legacy
// cookie-authed chat handlers stay safe because browsers don't auto-send
// cookies cross-origin — those handlers see no userId and reject.
export const wsServer = initWebSocketServer(server, wsOriginCheck);

// Attach Portal Protocol WS handlers to the same Socket.IO instance the
// legacy chat WS uses. Zero shared event names with the legacy `op:"chat"`
// protocol — both coexist on the same socket.
initPortalWs(wsServer);

const PORT = process.env.PORT || 80;
server.listen(PORT, "0.0.0.0", () => onListen());

// Graceful shutdown
async function shutdown(signal) {
  log.info("Seed", `${signal} received. Shutting down...`);

  // Close all MCP clients (these hold connections open)
  try {
    const { mcpClients, closeMCPClient } = await import("./seed/ws/mcp.js");
    for (const [visitorId] of mcpClients) {
      try { closeMCPClient(visitorId); } catch {}
    }
  } catch {}

  // Close WebSocket server (disconnects all clients)
  try {
    wsServer?.close?.();
  } catch {}

  // Remove disconnect listener so it doesn't log after the shell prompt returns
  mongoose.connection.removeAllListeners("disconnected");
  try { await mongoose.connection.close(); } catch {}
  server.close(() => {});
  log.info("Seed", "Shutdown complete.");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
