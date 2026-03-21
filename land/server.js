import express from "express";
import cors from "cors";
import http from "http";
import cookieParser from "cookie-parser";
import registerRoutes from "./routesFrontend/routesHandler.js";
import registerURLRoutes from "./routes/routeHandler.js";

import { initWebSocketServer } from "./ws/websocket.js";
import { startRawIdeaAutoPlaceJob } from "./jobs/rawIdeaAutoPlace.js";
import { startTreeDreamJob, runTreeDreamJob } from "./jobs/treeDream.js";
import { notFoundPage } from "./middleware/notFoundPage.js";
import mongoose from "./db/config.js"; // Initialize DB connection
import { getLandIdentity } from "./canopy/identity.js";
import { startHeartbeatJob } from "./canopy/peers.js";
import { startOutboxJob } from "./canopy/events.js";

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const rootFrontEnd = process.env.ROOT_FRONTEND_DOMAIN;
const treeFrontEnd = process.env.TREE_FRONTEND_DOMAIN;

const app = express();

app.use(
  cors({
    origin: [rootFrontEnd, treeFrontEnd],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);
app.use(cookieParser());
import { stripeWebhook } from "./routes/billing/webhook.js";

app.post(
  "/billing/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhook,
);

app.options("*", cors());
app.use(express.static("public"));
app.use(express.json({ limit: "1000mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));
app.set("trust proxy", 1);

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");

  // Allow framing from your own domains only
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader(
    "Content-Security-Policy",
    `frame-ancestors 'self' ${process.env.TREE_FRONTEND_DOMAIN || "https://treeOS.ai"} https://*.${process.env.ROOT_FRONTEND_DOMAIN ? new URL(process.env.ROOT_FRONTEND_DOMAIN).hostname : "tabors.site"}`,
  );

  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  res.setHeader(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains",
  );

  next();
});

registerRoutes(app);
registerURLRoutes(app);

// Catch-all 404 for unmatched routes
app.use((req, res) => {
  notFoundPage(req, res);
});

const server = http.createServer(app);
export const wsServer = initWebSocketServer(server);

const PORT = process.env.PORT || 80; //

server.listen(PORT, "0.0.0.0", async () => {
  // Initialize land identity (generates keypair on first boot)
  const land = getLandIdentity();
  console.log("[Land] Initializing Tree Land Node...");
  console.log(`[Land] Domain: ${land.domain}`);
  console.log(`[Land] Name: ${land.name}`);
  console.log(`[Land] Land ID: ${land.landId}`);
  console.log(`[Land] Canopy Protocol Version: ${land.protocolVersion}`);

  startRawIdeaAutoPlaceJob({ intervalMs: 15 * 60 * 1000 });
  startTreeDreamJob({ intervalMs: 30 * 60 * 1000 });

  // Wait for MongoDB before running startup tasks
  const onDbReady = () => {
    console.log("[Land] MongoDB connected");
    runTreeDreamJob();
    console.log(
      "[Land] Background jobs started (dream, drain, cleanup, understanding)",
    );

    // Start canopy network jobs
    startHeartbeatJob();
    startOutboxJob();
    console.log("[Land] Canopy API ready");

    // Connect Discord bots for gateway input channels
    import("./core/discordBotManager.js")
      .then(({ startupScan }) => {
        startupScan();
        console.log("[Land] Gateway scan complete");
        console.log(`[Land] Land node online. Listening on port ${PORT}`);
      })
      .catch((err) => {
        console.error("[Land] Discord bot startup scan failed:", err.message);
        console.log(`[Land] Land node online. Listening on port ${PORT}`);
      });
  };

  mongoose.connection.on("connected", onDbReady);
  if (mongoose.connection.readyState === 1) {
    onDbReady();
  }
});
