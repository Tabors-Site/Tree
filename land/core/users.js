import User from "../db/models/user.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { getLandConfigValue } from "./landConfig.js";
import { getLandUrl } from "../canopy/identity.js";

const __users_dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__users_dirname, "../..", ".env") });

if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required. Run the setup wizard or add it to .env");
const JWT_SECRET = process.env.JWT_SECRET;
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cookieDomain(req) {
  const host = (req.hostname || req.headers?.host || "").replace(/:\d+$/, "");
  const creatorUrl = process.env.CREATOR_DOMAIN || process.env.ROOT_FRONTEND_DOMAIN;
  const rootHost = creatorUrl ? new URL(creatorUrl).hostname : "";
  const treeHost = getLandUrl() ? new URL(getLandUrl()).hostname : "";
   if (treeHost && host.endsWith(treeHost)) return "." + treeHost;

  if (rootHost && host.endsWith(rootHost)) return "." + rootHost;
  return undefined;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function containsHtml(str) {
  return /<[a-zA-Z\/][^>]*>/.test(str);
}
function isValidEmail(email) {
  if (typeof email !== "string") return false;
  email = email.trim();
  if (email.length > 320) return false;
  return EMAIL_REGEX.test(email);
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
/* ===========================
    REGISTER
=========================== */
import TempUser from "../db/models/tempUser.js";

const register = async (req, res) => {
  try {
    let { username, password, email } = req.body;

    /* -------------------------
       VALIDATIONS
    -------------------------- */

    if (!username || !password) {
      return res.status(400).json({
        message: "Username and password are required",
      });
    }
    if (!/^[a-zA-Z0-9_\-]{1,32}$/.test(username)) {
      return res.status(400).json({
        message: "Username may only contain letters, numbers, hyphens, and underscores (1-32 chars)",
      });
    }
    if (password.length < 8) {
      return res.status(400).json({
        message: "Password must be at least 8 characters long",
      });
    }
    username = username.trim();

    if (email) {
      if (!isValidEmail(email)) {
        return res.status(400).json({
          message: "Please enter a valid email address",
        });
      }
      email = email.trim().toLowerCase();
    }

    /* -------------------------
       CHECK DUPLICATES
    -------------------------- */

    const existingUser = await User.findOne({
      username: { $regex: `^${escapeRegex(username)}$`, $options: "i" },
    });
    if (existingUser) {
      return res.status(400).json({ message: "Username already taken" });
    }

    if (email) {
      const existingEmail = await User.findOne({ email });
      if (existingEmail) {
        return res.status(400).json({ message: "Email already registered" });
      }
    }

    /* -------------------------
       FIRST USER: CREATE DIRECTLY AS ADMIN
    -------------------------- */

    // Atomic check: try to create the user as first. If another request
    // raced us, the duplicate username check above (or this countDocuments)
    // will catch it. We re-check count right before creation.
    const userCount = await User.countDocuments();
    const isFirstUser = userCount === 0;

    if (isFirstUser) {
      const user = new User({
        username,
        password,
        email: email || null,
        profileType: "god",
      });

      try {
        await user.save();
      } catch (err) {
        // Race condition: another first-user registered between count and save
        if (err.code === 11000) {
          return res.status(400).json({ message: "Username already taken" });
        }
        throw err;
      }

      const { rawKey, keyHash } = await generateApiKey();
      user.apiKeys.push({ keyHash, name: "treeos-cli" });
      await user.save();

      const token = jwt.sign(
        { userId: user._id, username: user.username },
        JWT_SECRET,
        { expiresIn: "365d" },
      );

      return res.status(201).json({
        firstUser: true,
        token,
        apiKey: rawKey,
        userId: user._id,
        username: user.username,
        profileType: user.profileType,
      });
    }

    /* -------------------------
       SUBSEQUENT USERS
    -------------------------- */

    const requireEmail = getLandConfigValue("REQUIRE_EMAIL") !== "false";

    if (requireEmail && !email) {
      return res.status(400).json({
        message: "Email is required for registration",
      });
    }

    // Email not required by land config: create user directly
    if (!requireEmail && !email) {
      const user = new User({
        username,
        password,
        email: null,
      });

      try {
        await user.save();
      } catch (err) {
        if (err.code === 11000) {
          return res.status(400).json({ message: "Username already taken" });
        }
        throw err;
      }

      const token = jwt.sign(
        { userId: user._id, username: user.username },
        JWT_SECRET,
        { expiresIn: "365d" },
      );

      return res.status(201).json({
        token,
        userId: user._id,
        username: user.username,
        profileType: user.profileType,
      });
    }

    // Email provided: verification flow
    await TempUser.deleteMany({
      $or: [
        { email },
        { username: { $regex: `^${escapeRegex(username)}$`, $options: "i" } },
      ],
    });

    const verificationToken = crypto.randomBytes(32).toString("hex");

    let temp = await TempUser.create({
      username,
      email,
      password,
      verificationToken,
      expiresAt: Date.now() + 1000 * 60 * 60 * 12, // 12 hours
    });

    const verifyUrl = `${getLandUrl()}/api/v1/user/verify/${verificationToken}`;
    await sendVerificationEmail(email, verifyUrl, temp.username);

    res.status(201).json({
      pendingVerification: true,
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
  username: { $regex: `^${escapeRegex(tempUser.username)}$`, $options: "i" },
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
      profileType: getLandConfigValue("LAND_DEFAULT_TIER") || "basic",
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
      domain: cookieDomain(req),
      maxAge: 604800000,
      path: "/",
    });
    /* -------------------------
       CLEANUP
    -------------------------- */

    await tempUser.deleteOne();
    return res.redirect(
      `${getLandUrl()}/setup`
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
      username: { $regex: `^${escapeRegex(username)}$`, $options: "i" },
    });
    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    // SECURITY: Remote/ghost users cannot log in with a password
    if (user.isRemote) {
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
      domain: cookieDomain(req),
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
      domain: cookieDomain(req),
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
      pass: process.env.EMAIL_PASS,
    },
  });

  await transporter.sendMail({
    from: `"TreeOS" <${process.env.EMAIL_USER}>`,
    to,
    subject: "Password Reset",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <span style="font-size: 48px;">🌳</span>
          <h1 style="font-size: 24px; color: #1a1a1a; margin: 8px 0 0;">Tree</h1>
        </div>

        <p style="font-size: 16px; color: #333; line-height: 1.6;">
          We received a request to reset your password.
        </p>

        <p style="font-size: 16px; color: #333; line-height: 1.6;">
          Click the button below to choose a new password:
        </p>

        <div style="text-align: center; margin: 32px 0;">
          <a href="${link}" style="display: inline-block; background-color: #736fe6; color: white; text-decoration: none; padding: 14px 32px; border-radius: 980px; font-size: 16px; font-weight: 600;">
            Reset My Password
          </a>
        </div>

        <p style="font-size: 13px; color: #888; line-height: 1.5;">
          This link expires in 15 minutes. If you didn't request a password reset, you can safely ignore this email — your password won't change.
        </p>

        <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0 16px;" />

        <p style="font-size: 12px; color: #aaa; line-height: 1.5;">
          If the button doesn't work, copy and paste this link into your browser:<br />
          <a href="${link}" style="color: #736fe6; word-break: break-all;">${link}</a>
        </p>
      </div>
    `,
  });
}

/* ---- SEND REGISTRATION VERIFICATION EMAIL ---- */
async function sendVerificationEmail(to, link, username) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  await transporter.sendMail({
    from: `"TreeOS" <${process.env.EMAIL_USER}>`,
    to,
    subject: "Complete Your Registration",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <span style="font-size: 48px;">🌳</span>
          <h1 style="font-size: 24px; color: #1a1a1a; margin: 8px 0 0;">Tree</h1>
        </div>

        <p style="font-size: 16px; color: #333; line-height: 1.6;">
          Hey ${escapeHtml(username)}, thanks for signing up!
        </p>

        <p style="font-size: 16px; color: #333; line-height: 1.6;">
          Click the button below to verify your email and activate your account:
        </p>

        <div style="text-align: center; margin: 32px 0;">
          <a href="${link}" style="display: inline-block; background-color: #736fe6; color: white; text-decoration: none; padding: 14px 32px; border-radius: 980px; font-size: 16px; font-weight: 600;">
            Verify My Email
          </a>
        </div>

        <p style="font-size: 13px; color: #888; line-height: 1.5;">
          This link expires in 12 hours. If you didn't create this account, you can safely ignore this email.
        </p>

        <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0 16px;" />

        <p style="font-size: 12px; color: #aaa; line-height: 1.5;">
          If the button doesn't work, copy and paste this link into your browser:<br />
          <a href="${link}" style="color: #736fe6; word-break: break-all;">${link}</a>
        </p>
      </div>
    `,
  });
}

/* ---- FORGOT PASSWORD ---- */
const forgotPassword = async (req, res) => {
  const { email } = req.body;

   if (!email || !isValidEmail(email)) {
    return res.json({ message: "Reset link sent if email exists" });
  }

  const user = await User.findOne({ email: email.trim().toLowerCase() });
  if (!user) {
    return res.json({
      message: "Reset link sent if email exists",
    });
  }

  const token = crypto.randomBytes(32).toString("hex");

  user.resetPasswordToken = token;
  user.resetPasswordExpiry = Date.now() + 1000 * 60 * 15; // 15 min
  await user.save();

  const resetURL = `${getLandUrl()}/api/v1/user/reset-password/${token}`;

  await sendResetEmail(user.email, resetURL);

  res.json({ message: "Reset link sent if email exists" });
};

/* ---- RESET PASSWORD ---- */
const resetPassword = async (req, res) => {
  const { token, password } = req.body;
if (!password || typeof password !== "string" || password.length < 8) {
    return res.status(400).json({
      message: "Password must be at least 8 characters long",
    });
  }
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

if (containsHtml(safeName)) {
  return res.status(400).json({ message: "Key name cannot contain HTML tags" });
}
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
