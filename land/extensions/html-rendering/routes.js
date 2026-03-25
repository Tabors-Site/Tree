import log from "../../seed/log.js";
import express from "express";
import crypto from "crypto";
import authenticate from "../../seed/middleware/authenticate.js";
import urlAuth from "./urlAuth.js";
import User from "../../seed/models/user.js";
import { getUserMeta, setUserMeta } from "../../seed/tree/userMetadata.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import {
  renderLoginPage,
  renderRegisterPage,
  renderForgotPasswordPage,
} from "./pages.js";
import rateLimit from "express-rate-limit";
import { isHtmlEnabled } from "./config.js";

const router = express.Router();

const URL_SAFE_REGEX = /^[A-Za-z0-9\-_.~]+$/;

// Sanitize token query parameter before any rendering
router.use((req, _res, next) => {
  if (req.query.token && !URL_SAFE_REGEX.test(req.query.token)) {
    req.query.token = "";
  }
  next();
});

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  handler: (req, res) => {
    sendError(res, 429, ERR.RATE_LIMITED, "Too many requests. Try again later.");
  },
});


// VERIFY token (returns share token + user info for frontend)
router.post("/verify-token", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId)
      .select("metadata")
      .lean();

    const htmlMeta = getUserMeta(user, "html");
    const HTMLShareToken = htmlMeta?.shareToken || null;

    let hasLlm = false;
    try {
      const fullUser = await User.findById(req.userId)
        .select("llmDefault metadata")
        .lean();
      if (fullUser?.llmDefault) {
        hasLlm = true;
      } else {
        let LlmConnection;
        try { LlmConnection = (await import("../../seed/models/llmConnection.js")).default; } catch { }
        if (LlmConnection) {
          const connCount = await LlmConnection.countDocuments({ userId: req.userId });
          hasLlm = connCount > 0;
        }
      }
    } catch (err) {
      log.error("HTML", "verify-token LLM check error:", err.message);
    }

    sendOk(res, {
      userId: req.userId,
      username: req.username,
      HTMLShareToken,
      hasLlm,
    });
  } catch (err) {
    log.error("HTML", "verify-token error:", err.message);
    sendError(res, 500, ERR.INTERNAL, "Failed to verify token");
  }
});

// Share token management page
router.get("/user/:userId/shareToken", urlAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).select("username metadata").lean();
    if (!user) return sendError(res, 404, ERR.USER_NOT_FOUND, "User not found");

    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
    const token = req.query.token ?? "";
    const tokenQS = token ? `?token=${encodeURIComponent(token)}&html` : "?html";

    if (!wantHtml || !isHtmlEnabled()) {
      const htmlMeta = getUserMeta(user, "html");
      return sendOk(res, { userId, shareToken: htmlMeta?.shareToken || null });
    }

    const { getExtension } = await import("../loader.js");
    const render = getExtension("html-rendering")?.exports?.renderShareToken;
    if (!render) return sendError(res, 404, ERR.EXTENSION_NOT_FOUND, "HTML rendering not available");

    return res.send(render({ userId, user, token, tokenQS }));
  } catch (err) {
    log.error("HTML", "Share token page error:", err.message);
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST share token update
router.post("/user/:userId/shareToken", authenticate, async (req, res) => {
  try {
    if (req.userId.toString() !== req.params.userId.toString()) {
      return sendError(res, 403, ERR.FORBIDDEN, "Not authorized");
    }
    const user = await User.findById(req.userId);
    if (!user) return sendError(res, 404, ERR.USER_NOT_FOUND, "User not found");

    let { htmlShareToken } = req.body;
    if (typeof htmlShareToken !== "string") {
      return sendError(res, 400, ERR.INVALID_INPUT, "htmlShareToken must be a string");
    }
    htmlShareToken = htmlShareToken.trim();
    if (htmlShareToken.length > 128 || htmlShareToken.length < 1) {
      return sendError(res, 400, ERR.INVALID_INPUT, "htmlShareToken must be 1 to 128 characters");
    }
    if (!URL_SAFE_REGEX.test(htmlShareToken)) {
      return sendError(res, 400, ERR.INVALID_INPUT, "htmlShareToken may only contain URL-safe characters");
    }

    setUserMeta(user, "html", { shareToken: htmlShareToken });
    await user.save();

    const token = req.query.token ?? "";
    if ("html" in req.query) {
      return res.redirect(`/api/v1/user/${req.params.userId}/sharetoken?token=${encodeURIComponent(token)}&html`);
    }
    return sendOk(res, { htmlShareToken });
  } catch (err) {
    log.error("HTML", "Share token update error:", err.message);
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// Page routes (mounted at / not /api/v1)
export const pageRouter = express.Router();

pageRouter.get("/login", (req, res) => {
  if (!isHtmlEnabled()) {
    return sendError(res, 404, ERR.EXTENSION_NOT_FOUND, "Server-rendered HTML is disabled.");
  }
  renderLoginPage(req, res);
});

pageRouter.get("/register", (req, res) => {
  if (!isHtmlEnabled()) {
    return sendError(res, 404, ERR.EXTENSION_NOT_FOUND, "Server-rendered HTML is disabled.");
  }
  renderRegisterPage(req, res);
});

pageRouter.get("/forgot-password", (req, res) => {
  if (!isHtmlEnabled()) {
    return sendError(res, 404, ERR.EXTENSION_NOT_FOUND, "Server-rendered HTML is disabled.");
  }
  renderForgotPasswordPage(req, res);
});

export default router;
