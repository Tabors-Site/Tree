import express from "express";
import {
  register,
  login,
  logout,
} from "../core/users.js";
import authenticate from "../middleware/authenticate.js";
import User from "../db/models/user.js";
import CustomLlmConnection from "../db/models/customLlmConnection.js";

import {
  renderLoginPage,
  renderRegisterPage,
} from "../core/login.js";

import rateLimit from "express-rate-limit";

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  handler: (req, res) => {
    res.status(429).json({
      error: "Too many registrations",
      message: "Please try again in 1 hour.",
    });
  },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  handler: (req, res) => {
    res.status(429).json({
      error: "Too many login attempts",
      message: "You have been blocked for 15 minutes due to spam.",
      retryAfterMinutes: 15,
    });
  },
});

// API routes (mounted at /api/v1 by routeHandler.js)
export const authApiRouter = express.Router();

authApiRouter.post("/register", registerLimiter, register);
authApiRouter.post("/login", loginLimiter, login);
authApiRouter.post("/logout", authenticate, logout);

authApiRouter.post(
  "/setHTMLShareToken",
  authenticate,
  loginLimiter,
  async (req, res) => {
    try {
      const user = await User.findById(req.userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      let { htmlShareToken } = req.body;
      if (typeof htmlShareToken !== "string") return res.status(400).json({ message: "htmlShareToken must be a string" });
      htmlShareToken = htmlShareToken.trim();
      if (htmlShareToken.length > 128 || htmlShareToken.length < 1) return res.status(400).json({ message: "htmlShareToken must be 1 to 128 characters" });
      if (!/^[A-Za-z0-9\-_.~]+$/.test(htmlShareToken)) return res.status(400).json({ message: "htmlShareToken may only contain URL-safe characters" });
      const { setUserMeta } = await import("../core/tree/userMetadata.js");
      setUserMeta(user, "html", { shareToken: htmlShareToken });
      await user.save();
      return res.json({ htmlShareToken });
    } catch (err) {
      console.error("[setHtmlShareToken]", err);
      res.status(500).json({ message: "Failed to set html share token" });
    }
  },
);

authApiRouter.post(
  "/verify-token",
  authenticate,
  async (req, res, next) => {
    try {
      const user = await User.findById(req.userId).select("metadata").lean().exec();
      req.HTMLShareToken = user?.metadata?.html?.shareToken ?? null;
      next();
    } catch (err) {
      console.error("[getHtmlShareToken]", err);
      res.status(500).json({ message: "Failed to fetch HTML share token" });
    }
  },
  async (req, res) => {
    let hasLlm = false;
    try {
      const user = await User.findById(req.userId)
        .select("llmDefault metadata")
        .lean();
      if (user?.llmAssignments?.main) {
        hasLlm = true;
      } else {
        const connCount = await CustomLlmConnection.countDocuments({
          userId: req.userId,
        });
        hasLlm = connCount > 0;
      }
    } catch (err) {
      console.error("verify-token LLM check error:", err.message);
    }
    res.json({
      userId: req.userId,
      username: req.username,
      HTMLShareToken: req.HTMLShareToken,
      hasLlm,
    });
  },
);

// Email routes (forgot-password, reset-password, verify) moved to email extension

// HTML pages + their POST handlers (mounted at / by routesHandler.js)
export const authPageRouter = express.Router();

// POST routes needed by the server-rendered HTML forms
authPageRouter.post("/register", registerLimiter, register);
authPageRouter.post("/login", loginLimiter, login);
authPageRouter.post("/logout", authenticate, logout);

authPageRouter.get("/login", (req, res, next) => {
  if (process.env.ENABLE_FRONTEND_HTML !== "true") return res.status(404).json({ error: "Server-rendered HTML is disabled. Use the SPA frontend." });
  renderLoginPage(req, res, next);
});
authPageRouter.get("/register", (req, res, next) => {
  if (process.env.ENABLE_FRONTEND_HTML !== "true") return res.status(404).json({ error: "Server-rendered HTML is disabled. Use the SPA frontend." });
  renderRegisterPage(req, res, next);
});
// forgot-password page route moved to email extension
