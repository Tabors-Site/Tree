import log from "./log.js";
import User from "./models/user.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { getLandUrl } from "../canopy/identity.js";
import { hooks } from "./hooks.js";
import { escapeRegex } from "./utils.js";
import { sendOk, sendError, ERR } from "./protocol.js";

const __users_dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__users_dirname, "../..", ".env") });

if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required. Run the setup wizard or add it to .env");
const JWT_SECRET = process.env.JWT_SECRET;

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
function isValidEmail(email) {
  if (typeof email !== "string") return false;
  email = email.trim();
  if (email.length > 320) return false;
  return EMAIL_REGEX.test(email);
}

/* ===========================
    REGISTER
=========================== */

const register = async (req, res) => {
  try {
    let { username, password, email } = req.body;

    /* -------------------------
       VALIDATIONS
    -------------------------- */

    if (!username || !password) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Username and password are required");
    }
    if (!/^[a-zA-Z0-9_\-]{1,32}$/.test(username)) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Username may only contain letters, numbers, hyphens, and underscores (1-32 chars)");
    }
    if (password.length < 8) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Password must be at least 8 characters long");
    }
    username = username.trim();

    if (email) {
      if (!isValidEmail(email)) {
        return sendError(res, 400, ERR.INVALID_INPUT, "Please enter a valid email address");
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
      return sendError(res, 400, ERR.INVALID_INPUT, "Username already taken");
    }

    if (email) {
      const existingEmail = await User.findOne({ email });
      if (existingEmail) {
        return sendError(res, 400, ERR.INVALID_INPUT, "Email already registered");
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
        isAdmin: true,
      });

      try {
        await user.save();
      } catch (err) {
        // Race condition: another first-user registered between count and save
        if (err.code === 11000) {
          return sendError(res, 400, ERR.INVALID_INPUT, "Username already taken");
        }
        throw err;
      }

      // afterRegister hook (fire-and-forget)
      hooks.run("afterRegister", { user, email }).catch(() => {});

      const token = jwt.sign(
        { userId: user._id, username: user.username },
        JWT_SECRET,
        { expiresIn: "30d" },
      );

      return sendOk(res, {
        firstUser: true,
        token,
        userId: user._id,
        username: user.username,
        isAdmin: user.isAdmin || false,
      }, 201);
    }

    /* -------------------------
       SUBSEQUENT USERS
    -------------------------- */

    // Let extensions handle email verification (beforeRegister hook).
    // If an extension sets hookData.handled = true, it owns the response.
    const hookData = { username, password, email, req, res, handled: false };
    const hookResult = await hooks.run("beforeRegister", hookData);
    if (hookResult.cancelled) {
      return sendError(res, 403, ERR.FORBIDDEN, hookResult.reason || "Registration blocked");
    }
    if (hookData.handled) {
      // Extension (e.g. email) sent its own response (pendingVerification, etc.)
      return;
    }

    // No extension handled it. Create user directly.
    const user = new User({
      username,
      password,
    });

    try {
      await user.save();
    } catch (err) {
      if (err.code === 11000) {
        return sendError(res, 400, ERR.INVALID_INPUT, "Username already taken");
      }
      throw err;
    }

    // afterRegister hook (fire-and-forget)
    hooks.run("afterRegister", { user, email }).catch(() => {});

    const token = jwt.sign(
      { userId: user._id, username: user.username },
      JWT_SECRET,
      { expiresIn: "30d" },
    );

    sendOk(res, {
      token,
      userId: user._id,
      username: user.username,
      isAdmin: user.isAdmin || false,
    }, 201);
  } catch (error) {
    log.error("Auth", "Registration error:", error);
    sendError(res, 500, ERR.INTERNAL, "Internal server error");
  }
};

/* ===========================
    LOGIN
=========================== */
const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Username and password are required");
    }

    const user = await User.findOne({
      username: { $regex: `^${escapeRegex(username)}$`, $options: "i" },
    });
    if (!user) {
      return sendError(res, 401, ERR.UNAUTHORIZED, "Invalid credentials");
    }

    // SECURITY: Remote/ghost users cannot log in with a password
    if (user.isRemote) {
      return sendError(res, 401, ERR.UNAUTHORIZED, "Invalid credentials");
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return sendError(res, 401, ERR.UNAUTHORIZED, "Invalid credentials");
    }

    const token = jwt.sign(
      { userId: user._id, username: user.username },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    const isLocal = !req.hostname || req.hostname === "localhost" || req.hostname.startsWith("127.") || req.hostname.startsWith("192.168.");

    res.cookie("token", token, {
      httpOnly: true,
      secure: !isLocal,
      sameSite: isLocal ? "Lax" : "None",
      domain: cookieDomain(req),
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days (matches JWT expiry)
      path: "/",
    });

    sendOk(res, {
      token,
      userId: user._id.toString(),
      username: user.username,
      htmlShareToken: user.metadata?.html?.shareToken || null,
    });
  } catch (error) {
    log.error("Auth", "Login error:", error);
    sendError(res, 500, ERR.INTERNAL, "Server is down");
  }
};

/* ===========================
    LOGOUT
=========================== */
const logout = async (req, res) => {
  try {
    const isLocal = !req.hostname || req.hostname === "localhost" || req.hostname.startsWith("127.") || req.hostname.startsWith("192.168.");

    res.clearCookie("token", {
      httpOnly: true,
      secure: !isLocal,
      sameSite: isLocal ? "Lax" : "None",
      domain: cookieDomain(req),
      path: "/",
    });

    return sendOk(res, { message: "Logged out successfully" });
  } catch (error) {
    log.error("Auth", "Logout error:", error);
    return sendError(res, 500, ERR.INTERNAL, "Logout failed");
  }
};

/* ===========================
    EXPORT CONTROLLERS
=========================== */
export {
  register,
  login,
  logout,
};
