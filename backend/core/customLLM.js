import User from "../db/models/user.js";
import { clearUserClientCache } from "../ws/conversation.js";
import crypto from "crypto";
import dns from "dns/promises";
import dotenv from "dotenv";

dotenv.config();

const ENCRYPTION_KEY = process.env.CUSTOM_LLM_API_SECRET_KEY;
const ALGORITHM = "aes-256-cbc";

// ─────────────────────────────────────────────────────────────────────────
// ENCRYPTION
// ─────────────────────────────────────────────────────────────────────────

function getEncryptionKey() {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) {
    throw new Error("CUSTOM_LLM_API_SECRET_KEY must be at least 32 characters");
  }
  return Buffer.from(ENCRYPTION_KEY.slice(0, 32));
}

function encrypt(text) {
  var key = getEncryptionKey();
  var iv = crypto.randomBytes(16);
  var cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  var encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

// ─────────────────────────────────────────────────────────────────────────
// SSRF PROTECTION
// ─────────────────────────────────────────────────────────────────────────

const BLOCKED_HOSTS = new Set([
  "localhost",
  "tree.tabors.site",
  "0.0.0.0",
  "[::1]",
  "metadata.google.internal",
  "169.254.169.254",
  "metadata.internal",
]);

const BLOCKED_IP_PATTERNS = [
  /^127\./,                              // loopback
  /^10\./,                               // private class A
  /^192\.168\./,                         // private class C
  /^172\.(1[6-9]|2[0-9]|3[01])\./,      // private class B
  /^169\.254\./,                         // link-local
  /^0\./,                                // "this" network
  /^100\.(6[4-9]|[7-9]\d|1[0-2]\d)\./,  // carrier-grade NAT
  /^198\.18\./,                          // benchmarking
  /^198\.19\./,                          // benchmarking
  /^fc/i,                                // IPv6 unique local
  /^fe80/i,                              // IPv6 link-local
  /^::1$/,                               // IPv6 loopback
  /^::$/,                                // IPv6 unspecified
];

function isBlockedIp(ip) {
  return BLOCKED_IP_PATTERNS.some(function (p) { return p.test(ip); });
}

async function resolveAndValidateHost(hostname) {
  // If the hostname itself looks like a raw IP, check it directly
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new Error("URL points to a private/internal IP");
    }
    return;
  }

  try {
    var result = await dns.lookup(hostname, { all: true });

    for (var i = 0; i < result.length; i++) {
      if (isBlockedIp(result[i].address)) {
        throw new Error("URL resolves to a private/internal IP");
      }
    }
  } catch (err) {
    if (err.message.includes("private") || err.message.includes("internal")) {
      throw err;
    }
    throw new Error("Could not resolve hostname: " + hostname);
  }
}

function validateCustomBaseUrl(baseUrl) {
  var parsed;

  try {
    parsed = new URL(baseUrl);
  } catch (err) {
    throw new Error("Invalid base URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are allowed");
  }

  var hostname = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTS.has(hostname)) {
    throw new Error("This base URL is not allowed");
  }

  // Check raw hostname against IP patterns (catches numeric IPs in URL)
  if (isBlockedIp(hostname)) {
    throw new Error("Local/private network URLs are not allowed");
  }

  // Block URLs with credentials
  if (parsed.username || parsed.password) {
    throw new Error("URLs with credentials are not allowed");
  }

  return parsed.href.replace(/\/+$/, "");
}

// ─────────────────────────────────────────────────────────────────────────
// VALIDATION HELPERS
// ─────────────────────────────────────────────────────────────────────────

function hasPaidPlan(user) {
  if (!user) return false;
  if (user.profileType === "basic") return false;
  if (!user.planExpiresAt) return false;
  return user.planExpiresAt > new Date();
}

function validateInputs(baseUrl, apiKey, model, requireApiKey) {
  if (!baseUrl || typeof baseUrl !== "string" || baseUrl.length > 500) {
    throw new Error("Invalid base URL");
  }

  if (requireApiKey) {
    if (!apiKey || typeof apiKey !== "string" || apiKey.length > 500) {
      throw new Error("Invalid API key");
    }
  } else if (apiKey !== undefined && apiKey !== null) {
    if (typeof apiKey !== "string" || apiKey.length > 500) {
      throw new Error("Invalid API key");
    }
  }

  if (!model || typeof model !== "string" || model.length > 200) {
    throw new Error("Invalid model name");
  }

  // Sanitize model to reasonable characters
  var safeModel = model.replace(/[^a-zA-Z0-9\-_\.\/\:]/g, "");
  if (safeModel.length === 0) {
    throw new Error("Invalid model name after sanitization");
  }

  return safeModel;
}

// ─────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────

export async function setCustomLlmConnection(userId, { baseUrl, apiKey, model }) {
  // 1. Check user exists and has paid plan FIRST
  var user = await User.findById(userId)
    .select("profileType planExpiresAt customLlmConnection")
    .lean();

  if (!user) throw new Error("User not found");
  if (!hasPaidPlan(user)) {
    throw new Error("Custom LLM connections require an active paid plan");
  }

  // 2. Determine if this is an update (apiKey may be optional)
  var isUpdate = !!(user.customLlmConnection && user.customLlmConnection.baseUrl);
  var requireApiKey = !isUpdate;

  // 3. Validate and sanitize inputs
  var safeModel = validateInputs(baseUrl, apiKey, model, requireApiKey);

  // 4. Validate URL format
  var safeBaseUrl = validateCustomBaseUrl(baseUrl);

  // 5. DNS resolution check — blocks SSRF via DNS
  var hostname = new URL(safeBaseUrl).hostname;
  await resolveAndValidateHost(hostname);

  // 6. Build update payload
  var updatePayload = {
    "customLlmConnection.baseUrl": safeBaseUrl,
    "customLlmConnection.model": safeModel,
    "customLlmConnection.lastUsedAt": null,
    "customLlmConnection.revoked": false,
  };

  // Only update the API key if one was provided
  if (apiKey) {
    updatePayload["customLlmConnection.encryptedApiKey"] = encrypt(apiKey);
  }

  // 7. Write to DB
  await User.findByIdAndUpdate(userId, { $set: updatePayload });

  // 8. Bust cache
  clearUserClientCache(userId);

  return { baseUrl: safeBaseUrl, model: safeModel, revoked: false };
}

export async function clearCustomLlmConnection(userId) {
  var user = await User.findByIdAndUpdate(
    userId,
    { $unset: { customLlmConnection: 1 } },
    { new: true }
  );

  if (!user) throw new Error("User not found");

  clearUserClientCache(userId);
}

export async function setCustomLlmRevoked(userId, revoked) {
  if (typeof revoked !== "boolean") {
    throw new Error("Revoked must be a boolean");
  }

  var user = await User.findByIdAndUpdate(
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
    revoked: user.customLlmConnection ? user.customLlmConnection.revoked : true,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// DNS VALIDATION FOR REQUEST TIME (export for use in conversation.js)
// ─────────────────────────────────────────────────────────────────────────

export { resolveAndValidateHost };