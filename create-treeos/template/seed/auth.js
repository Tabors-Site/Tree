// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import User from "./models/user.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { escapeRegex } from "./utils.js";
import { getLandConfigValue } from "./landConfig.js";
import { ERR, ProtocolError } from "./protocol.js";

import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required. Run the setup wizard or add it to .env");
const JWT_SECRET = process.env.JWT_SECRET;

// ─────────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────────

const USERNAME_RE = /^[a-zA-Z0-9_-]{1,32}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

function validateUsername(username) {
  if (!username || typeof username !== "string") throw new ProtocolError(400, ERR.INVALID_INPUT, "Username is required");
  const trimmed = username.trim();
  if (!USERNAME_RE.test(trimmed)) {
    throw new ProtocolError(400, ERR.INVALID_INPUT, "Username may only contain letters, numbers, hyphens, and underscores (1-32 chars)");
  }
  return trimmed;
}

function validatePassword(password) {
  if (!password || typeof password !== "string") throw new ProtocolError(400, ERR.INVALID_INPUT, "Password is required");
  if (password.length < MIN_PASSWORD) throw new ProtocolError(400, ERR.INVALID_INPUT, `Password must be at least ${MIN_PASSWORD} characters`);
  if (password.length > MAX_PASSWORD) throw new ProtocolError(400, ERR.INVALID_INPUT, `Password must be ${MAX_PASSWORD} characters or fewer`);
}

// ─────────────────────────────────────────────────────────────────────────
// USER CREATION
// ─────────────────────────────────────────────────────────────────────────

/**
 * Check if this is the first user on the land.
 */
export async function isFirstUser() {
  return (await User.countDocuments()) === 0;
}

/**
 * Create the first user (admin) on a fresh land.
 * Handles the race condition where two concurrent requests both pass
 * the isFirstUser() check: creates the user, then verifies it is
 * actually the earliest. If it lost the race, demotes to non-admin.
 */
export async function createFirstUser(username, password) {
  const user = await createUser(username, password, { isAdmin: true });

  // Post-creation race check: if multiple admins exist, the one
  // with the earliest _id (UUID v4, but insertion order is what matters)
  // keeps admin. Losers get demoted.
  const adminCount = await User.countDocuments({ isAdmin: true });
  if (adminCount > 1) {
    const earliest = await User.findOne({ isAdmin: true }).sort({ _id: 1 }).select("_id").lean();
    if (earliest && earliest._id.toString() !== user._id.toString()) {
      await User.updateOne({ _id: user._id }, { $set: { isAdmin: false } });
      user.isAdmin = false;
    }
  }

  return user;
}

/**
 * Create a user. Hashes password via User schema pre-save hook.
 * Returns the saved user document.
 */
export async function createUser(username, password, opts = {}) {
  username = validateUsername(username);
  validatePassword(password);

  // Case-insensitive uniqueness check. The regex is needed because MongoDB
  // collation support varies across deployments. The unique index on username
  // (case-sensitive) is the safety net; this check provides a friendly error.
  const existing = await User.findOne({
    username: { $regex: `^${escapeRegex(username)}$`, $options: "i" },
  });
  if (existing) throw new ProtocolError(409, ERR.RESOURCE_CONFLICT, "Username already taken");

  const user = new User({
    username,
    password,
    isAdmin: opts.isAdmin || false,
  });
  try {
    await user.save();
  } catch (err) {
    if (err.code === 11000) throw new ProtocolError(409, ERR.RESOURCE_CONFLICT, "Username already taken");
    throw err;
  }
  return user;
}

// ─────────────────────────────────────────────────────────────────────────
// PASSWORD VERIFICATION
// ─────────────────────────────────────────────────────────────────────────

/**
 * Verify a password against a user's stored hash.
 * bcrypt is intentionally slow. Timeout prevents extreme cost factors
 * from blocking the event loop for extended periods.
 */
const BCRYPT_TIMEOUT_MS = 5000;

export async function verifyPassword(user, password) {
  if (!user?.password || !password) return false;
  let timer;
  try {
    return await Promise.race([
      bcrypt.compare(password, user.password),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Password verification timed out")), BCRYPT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// TOKEN GENERATION
// ─────────────────────────────────────────────────────────────────────────

/**
 * Generate a JWT for a user.
 * Includes a unique jti for per-token revocation if needed.
 * Expiry is configurable via land config (default 30 days).
 */
export function generateToken(user) {
  const expiresIn = getLandConfigValue("jwtExpiryDays")
    ? `${Math.max(1, Math.min(Number(getLandConfigValue("jwtExpiryDays")), 365))}d`
    : "30d";

  return jwt.sign(
    {
      userId: user._id,
      username: user.username,
      jti: crypto.randomUUID(),
    },
    JWT_SECRET,
    { expiresIn },
  );
}

// ─────────────────────────────────────────────────────────────────────────
// USER LOOKUP
// ─────────────────────────────────────────────────────────────────────────

/**
 * Find a user by username (case-insensitive).
 */
export async function findUserByUsername(username) {
  if (!username || typeof username !== "string") return null;
  return User.findOne({
    username: { $regex: `^${escapeRegex(username.trim())}$`, $options: "i" },
  }).select("+password");
}
