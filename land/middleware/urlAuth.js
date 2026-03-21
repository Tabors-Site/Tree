import bcrypt from "bcrypt";
import User from "../db/models/user.js";
import { resolveHtmlShareAccess } from "../core/authenticate.js";
import { errorHtml } from "./notFoundPage.js";
import { verifyCanopyToken, getLandIdentity } from "../canopy/identity.js";
import { getPeerByDomain, registerPeer } from "../canopy/peers.js";
import { lookupLandByDomain } from "../canopy/directory.js";

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
      if (!ghostUser) return res.status(403).json({ message: "Remote user not registered on this land" });

      req.userId = ghostUser._id;
      req.username = ghostUser.username;
      req.authType = "canopy";
      req.isHtmlShare = false;
      return next();
    }

    /* ===========================
        1️⃣ API KEY AUTH
    ============================ */
    const apiKey =
      req.headers["x-api-key"] ||
      (authHeader?.startsWith("ApiKey ")
        ? authHeader.slice(7).trim()
        : null);

    if (apiKey) {
      const users = await User.find({ "apiKeys.revoked": false });

      for (const user of users) {
        for (const key of user.apiKeys) {
          if (key.revoked) continue;

          const match = await bcrypt.compare(apiKey, key.keyHash);
          if (!match) continue;

          req.userId = user._id;
          req.username = user.username;
          req.authType = "apiKey";
          req.apiKeyId = key._id;
          req.isHtmlShare = false;

          await User.updateOne(
            { _id: user._id, "apiKeys._id": key._id },
            {
              $inc: { "apiKeys.$.usageCount": 1 },
              $set: { "apiKeys.$.lastUsedAt": new Date() },
            }
          );

          return next();
        }
      }

      return res.status(401).json({ message: "Invalid API key" });
    }

    /* ===========================
        3️⃣ SHARE TOKEN AUTH (existing flow)
    ============================ */
    const shareToken =
      req.query.token ||
      req.params.token;

    if (!shareToken) {
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

    const nodeId =
      req.params?.nodeId ||
      req.body?.nodeId ||
      req.query?.nodeId ||
      req.params?.rootId ||
      null;

    if (!userId && !nodeId) {
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
      nodeId,
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
    console.error("[urlAuth] error:", err);
    if (wantsHtml(req)) {
      return errorPage(res, 403, "Authorization Failed",
        "Something went wrong while verifying your access. Please try again or request a new share link.");
    }
    res.status(403).json({
      message: "Share authorization failed",
    });
  }
}
