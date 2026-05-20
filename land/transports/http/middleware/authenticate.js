// TreeOS Seed . AGPL-3.0 . https://treeos.ai
//
// HTTP authentication middleware.
//
// Order of precedence:
//   1. JWT (Bearer header or cookie) — verified strictly (existence + revocation).
//   2. Extension auth strategies (api-keys, custom schemes).
//   3. Reject (or pass through for `authenticateOptional`).
//
// JWT verification lives in seed/being/identity.js so every transport
// (HTTP middleware, WS, IBP adapter, MCP) shares one source of truth.

import log from "../../../seed/system/log.js";
import { verifyTokenStrict } from "../../../seed/being/identity.js";
import { resolveSpaceAccess } from "../../../seed/space/spaceFetch.js";
import { authStrategies } from "../../../seed/services.js";
import { sendError, ERR } from "../../../seed/ibp/protocol.js";

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
        return sendError(res, 401, ERR.UNAUTHORIZED, "Invalid or expired credentials");
      }
      req.beingId  = result.beingId;
      req.name     = result.name;
      req.authType = "jwt";
      if (!await attachTreeAccess(req, res)) return;
      return next();
    }

    // ── 2. Extension auth strategies (api-keys, etc.) ───────────────
    for (const { name, handler } of authStrategies) {
      try {
        const result = await handler(req);
        if (result) {
          req.beingId  = result.beingId;
          req.name     = result.name;
          req.authType = name;
          // Strategies can attach extra context under a namespaced key.
          // Never assign directly onto req — that could overwrite Express
          // internals or core auth fields.
          if (result.extra && typeof result.extra === "object") {
            req.strategyExtra = Object.freeze({ ...result.extra });
          }
          if (!await attachTreeAccess(req, res)) return;
          return next();
        }
      } catch (strategyErr) {
        if (strategyErr.status) {
          return sendError(res, strategyErr.status, ERR.UNAUTHORIZED, strategyErr.message);
        }
      }
    }

    return sendError(res, 401, ERR.UNAUTHORIZED, "Missing or invalid credentials");
  } catch (err) {
    log.error("Auth", "Auth error:", err);
    return sendError(res, 401, ERR.UNAUTHORIZED, "Invalid or expired credentials");
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

// ────────────────────────────────────────────────────────────────────
// Tree-access helper
// ────────────────────────────────────────────────────────────────────

const TREE_ACCESS_ERRORS = {
  [ERR.SPACE_NOT_FOUND]: { http: 404, code: ERR.SPACE_NOT_FOUND },
  [ERR.INVALID_INPUT]:  { http: 400, code: ERR.INVALID_INPUT },
  [ERR.INVALID_TREE]:   { http: 400, code: ERR.INVALID_TREE },
};

/**
 * Resolve tree access for the request. Sends error response and returns
 * `false` if access is denied or the node doesn't exist. Returns `true`
 * on success or when no spaceId is present (nothing to check).
 */
async function attachTreeAccess(req, res) {
  const spaceId = req.body?.spaceId || req.params?.spaceId || req.query?.spaceId;
  if (!spaceId) return true;

  const access = await resolveSpaceAccess(spaceId, req.beingId);
  if (!access.ok) {
    const mapped = TREE_ACCESS_ERRORS[access.error] || { http: 500, code: ERR.INTERNAL };
    sendError(res, mapped.http, mapped.code, access.message);
    return false;
  }
  if (!access.canWrite) {
    sendError(res, 403, ERR.FORBIDDEN, "You do not have write access to this tree");
    return false;
  }
  req.rootId     = access.rootId;
  req.treeAccess = access;
  return true;
}
