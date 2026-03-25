// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import User from "../models/user.js";
import LlmConnection from "../models/llmConnection.js";
import Node from "../models/node.js";
import { clearUserClientCache } from "../ws/conversation.js";
import crypto from "crypto";
import { getLandConfigValue } from "../landConfig.js";
import dns from "dns/promises";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
// getUserMeta removed: billing check moved to billing extension
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../..", ".env") });

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
  "0.0.0.0",
  "[::1]",
  "metadata.google.internal",
  "169.254.169.254",
  "metadata.internal",
]);

// Auto-block this land's own hostname to prevent SSRF loops
try {
  const landUrl = getLandConfigValue("landUrl");
  if (landUrl) BLOCKED_HOSTS.add(new URL(landUrl).hostname);
} catch (_) {}

const BLOCKED_IP_PATTERNS = [
  /^127\./, // loopback
  /^10\./, // private class A
  /^192\.168\./, // private class C
  /^172\.(1[6-9]|2[0-9]|3[01])\./, // private class B
  /^169\.254\./, // link-local
  /^0\./, // "this" network
  /^100\.(6[4-9]|[7-9]\d|1[0-2]\d)\./, // carrier-grade NAT
  /^198\.18\./, // benchmarking
  /^198\.19\./, // benchmarking
  /^fc/i, // IPv6 unique local
  /^fe80/i, // IPv6 link-local
  /^::1$/, // IPv6 loopback
  /^::$/, // IPv6 unspecified
];

function isBlockedIp(ip) {
  return BLOCKED_IP_PATTERNS.some(function (p) {
    return p.test(ip);
  });
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

// hasPaidPlan removed: billing is an extension concern, not kernel

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

// Core user slots. Extensions register additional via registerUserLlmSlot().
const CORE_USER_SLOTS = new Set(["main"]);
const _extUserSlots = new Set();
export function registerUserLlmSlot(slot) { _extUserSlots.add(slot); }
function isValidUserSlot(slot) { return CORE_USER_SLOTS.has(slot) || _extUserSlots.has(slot); }

// Core tree slots. Extensions register additional via registerRootLlmSlot().
const CORE_ROOT_SLOTS = new Set(["default", "placement", "respond", "notes"]);
const _extRootSlots = new Set();
export function registerRootLlmSlot(slot) { _extRootSlots.add(slot); }
export function isValidRootLlmSlot(slot) { return CORE_ROOT_SLOTS.has(slot) || _extRootSlots.has(slot); }
export function getAllRootLlmSlots() { return [...CORE_ROOT_SLOTS, ..._extRootSlots]; }

// ─────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────

export async function addLlmConnection(
  userId,
  { name, baseUrl, apiKey, model },
) {
  var user = await User.findById(userId).select("_id isAdmin").lean();

  if (!user) throw new Error("User not found");

  const isAdmin = user.isAdmin === true;

  var count = await LlmConnection.countDocuments({ userId });
  if (count >= 15) throw new Error("Maximum of 15 connections reached");

  if (!name || typeof name !== "string" || name.length > 100) {
    throw new Error("Invalid connection name");
  }

  var safeModel = validateInputs(baseUrl, apiKey, model, true);
  // Basic format check for all users (including admin)
  var parsed;
  try {
    parsed = new URL(baseUrl);
  } catch (_) {
    throw new Error("Invalid base URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are allowed");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URLs with credentials are not allowed");
  }

  // Admin users skip SSRF/host blocking but still get format validation above
  var safeBaseUrl = isAdmin
    ? parsed.href.replace(/\/+$/, "")
    : validateCustomBaseUrl(baseUrl);

  if (!isAdmin) {
    var hostname = new URL(safeBaseUrl).hostname;
    await resolveAndValidateHost(hostname);
  }

  var conn = await LlmConnection.create({
    userId,
    name: name.trim(),
    baseUrl: safeBaseUrl,
    encryptedApiKey: encrypt(apiKey),
    model: safeModel,
  });

  return {
    _id: conn._id,
    name: conn.name,
    baseUrl: conn.baseUrl,
    model: conn.model,
  };
}

export async function updateLlmConnection(
  userId,
  connectionId,
  { name, baseUrl, apiKey, model },
) {
  var user = await User.findById(userId).select("llmDefault metadata").lean();

  if (!user) throw new Error("User not found");

  var existing = await LlmConnection.findOne({
    _id: connectionId,
    userId,
  });
  if (!existing) throw new Error("Connection not found");

  var safeModel = validateInputs(baseUrl, apiKey, model, false);
  var safeBaseUrl = validateCustomBaseUrl(baseUrl);

  var hostname = new URL(safeBaseUrl).hostname;
  await resolveAndValidateHost(hostname);

  var update = {
    baseUrl: safeBaseUrl,
    model: safeModel,
  };
  if (name !== undefined && name !== null) {
    if (typeof name !== "string" || name.length > 100)
      throw new Error("Invalid connection name");
    update.name = name.trim();
  }
  if (apiKey) {
    update.encryptedApiKey = encrypt(apiKey);
  }

  var updated = await LlmConnection.findByIdAndUpdate(
    connectionId,
    { $set: update },
    { new: true },
  );

  // If this connection is currently assigned to any slot, bust cache
  const userSlots = user?.metadata?.userLlm?.slots || {};
  if (user?.llmDefault === connectionId || Object.values(userSlots).includes(connectionId)) {
    clearUserClientCache(userId);
  }

  return {
    _id: updated._id,
    name: updated.name,
    baseUrl: updated.baseUrl,
    model: updated.model,
  };
}

export async function deleteLlmConnection(userId, connectionId) {
  var conn = await LlmConnection.findOneAndDelete({
    _id: connectionId,
    userId,
  });
  if (!conn) throw new Error("Connection not found");

  // If deleted connection was assigned to user's default, clear it
  var user = await User.findById(userId).select("llmDefault metadata").lean();
  if (user) {
    const updates = {};
    if (user.llmDefault === connectionId) {
      updates.llmDefault = null;
    }
    const userSlots = user.metadata?.userLlm?.slots || {};
    for (const [s, val] of Object.entries(userSlots)) {
      if (val === connectionId) {
        updates[`metadata.userLlm.slots.${s}`] = null;
      }
    }
    if (Object.keys(updates).length > 0) {
      await User.findByIdAndUpdate(userId, { $set: updates });
      clearUserClientCache(userId);
    }
  }

  // If deleted connection was assigned to any root node default, clear it
  await Node.updateMany(
    { llmDefault: connectionId },
    { $set: { llmDefault: null } },
  );
  // Clear extension slots on nodes
  for (const slot of getAllRootLlmSlots()) {
    if (slot === "default") continue;
    await Node.updateMany(
      { [`metadata.llm.slots.${slot}`]: connectionId },
      { $set: { [`metadata.llm.slots.${slot}`]: null } },
    );
  }

  return { removed: true };
}

export async function getConnectionsForUser(userId) {
  return LlmConnection.find({ userId })
    .select("_id name baseUrl model lastUsedAt createdAt")
    .sort({ createdAt: -1 })
    .lean();
}

export async function assignConnection(userId, slot, connectionId) {
  if (!isValidUserSlot(slot)) {
    throw new Error("Invalid assignment slot: " + slot);
  }

  // If assigning (not clearing), verify the connection exists and belongs to this user
  if (connectionId) {
    var conn = await LlmConnection.findOne({
      _id: connectionId,
      userId,
    }).lean();
    if (!conn) throw new Error("Connection not found");
  }

  // "main" slot goes to llmDefault, other slots go to metadata.userLlm.slots
  if (slot === "main") {
    await User.findByIdAndUpdate(userId, {
      $set: { llmDefault: connectionId || null },
    });
  } else {
    await User.findByIdAndUpdate(userId, {
      $set: { [`metadata.userLlm.slots.${slot}`]: connectionId || null },
    });
  }

  // Bust cache so the new assignment takes effect
  clearUserClientCache(userId);

  return { slot, connectionId: connectionId || null };
}

// ─────────────────────────────────────────────────────────────────────────
// DNS VALIDATION FOR REQUEST TIME (export for use in conversation.js)
// ─────────────────────────────────────────────────────────────────────────

export { resolveAndValidateHost };
