// TreeOS Seed . AGPL-3.0 . https://treeos.ai
/**
 * LLM Connection Management
 *
 * CRUD for per-being LLM connections. Each connection stores an
 * encrypted API key, base URL, and model name. The resolution chain in
 * conversation.js picks which connection handles each request.
 *
 * Security model:
 *   - API keys encrypted at rest (AES-256-CBC)
 *   - Base URLs validated against SSRF blocklist (every connection,
 *     no admin bypass — local LLM hosts go in `allowedLlmDomains`)
 *   - DNS resolution checked at write time AND at request time
 *   - Slot names validated to prevent MongoDB path injection
 *   - Connection IDs validated as strings before querying
 */

import log from "../core/log.js";
import Being from "../models/being.js";
import LlmConnection from "../models/llmConnection.js";
import Node from "../models/node.js";
import { clearBeingClientCache } from "./llmClient.js";
import crypto from "crypto";
import { getLandConfigValue } from "../landConfig.js";
import dns from "dns/promises";

const ENCRYPTION_KEY = process.env.CUSTOM_LLM_API_SECRET_KEY;
const ALGORITHM = "aes-256-cbc";
let MAX_CONNECTIONS_PER_USER = 15;
export function setMaxConnectionsPerUser(n) { MAX_CONNECTIONS_PER_USER = Math.max(1, Math.min(Number(n) || 15, 100)); }
const MAX_NAME_LENGTH = 100;
const MAX_KEY_LENGTH = 500;
const MAX_MODEL_LENGTH = 200;
const MAX_SLOT_NAME_LENGTH = 50;
const SLOT_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

// ─────────────────────────────────────────────────────────────────────────
// ENCRYPTION
// ─────────────────────────────────────────────────────────────────────────

export function getEncryptionKey() {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) {
    throw new Error("CUSTOM_LLM_API_SECRET_KEY must be at least 32 characters");
  }
  return Buffer.from(ENCRYPTION_KEY.slice(0, 32));
}

function encrypt(text) {
  if (!text || typeof text !== "string") throw new Error("Cannot encrypt: value must be a non-empty string");
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
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
} catch {}

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
  return BLOCKED_IP_PATTERNS.some(p => p.test(ip));
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
    // 5s timeout on DNS resolution. Prevents the connection creation
    // from hanging when DNS is slow or unresponsive.
    const result = await Promise.race([
      dns.lookup(hostname, { all: true }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("DNS lookup timed out")), Number(getLandConfigValue("dnsLookupTimeout")) || 5000)),
    ]);
    for (const entry of result) {
      if (isBlockedIp(entry.address)) {
        throw new Error("URL resolves to a private/internal IP");
      }
    }
  } catch (err) {
    if (err.message.includes("private") || err.message.includes("internal")) {
      throw err;
    }
    throw new Error("Could not resolve hostname: " + hostname + (err.message.includes("timed out") ? " (DNS timeout)" : ""));
  }
}

/**
 * Validate and sanitize a base URL. Returns the cleaned URL.
 *
 * Admin-bypass retired 2026-05-18. The SSRF + private-host gate applies
 * to every connection now. Local-LLM-style usage (Ollama, etc.) requires
 * adding the host to the land's `allowedLlmDomains` config; stance
 * authorization will eventually grant per-stance exceptions.
 */
function validateBaseUrl(baseUrl) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("Invalid base URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are allowed");
  }

  if (parsed.username || parsed.password) {
    throw new Error("URLs with credentials are not allowed");
  }

  const hostname = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTS.has(hostname)) {
    throw new Error("This base URL is not allowed");
  }
  if (isBlockedIp(hostname)) {
    throw new Error("Local/private network URLs are not allowed");
  }

  // Operator whitelist: when set, only listed domains are allowed.
  const allowed = getLandConfigValue("allowedLlmDomains");
  if (Array.isArray(allowed) && allowed.length > 0) {
    const match = allowed.some(d => hostname === d.toLowerCase() || hostname.endsWith("." + d.toLowerCase()));
    if (!match) {
      throw new Error(`LLM domain "${hostname}" is not in this land's allowed list.`);
    }
  }

  return parsed.href.replace(/\/+$/, "");
}

// ─────────────────────────────────────────────────────────────────────────
// VALIDATION HELPERS
// ─────────────────────────────────────────────────────────────────────────

function validateName(name) {
  if (!name || typeof name !== "string") throw new Error("Connection name is required");
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) {
    throw new Error(`Connection name must be 1-${MAX_NAME_LENGTH} characters`);
  }
  return trimmed;
}

function validateModel(model) {
  if (!model || typeof model !== "string" || model.length > MAX_MODEL_LENGTH) {
    throw new Error("Invalid model name");
  }
  const safe = model.replace(/[^a-zA-Z0-9\-_\.\/\:]/g, "");
  if (safe.length === 0) {
    throw new Error("Invalid model name after sanitization");
  }
  return safe;
}

function validateApiKey(apiKey, required) {
  if (required) {
    if (!apiKey || typeof apiKey !== "string" || apiKey.length === 0) {
      throw new Error("API key is required");
    }
  }
  if (apiKey != null) {
    if (typeof apiKey !== "string") throw new Error("Invalid API key");
    if (apiKey.length > MAX_KEY_LENGTH) throw new Error("API key too long");
  }
  return apiKey;
}

/**
 * Validate a connection ID is a string. Prevents MongoDB operator injection
 * from JSON bodies like { connectionId: { "$gt": "" } }.
 */
function validateConnectionId(connectionId) {
  if (connectionId === null || connectionId === undefined) return null;
  if (typeof connectionId !== "string") throw new Error("Invalid connection ID");
  if (connectionId.length > 100) throw new Error("Invalid connection ID");
  return connectionId;
}

// ─────────────────────────────────────────────────────────────────────────
// SLOT REGISTRATION
// ─────────────────────────────────────────────────────────────────────────

// Core user slots. Extensions register additional via registerBeingLlmSlot().
const CORE_BEING_SLOTS = new Set(["main"]);
const _extBeingSlots = new Set();

export function registerBeingLlmSlot(slot) {
  if (typeof slot !== "string" || !SLOT_NAME_PATTERN.test(slot) || slot.length > MAX_SLOT_NAME_LENGTH) {
    log.warn("LLM", `Invalid user LLM slot name rejected: ${String(slot).slice(0, 50)}`);
    return;
  }
  _extBeingSlots.add(slot);
}

function isValidUserSlot(slot) {
  return typeof slot === "string" && (CORE_BEING_SLOTS.has(slot) || _extBeingSlots.has(slot));
}

export function getAllBeingLlmSlots() { return [...CORE_BEING_SLOTS, ..._extBeingSlots]; }

// Core tree slots. Extensions register additional via registerRootLlmSlot().
// Only "default" is kernel. Extensions register their own slots during init.
const CORE_ROOT_SLOTS = new Set(["default"]);
const _extRootSlots = new Set();

export function registerRootLlmSlot(slot) {
  if (typeof slot !== "string" || !SLOT_NAME_PATTERN.test(slot) || slot.length > MAX_SLOT_NAME_LENGTH) {
    log.warn("LLM", `Invalid root LLM slot name rejected: ${String(slot).slice(0, 50)}`);
    return;
  }
  _extRootSlots.add(slot);
}

export function isValidRootLlmSlot(slot) {
  return typeof slot === "string" && (CORE_ROOT_SLOTS.has(slot) || _extRootSlots.has(slot));
}

export function getAllRootLlmSlots() { return [...CORE_ROOT_SLOTS, ..._extRootSlots]; }

// ─────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────

export async function addLlmConnection(beingId, { name, baseUrl, apiKey, model }) {
  const being = await Being.findById(beingId).select("_id").lean();
  if (!being) throw new Error("Being not found");

  const count = await LlmConnection.countDocuments({ beingId });
  if (count >= MAX_CONNECTIONS_PER_USER) {
    throw new Error(`Maximum of ${MAX_CONNECTIONS_PER_USER} connections reached`);
  }

  const safeName = validateName(name);
  const safeModel = validateModel(model);
  validateApiKey(apiKey, true);
  const safeBaseUrl = validateBaseUrl(baseUrl);

  // SSRF protection — every connection validated against the allowlist.
  const hostname = new URL(safeBaseUrl).hostname;
  await resolveAndValidateHost(hostname);

  const conn = await LlmConnection.create({
    beingId,
    name: safeName,
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

export async function updateLlmConnection(beingId, connectionId, { name, baseUrl, apiKey, model }) {
  const being = await Being.findById(beingId).select("llmDefault metadata").lean();
  if (!being) throw new Error("Being not found");

  const safeConnId = validateConnectionId(connectionId);
  const existing = await LlmConnection.findOne({ _id: safeConnId, beingId });
  if (!existing) throw new Error("Connection not found");

  const update = {};

  if (baseUrl !== undefined) {
    const safeBaseUrl = validateBaseUrl(baseUrl);
    const hostname = new URL(safeBaseUrl).hostname;
    await resolveAndValidateHost(hostname);
    update.baseUrl = safeBaseUrl;
  }

  if (model !== undefined) {
    update.model = validateModel(model);
  }

  if (name !== undefined && name !== null) {
    update.name = validateName(name);
  }

  if (apiKey) {
    validateApiKey(apiKey, false);
    update.encryptedApiKey = encrypt(apiKey);
  }

  if (Object.keys(update).length === 0) {
    return { _id: existing._id, name: existing.name, baseUrl: existing.baseUrl, model: existing.model };
  }

  const updated = await LlmConnection.findByIdAndUpdate(
    safeConnId,
    { $set: update },
    { new: true },
  );

  // Bust cache if this connection is currently assigned
  const userLlmMeta = being.metadata instanceof Map ? being.metadata.get("userLlm") : being.metadata?.userLlm;
  const userSlots = userLlmMeta?.slots || {};
  if (being.llmDefault === connectionId || Object.values(userSlots).includes(connectionId)) {
    clearBeingClientCache(beingId);
  }

  return {
    _id: updated._id,
    name: updated.name,
    baseUrl: updated.baseUrl,
    model: updated.model,
  };
}

export async function deleteLlmConnection(beingId, connectionId) {
  const safeConnId = validateConnectionId(connectionId);
  const conn = await LlmConnection.findOneAndDelete({ _id: safeConnId, beingId });
  if (!conn) throw new Error("Connection not found");

  // Clear being assignments pointing to the deleted connection.
  const being = await Being.findById(beingId).select("llmDefault metadata").lean();
  if (being) {
    const updates = {};
    if (being.llmDefault === connectionId) {
      updates.llmDefault = null;
    }
    const beingLlmMeta = being.metadata instanceof Map ? being.metadata.get("userLlm") : being.metadata?.userLlm;
    const beingSlots = beingLlmMeta?.slots || {};
    for (const [s, val] of Object.entries(beingSlots)) {
      if (val === connectionId) {
        updates[`metadata.userLlm.slots.${s}`] = null;
      }
    }
    if (Object.keys(updates).length > 0) {
      await Being.findByIdAndUpdate(beingId, { $set: updates });
      clearBeingClientCache(beingId);
    }
  }

  // Clear tree assignments pointing to deleted connection (batched)
  await Node.updateMany(
    { llmDefault: connectionId },
    { $set: { llmDefault: null } },
  );

  // Clear extension slots on nodes in one pass per slot
  const extSlots = getAllRootLlmSlots().filter(s => s !== "default");
  for (const slot of extSlots) {
    await Node.updateMany(
      { [`metadata.llm.slots.${slot}`]: connectionId },
      { $set: { [`metadata.llm.slots.${slot}`]: null } },
    );
  }

  return { removed: true };
}

export async function assignConnection(beingId, slot, connectionId) {
  if (!isValidUserSlot(slot)) {
    throw new Error("Invalid assignment slot: " + slot);
  }

  const safeConnId = validateConnectionId(connectionId);

  // If assigning (not clearing), verify the connection exists and belongs to this user
  if (safeConnId) {
    const conn = await LlmConnection.findOne({ _id: safeConnId, beingId }).lean();
    if (!conn) throw new Error("Connection not found");
  }

  // "main" slot goes to llmDefault, other slots go to metadata.userLlm.slots
  if (slot === "main") {
    await Being.findByIdAndUpdate(beingId, {
      $set: { llmDefault: safeConnId },
    });
  } else {
    await Being.findByIdAndUpdate(beingId, {
      $set: { [`metadata.userLlm.slots.${slot}`]: safeConnId },
    });
  }

  // Bust cache so the new assignment takes effect
  clearBeingClientCache(beingId);

  return { slot, connectionId: safeConnId };
}

// ─────────────────────────────────────────────────────────────────────────
// DNS VALIDATION FOR REQUEST TIME (export for use in conversation.js)
// ─────────────────────────────────────────────────────────────────────────

export { resolveAndValidateHost };
