import me from "./me.js";
import note from "./notes.js";
import node from "./node.js";
import root from "./root.js";
import user from "./user.js";
import contributions from "./contributions.js";
import transactions from "./transactions.js";
import values from "./values.js";
import appe from "./app.js";
import chat from "./chat.js";
import setup from "./setup.js";
import understanding from "./understanding.js";
import tree from "./tree.js";
import blog from "./blog.js";
import gatewayWebhooks from "./gatewayWebhooks.js";
import canopy from "./canopy.js";

import {
  renderLoginPage,
  renderRegisterPage,
  renderForgotPasswordPage,
} from "../core/login.js";

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
  app.use("/", setup);
  app.use("/api/v1", blog);

  app.use("/", appe);
  app.use("/", chat);

  // Same routes also available under /api/v1 for frontend API calls
  app.use("/api/v1", me);
  app.use("/api/v1", user);
  app.use("/api/v1", root);
  app.use("/api/v1", chat);
  app.use("/api/v1", understanding);
  app.use("/api/v1", note);
  app.use("/api/v1", contributions);
  app.use("/api/v1", transactions);
  app.use("/api/v1", values);
  app.use("/api/v1", node);
  app.use("/api/v1", tree);
  app.use("/api/v1", gatewayWebhooks);

  // Canopy protocol stays at /canopy (not versioned with API)
  app.use("/", canopy);
}
