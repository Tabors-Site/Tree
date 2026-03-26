import log from "../../seed/log.js";
import { sendError, ERR } from "../../seed/protocol.js";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import User from "../../seed/models/user.js";
import { resolvePublicRoot, isPublic } from "./publicAccess.js";
import { errorHtml } from "./notFoundPage.js";
import { resolveHtmlShareAccess } from "./shareAuth.js";
import { verifyCanopyToken, getLandIdentity } from "../../canopy/identity.js";
import { getPeerByDomain, registerPeer } from "../../canopy/peers.js";
import { lookupLandByDomain } from "../../canopy/horizon.js";
import { authStrategies } from "../../seed/services.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../..", ".env") });
const JWT_SECRET = process.env.JWT_SECRET;

function wantsHtml(req) {
  return "html" in req.query || (req.headers.accept || "").includes("text/html");
}

function errorPage(res, status, title, message) {
  return res.status(status).send(errorHtml(status, title, message));
}

export default async function urlAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    /* ===========================
        0. CANOPY TOKEN AUTH (remote land users)
    ============================ */
    if (authHeader?.startsWith("CanopyToken ")) {
      const canopyToken = authHeader.slice("CanopyToken ".length);

      let unverified;
      try {
        const parts = canopyToken.split(".");
        unverified = JSON.parse(Buffer.from(parts[1], "base64url").toString());
      } catch {
        return sendError(res, 401, ERR.UNAUTHORIZED, "Malformed CanopyToken");
      }

      let peer = await getPeerByDomain(unverified.iss);
      if (!peer) {
        try {
          const horizonLand = await lookupLandByDomain(unverified.iss);
          if (horizonLand?.baseUrl) {
            const infoRes = await fetch(
              `${horizonLand.baseUrl.replace(/\/+$/, "")}/canopy/info`,
              { signal: AbortSignal.timeout(5000) }
            );
            if (infoRes.ok) {
              const info = await infoRes.json();
              if (info.domain === unverified.iss) {
                peer = await registerPeer(horizonLand.baseUrl);
              }
            }
          }
        } catch (_) {}
      }
      if (!peer) return sendError(res, 403, ERR.FORBIDDEN, "Unknown land: " + unverified.iss);
      if (peer.status === "blocked") return sendError(res, 403, ERR.FORBIDDEN, "Land blocked");

      const { valid, payload } = await verifyCanopyToken(canopyToken, peer.publicKey);
      if (!valid) return sendError(res, 401, ERR.UNAUTHORIZED, "Invalid CanopyToken");

      const myDomain = getLandIdentity().domain;
      if (payload.aud && payload.aud !== myDomain) {
        return sendError(res, 401, ERR.UNAUTHORIZED, "CanopyToken audience mismatch");
      }

      const ghostUser = await User.findOne({
        _id: payload.sub,
        isRemote: true,
        homeLand: payload.iss,
      });

      if (ghostUser) {
        req.userId = ghostUser._id;
        req.username = ghostUser.username;
        req.authType = "canopy";
        req.isHtmlShare = false;
        return next();
      }

      // No ghost user. Check if tree is public (allow as authenticated visitor).
      const nodeId = req.params?.nodeId || req.params?.rootId;
      if (nodeId) {
        const rootInfo = await resolvePublicRoot(nodeId);
        if (rootInfo && isPublic(rootInfo.visibility)) {
          req.isPublicAccess = true;
          req.publicRootId = rootInfo.rootId;
          req.publicRootOwner = rootInfo.rootOwner;
          req.publicLlmDefault = rootInfo.llmDefault;
          req.userId = null;
          req.canopyVisitor = { userId: payload.sub, homeLand: payload.iss };
          req.isHtmlShare = false;
          return next();
        }
      }

      return sendError(res, 403, ERR.FORBIDDEN, "Remote user not registered on this land");
    }

    /* ===========================
        1. EXTENSION AUTH STRATEGIES (api-keys, etc.)
    ============================ */
    for (const { name, handler } of authStrategies) {
      try {
        const result = await handler(req);
        if (result) {
          req.userId = result.userId;
          req.username = result.username;
          req.authType = name;
          req.isHtmlShare = false;
          if (result.extra && typeof result.extra === "object") {
            req.strategyExtra = Object.freeze({ ...result.extra });
          }
          return next();
        }
      } catch (strategyErr) {
        if (strategyErr.status) {
          const code = strategyErr.status === 401 ? ERR.UNAUTHORIZED
            : strategyErr.status === 403 ? ERR.FORBIDDEN
            : ERR.INTERNAL;
          return sendError(res, strategyErr.status, code, strategyErr.message);
        }
      }
    }

    /* ===========================
        1.5. JWT AUTH (Bearer token or cookie)
    ============================ */
    let jwtToken = null;
    if (authHeader?.startsWith("Bearer ")) {
      jwtToken = authHeader.slice(7).trim();
    }
    if (!jwtToken && req.cookies?.token) {
      jwtToken = req.cookies.token;
    }
    if (jwtToken && JWT_SECRET) {
      try {
        const decoded = jwt.verify(jwtToken, JWT_SECRET);
        req.userId = decoded.userId;
        req.username = decoded.username;
        req.authType = "jwt";
        req.isHtmlShare = false;
        return next();
      } catch (_) {
        // Invalid JWT, fall through to share token / public
      }
    }

    /* ===========================
        2. SHARE TOKEN AUTH
    ============================ */
    const shareToken =
      req.query.token ||
      req.params.token;

    if (!shareToken) {
      /* ===========================
          3. PUBLIC TREE ACCESS (last resort, no credentials at all)
      ============================ */
      const nodeId = req.params?.nodeId || req.params?.rootId;
      if (nodeId) {
        const rootInfo = await resolvePublicRoot(nodeId);
        if (rootInfo && isPublic(rootInfo.visibility)) {
          req.isPublicAccess = true;
          req.publicRootId = rootInfo.rootId;
          req.publicRootOwner = rootInfo.rootOwner;
          req.publicLlmDefault = rootInfo.llmDefault;
          req.userId = null;
          req.isHtmlShare = false;
          return next();
        }
      }

      if (wantsHtml(req)) {
        return errorPage(res, 401, "Share Token Required",
          "No share token was provided. You need a valid share link to view this page.");
      }
      return sendError(res, 401, ERR.UNAUTHORIZED, "No share token provided");
    }

    const userId =
      req.params?.userId || req.body?.userId || req.query?.userId || null;

    const shareNodeId =
      req.params?.nodeId ||
      req.body?.nodeId ||
      req.query?.nodeId ||
      req.params?.rootId ||
      null;

    if (!userId && !shareNodeId) {
      if (wantsHtml(req)) {
        return errorPage(res, 400, "Invalid Link",
          "This link is missing required information. Please check that you have the full URL.");
      }
      return sendError(res, 400, ERR.INVALID_INPUT, "userId or nodeId is required for shared access");
    }

    const result = await resolveHtmlShareAccess({
      userId,
      nodeId: shareNodeId,
      shareToken,
    });

    if (!result.allowed) {
      if (wantsHtml(req)) {
        return errorPage(res, 403, "Access Denied",
          "You don't have access to this content. It may have been deleted, moved, or your share token is invalid. Ask the owner for a new link.");
      }
      return sendError(res, 403, ERR.FORBIDDEN, "Invalid or unauthorized share token");
    }

    req.userId = result.matchedUserId;
    req.username = result.matchedUsername;
    req.rootId = result.rootId ?? null;
    req.isHtmlShare = true;

    next();
  } catch (err) {
    log.error("Auth", "[urlAuth] error:", err);
    if (wantsHtml(req)) {
      return errorPage(res, 403, "Authorization Failed",
        "Something went wrong while verifying your access. Please try again or request a new share link.");
    }
    sendError(res, 403, ERR.FORBIDDEN, "Share authorization failed");
  }
}
