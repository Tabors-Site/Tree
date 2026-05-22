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
//   5. /mcp routes — POST / GET / DELETE.
//   6. /api/v1/uploads — static serving of uploaded matter.
//   7. /api/v1 authApiRouter — JSON auth.
//   8. /api/v1 placeConfig — config read/write.
//   9. /ibp/:verb/<addr> — the single IBP HTTP adapter. Same
//      dispatcher the WebSocket layer uses; every kernel and
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
//   GET /ibp/see/<place>/.extensions   — extensions + capabilities
//   GET /ibp/see/<place>/.tools        — registered tools
//   GET /ibp/see/<place>/.roles        — registered roles
//   GET /ibp/see/<place>/.operations   — registered DO operations

import { authApiRouter, authPageRouter } from "./auth.js";
import ibp from "./api/ibp.js";
import placeConfig from "./api/config.js";

import dbHealth from "./middleware/dbHealth.js";

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import rateLimit from "express-rate-limit";
import { sendError, IBP_ERR } from "../../seed/ibp/protocol.js";

import { DELETED } from "../../seed/place/space/seedSpaces.js";

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
  app.use("/api/v1", placeConfig);

  // IBP HTTP adapter: POST /ibp/:verb/<encoded-address>.
  // No /api/v1 prefix. The protocol IS the API. Same handler the
  // WebSocket layer uses; every registered IBP operation (kernel or
  // extension) is automatically callable here.
  app.use("/", ibp);
}
