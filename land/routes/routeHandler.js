import me from "./api/me.js";
import note from "./api/notes.js";
import node from "./api/node.js";
import root from "./api/root.js";
import { authApiRouter, authPageRouter } from "./auth.js";
import user from "./api/user.js";

import contributions from "./api/contributions.js";

import orchestrate from "./api/orchestrate.js";
// gateway webhooks loaded via extension system
import landConfig from "./api/config.js";
import canopy from "./canopy.js";

import { handleMcpRequest, mcpServerInstance } from "../mcp/server.js";
import authenticateMCP from "../middleware/authenticateMCP.js";

import express from "express";
import path from "path";
import rateLimit from "express-rate-limit";
import { notFoundPage } from "../middleware/notFoundPage.js";

import { loadExtensions, getLoadedExtensionNames, getLoadedManifests } from "../extensions/loader.js";
import { getLandConfigValue } from "../core/landConfig.js";

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

export default async function registerURLRoutes(app) {
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

  // Auth page routes (login, register, etc.)
  app.use("/", authPageRouter);

  // Load extensions (manifests discovered, deps validated, routes wired)
  await loadExtensions(app, mcpServerInstance, { getConfigValue: getLandConfigValue });

  app.post("/mcp", authenticateMCP, handleMcpRequest);

  // Serve uploaded files
  app.use("/api/v1/uploads", express.static(path.join(process.cwd(), "uploads")));

  app.use("/api/v1", me);
  app.use("/api/v1", authApiRouter);
  app.use("/api/v1", user);

  app.use("/api/v1", root);
  // understanding routes loaded via extension system
  app.use("/api/v1", note);
  app.use("/api/v1", contributions);
  // values routes loaded via extension system
  app.use("/api/v1", node);
  app.use("/api/v1", orchestrate);
  // gateway webhooks loaded via extension system
  app.use("/api/v1", landConfig);

  // Canopy protocol stays at /canopy (not versioned with API)
  app.use("/", canopy);

  // Protocol spec endpoint (both paths for nginx compatibility)
  const protocolHandler = (req, res) => {
    const allExtensions = getLoadedExtensionNames();

    // Filter out disabled extensions (may still be loaded in memory until restart)
    const disabled = new Set(getLandConfigValue("disabledExtensions") || []);
    const activeExtensions = allExtensions.filter((name) => !disabled.has(name));

    // Collect CLI declarations from active extension manifests
    const manifests = getLoadedManifests();
    const cli = {};
    for (const m of manifests) {
      if (disabled.has(m.name)) continue;
      if (m.provides?.cli?.length) {
        cli[m.name] = m.provides.cli;
      }
    }

    res.json({
      name: "TreeOS",
      version: "1.0",
      capabilities: [
        "chat", "place", "query",
        "canopy", "types", "llm-assignments",
        "transactions", "contributions",
      ],
      nodeTypes: ["goal", "plan", "task", "knowledge", "resource", "identity"],
      extensions: activeExtensions,
      cli,
    });
  };
  app.get("/protocol", protocolHandler);
  app.get("/api/v1/protocol", protocolHandler);
}
