// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// HTTP authentication middleware.
//
// Order of precedence:
//   1. JWT (Bearer header or cookie) — verified strictly (existence + revocation).
//   2. Extension auth strategies (api-keys, custom schemes).
//   3. Reject (or pass through for `authenticateOptional`).
//
// JWT verification lives in seed/materials/being/identity.js so every transport
// (HTTP middleware, WS, IBP adapter, MCP) shares one source of truth.

import log from "../../../../seed/seedStory/log.js";
import { verifyTokenStrict } from "../../../../seed/materials/being/identity.js";
import { authStrategies } from "../../../../seed/services.js";
import { sendError, IBP_ERR } from "../../../../seed/ibp/protocol.js";

function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7).trim();
  if (req.cookies?.token)                 return req.cookies.token;
  return null;
}

export default async function authenticate(req, res, next) {
  try {
    const token = extractToken(req);

    // ── 1. JWT auth (strict) ────────────────────────────────────────
    if (token) {
      const result = await verifyTokenStrict(token);
      if (!result) {
        return sendError(res, 401, IBP_ERR.UNAUTHORIZED, "Invalid or expired credentials");
      }
      req.beingId  = result.beingId;
      req.name     = result.name;
      req.nameId   = result.nameId || null;
      req.authType = "jwt";
      return next();
    }

    // ── 2. Extension auth strategies (api-keys, etc.) ───────────────
    for (const { name, handler } of authStrategies) {
      try {
        const result = await handler(req);
        if (result) {
          req.beingId  = result.beingId;
          req.name     = result.name;
          req.nameId   = result.nameId || null;
          req.authType = name;
          // Strategies can attach extra context under a namespaced key.
          // Never assign directly onto req — that could overwrite Express
          // internals or core auth fields.
          if (result.extra && typeof result.extra === "object") {
            req.strategyExtra = Object.freeze({ ...result.extra });
          }
          return next();
        }
      } catch (strategyErr) {
        if (strategyErr.status) {
          return sendError(res, strategyErr.status, IBP_ERR.UNAUTHORIZED, strategyErr.message);
        }
      }
    }

    return sendError(res, 401, IBP_ERR.UNAUTHORIZED, "Missing or invalid credentials");
  } catch (err) {
    log.error("Auth", "Auth error:", err);
    return sendError(res, 401, IBP_ERR.UNAUTHORIZED, "Invalid or expired credentials");
  }
}

/**
 * Optional auth: same pipeline as authenticate but doesn't reject when
 * credentials are missing or invalid. Use for routes that serve both
 * authenticated users and anonymous/public access.
 */
export async function authenticateOptional(req, res, next) {
  try {
    const token = extractToken(req);
    if (token) {
      const result = await verifyTokenStrict(token);
      if (result) {
        req.beingId  = result.beingId;
        req.name     = result.name;
        req.nameId   = result.nameId || null;
        req.authType = "jwt";
        return next();
      }
    }

    for (const { name, handler } of authStrategies) {
      try {
        const result = await handler(req);
        if (result) {
          req.beingId  = result.beingId;
          req.name     = result.name;
          req.nameId   = result.nameId || null;
          req.authType = name;
          if (result.extra && typeof result.extra === "object") {
            req.strategyExtra = Object.freeze({ ...result.extra });
          }
          return next();
        }
      } catch (stratErr) {
        log.debug("Auth", `Optional strategy "${name}" failed: ${stratErr.message}`);
      }
    }

    return next();
  } catch (outerErr) {
    log.debug("Auth", `Optional auth pipeline error: ${outerErr.message}`);
    return next();
  }
}

// Note: a legacy `attachSpaceAccess(req, res)` helper used to live here.
// It called `resolveSpaceAccess` directly and pre-filtered HTTP requests
// on `hasAccess`. That bypassed the substrate's single gate (the seed's
// `authorize()`) and the attached `req.spaceAccess` / `req.rootId` had no
// downstream readers. Retired 2026-06-07 — every verb call now flows
// through the seed's authorize, which gates per-verb against
// qualities.permissions on the target position. The HTTP middleware's
// job is just to identify the caller; access decisions belong to the
// substrate.
