import log from "../../core/log.js";
import express from "express";
import crypto from "crypto";
import authenticate from "../../middleware/authenticate.js";
import User from "../../db/models/user.js";
import { getUserMeta, setUserMeta } from "../../core/tree/userMetadata.js";
import {
  renderLoginPage,
  renderRegisterPage,
  renderForgotPasswordPage,
} from "./pages.js";
import rateLimit from "express-rate-limit";

const router = express.Router();

const URL_SAFE_REGEX = /^[A-Za-z0-9\-_.~]+$/;

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  handler: (req, res) => {
    res.status(429).json({ message: "Too many requests. Try again later." });
  },
});

// SET share token
router.post("/setHTMLShareToken", authenticate, limiter, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    let { htmlShareToken } = req.body;
    if (typeof htmlShareToken !== "string") {
      return res.status(400).json({ message: "htmlShareToken must be a string" });
    }

    htmlShareToken = htmlShareToken.trim();
    if (htmlShareToken.length > 128 || htmlShareToken.length < 1) {
      return res.status(400).json({ message: "htmlShareToken must be 1 to 128 characters" });
    }
    if (!URL_SAFE_REGEX.test(htmlShareToken)) {
      return res.status(400).json({ message: "htmlShareToken may only contain URL-safe characters" });
    }

    setUserMeta(user, "html", { shareToken: htmlShareToken });
    await user.save();

    return res.json({ htmlShareToken });
  } catch (err) {
    log.error("HTML", "setHtmlShareToken error:", err.message);
    res.status(500).json({ message: "Failed to set html share token" });
  }
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
        let CustomLlmConnection;
        try { CustomLlmConnection = (await import("../../db/models/customLlmConnection.js")).default; } catch { }
        if (CustomLlmConnection) {
          const connCount = await CustomLlmConnection.countDocuments({ userId: req.userId });
          hasLlm = connCount > 0;
        }
      }
    } catch (err) {
      log.error("HTML", "verify-token LLM check error:", err.message);
    }

    res.json({
      userId: req.userId,
      username: req.username,
      HTMLShareToken,
      hasLlm,
    });
  } catch (err) {
    log.error("HTML", "verify-token error:", err.message);
    res.status(500).json({ message: "Failed to verify token" });
  }
});

// Page routes (mounted at / not /api/v1)
export const pageRouter = express.Router();

pageRouter.get("/login", (req, res) => {
  if (process.env.ENABLE_FRONTEND_HTML !== "true") {
    return res.status(404).json({ error: "Server-rendered HTML is disabled." });
  }
  renderLoginPage(req, res);
});

pageRouter.get("/register", (req, res) => {
  if (process.env.ENABLE_FRONTEND_HTML !== "true") {
    return res.status(404).json({ error: "Server-rendered HTML is disabled." });
  }
  renderRegisterPage(req, res);
});

pageRouter.get("/forgot-password", (req, res) => {
  if (process.env.ENABLE_FRONTEND_HTML !== "true") {
    return res.status(404).json({ error: "Server-rendered HTML is disabled." });
  }
  renderForgotPasswordPage(req, res);
});

export default router;
