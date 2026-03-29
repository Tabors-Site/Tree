import me from "./api/me.js";
import note from "./api/notes.js";
import node from "./api/node.js";
import root from "./api/root.js";
import { authApiRouter, authPageRouter } from "./auth.js";
import user from "./api/user.js";

import contributions from "./api/contributions.js";
import cascade from "./api/cascade.js";

import orchestrate from "./api/orchestrate.js";
// gateway webhooks loaded via extension system
import landConfig from "./api/config.js";
import llm from "./api/llm.js";
import canopy from "./canopy.js";

import { handleMcpRequest, mcpServerInstance, connectMcpTransport } from "../mcp/server.js";
import authenticateMCP from "../seed/middleware/authenticateMCP.js";
import dbHealth from "../seed/middleware/dbHealth.js";

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import rateLimit from "express-rate-limit";
import { sendOk, sendError, ERR } from "../seed/protocol.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { loadExtensions, getLoadedExtensionNames, getLoadedManifests } from "../extensions/loader.js";

function notFoundPage(req, res, message = "This page doesn't exist or may have been moved.") {
  return sendError(res, 404, ERR.NODE_NOT_FOUND, message);
}
import { getLandConfigValue } from "../seed/landConfig.js";

import { DELETED } from "../seed/protocol.js";

const BLOCKED_IDS = new Set([DELETED, "empty", "null", "system"]);

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1800, // same rate as 60 / 30s
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    sendError(res, 429, ERR.RATE_LIMITED, "You are sending requests too fast. Try again in 15 minutes.", { retryAfterMinutes: 15 });
  },
});

export default async function registerURLRoutes(app, opts = {}) {
  app.param("userId", (req, res, next, val) => {
    if (BLOCKED_IDS.has(val)) return notFoundPage(req, res);
    next();
  });
  app.param("nodeId", (req, res, next, val) => {
    if (BLOCKED_IDS.has(val)) return notFoundPage(req, res);
    next();
  });
  app.param("rootId", (req, res, next, val) => {
    if (BLOCKED_IDS.has(val)) return notFoundPage(req, res);
    next();
  });

  // Protocol spec endpoint (no auth, no rate limit, used by CLI connect)
  // Optional ?nodeId scopes the response to what's available at that position.
  // Without nodeId, returns everything (backward compatible for connect).
  const protocolHandler = async (req, res) => {
    const allExtensions = getLoadedExtensionNames();
    const disabled = new Set(getLandConfigValue("disabledExtensions") || []);
    let activeExtensions = allExtensions.filter(name => !disabled.has(name));

    // Position-aware: if nodeId provided, exclude blocked extensions
    let blocked = new Set();
    const nodeId = req.query.nodeId;
    if (nodeId) {
      try {
        const { getBlockedExtensionsAtNode } = await import("../seed/tree/extensionScope.js");
        const scope = await getBlockedExtensionsAtNode(nodeId);
        blocked = scope.blocked || new Set();
        activeExtensions = activeExtensions.filter(name => !blocked.has(name));
      } catch {}
    }

    const manifests = getLoadedManifests();
    const cli = {};
    for (const m of manifests) {
      if (disabled.has(m.name)) continue;
      if (blocked.has(m.name)) continue;
      if (m.provides?.cli?.length) {
        cli[m.name] = m.provides.cli;
      }
    }

    // Short descriptions for tab completion hints in CLI
    const extensionDescriptions = {};
    for (const m of manifests) {
      if (disabled.has(m.name)) continue;
      if (blocked.has(m.name)) continue;
      if (m.description) {
        const first = m.description.split(/(?<=\.)\s+/)[0].slice(0, 100);
        extensionDescriptions[m.name] = first;
      }
    }

    sendOk(res, {
      name: "TreeOS",
      version: "1.0",
      capabilities: [
        "chat", "place", "query",
        "canopy", "types", "llm-assignments",
        "transactions", "contributions",
      ],
      nodeTypes: ["goal", "plan", "task", "knowledge", "resource", "identity"],
      extensions: activeExtensions,
      extensionDescriptions,
      cli,
      position: nodeId || null,
    });
  };
  app.get("/protocol", protocolHandler);
  app.get("/api/v1/protocol", protocolHandler);

  // Rate limiter (after health and protocol so load balancer pings don't count)
  app.use(apiLimiter);

  // DB health gate: 503 when MongoDB is disconnected.
  // Mounted after rate limiter so health pings still get rate-limited.
  app.use("/api/v1", dbHealth);

  // Auth page routes (login, register, etc.)
  app.use("/", authPageRouter);

  // Ensure land root and config exist before extensions load.
  // On first boot, extensions that read .config or create system child nodes
  // would fail if the land root hasn't been created yet.
  const { ensureLandRoot } = await import("../seed/landRoot.js");
  const { initLandConfig } = await import("../seed/landConfig.js");
  await ensureLandRoot();
  await initLandConfig();

  // Load extensions (manifests discovered, deps validated, routes wired)
  await loadExtensions(app, mcpServerInstance, {
    getConfigValue: getLandConfigValue,
    registerRawWebhook: opts.registerRawWebhook,
  });

  // Connect MCP transport AFTER extensions register tools (SDK locks after connect)
  await connectMcpTransport();

  app.post("/mcp", authenticateMCP, handleMcpRequest);
  app.get("/mcp", authenticateMCP, handleMcpRequest);
  app.delete("/mcp", authenticateMCP, handleMcpRequest);

  // Serve uploaded files (path matches seed/tree/notes.js and uploadCleanup.js)
  const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, "../uploads");
  app.use("/api/v1/uploads", express.static(uploadsDir));

  app.use("/api/v1", me);
  app.use("/api/v1", authApiRouter);
  app.use("/api/v1", user);

  app.use("/api/v1", root);
  // understanding routes loaded via extension system
  app.use("/api/v1", note);
  app.use("/api/v1", contributions);
  app.use("/api/v1", cascade);
  // values routes loaded via extension system
  app.use("/api/v1", node);
  app.use("/api/v1", orchestrate);
  // gateway webhooks loaded via extension system
  app.use("/api/v1", landConfig);
  app.use("/api/v1", llm);

  // Canopy protocol stays at /canopy (not versioned with API)
  app.use("/", canopy);

}
