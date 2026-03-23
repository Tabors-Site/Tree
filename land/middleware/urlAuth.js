import log from "../core/log.js";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import User from "../db/models/user.js";
import { resolveHtmlShareAccess } from "../core/authenticate.js";
import { resolvePublicRoot, isPublic } from "../core/tree/publicAccess.js";
import { errorHtml } from "./notFoundPage.js";
import { verifyCanopyToken, getLandIdentity } from "../canopy/identity.js";
import { getPeerByDomain, registerPeer } from "../canopy/peers.js";
import { lookupLandByDomain } from "../canopy/directory.js";
import { authStrategies } from "../core/services.js";

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
        0️⃣ CANOPY TOKEN AUTH (remote land users)
    ============================ */
    if (authHeader?.startsWith("CanopyToken ")) {
      const canopyToken = authHeader.slice("CanopyToken ".length);

      let unverified;
      try {
        const parts = canopyToken.split(".");
        unverified = JSON.parse(Buffer.from(parts[1], "base64url").toString());
      } catch {
        return res.status(401).json({ message: "Malformed CanopyToken" });
      }

      let peer = await getPeerByDomain(unverified.iss);
      if (!peer) {
        try {
          const directoryLand = await lookupLandByDomain(unverified.iss);
          if (directoryLand?.baseUrl) {
            const infoRes = await fetch(
              `${directoryLand.baseUrl.replace(/\/+$/, "")}/canopy/info`,
              { signal: AbortSignal.timeout(5000) }
            );
            if (infoRes.ok) {
              const info = await infoRes.json();
              if (info.domain === unverified.iss) {
                peer = await registerPeer(directoryLand.baseUrl);
              }
            }
          }
        } catch (_) {}
      }
      if (!peer) return res.status(403).json({ message: "Unknown land: " + unverified.iss });
      if (peer.status === "blocked") return res.status(403).json({ message: "Land blocked" });

      const { valid, payload } = await verifyCanopyToken(canopyToken, peer.publicKey);
      if (!valid) return res.status(401).json({ message: "Invalid CanopyToken" });

      const myDomain = getLandIdentity().domain;
      if (payload.aud && payload.aud !== myDomain) {
        return res.status(401).json({ message: "CanopyToken audience mismatch" });
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

      return res.status(403).json({ message: "Remote user not registered on this land" });
    }

    /* ===========================
        1️⃣ EXTENSION AUTH STRATEGIES (api-keys, etc.)
    ============================ */
    for (const { name, handler } of authStrategies) {
      try {
        const result = await handler(req);
        if (result) {
          req.userId = result.userId;
          req.username = result.username;
          req.authType = name;
          req.isHtmlShare = false;
          if (result.extra) Object.assign(req, result.extra);
          return next();
        }
      } catch (strategyErr) {
        if (strategyErr.status) {
          return res.status(strategyErr.status).json({ message: strategyErr.message });
        }
      }
    }

    /* ===========================
        1.5️⃣ JWT AUTH (Bearer token or cookie)
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
        2️⃣ SHARE TOKEN AUTH (existing flow)
    ============================ */
    const shareToken =
      req.query.token ||
      req.params.token;

    if (!shareToken) {
      /* ===========================
          3️⃣ PUBLIC TREE ACCESS (last resort, no credentials at all)
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
      return res.status(401).json({
        message: "No share token provided",
      });
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
      return res.status(400).json({
        message: "userId or nodeId is required for shared access",
      });
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
      return res.status(403).json({
        message: "Invalid or unauthorized share token",
      });
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
    res.status(403).json({
      message: "Share authorization failed",
    });
  }
}
