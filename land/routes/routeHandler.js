import me from "./api/me.js";
import note from "./api/notes.js";
import node from "./api/node.js";
import root from "./api/root.js";
import { authApiRouter } from "./auth.js";
import user from "./api/user.js";

import contributions from "./api/contributions.js";
import transactions from "./api/transactions.js";
import values from "./api/values.js";

import understanding from "./api/understanding.js";
import orchestrate from "./api/orchestrate.js";
import blog from "./api/blog.js";
import gatewayWebhooks from "./api/gatewayWebhooks.js";
import landConfig from "./api/config.js";
import canopy from "./canopy.js";

import { handleMcpRequest } from "../mcp/server.js";
import authenticateMCP from "../middleware/authenticateMCP.js";

import rateLimit from "express-rate-limit";
import { notFoundPage } from "../middleware/notFoundPage.js";

const BLOCKED_IDS = ["deleted", "empty", "null", "system"];

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1800, // same rate as 60 / 30s
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: "Too many requests",
      message: "You are sending requests too fast. Try again in 15 minutes.",
      retryAfterMinutes: 15,
    });
  },
});

export default function registerURLRoutes(app) {
  app.param("userId", (req, res, next, val) => {
    if (BLOCKED_IDS.includes(val)) return notFoundPage(req, res);
    next();
  });
  app.param("nodeId", (req, res, next, val) => {
    if (BLOCKED_IDS.includes(val)) return notFoundPage(req, res);
    next();
  });
  app.param("rootId", (req, res, next, val) => {
    if (BLOCKED_IDS.includes(val)) return notFoundPage(req, res);
    next();
  });

  app.use(apiLimiter);

  // HTML pages served at root (flat paths from nginx)
  app.use("/api/v1", blog);

  app.post("/mcp", authenticateMCP, handleMcpRequest);

  app.use("/api/v1", me);
  app.use("/api/v1", authApiRouter);
  app.use("/api/v1", user);

  app.use("/api/v1", root);
  app.use("/api/v1", understanding);
  app.use("/api/v1", note);
  app.use("/api/v1", contributions);
  app.use("/api/v1", transactions);
  app.use("/api/v1", values);
  app.use("/api/v1", node);
  app.use("/api/v1", orchestrate);
  app.use("/api/v1", gatewayWebhooks);
  app.use("/api/v1", landConfig);

  // Canopy protocol stays at /canopy (not versioned with API)
  app.use("/", canopy);

  // Protocol spec endpoint
  app.get("/protocol", (req, res) => {
    res.json({
      name: "TreeOS",
      version: "1.0",
      capabilities: [
        "chat", "place", "query",
        "canopy", "types", "gateway", "llm-assignments",
        "transactions", "contributions",
      ],
      nodeTypes: ["goal", "plan", "task", "knowledge", "resource", "identity"],
      extensions: [
        "energy",
        "billing",
        "scripts",
        "prestige",
        "schedules",
        "dreams",
        "understanding",
        "raw-ideas",
        "book",
        "blog",
        "api-keys",
        "html-rendering",
      ],
    });
  });
}
