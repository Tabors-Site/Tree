import User from "../db/models/user.js";
import { clearUserClientCache } from "../ws/conversation.js";
import crypto from "crypto";

import dotenv from "dotenv";

dotenv.config();
const ENCRYPTION_KEY = process.env.CUSTOM_LLM_API_SECRET_KEY;
const ALGORITHM = "aes-256-cbc";

function encrypt(text) {
  const key = Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32));
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

// ─────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────


function validateCustomBaseUrl(baseUrl) {
  let parsed;

  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("Invalid base URL");
  }

  // Only allow http/https
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are allowed");
  }

  const hostname = parsed.hostname.toLowerCase();

  // 🚫 Block specific hosts
  const blockedHosts = new Set([
    "localhost",
    "tree.tabors.site"
  ]);

  if (blockedHosts.has(hostname)) {
    throw new Error("This base URL is not allowed");
  }

  // 🚫 Block loopback + private IP ranges
  if (
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("10.") ||
    hostname.startsWith("172.16.") ||
    hostname.startsWith("172.17.") ||
    hostname.startsWith("172.18.") ||
    hostname.startsWith("172.19.") ||
    hostname.startsWith("172.2") // covers 172.20–172.29
  ) {
    throw new Error("Local/private network URLs are not allowed");
  }

return parsed.href.replace(/\/+$/, "");
}

export async function setCustomLlmConnection(userId, { baseUrl, apiKey, model }) {

      const safeBaseUrl = validateCustomBaseUrl(baseUrl);

  const encryptedApiKey = encrypt(apiKey);

  const user = await User.findByIdAndUpdate(
    userId,
    {
      $set: {
        customLlmConnection: {
    baseUrl: safeBaseUrl,          encryptedApiKey,
          model,
          lastUsedAt: null,
          revoked: false,
        },
      },
    },
    { new: true }
  );

  if (!user) throw new Error("User not found");

  // Bust the cached OpenAI client so next request picks up the new config
  clearUserClientCache(userId);

  return {
    baseUrl: user.customLlmConnection.baseUrl,
    model: user.customLlmConnection.model,
    revoked: false,
  };
}

export async function clearCustomLlmConnection(userId) {
  const user = await User.findByIdAndUpdate(
    userId,
    { $unset: { customLlmConnection: 1 } },
    { new: true }
  );

  if (!user) throw new Error("User not found");

  // Bust cache so it falls back to default LLM
  clearUserClientCache(userId);
}

export async function setCustomLlmRevoked(userId, revoked) {
  const user = await User.findByIdAndUpdate(
    userId,
    {
      $set: {
        "customLlmConnection.revoked": revoked,
      },
    },
    { new: true }
  );

  if (!user) throw new Error("User not found");

  clearUserClientCache(userId);

  return {
    revoked: user.customLlmConnection?.revoked ?? true,
  };
}
