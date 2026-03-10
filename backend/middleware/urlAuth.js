import bcrypt from "bcrypt";
import User from "../db/models/user.js";
import { resolveHtmlShareAccess } from "../core/authenticate.js";

function wantsHtml(req) {
  return "html" in req.query || (req.headers.accept || "").includes("text/html");
}

function errorPage(res, status, title, message) {
  return res.status(status).send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 20px;
}
.card {
  background: rgba(255,255,255,0.12);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 20px;
  padding: 48px 40px;
  max-width: 480px;
  width: 100%;
  text-align: center;
  box-shadow: 0 20px 60px rgba(0,0,0,0.2);
}
.icon { font-size: 48px; margin-bottom: 20px; }
h1 {
  font-size: 22px;
  font-weight: 700;
  margin-bottom: 12px;
  color: white;
}
p {
  font-size: 15px;
  line-height: 1.6;
  color: rgba(255,255,255,0.75);
  margin-bottom: 28px;
}
.btn {
  display: inline-block;
  padding: 12px 32px;
  border-radius: 980px;
  background: rgba(255,255,255,0.18);
  border: 1px solid rgba(255,255,255,0.25);
  color: white;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  transition: all 0.2s;
}
.btn:hover {
  background: rgba(255,255,255,0.28);
  transform: translateY(-1px);
}
.code {
  display: inline-block;
  margin-bottom: 12px;
  font-size: 13px;
  font-weight: 700;
  color: rgba(255,255,255,0.35);
  letter-spacing: 1px;
}
.ai-note {
  margin-top: 20px;
  padding: 12px 16px;
  background: rgba(239,68,68,0.2);
  border: 1px solid rgba(239,68,68,0.35);
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(220,120,120,0.95);
}
</style>
</head>
<body>
<div class="card">
  <div class="code">${status}</div>
  <div class="icon">${status === 401 ? "🔒" : "🚫"}</div>
  <h1>${title}</h1>
  <p>${message}</p>
  <div class="ai-note">If this was triggered by an AI automated process, wait a moment. You may be redirected shortly.</div>
</div>
</body>
</html>`);
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
