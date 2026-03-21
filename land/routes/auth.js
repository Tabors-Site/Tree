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

// API routes (mounted at /api/v1 by routeHandler.js)
export const authApiRouter = express.Router();

authApiRouter.post("/register", registerLimiter, register);
authApiRouter.post("/login", loginLimiter, login);
authApiRouter.post("/logout", authenticate, logout);

authApiRouter.post(
  "/setHTMLShareToken",
  authenticate,
  loginLimiter,
  setHtmlShareToken,
);

authApiRouter.post(
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

authApiRouter.post("/forgot-password", emailLimiter, forgotPassword);
authApiRouter.post("/user/reset-password", resetPassword);
authApiRouter.get("/user/verify/:token", verifyEmail);

// HTML pages + their POST handlers (mounted at / by routesHandler.js)
export const authPageRouter = express.Router();

// POST routes needed by the server-rendered HTML forms
authPageRouter.post("/register", registerLimiter, register);
authPageRouter.post("/login", loginLimiter, login);
authPageRouter.post("/logout", authenticate, logout);
authPageRouter.post("/forgot-password", emailLimiter, forgotPassword);
authPageRouter.post("/user/reset-password", resetPassword);

authPageRouter.get("/login", (req, res, next) => {
  if (process.env.ENABLE_FRONTEND_HTML !== "true") return res.status(404).json({ error: "Server-rendered HTML is disabled. Use the SPA frontend." });
  renderLoginPage(req, res, next);
});
authPageRouter.get("/register", (req, res, next) => {
  if (process.env.ENABLE_FRONTEND_HTML !== "true") return res.status(404).json({ error: "Server-rendered HTML is disabled. Use the SPA frontend." });
  renderRegisterPage(req, res, next);
});
authPageRouter.get("/forgot-password", (req, res, next) => {
  if (process.env.ENABLE_FRONTEND_HTML !== "true") return res.status(404).json({ error: "Server-rendered HTML is disabled. Use the SPA frontend." });
  renderForgotPasswordPage(req, res, next);
});
