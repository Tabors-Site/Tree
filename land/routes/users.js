import express from "express";
import {
  register,
  login,
  logout,
  setHtmlShareToken,
  getHtmlShareToken,
  forgotPassword,
  resetPassword,
  verifyEmail,
} from "../core/users.js";
import authenticate from "../middleware/authenticate.js";
import User from "../db/models/user.js";
import CustomLlmConnection from "../db/models/customLlmConnection.js";

import {
  renderLoginPage,
  renderRegisterPage,
  renderForgotPasswordPage,
} from "../core/login.js";

const router = express.Router();

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

// Limit login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  handler: (req, res) => {
    res.status(429).json({
      error: "Too many login attempts",
      message: "You have been blocked for 15 minutes due to spam.",
      retryAfterMinutes: 15,
    });
  },
});

// Limit email-based actions
const emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  handler: (req, res) => {
    res.status(429).json({
      error: "Too many email requests",
      message: "Too many email requests.",
    });
  },
});

router.post("/register", registerLimiter, register);

router.post("/login", loginLimiter, login);

router.post("/logout", authenticate, logout);

router.post(
  "/setHTMLShareToken",
  authenticate,
  loginLimiter,
  setHtmlShareToken,
);

router.post(
  "/verify-token",
  authenticate,
  getHtmlShareToken,
  async (req, res) => {
    let hasLlm = false;
    try {
      const user = await User.findById(req.userId)
        .select("llmAssignments")
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

router.post("/forgot-password", emailLimiter, forgotPassword);
router.post("/user/reset-password", resetPassword);
router.get("/user/verify/:token", verifyEmail);

router.get("/login", (req, res, next) => {
  if (process.env.ENABLE_FRONTEND_HTML !== "true") return res.status(404).json({ error: "Server-rendered HTML is disabled. Use the SPA frontend." });
  renderLoginPage(req, res, next);
});
router.get("/register", (req, res, next) => {
  if (process.env.ENABLE_FRONTEND_HTML !== "true") return res.status(404).json({ error: "Server-rendered HTML is disabled. Use the SPA frontend." });
  renderRegisterPage(req, res, next);
});
router.get("/forgot-password", (req, res, next) => {
  if (process.env.ENABLE_FRONTEND_HTML !== "true") return res.status(404).json({ error: "Server-rendered HTML is disabled. Use the SPA frontend." });
  renderForgotPasswordPage(req, res, next);
});

export default router;
