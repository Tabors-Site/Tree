// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Auth routes. Two routers — `authApiRouter` mounts at /api/v1 for
// JSON callers (CLI, programmatic clients); `authPageRouter` mounts
// at / for HTML form POSTs from the login / register pages. Both
// dispatch into the same handlers in users.js, which are thin shims
// over the IBP BE verb routed through the cherub.
//
// HTML GET pages, share-token, verify-token, forgot-password,
// reset-password, and email-verify routes belong to the
// html-rendering / email extensions — they live in extensions/,
// not here.

import express from "./app.js";
import { register, login, logout } from "./users.js";
import authenticate from "./middleware/authenticate.js";
import rateLimit from "./middleware/rateLimit.js";
import { sendError, IBP_ERR } from "../../seed/ibp/protocol.js";

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  handler: (req, res) => {
    sendError(res, 429, IBP_ERR.RATE_LIMITED, "Too many registrations. Please try again in 1 hour.");
  },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  handler: (req, res) => {
    sendError(res, 429, IBP_ERR.RATE_LIMITED, "Too many login attempts. You have been blocked for 15 minutes due to spam.", { retryAfterMinutes: 15 });
  },
});

// JSON API routes (mounted at /api/v1).
export const authApiRouter = express.Router();
authApiRouter.post("/register", registerLimiter, register);
authApiRouter.post("/login",    loginLimiter,    login);
authApiRouter.post("/logout",   authenticate,    logout);

// HTML form POST handlers (mounted at /).
export const authPageRouter = express.Router();
authPageRouter.post("/register", registerLimiter, register);
authPageRouter.post("/login",    loginLimiter,    login);
authPageRouter.post("/logout",   authenticate,    logout);
