import express from "express";
import cors from "cors";
import http from "http";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import registerURLRoutes from "./routes/routeHandler.js";
import { initWebSocketServer } from "./seed/ws/websocket.js";
import { sendOk, sendError, ERR } from "./seed/protocol.js";
import { getExtension } from "./extensions/loader.js";
function notFoundPage(req, res, message = "This page doesn't exist or may have been moved.") {
  const fn = getExtension("html-rendering")?.exports?.notFoundPage;
  if (fn) return fn(req, res, message);
  return sendError(res, 404, ERR.NODE_NOT_FOUND, message);
}
import securityHeaders from "./seed/middleware/securityHeaders.js";
// Billing webhook loaded dynamically (extension-owned)
let stripeWebhook = (req, res) => sendError(res, 500, ERR.INTERNAL, "Billing extension not loaded");
try {
  const mod = await import("./extensions/billing/webhook.js");
  stripeWebhook = mod.stripeWebhook;
} catch {}
import { onListen } from "./startup.js";
import { getLandUrl } from "./canopy/identity.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, ".env") });

const app = express();

app.use(
  cors({
    origin: [getLandUrl()],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);
app.use(cookieParser());
app.post("/billing/webhook", express.raw({ type: "application/json" }), stripeWebhook);
app.options("*", cors());
app.use(express.static("public"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(securityHeaders);

// Health check (no auth, used by load balancers / uptime monitors)
app.get("/health", async (_req, res) => {
  const mongoose = (await import("mongoose")).default;
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
async function shutdown(signal) {
  console.log(`\n[KERNEL] ${signal} received. Shutting down...`);
  server.close(() => {
    import("mongoose").then(m => m.default.connection.close()).catch(() => {});
    console.log("[KERNEL] Server closed.");
    process.exit(0);
  });
  setTimeout(() => { console.log("[KERNEL] Forced exit."); process.exit(1); }, 10000);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
