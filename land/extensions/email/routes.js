import log from "../../core/log.js";
import express from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import User from "../../db/models/user.js";
import TempUser from "./model.js";
import { sendResetEmail } from "./core.js";
import { getLandUrl } from "../../canopy/identity.js";
import { getLandConfigValue } from "../../core/landConfig.js";
import { getExtension } from "../loader.js";
import rateLimit from "express-rate-limit";

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
    res.status(429).json({
      error: "Too many email requests",
      message: "Too many email requests.",
    });
  },
});

const router = express.Router();

router.post("/forgot-password", emailLimiter, async (req, res) => {
  const { email } = req.body;
  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !EMAIL_REGEX.test(email)) {
    return res.json({ message: "Reset link sent if email exists" });
  }

  const user = await User.findOne({ "metadata.email.address": email.trim().toLowerCase() });
  if (!user) {
    return res.json({ message: "Reset link sent if email exists" });
  }

  const token = crypto.randomBytes(32).toString("hex");

  const emailMeta = (user.metadata instanceof Map ? user.metadata.get("email") : user.metadata?.email) || {};
  emailMeta.resetToken = token;
  emailMeta.resetExpiry = Date.now() + 1000 * 60 * 15;
  if (user.metadata instanceof Map) {
    user.metadata.set("email", emailMeta);
  } else {
    if (!user.metadata) user.metadata = {};
    user.metadata.email = emailMeta;
  }
  if (user.markModified) user.markModified("metadata");
  await user.save();

  const resetURL = `${getLandUrl()}/api/v1/user/reset-password/${token}`;
  await sendResetEmail(emailMeta.address, resetURL);

  res.json({ message: "Reset link sent if email exists" });
});

router.post("/user/reset-password", async (req, res) => {
  const { token, password } = req.body;
  if (!password || typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ message: "Password must be at least 8 characters long" });
  }

  const user = await User.findOne({
    "metadata.email.resetToken": token,
    "metadata.email.resetExpiry": { $gt: Date.now() },
  });

  if (!user) {
    return res.status(400).json({ message: "Invalid or expired token" });
  }

  user.password = password;
  const emailMeta = (user.metadata instanceof Map ? user.metadata.get("email") : user.metadata?.email) || {};
  delete emailMeta.resetToken;
  delete emailMeta.resetExpiry;
  if (user.metadata instanceof Map) {
    user.metadata.set("email", emailMeta);
  } else {
    user.metadata.email = emailMeta;
  }
  if (user.markModified) user.markModified("metadata");
  await user.save();

  res.json({ message: "Password has been reset successfully" });
});

router.get("/user/verify/:token", async (req, res) => {
  try {
    const { token } = req.params;

    const tempUser = await TempUser.findOne({
      verificationToken: token,
      expiresAt: { $gt: Date.now() },
    });

    if (!tempUser) {
      return res.status(400).json({ message: "Invalid or expired verification link" });
    }

    const existingUser = await User.findOne({
      username: { $regex: `^${escapeRegex(tempUser.username)}$`, $options: "i" },
    });
    if (existingUser) {
      await tempUser.deleteOne();
      return res.status(400).json({ message: "Username already taken" });
    }

    const existingEmail = await User.findOne({ "metadata.email.address": tempUser.email });
    if (existingEmail) {
      await tempUser.deleteOne();
      return res.status(400).json({ message: "Email already registered" });
    }

    const user = await User.create({
      username: tempUser.username,
      password: tempUser.password,
      profileType: getLandConfigValue("LAND_DEFAULT_TIER") || "basic",
    });

    if (user.metadata instanceof Map) {
      user.metadata.set("email", { address: tempUser.email, verified: true });
    } else {
      if (!user.metadata) user.metadata = {};
      user.metadata.email = { address: tempUser.email, verified: true };
    }
    if (user.markModified) user.markModified("metadata");
    await user.save();

    const { hooks } = await import("../../core/hooks.js");
    hooks.run("afterRegister", { user, email: tempUser.email }).catch(() => {});

    const authToken = jwt.sign(
      { userId: user._id, username: user.username },
      JWT_SECRET,
      { expiresIn: "365d" },
    );

    res.cookie("token", authToken, {
      httpOnly: false,
      secure: true,
      sameSite: "None",
      domain: cookieDomain(req),
      maxAge: 604800000,
      path: "/",
    });

    await tempUser.deleteOne();
    return res.redirect(`${getLandUrl()}/setup`);
  } catch (err) {
 log.error("Email", "[email:verifyEmail]", err);
    res.status(500).json({ message: "Verification failed" });
  }
});

router.get("/forgot-password", (req, res) => {
  const htmlExt = getExtension("html-rendering");
  const render = htmlExt?.exports?.renderForgotPasswordPage;
  if (process.env.ENABLE_FRONTEND_HTML !== "true" || !render) {
    return res.status(404).json({ error: "Not available" });
  }
  render(req, res);
});

export default router;
