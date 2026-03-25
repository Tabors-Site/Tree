import log from "../log.js";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import User from "../models/user.js";
import { resolveTreeAccess } from "../authenticate.js";
import { verifyCanopyToken, getLandIdentity } from "../../canopy/identity.js";
import { getPeerByDomain } from "../../canopy/peers.js";
import { authStrategies } from "../services.js";
import { sendError, ERR } from "../protocol.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../..", ".env") });

if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required. Run the setup wizard or add it to .env");
const JWT_SECRET = process.env.JWT_SECRET;

export default async function authenticate(req, res, next) {
  try {
    /* ===========================
        0. CANOPY TOKEN AUTH (remote land users)
    ============================ */
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("CanopyToken ")) {
      const canopyToken = authHeader.slice("CanopyToken ".length);

      // Decode to get issuer
      let unverified;
      try {
        const parts = canopyToken.split(".");
        unverified = JSON.parse(Buffer.from(parts[1], "base64url").toString());
      } catch {
        return sendError(res, 401, ERR.UNAUTHORIZED, "Malformed CanopyToken");
      }

      const peer = await getPeerByDomain(unverified.iss);
      if (!peer) {
        return sendError(res, 403, ERR.FORBIDDEN, "Unknown land: " + unverified.iss);
      }
      if (peer.status === "blocked") {
        return sendError(res, 403, ERR.FORBIDDEN, "Land " + unverified.iss + " is blocked");
      }

      const { valid, payload, error } = await verifyCanopyToken(canopyToken, peer.publicKey);
      if (!valid) {
        return sendError(res, 401, ERR.UNAUTHORIZED, "Invalid CanopyToken: " + error);
      }

      // Verify token was intended for this land (prevent replay across lands)
      const myDomain = getLandIdentity().domain;
      if (payload.aud && payload.aud !== myDomain) {
        return sendError(res, 401, ERR.UNAUTHORIZED, "CanopyToken audience mismatch");
      }

      // Verify the verified issuer matches what we used for peer lookup
      if (payload.iss && payload.iss !== unverified.iss) {
        return sendError(res, 401, ERR.UNAUTHORIZED, "CanopyToken issuer mismatch");
      }

      // The sub is the remote user's ID. Must be a ghost user from the claiming land.
      // SECURITY: Verify isRemote and homeLand match to prevent UUID collision attacks.
      const ghostUser = await User.findOne({
        _id: payload.sub,
        isRemote: true,
        homeLand: payload.iss,
      });
      if (!ghostUser) {
        return sendError(res, 403, ERR.FORBIDDEN, "Remote user not registered on this land");
      }

      req.userId = ghostUser._id;
      req.username = ghostUser.username;
      req.authType = "canopy";
      req.canopy = {
        sourceLandDomain: unverified.iss,
        sourceLandId: payload.landId,
        peer,
      };

      await attachTreeAccess(req);
      return next();
    }

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

      await attachTreeAccess(req);
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
          await attachTreeAccess(req);
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

/* ===========================
    TREE ACCESS HELPER
=========================== */
async function attachTreeAccess(req) {
  const nodeId = req.body?.nodeId || req.params?.nodeId || req.query?.nodeId;

  if (!nodeId) return;

  const access = await resolveTreeAccess(nodeId, req.userId);

  if (!access.canWrite && !access.isOwner && !access.isContributor) {
    throw new Error("TREE_ACCESS_DENIED");
  }

  req.rootId = access.rootId;
  req.treeAccess = access;
}

