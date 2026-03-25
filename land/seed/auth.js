// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import User from "./models/user.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { escapeRegex } from "./utils.js";

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required. Run the setup wizard or add it to .env");
const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Check if this is the first user on the land.
 */
export async function isFirstUser() {
  return (await User.countDocuments()) === 0;
}

/**
 * Create a user. Hashes password via User schema pre-save hook.
 * Returns the saved user document.
 */
export async function createUser(username, password, opts = {}) {
  if (!username || !password) {
    throw new Error("Username and password are required");
  }
  if (!/^[a-zA-Z0-9_\-]{1,32}$/.test(username)) {
    throw new Error("Username may only contain letters, numbers, hyphens, and underscores (1-32 chars)");
  }
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters long");
  }
  username = username.trim();

  const existing = await User.findOne({
    username: { $regex: `^${escapeRegex(username)}$`, $options: "i" },
  });
  if (existing) {
    throw new Error("Username already taken");
  }

  const user = new User({
    username,
    password,
    isAdmin: opts.isAdmin || false,
  });
  try {
    await user.save();
  } catch (err) {
    if (err.code === 11000) throw new Error("Username already taken");
    throw err;
  }
  return user;
}

/**
 * Verify a password against a user's stored hash.
 */
export async function verifyPassword(user, password) {
  return bcrypt.compare(password, user.password);
}

/**
 * Generate a JWT for a user.
 */
export function generateToken(user) {
  return jwt.sign(
    { userId: user._id, username: user.username },
    JWT_SECRET,
    { expiresIn: "30d" },
  );
}

/**
 * Find a user by username (case-insensitive).
 */
export async function findUserByUsername(username) {
  return User.findOne({
    username: { $regex: `^${escapeRegex(username)}$`, $options: "i" },
  }).select("+password");
}
