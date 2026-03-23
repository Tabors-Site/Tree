import express from "express";
import {
  register,
  login,
  logout,
} from "../core/users.js";
import authenticate from "../middleware/authenticate.js";
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

// HTML page routes, share token, verify-token moved to html-rendering extension
// Email routes (forgot-password, reset-password, verify) moved to email extension

// HTML form POST handlers (mounted at / by routesHandler.js)
export const authPageRouter = express.Router();

authPageRouter.post("/register", registerLimiter, register);
authPageRouter.post("/login", loginLimiter, login);
authPageRouter.post("/logout", authenticate, logout);

// GET /login, GET /register, GET /forgot-password pages served by html-rendering extension
