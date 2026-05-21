// HTTP route mounting + boot ordering.
//
// I open the HTTP side of my senses here. The path is fixed:
//
//   1. Rate limit — every request first.
//   2. DB health gate under /api/v1. If MongoDB is down I 503
//      cleanly instead of letting Mongoose throw from inside a
//      handler.
//   3. Auth page routes (login / register / logout HTML forms).
//   4. ensureLandRoot + initLandConfig — the land root and .config
//      space must exist before any extension reads them. Idempotent.
//   5. registerExtensionManagementOps — install / uninstall / enable
//      / disable DO ops register before extensions load so they're
//      callable even if every extension fails.
//   6. loadExtensions — manifests discovered, deps validated, routes
//      and hooks wired.
//   7. connectMcpTransport — AFTER step 6, because the MCP SDK locks
//      its tool list at connect time and extension tools must be
//      present first.
//   8. MCP HTTP routes (POST/GET/DELETE /mcp).
//   9. /api/v1/uploads static.
//  10. /api/v1 auth + /api/v1 land-config routes.
//  11. /ibp/:verb/<addr> — the single IBP HTTP adapter. Same
//      dispatcher the WebSocket layer uses; every kernel and
//      extension operation is automatically callable here.
//
// The protocol IS the API. Cross-land federation flows through
// /ibp/ with canopy-signed envelopes (canopy itself is just the
// signing-key + peer-registry shape on top).

import { authApiRouter, authPageRouter } from "./auth.js";
import ibp from "./api/ibp.js";
import landConfig from "./api/config.js";

import { handleMcpRequest, mcpServerInstance, connectMcpTransport } from "../../protocols/mcp/server.js";
import authenticateMCP from "./middleware/authenticateMCP.js";
import dbHealth from "./middleware/dbHealth.js";

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import rateLimit from "express-rate-limit";
import { sendOk, sendError, IBP_ERR } from "../../seed/ibp/protocol.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { loadExtensions, registerExtensionManagementOps } from "../../extensions/loader.js";

function rejectReservedId(req, res, message = "Reserved identifier.") {
  return sendError(res, 400, IBP_ERR.INVALID_INPUT, message);
}
import { getLandConfigValue } from "../../seed/landConfig.js";

import { DELETED } from "../../seed/land/space/seedSpaces.js";

const BLOCKED_IDS = new Set([DELETED, "empty", "null", "system"]);

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1800, // same rate as 60 / 30s
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    sendError(res, 429, IBP_ERR.RATE_LIMITED, "You are sending requests too fast. Try again in 15 minutes.", { retryAfterMinutes: 15 });
  },
});

export default async function registerURLRoutes(app, opts = {}) {
  app.param("beingId", (req, res, next, val) => {
    if (BLOCKED_IDS.has(val)) return rejectReservedId(req, res);
    next();
  });
  app.param("spaceId", (req, res, next, val) => {
    if (BLOCKED_IDS.has(val)) return rejectReservedId(req, res);
    next();
  });
  app.param("rootId", (req, res, next, val) => {
    if (BLOCKED_IDS.has(val)) return rejectReservedId(req, res);
    next();
  });

  // CLI bootstrap endpoint is `GET /.well-known/treeos-portal`
  // (mounted by IBP's bootstrap-route.js). Beyond that initial
  // discovery, clients read the rest of the protocol surface via
  // `ibp:see` on land seed spaces:
  //
  //   GET /ibp/see/<land>/.extensions   — extensions + capabilities
  //   GET /ibp/see/<land>/.tools        — registered tools
  //   GET /ibp/see/<land>/.roles        — registered roles
  //   GET /ibp/see/<land>/.operations   — registered DO operations

  // Rate limiter (after bootstrap so load balancer pings don't count)
  app.use(apiLimiter);

  // DB health gate: 503 when MongoDB is disconnected.
  // Mounted after rate limiter so health pings still get rate-limited.
  app.use("/api/v1", dbHealth);

  // Auth page routes (login, register, etc.)
  app.use("/", authPageRouter);

  // Ensure land root and config exist before extensions load.
  // On first boot, extensions that read .config or create system child nodes
  // would fail if the land root hasn't been created yet.
  const { ensureLandRoot } = await import("../../seed/landRoot.js");
  const { initLandConfig } = await import("../../seed/landConfig.js");
  await ensureLandRoot();
  await initLandConfig();

  // Register the extension-management DO ops (install/uninstall/
  // enable/disable). Lives in loader.js (not seed) because its
  // handlers touch loader internals — see registerExtensionManagementOps
  // for the inversion rationale. Done before loadExtensions so the
  // ops are present in the registry even if every extension fails.
  await registerExtensionManagementOps();

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

  // Serve uploaded files (path matches seed/land/matter/matters.js and uploadCleanup.js)
  const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, "../uploads");
  app.use("/api/v1/uploads", express.static(uploadsDir));

  app.use("/api/v1", authApiRouter);
  app.use("/api/v1", landConfig);

  // IBP HTTP adapter: POST /ibp/:verb/<encoded-address>.
  // No /api/v1 prefix — the protocol IS the API. Same handler the
  // WebSocket layer uses; every registered IBP operation (kernel or
  // extension) is automatically callable here.
  app.use("/", ibp);
}
