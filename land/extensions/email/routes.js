import log from "../../seed/log.js";
import express from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
// User model wired from init via setModels
let User = null;
export function setModels(models) { User = models.User; }
import TempUser from "./model.js";
import { sendResetEmail } from "./core.js";
import { getLandUrl } from "../../canopy/identity.js";
import { getLandConfigValue } from "../../seed/landConfig.js";
import { getExtension } from "../loader.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import authenticate from "../../seed/middleware/authenticate.js";
import rateLimit from "express-rate-limit";
import { getUserMeta, setUserMeta } from "../../seed/tree/userMetadata.js";

const JWT_SECRET = process.env.JWT_SECRET;

function cookieDomain(req) {
  const host = req.hostname || req.headers.host || "";
  return host.replace(/:\d+$/, "");
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  handler: (req, res) => {
    sendError(res, 429, ERR.RATE_LIMITED, "Too many email requests.");
  },
});

const router = express.Router();

router.post("/forgot-password", emailLimiter, async (req, res) => {
  const { email } = req.body;
  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !EMAIL_REGEX.test(email)) {
    return sendOk(res, { message: "Reset link sent if email exists" });
  }

  const user = await User.findOne({ "metadata.email.address": email.trim().toLowerCase() });
  if (!user) {
    return sendOk(res, { message: "Reset link sent if email exists" });
  }

  const token = crypto.randomBytes(32).toString("hex");

  const emailMeta = getUserMeta(user, "email");
  emailMeta.resetToken = token;
  emailMeta.resetExpiry = Date.now() + 1000 * 60 * 15;
  setUserMeta(user, "email", emailMeta);
  await user.save();

  const resetURL = `${getLandUrl()}/api/v1/user/reset-password/${token}`;
  await sendResetEmail(emailMeta.address, resetURL);

  sendOk(res, { message: "Reset link sent if email exists" });
});

router.post("/user/reset-password", async (req, res) => {
  const { token, password } = req.body;
  if (!password || typeof password !== "string" || password.length < 8) {
    return sendError(res, 400, ERR.INVALID_INPUT, "Password must be at least 8 characters long");
  }

  const user = await User.findOne({
    "metadata.email.resetToken": token,
    "metadata.email.resetExpiry": { $gt: Date.now() },
  });

  if (!user) {
    return sendError(res, 403, ERR.SESSION_EXPIRED, "Invalid or expired token");
  }

  user.password = password;

  // Clear reset token
  const emailMeta = getUserMeta(user, "email");
  delete emailMeta.resetToken;
  delete emailMeta.resetExpiry;
  setUserMeta(user, "email", emailMeta);

  // Invalidate all existing JWT tokens
  const authMeta = getUserMeta(user, "auth");
  authMeta.tokensInvalidBefore = new Date().toISOString();
  setUserMeta(user, "auth", authMeta);

  await user.save();

  sendOk(res, { message: "Password has been reset successfully" });
});

router.get("/user/verify/:token", async (req, res) => {
  try {
    const { token } = req.params;

    const tempUser = await TempUser.findOne({
      verificationToken: token,
      expiresAt: { $gt: Date.now() },
    });

    if (!tempUser) {
      return sendError(res, 403, ERR.SESSION_EXPIRED, "Invalid or expired verification link");
    }

    const existingUser = await User.findOne({
      username: { $regex: `^${escapeRegex(tempUser.username)}$`, $options: "i" },
    });
    if (existingUser) {
      await tempUser.deleteOne();
      return sendError(res, 400, ERR.INVALID_INPUT, "Username already taken");
    }

    const existingEmail = await User.findOne({ "metadata.email.address": tempUser.email });
    if (existingEmail) {
      await tempUser.deleteOne();
      return sendError(res, 400, ERR.INVALID_INPUT, "Email already registered");
    }

    const user = await User.create({
      username: tempUser.username,
      password: tempUser.password,
      // Tier set via user-tiers extension if installed
    });

    setUserMeta(user, "email", { address: tempUser.email, verified: true });
    await user.save();

    const { hooks } = await import("../../seed/hooks.js");
    hooks.run("afterRegister", { user, email: tempUser.email }).catch(() => {});

    const authToken = jwt.sign(
      { userId: user._id, username: user.username },
      JWT_SECRET,
      { expiresIn: "365d" },
    );

    res.cookie("token", authToken, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      domain: cookieDomain(req),
      maxAge: 604800000,
      path: "/",
    });

    await tempUser.deleteOne();
    return res.redirect(`${getLandUrl()}/setup`);
  } catch (err) {
    log.error("Email", "[email:verifyEmail]", err);
    sendError(res, 500, ERR.INTERNAL, "Verification failed");
  }
});

router.post("/user/change-password", authenticate, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || typeof oldPassword !== "string") {
      return sendError(res, 400, ERR.INVALID_INPUT, "Current password is required");
    }
    if (!newPassword || typeof newPassword !== "string" || newPassword.length < 8) {
      return sendError(res, 400, ERR.INVALID_INPUT, "New password must be at least 8 characters");
    }

    const user = await User.findById(req.userId).select("+password metadata");
    if (!user) return sendError(res, 404, ERR.USER_NOT_FOUND, "User not found");

    const bcrypt = (await import("bcrypt")).default;
    const valid = await bcrypt.compare(oldPassword, user.password);
    if (!valid) {
      return sendError(res, 403, ERR.FORBIDDEN, "Current password is incorrect");
    }

    // Set new password. User pre-save hook rehashes it.
    user.password = newPassword;

    // Invalidate all existing tokens
    const authMeta = getUserMeta(user, "auth");
    authMeta.tokensInvalidBefore = new Date().toISOString();
    setUserMeta(user, "auth", authMeta);

    await user.save();

    // Issue new token so user stays logged in
    const newToken = jwt.sign(
      { userId: user._id, username: user.username },
      JWT_SECRET,
      { expiresIn: "365d" },
    );

    sendOk(res, { message: "Password changed successfully", token: newToken });
  } catch (err) {
    log.error("Email", "Change password error:", err.message);
    sendError(res, 500, ERR.INTERNAL, "Failed to change password");
  }
});

router.get("/forgot-password", (req, res) => {
  const htmlExt = getExtension("html-rendering");
  const render = htmlExt?.exports?.renderForgotPasswordPage;
  if (!getExtension("html-rendering") || !render) {
    return sendError(res, 404, ERR.EXTENSION_NOT_FOUND, "Not available");
  }
  render(req, res);
});

export default router;
