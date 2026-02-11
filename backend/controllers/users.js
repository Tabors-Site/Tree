import User from "../db/models/user.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import nodemailer from "nodemailer";

const JWT_SECRET = process.env.JWT_SECRET || "your_secret_key";

/* ===========================
    REGISTER
=========================== */
import TempUser from "../db/models/tempUser.js";

const register = async (req, res) => {
  try {
    let { username, password, email } = req.body;

    /* -------------------------
       ORIGINAL VALIDATIONS
    -------------------------- */

    if (!username || !password || !email) {
      return res.status(400).json({
        message: "Username, email, and password are required",
      });
    }
    if (password.length < 8) {
      return res.status(400).json({
        message: "Password must be at least 8 characters long",
      });
    }
    username = username.trim();

    /* -------------------------
       CHECK REAL USERS (EXACT MATCH)
    -------------------------- */

    const existingUser = await User.findOne({
      username: { $regex: `^${username}$`, $options: "i" },
    });

    if (existingUser) {
      return res.status(400).json({ message: "Username already taken" });
    }

    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      return res.status(400).json({ message: "Email already registered" });
    }

    /* -------------------------
       CLEAN OLD TEMP USERS
    -------------------------- */

    await TempUser.deleteMany({
      $or: [
        { email },
        { username: { $regex: `^${username}$`, $options: "i" } },
      ],
    });

    /* -------------------------
       CREATE TEMP USER
    -------------------------- */

    const verificationToken = crypto.randomBytes(32).toString("hex");

    let temp = await TempUser.create({
      username,
      email,
      password,
      verificationToken,
      expiresAt: Date.now() + 1000 * 60 * 60 * 12, // 12 hours
    });

    /* -------------------------
       SEND EMAIL
    -------------------------- */

    const verifyUrl = `https://tree.tabors.site/api/user/verify/${verificationToken}`;
    await sendVerificationEmail(email, verifyUrl, temp.username);

    res.status(201).json({
      message: "Check your email to complete registration",
    });
  } catch (error) {
    console.error("Error during registration:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

const verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;

    const tempUser = await TempUser.findOne({
      verificationToken: token,
      expiresAt: { $gt: Date.now() },
    });

    if (!tempUser) {
      return res.status(400).json({
        message: "Invalid or expired verification link",
      });
    }

    /* -------------------------
       RE-RUN ORIGINAL CHECKS
    -------------------------- */

    const existingUser = await User.findOne({
      username: { $regex: `^${tempUser.username}$`, $options: "i" },
    });

    if (existingUser) {
      await tempUser.deleteOne();
      return res.status(400).json({ message: "Username already taken" });
    }

    const existingEmail = await User.findOne({ email: tempUser.email });
    if (existingEmail) {
      await tempUser.deleteOne();
      return res.status(400).json({ message: "Email already registered" });
    }

    /* -------------------------
       CREATE REAL USER
    -------------------------- */

    const user = await User.create({
      username: tempUser.username,
      email: tempUser.email,
      password: tempUser.password, // already hashed
    });
    const authToken = jwt.sign(
      { userId: user._id, username: user.username },
      JWT_SECRET,
      { expiresIn: "365d" }
    );

    res.cookie("token", authToken, {
      httpOnly: false, // matches your login behavior
      secure: true,
      sameSite: "None",
      domain: ".tabors.site",
      maxAge: 604800000,
      path: "/",
    });
    /* -------------------------
       CLEANUP
    -------------------------- */

    await tempUser.deleteOne();
    return res.redirect(
      `https://tree.tabors.site/app`
    );
  } catch (err) {
    console.error("[verifyEmail]", err);
    res.status(500).json({ message: "Verification failed" });
  }
};

/* ===========================
    LOGIN
=========================== */
const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res
        .status(400)
        .json({ message: "Username and password are required" });
    }

    const user = await User.findOne({
      username: { $regex: `^${username}$`, $options: "i" },
    });
    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { userId: user._id, username: user.username },
      JWT_SECRET,
      { expiresIn: "365d" }
    );

    res.cookie("token", token, {
      httpOnly: false,
      secure: true,
      sameSite: "None",
      domain: ".tabors.site",
      maxAge: 604800000,
      path: "/",
    });

    res.status(200).json({
      message: "Login successful",
      token,
      userId: user._id.toString(),
      htmlShareToken: user.htmlShareToken || null,
    });
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).json({ message: "Server is down" });
  }
};

/* ===========================
    LOGOUT
=========================== */
const logout = async (req, res) => {
  try {
    res.clearCookie("token", {
      httpOnly: false,
      secure: true,
      sameSite: "None",
      domain: ".tabors.site",
      path: "/",
    });

    return res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    console.error("Error during logout:", error);
    return res.status(500).json({ message: "Logout failed" });
  }
};

/* ===========================
    GET HTML SHARE TOKEN
=========================== */
const getHtmlShareToken = async (req, res, next) => {
  try {
    const userId = req.userId;

    const user = await User.findById(userId)
      .select("htmlShareToken")
      .lean()
      .exec();

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    req.HTMLShareToken = user.htmlShareToken ?? null;
    next();
  } catch (err) {
    console.error("[getHtmlShareToken]", err);
    res.status(500).json({ message: "Failed to fetch HTML share token" });
  }
};

const URL_SAFE_REGEX = /^[A-Za-z0-9\-_.~]+$/;

/* ===========================
    SET HTML SHARE TOKEN
=========================== */
const setHtmlShareToken = async (req, res) => {
  try {
    const userId = req.userId;
    let { htmlShareToken } = req.body;

    if (!userId) {
      return res.status(401).json({
        message: "Not authenticated",
      });
    }

    if (typeof htmlShareToken !== "string") {
      return res.status(400).json({
        message: "htmlShareToken must be a string",
      });
    }

    htmlShareToken = htmlShareToken.trim();

    if (htmlShareToken.length > 128 || htmlShareToken.length < 1) {
      return res.status(400).json({
        message: "htmlShareToken must be 1–128 characters",
      });
    }

    if (!URL_SAFE_REGEX.test(htmlShareToken)) {
      return res.status(400).json({
        message:
          "htmlShareToken may only contain URL-safe characters (A–Z a–z 0–9 - _ . ~)",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    user.htmlShareToken = htmlShareToken;
    await user.save();

    return res.json({
      htmlShareToken: user.htmlShareToken,
    });
  } catch (err) {
    console.error("[setHtmlShareToken]", err);
    res.status(500).json({
      message: "Failed to set html share token",
    });
  }
};

/* ==========================================================
     PASSWORD RESET LOGIC  — Placed at bottom as requested
========================================================== */

/* ---- SEND EMAIL FUNCTION ---- */
async function sendResetEmail(to, link) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS, // Google App Password
    },
  });

  await transporter.sendMail({
    from: `<${process.env.EMAIL_USER}>`,
    to,
    subject: "Password Reset",
    html: `
      <p>You requested a password reset.</p>
      <p>Click the link below to reset your password:</p>
      <a href="${link}">${link}</a>
      <p>This link expires in 15 minutes.</p>

      <p>Sincerely,</p>
      <p>Tree Helper</p>

    `,
  });
}

/* ---- SEND REGISTRATION VERIFICATION EMAIL ---- */
async function sendVerificationEmail(to, link, username) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS, // Google App Password
    },
  });

  await transporter.sendMail({
    from: `<${process.env.EMAIL_USER}>`,
    to,
    subject: "Complete Your Registration",
    html: `
      <p>Thanks for registering, ${username}!</p>

      <p>Please confirm your email by clicking the link below:</p>

      <p>
        <a href="${link}">${link}</a>
      </p>

      <p>This link expires in <strong>12 hours</strong>.</p>

      <p>If you did not request this account, you can ignore this email.</p>

      <p>— Tree Helper</p>
    `,
  });
}

/* ---- FORGOT PASSWORD ---- */
const forgotPassword = async (req, res) => {
  const { email } = req.body;

  const user = await User.findOne({ email });
  if (!user) {
    return res.json({
      message: "Reset link sent if email exists",
    });
  }

  const token = crypto.randomBytes(32).toString("hex");

  user.resetPasswordToken = token;
  user.resetPasswordExpiry = Date.now() + 1000 * 60 * 15; // 15 min
  await user.save();

  const resetURL = `https://tree.tabors.site/api/user/reset-password/${token}`;

  await sendResetEmail(user.email, resetURL);

  res.json({ message: "Reset link sent if email exists" });
};

/* ---- RESET PASSWORD ---- */
const resetPassword = async (req, res) => {
  const { token, password } = req.body;

  const user = await User.findOne({
    resetPasswordToken: token,
    resetPasswordExpiry: { $gt: Date.now() },
  });

  if (!user) {
    return res.status(400).json({ message: "Invalid or expired token" });
  }

  user.password = password; // Automatically hashed
  user.resetPasswordToken = undefined;
  user.resetPasswordExpiry = undefined;

  await user.save();

  res.json({ message: "Password has been reset successfully" });
};

export async function generateApiKey() {
  const rawKey = crypto.randomBytes(32).toString("hex"); // 64 chars
  const keyHash = await bcrypt.hash(rawKey, 10);

  return { rawKey, keyHash };
}

export async function compareApiKey(rawKey, keyHash) {
  return bcrypt.compare(rawKey, keyHash);
}

const MAX_API_KEYS_PER_USER = 10;

export const createApiKey = async (req, res) => {
  try {
    const userId = req.userId;
    const { name, revokeOld = false } = req.body;

    if (name && typeof name !== "string") {
      return res.status(400).json({ message: "Invalid key name" });
    }

    const safeName = name?.trim().slice(0, 64) || "API Key";

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (
      user.apiKeys.filter((k) => !k.revoked).length >= MAX_API_KEYS_PER_USER
    ) {
      return res.status(400).json({
        message: "API key limit reached",
      });
    }

    if (revokeOld) {
      user.apiKeys.forEach((k) => (k.revoked = true));
    }

    const { rawKey, keyHash } = await generateApiKey();

    user.apiKeys.push({
      keyHash,
      name: safeName,
    });

    await user.save();

    return res.status(201).json({
      apiKey: rawKey,
      message: "Store this key securely. You will not see it again.",
    });
  } catch (err) {
    console.error("[createApiKey]", err);
    return res.status(500).json({ message: "Failed to create API key" });
  }
};

export const listApiKeys = async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("apiKeys").lean();

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json(
      user.apiKeys.map((k) => ({
        id: k._id,
        name: k.name,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
        usageCount: k.usageCount,
        revoked: k.revoked,
      }))
    );
  } catch (err) {
    console.error("[listApiKeys]", err);
    return res.status(500).json({ message: "Failed to list API keys" });
  }
};

export const deleteApiKey = async (req, res) => {
  try {
    const { keyId } = req.params;

    if (!keyId) {
      return res.status(400).json({ message: "Key ID required" });
    }

    const result = await User.updateOne(
      { _id: req.userId, "apiKeys._id": keyId },
      { $set: { "apiKeys.$.revoked": true } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "API key not found" });
    }

    return res.json({ message: "API key revoked" });
  } catch (err) {
    console.error("[deleteApiKey]", err);
    return res.status(500).json({ message: "Failed to revoke API key" });
  }
};

/* ===========================
    EXPORT CONTROLLERS
=========================== */
export {
  register,
  login,
  logout,
  getHtmlShareToken,
  setHtmlShareToken,
  forgotPassword,
  resetPassword,
  verifyEmail,
};
