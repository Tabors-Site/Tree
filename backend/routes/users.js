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
} from "../controllers/users.js";
import authenticate from "../middleware/authenticate.js";

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
  setHtmlShareToken
);

router.post("/verify-token", authenticate, getHtmlShareToken, (req, res) => {
  res.json({
    userId: req.userId,
    username: req.username,
    HTMLShareToken: req.HTMLShareToken,
  });
});

router.post("/user/forgot-password", emailLimiter, forgotPassword);
router.post("/user/reset-password", resetPassword);
router.get("/user/verify/:token", verifyEmail);

export default router;
