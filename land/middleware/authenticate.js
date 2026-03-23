import log from "../core/log.js";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import User from "../db/models/user.js";
import { resolveTreeAccess } from "../core/authenticate.js";
import { resolvePublicRoot, isPublic } from "../core/tree/publicAccess.js";
import { verifyCanopyToken, getLandIdentity } from "../canopy/identity.js";
import { getPeerByDomain } from "../canopy/peers.js";
import { authStrategies } from "../core/services.js";

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
        return res.status(401).json({ message: "Malformed CanopyToken" });
      }

      const peer = await getPeerByDomain(unverified.iss);
      if (!peer) {
        return res.status(403).json({ message: "Unknown land: " + unverified.iss });
      }
      if (peer.status === "blocked") {
        return res.status(403).json({ message: "Land " + unverified.iss + " is blocked" });
      }

      const { valid, payload, error } = await verifyCanopyToken(canopyToken, peer.publicKey);
      if (!valid) {
        return res.status(401).json({ message: "Invalid CanopyToken: " + error });
      }

      // Verify token was intended for this land (prevent replay across lands)
      const myDomain = getLandIdentity().domain;
      if (payload.aud && payload.aud !== myDomain) {
        return res.status(401).json({ message: "CanopyToken audience mismatch" });
      }

      // Verify the verified issuer matches what we used for peer lookup
      if (payload.iss && payload.iss !== unverified.iss) {
        return res.status(401).json({ message: "CanopyToken issuer mismatch" });
      }

      // The sub is the remote user's ID. Must be a ghost user from the claiming land.
      // SECURITY: Verify isRemote and homeLand match to prevent UUID collision attacks.
      const ghostUser = await User.findOne({
        _id: payload.sub,
        isRemote: true,
        homeLand: payload.iss,
      });
      if (!ghostUser) {
        return res.status(403).json({ message: "Remote user not registered on this land" });
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
          return res.status(strategyErr.status).json({ message: strategyErr.message });
        }
      }
    }

    return res.status(401).json({
      message: "Missing or invalid credentials",
    });
  } catch (err) {
    log.error("Auth", "Auth error:", err);
    return res.status(401).json({
      message: "Invalid or expired credentials",
    });
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

/**
 * Middleware: Try normal auth first. If no credentials, check if the
 * target tree is public. Used on routes that should allow public access
 * (query endpoint, land root listing).
 */
export async function authenticateOrPublic(req, res, next) {
  const authHeader = req.headers.authorization;
  const apiKey = req.headers["x-api-key"];
  const cookieToken = req.cookies?.token;

  const hasCredentials = !!(
    authHeader ||
    apiKey ||
    cookieToken
  );

  // If credentials are present, try normal auth
  if (hasCredentials) {
    return authenticate(req, res, next);
  }

  // No credentials. Check if target tree is public.
  const nodeId = req.params?.rootId || req.params?.nodeId;
  if (nodeId) {
    try {
      const rootInfo = await resolvePublicRoot(nodeId);
      if (rootInfo && isPublic(rootInfo.visibility)) {
        req.isPublicAccess = true;
        req.publicRootId = rootInfo.rootId;
        req.publicRootOwner = rootInfo.rootOwner;
        req.publicLlmDefault = rootInfo.llmDefault;
        req.userId = null;
        return next();
      }
    } catch (_) {}
  }

  return res.status(401).json({ message: "Missing credentials" });
}
