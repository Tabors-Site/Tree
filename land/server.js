import express from "express";
import cors from "cors";
import http from "http";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";

import registerURLRoutes from "./routes/handler.js";
import { initWebSocketServer } from "./seed/ws/websocket.js";
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

// Billing webhook loaded dynamically (extension-owned).
// Must be mounted BEFORE express.json() because Stripe needs the raw body.
let stripeWebhook = (req, res) => sendError(res, 500, ERR.INTERNAL, "Billing extension not loaded");
try {
  const mod = await import("./extensions/billing/webhook.js");
  stripeWebhook = mod.stripeWebhook;
} catch (err) {
  if (err.code !== "ERR_MODULE_NOT_FOUND") {
    log.warn("Server", `Billing webhook failed to load: ${err.message}`);
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, ".env") });

const app = express();

// CORS: landUrl + any configured allowed domains
const landUrl = getLandUrl();
const corsOrigins = [landUrl];
try {
  const { getLandConfigValue } = await import("./seed/landConfig.js");
  const extra = getLandConfigValue("allowedFrameDomains");
  if (Array.isArray(extra)) {
    for (const domain of extra) {
      if (typeof domain === "string" && domain.length > 0) corsOrigins.push(domain);
    }
  }
} catch {}

app.use(
  cors({
    origin: corsOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-api-key", "x-internal-token"],
    credentials: true,
  }),
);
app.use(cookieParser());

// Billing webhook MUST be before express.json (needs raw body for signature verification)
app.post("/billing/webhook", express.raw({ type: "application/json" }), stripeWebhook);

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

await registerURLRoutes(app);
app.use((req, res) => notFoundPage(req, res));

const server = http.createServer(app);
export const wsServer = initWebSocketServer(server);

const PORT = process.env.PORT || 80;
server.listen(PORT, "0.0.0.0", () => onListen());

// Graceful shutdown
const SHUTDOWN_TIMEOUT_MS = 15000;

async function shutdown(signal) {
  log.info("Kernel", `${signal} received. Shutting down...`);

  // Stop accepting new connections
  server.close(async () => {
    try {
      await mongoose.connection.close();
      log.info("Kernel", "Database connection closed.");
    } catch {}
    log.info("Kernel", "Server closed.");
    process.exit(0);
  });

  // Force exit if graceful shutdown hangs
  setTimeout(() => {
    log.warn("Kernel", "Forced exit after timeout.");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
