// TreeOS Place . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// HTTP route mounting. Pure plumbing.
//
// Body forming is genesis.js's job, not this layer's. By the time
// registerRoutes is called, genesis has already finished: extensions
// are loaded, MCP transport is connected, the place root and config
// exist, the role/operation registries are populated. All that is
// left here is to attach the routers to the express app in the right
// order so requests dispatch correctly.
//
// Mount order:
//
//   1. app.param guards (block reserved identifiers in URLs).
//   2. apiLimiter — rate limit every request.
//   3. /api/v1 dbHealth — 503 cleanly when MongoDB is down instead
//      of letting Mongoose throw from inside a handler.
//   4. authPageRouter — HTML form login / register / logout.
//   5. /api/v1/uploads — static serving of uploaded matter.
//   6. /api/v1 authApiRouter — JSON auth.
//   7. /api/v1 realityConfig — config read/write.
//   8. Built 3D portal at / (fallthrough enabled so IBP/api/uploads
//      keep working; SPA fallback to index.html for client routes).
//      Skipped when portal/3d-app/dist is absent.
//   9. /ibp/:verb/<addr> — the single IBP HTTP adapter. Same
//      dispatcher the WebSocket layer uses; every seed and
//      extension operation is automatically callable here.
//
// The protocol IS the API. Cross-place federation flows through
// /ibp/ with canopy-signed envelopes (canopy itself is just the
// signing-key + peer-registry shape on top).
//
// CLI bootstrap endpoint is `GET /.well-known/treeos-portal`
// (mounted separately by IBP's bootstrap-route.js). Beyond that
// initial discovery, clients read the rest of the protocol surface
// via `ibp:see` on place seed spaces:
//
//   GET /ibp/see/<reality>/.extensions   — extensions + capabilities
//   GET /ibp/see/<reality>/.tools        — registered tools
//   GET /ibp/see/<reality>/.roles        — registered roles
//   GET /ibp/see/<reality>/.operations   — registered DO operations

import { authApiRouter, authPageRouter } from "./auth.js";
import ibp from "./api/ibp.js";
import realityConfig from "./api/config.js";

import dbHealth from "./middleware/dbHealth.js";

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import rateLimit from "express-rate-limit";
import { sendError, IBP_ERR } from "../../seed/ibp/protocol.js";
import log from "../../seed/seedReality/log.js";

import { DELETED } from "../../seed/materials/space/seedSpaces.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BLOCKED_IDS = new Set([DELETED, "empty", "null", "system"]);

function rejectReservedId(req, res, message = "Reserved identifier.") {
  return sendError(res, 400, IBP_ERR.INVALID_INPUT, message);
}

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1800, // same rate as 60 / 30s
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    sendError(res, 429, IBP_ERR.RATE_LIMITED, "You are sending requests too fast. Try again in 15 minutes.", { retryAfterMinutes: 15 });
  },
});

export default function registerRoutes(app) {
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

  app.use(apiLimiter);
  app.use("/api/v1", dbHealth);
  app.use("/", authPageRouter);

  const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, "../uploads");
  app.use("/api/v1/uploads", express.static(uploadsDir));

  app.use("/api/v1", authApiRouter);
  app.use("/api/v1", realityConfig);

  // Built 3D portal at /. Static files first (fallthrough: true lets
  // /ibp, /api, /.well-known, etc. pass through to their handlers);
  // SPA fallback to index.html for any GET that didn't match a static
  // asset or another route. Skipped silently when the dist isn't built
  // (npm run build:portal); operators who don't need the bundled
  // client still get a working API.
  const portalDist = path.resolve(__dirname, "../../portal/3d-app/dist");
  if (fs.existsSync(path.join(portalDist, "index.html"))) {
    app.use("/", express.static(portalDist, { fallthrough: true, index: "index.html" }));
    app.get(/^\/(?!api\/|ibp\/|mcp\/?|\.well-known\/).*/, (req, res, next) => {
      // SPA fallback: serve index.html for non-api GETs that no static
      // asset matched. Skips api/ibp/mcp/.well-known so those reach
      // their handlers (or fall through to the 404 below).
      if (req.method !== "GET") return next();
      res.sendFile(path.join(portalDist, "index.html"));
    });
    log.verbose("HTTP", `Portal mounted at / (${portalDist})`);
  } else {
    log.verbose("HTTP", `Portal dist not found at ${portalDist}; skipping (run: npm run build:portal)`);
  }

  // IBP HTTP adapter: POST /ibp/:verb/<encoded-address>.
  // No /api/v1 prefix. The protocol IS the API. Same handler the
  // WebSocket layer uses; every registered IBP operation (seed or
  // extension) is automatically callable here.
  app.use("/", ibp);
}
