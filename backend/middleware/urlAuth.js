import bcrypt from "bcrypt";
import User from "../db/models/user.js";
import { resolveHtmlShareAccess } from "../core/authenticate.js";
import { errorHtml } from "./notFoundPage.js";

function wantsHtml(req) {
  return "html" in req.query || (req.headers.accept || "").includes("text/html");
}

function errorPage(res, status, title, message) {
  return res.status(status).send(errorHtml(status, title, message));
}

export default async function urlAuth(req, res, next) {
  try {
    /* ===========================
        1️⃣ API KEY AUTH (bypass share token)
    ============================ */
    const apiKey =
      req.headers["x-api-key"] ||
      (req.headers.authorization?.startsWith("ApiKey ")
        ? req.headers.authorization.slice(7).trim()
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
        2️⃣ SHARE TOKEN AUTH (existing flow)
    ============================ */
    const shareToken =
      req.query.token ||
      req.params.token ||
      req.headers["authorization"]?.split(" ")[1];

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
