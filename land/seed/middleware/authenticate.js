import log from "../log.js";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import User from "../models/user.js";
import { resolveTreeAccess } from "../tree/treeAccess.js";
import { authStrategies } from "../services.js";
import { sendError, ERR } from "../protocol.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../..", ".env") });

if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required. Run the setup wizard or add it to .env");
const JWT_SECRET = process.env.JWT_SECRET;

export default async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    /* ===========================
        1. JWT AUTH (preferred)
    ============================ */
    let token = null;

    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.slice(7).trim();
    }

    if (!token && req.cookies?.token) {
      token = req.cookies.token;
    }

    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);

      // Verify user still exists and token hasn't been revoked
      const user = await User.findById(decoded.userId).lean();
      if (!user) {
        return sendError(res, 401, ERR.UNAUTHORIZED, "User no longer exists");
      }

      // Check token revocation (password change invalidates all prior tokens)
      const authMeta = user.metadata instanceof Map
        ? user.metadata.get("auth")
        : user.metadata?.auth;
      if (authMeta?.tokensInvalidBefore) {
        const invalidBefore = new Date(authMeta.tokensInvalidBefore).getTime() / 1000;
        if (decoded.iat && decoded.iat < invalidBefore) {
          return sendError(res, 403, ERR.SESSION_EXPIRED, "Token has been revoked");
        }
      }

      req.userId = decoded.userId;
      req.username = decoded.username;
      req.authType = "jwt";

      if (!await attachTreeAccess(req, res)) return;
      return next();
    }

    /* ===========================
        2. EXTENSION AUTH STRATEGIES (api-keys, etc.)
    ============================ */
    for (const { name, handler } of authStrategies) {
      try {
        const result = await handler(req);
        if (result) {
          req.userId = result.userId;
          req.username = result.username;
          req.authType = name;
          if (result.extra) Object.assign(req, result.extra);
          if (!await attachTreeAccess(req, res)) return;
          return next();
        }
      } catch (strategyErr) {
        // Strategy-specific errors (rate limit, etc.)
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
 * Optional auth: same pipeline as authenticate but doesn't reject.
 * If no credentials match, req.userId stays null and the request continues.
 * Use for routes that serve both authenticated users and anonymous/public access.
 */
export async function authenticateOptional(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    // JWT
    let token = null;
    if (authHeader?.startsWith("Bearer ")) token = authHeader.slice(7).trim();
    if (!token && req.cookies?.token) token = req.cookies.token;

    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId).lean();
        if (user) {
          const authMeta = user.metadata instanceof Map
            ? user.metadata.get("auth")
            : user.metadata?.auth;
          const invalidBefore = authMeta?.tokensInvalidBefore
            ? new Date(authMeta.tokensInvalidBefore).getTime() / 1000 : 0;
          if (!decoded.iat || decoded.iat >= invalidBefore) {
            req.userId = decoded.userId;
            req.username = decoded.username;
            req.authType = "jwt";
            return next();
          }
        }
      } catch {}
    }

    // Extension strategies
    for (const { name, handler } of authStrategies) {
      try {
        const result = await handler(req);
        if (result) {
          req.userId = result.userId;
          req.username = result.username;
          req.authType = name;
          if (result.extra) Object.assign(req, result.extra);
          return next();
        }
      } catch {}
    }

    // No auth matched. Continue anonymously.
    return next();
  } catch {
    return next();
  }
}

/* ===========================
    TREE ACCESS HELPER
=========================== */

// Map resolveTreeAccess error strings to protocol codes and HTTP statuses
const TREE_ACCESS_ERRORS = {
  NODE_NOT_FOUND: { http: 404, code: ERR.NODE_NOT_FOUND },
  BROKEN_TREE:    { http: 500, code: ERR.INTERNAL },
  INVALID_TREE:   { http: 500, code: ERR.INTERNAL },
};

/**
 * Resolve tree access for the request. Sends error response and returns false
 * if access is denied or the node doesn't exist. Returns true on success or
 * when no nodeId is present (nothing to check).
 */
async function attachTreeAccess(req, res) {
  const nodeId = req.body?.nodeId || req.params?.nodeId || req.query?.nodeId;

  if (!nodeId) return true;

  const access = await resolveTreeAccess(nodeId, req.userId);

  if (!access.ok) {
    const mapped = TREE_ACCESS_ERRORS[access.error] || { http: 500, code: ERR.INTERNAL };
    sendError(res, mapped.http, mapped.code, access.message);
    return false;
  }

  if (!access.canWrite) {
    sendError(res, 403, ERR.FORBIDDEN, "You do not have write access to this tree");
    return false;
  }

  req.rootId = access.rootId;
  req.treeAccess = access;
  return true;
}

