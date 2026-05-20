import { authApiRouter, authPageRouter } from "./auth.js";

import ibp from "./api/ibp.js";

// Legacy per-feature route files retired 2026-05-18. Every operation
// is reachable through the unified IBP HTTP adapter at
// `/ibp/<verb>/<addr>`. See [[project_everything_is_substrate]] and
// [[project_protocol_transport_separation]].
//
// Deleted route files + their IBP equivalents:
//   /api/v1/me                  → GET /ibp/see/<land>/@<myname>
//   /api/v1/user/*              → ibp:see + ibp:do create-child
//   /api/v1/node/*              → ibp:see + ibp:do set-meta
//   /api/v1/root/*              → ibp:see + ibp:do set-meta
//   /api/v1/..../matter/matters/*     → ibp:do create-artifact / set-name / etc.
//   /api/v1/.../dids            → ibp:see (with dids field)
//   /api/v1/.../cascade,/flow*  → ibp:do cascade + ibp:see on .flow
//   /api/v1/user/*/custom-llm   → ibp:do add/update/delete-llm-connection
//   /api/v1/user/*/llm-assign   → ibp:do assign-llm-slot
//   /api/v1/land/extensions/*   → ibp:do install/uninstall/enable/disable-extension
import landConfig from "./api/config.js";

import { handleMcpRequest, mcpServerInstance, connectMcpTransport } from "../../protocols/mcp/server.js";
import authenticateMCP from "./middleware/authenticateMCP.js";
import dbHealth from "./middleware/dbHealth.js";

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import rateLimit from "express-rate-limit";
import { sendOk, sendError, ERR } from "../../seed/ibp/protocol.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { loadExtensions, registerExtensionManagementOps } from "../../extensions/loader.js";

function notFoundPage(req, res, message = "This page doesn't exist or may have been moved.") {
  return sendError(res, 404, ERR.SPACE_NOT_FOUND, message);
}
import { getLandConfigValue } from "../../seed/landConfig.js";

import { DELETED } from "../../seed/space/seedSpaces.js";

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
  app.param("beingId", (req, res, next, val) => {
    if (BLOCKED_IDS.has(val)) return notFoundPage(req, res);
    next();
  });
  app.param("spaceId", (req, res, next, val) => {
    if (BLOCKED_IDS.has(val)) return notFoundPage(req, res);
    next();
  });
  app.param("rootId", (req, res, next, val) => {
    if (BLOCKED_IDS.has(val)) return notFoundPage(req, res);
    next();
  });

  // CLI bootstrap endpoint is `GET /.well-known/treeos-portal` (mounted
  // by IBP's bootstrap-route.js). Beyond that initial discovery, clients
  // read the rest of the protocol surface via `ibp:see` on substrate
  // positions:
  //
  //   GET /ibp/see/<land>/.extensions   — extensions + capabilities
  //   GET /ibp/see/<land>/.tools        — registered tools
  //   GET /ibp/see/<land>/.roles        — registered roles
  //   GET /ibp/see/<land>/.operations   — registered DO operations
  //
  // The legacy /protocol + /api/v1/protocol endpoints retired
  // 2026-05-19; CLI bootstrap is `/.well-known/treeos-portal` then ibp.

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

  // Serve uploaded files (path matches seed/matter/matters.js and uploadCleanup.js)
  const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, "../uploads");
  app.use("/api/v1/uploads", express.static(uploadsDir));

  app.use("/api/v1", authApiRouter);
  app.use("/api/v1", landConfig);

  // IBP HTTP adapter: POST /ibp/:verb/<encoded-address>
  // No /api/v1 prefix — per [[project_protocol_transport_separation]] +
  // [[project_extensions_are_server_side]], the protocol IS the API.
  // Same handler the WebSocket layer uses. Every registered IBP
  // operation (kernel or extension) is automatically callable here.
  app.use("/", ibp);

  // The parallel /canopy/* federation surface retired 2026-05-19. Canopy
  // is now the cross-land auth scheme only (signing keys + peer registry).
  // Cross-land calls flow through /ibp/<verb>/<addr> with canopy-signed
  // envelopes. See [[project_canopy_folds_into_ibp]].

}
