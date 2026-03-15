import express from "express";
import cors from "cors";
import http from "http";
import cookieParser from "cookie-parser";
import registerRoutes from "./routes/routesHandler.js";
import registerURLRoutes from "./routesURL/routeURLHandler.js";

import { initWebSocketServer } from "./ws/websocket.js";
import { startRawIdeaAutoPlaceJob } from "./jobs/rawIdeaAutoPlace.js";
import { startTreeDreamJob, runTreeDreamJob } from "./jobs/treeDream.js";
import { notFoundPage } from "./middleware/notFoundPage.js";
import mongoose from "./db/config.js"; // Initialize DB connection

import dotenv from "dotenv";
//import { initWebSocketServer } from "./ws/websocket.js";

dotenv.config();

const rootFrontEnd = process.env.ROOT_FRONTEND_DOMAIN;
const treeFrontEnd = process.env.TREE_FRONTEND_DOMAIN;
const beFrontEnd = process.env.BE_FRONTEND_DOMAIN;

const app = express();

app.use(
  cors({
    origin: [rootFrontEnd, treeFrontEnd, beFrontEnd],
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
    "frame-ancestors 'self' https://tree.tabors.site https://*.tabors.site",
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
  console.log(`Express server (Tree/MCP coupled) running on port ${PORT}`);
  startRawIdeaAutoPlaceJob({ intervalMs: 15 * 60 * 1000 });
  startTreeDreamJob({ intervalMs: 30 * 60 * 1000 });
  // Wait for MongoDB before running immediately
  mongoose.connection.on("connected", () => {
    runTreeDreamJob();
  });
  if (mongoose.connection.readyState === 1) {
    runTreeDreamJob();
  }
});
