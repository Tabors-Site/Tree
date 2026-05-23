// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Connection setup for LLM-flow moments. Everything about which
// voice this being's moment will be spoken in: the catalog of
// possible providers, the rules that decide which one applies at
// this position for this being, and the live client-cache the
// factory line consults before each inference.
//
// I am not part of any moment. I am the catalog and the rule book
// the line opens before it ever calls a provider.
//
// What I own:
//
//   SLOT RULES        Read assignment data off space and being
//                     qualities. Slot names like "main", "scout"
//                     map to connectionIds; flags like
//                     enforced/locked/preferOwn shape the
//                     resolution chain. Sanitized inputs against
//                     prototype pollution + path injection.
//
//   CONNECTIONS CRUD  Per-being LlmConnection rows: name + base
//                     URL + encrypted API key + model. Add,
//                     update, delete, assign-to-slot, assign-to-
//                     space-slot. AES-256-CBC at rest.
//
//   SSRF GATE         Every base URL validated against blocked
//                     hosts and private-IP patterns. Local-LLM
//                     hosts (Ollama, etc.) require explicit opt-
//                     in via `allowedLlmDomains` place config.
//
//   SLOT REGISTRY     Extensions register additional being/space
//                     slots (e.g. "reflect", "scout"). The kernel
//                     ships only "main" (being) and "default"
//                     (space).
//
//   CLIENT CACHE      OpenAI-shape clients cached by (beingId,
//                     slot) with TTL eviction. Invalidated when
//                     assignments change.
//
//   RESOLUTION CHAIN  The four-layer chain that picks the
//                     connectionId for a (being, space, slot)
//                     triple at moment-time: lockout > enforcement
//                     > default-chain (position-first) > per-call
//                     override.
//
//   CAPABILITY CHECK  Cheap probe for "does this being have any
//                     LLM available."
//
// Used by:
//   - call.js — the provider-call surround calls into the
//     resolved client to make the actual inference.
//   - runTurn.js — the loop body asks `getClientForBeing` once at
//     the top of each moment.
//   - assemble.js — never reaches in here directly; the frame
//     it renders is voice-agnostic.

import OpenAI from "openai";
import crypto from "crypto";
import dns from "dns/promises";
import { v4 as uuidv4 } from "uuid";
import log from "../../../system/log.js";
import Being from "../../../models/being.js";
import Space from "../../../models/space.js";
import { I_AM } from "../../../place/being/seedBeings.js";
import { getPlaceConfigValue } from "../../../placeConfig.js";
import { getAncestorChain } from "../../../place/space/ancestorCache.js";

// Connections live in `Being.qualities.llmConnections` as a Map keyed by
// connection uuid. Each entry is { name, baseUrl, encryptedApiKey, model,
// createdAt, lastUsedAt }. Connections are owned by a being; lookup
// always requires beingId alongside connectionId (no global registry).

let _iAmBeingId = null;
async function getIAmBeingId() {
  if (_iAmBeingId) return _iAmBeingId;
  const iAm = await Being.findOne({ name: I_AM }).select("_id").lean();
  _iAmBeingId = iAm ? String(iAm._id) : null;
  return _iAmBeingId;
}

function readConnectionsFrom(being) {
  if (!being?.qualities) return {};
  const conns = being.qualities instanceof Map
    ? being.qualities.get("llmConnections")
    : being.qualities?.llmConnections;
  return conns || {};
}

async function readConnection(beingId, connectionId) {
  if (!beingId || !connectionId) return null;
  const being = await Being.findById(beingId).select("qualities").lean();
  return readConnectionsFrom(being)[connectionId] || null;
}

async function readAllConnections(beingId) {
  if (!beingId) return {};
  const being = await Being.findById(beingId).select("qualities").lean();
  return readConnectionsFrom(being);
}

// ─────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────

const ENCRYPTION_KEY = process.env.CUSTOM_LLM_API_SECRET_KEY;
const ALGORITHM = "aes-256-cbc";

let MAX_CONNECTIONS_PER_USER = 15;
export function setMaxConnectionsPerUser(n) {
  MAX_CONNECTIONS_PER_USER = Math.max(1, Math.min(Number(n) || 15, 100));
}
const MAX_NAME_LENGTH = 100;
const MAX_KEY_LENGTH = 500;
const MAX_MODEL_LENGTH = 200;
const MAX_SLOT_NAME_LENGTH = 50;
const SLOT_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

let LLM_TIMEOUT_MS = 5 * 60 * 1000;
export function setLlmTimeout(ms) {
  LLM_TIMEOUT_MS = ms;
}
export function getLlmTimeout() {
  return LLM_TIMEOUT_MS;
}

let CLIENT_CACHE_TTL = 5 * 60 * 1000;
export function setClientCacheTtl(ms) {
  CLIENT_CACHE_TTL = ms;
}

const DANGEROUS_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "hasOwnProperty",
  "toString",
  "valueOf",
]);
const MAX_SLOTS = 50;

// ─────────────────────────────────────────────────────────────────────────
// SLOT RULES (assignments)
// ─────────────────────────────────────────────────────────────────────────
//
// Assignment data carries two kinds of fields:
//   Connection fields (which LLM):
//     `default` / `main`  — the primary connection
//     `[slotName]`        — role-specific overrides (e.g. "scout")
//
//   Authority flags (who decides):
//     `enforced`   lock IN this assignment for descendants. Space
//                  enforcement wins over being enforcement when both
//                  apply; both override being.preferOwn.
//     `locked`     lock OUT all LLM usage for descendants. Mirrors
//                  space.llmDefault === "none"; sovereign — stops
//                  the resolver entirely.
//     `preferOwn`  (being only) invert the chain so the being's own
//                  LLM ranks above the position's.

function sanitizeSlots(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const entries = raw instanceof Map ? [...raw.entries()] : Object.entries(raw);
  const clean = {};
  let count = 0;
  for (const [key, value] of entries) {
    if (count >= MAX_SLOTS) break;
    if (typeof key !== "string" || DANGEROUS_KEYS.has(key)) continue;
    if (value === null || (typeof value === "string" && value.length <= 100)) {
      clean[key] = value;
      count++;
    }
  }
  return clean;
}

function asBool(v) {
  return v === true;
}

/**
 * LLM assignments for a space.
 * Reads `space.llmDefault`, `space.qualities.llm.slots`, and
 * `space.qualities.llm.enforced`. Returns
 * `{ default, [slot]: connId, enforced }`.
 */
export function getSpaceLlmAssignments(space) {
  if (!space) return { default: null, enforced: false };
  const meta =
    space.qualities instanceof Map
      ? space.qualities.get("llm")
      : space.qualities?.llm;
  const slots = sanitizeSlots(meta?.slots);
  const result = { ...slots };
  result.default =
    typeof space.llmDefault === "string" && space.llmDefault.length <= 100
      ? space.llmDefault
      : null;
  result.enforced = asBool(meta?.enforced);
  return result;
}

/**
 * LLM assignments for a being.
 * Reads `being.llmDefault`, `being.qualities.beingLlm.slots`, and
 * the authority flags. Returns
 * `{ main, [slot]: connId, enforced, locked, preferOwn }`.
 */
export function getBeingLlmAssignments(being) {
  if (!being)
    return { main: null, enforced: false, locked: false, preferOwn: false };
  const meta =
    being.qualities instanceof Map
      ? being.qualities.get("beingLlm")
      : being.qualities?.beingLlm;
  const slots = sanitizeSlots(meta?.slots);
  const result = { ...slots };
  result.main =
    typeof being.llmDefault === "string" && being.llmDefault.length <= 100
      ? being.llmDefault
      : null;
  result.enforced = asBool(meta?.enforced);
  result.locked = asBool(meta?.locked);
  result.preferOwn = asBool(meta?.preferOwn);
  return result;
}

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
  if (!text || typeof text !== "string")
    throw new Error("Cannot encrypt: value must be a non-empty string");
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function decrypt(encryptedText) {
  let key;
  try {
    key = getEncryptionKey();
  } catch (e) {
    throw new Error("Cannot decrypt LLM credentials: " + e.message);
  }
  const [ivHex, encrypted] = encryptedText.split(":");
  if (!ivHex || !encrypted)
    throw new Error(
      "Malformed encrypted LLM credential (expected iv:ciphertext)",
    );
  try {
    const iv = Buffer.from(ivHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    throw new Error(
      "Failed to decrypt LLM credential. The encryption key may have changed or the stored credential is corrupted.",
    );
  }
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

try {
  const placeUrl = getPlaceConfigValue("placeUrl");
  if (placeUrl) BLOCKED_HOSTS.add(new URL(placeUrl).hostname);
} catch {}

const BLOCKED_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^169\.254\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[0-2]\d)\./,
  /^198\.18\./,
  /^198\.19\./,
  /^fc/i,
  /^fe80/i,
  /^::1$/,
  /^::$/,
];

function isBlockedIp(ip) {
  return BLOCKED_IP_PATTERNS.some((p) => p.test(ip));
}

export async function resolveAndValidateHost(hostname) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new Error("URL points to a private/internal IP");
    }
    return;
  }

  try {
    const result = await Promise.race([
      dns.lookup(hostname, { all: true }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("DNS lookup timed out")),
          Number(getPlaceConfigValue("dnsLookupTimeout")) || 5000,
        ),
      ),
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
    throw new Error(
      "Could not resolve hostname: " +
        hostname +
        (err.message.includes("timed out") ? " (DNS timeout)" : ""),
    );
  }
}

export function hostInAllowedLlmDomains(hostname) {
  const allowed = getPlaceConfigValue("allowedLlmDomains");
  if (!Array.isArray(allowed) || allowed.length === 0) return false;
  return allowed.some((d) => {
    const low = d.toLowerCase();
    return hostname === low || hostname.endsWith("." + low);
  });
}

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
  if (hostInAllowedLlmDomains(hostname)) {
    return parsed.href.replace(/\/+$/, "");
  }
  if (BLOCKED_HOSTS.has(hostname)) {
    throw new Error("This base URL is not allowed");
  }
  if (isBlockedIp(hostname)) {
    throw new Error(
      "Local/private network URLs are not allowed. Add the host to " +
        "`allowedLlmDomains` in place config to opt in (e.g. for Ollama " +
        "or a LAN-hosted LLM).",
    );
  }
  const allowed = getPlaceConfigValue("allowedLlmDomains");
  if (Array.isArray(allowed) && allowed.length > 0) {
    throw new Error(
      `LLM domain "${hostname}" is not in this place's allowed list.`,
    );
  }
  return parsed.href.replace(/\/+$/, "");
}

// ─────────────────────────────────────────────────────────────────────────
// VALIDATION HELPERS
// ─────────────────────────────────────────────────────────────────────────

function validateName(name) {
  if (!name || typeof name !== "string")
    throw new Error("Connection name is required");
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

function validateConnectionId(connectionId) {
  if (connectionId === null || connectionId === undefined) return null;
  if (typeof connectionId !== "string")
    throw new Error("Invalid connection ID");
  if (connectionId.length > 100) throw new Error("Invalid connection ID");
  return connectionId;
}

// ─────────────────────────────────────────────────────────────────────────
// SLOT REGISTRATION
// ─────────────────────────────────────────────────────────────────────────

// Core being slot. Extensions register additional via registerBeingLlmSlot().
const CORE_BEING_SLOTS = new Set(["main"]);
const _extBeingSlots = new Set();

export function registerBeingLlmSlot(slot) {
  if (
    typeof slot !== "string" ||
    !SLOT_NAME_PATTERN.test(slot) ||
    slot.length > MAX_SLOT_NAME_LENGTH
  ) {
    log.warn(
      "LLM",
      `Invalid being LLM slot name rejected: ${String(slot).slice(0, 50)}`,
    );
    return;
  }
  _extBeingSlots.add(slot);
}

function isValidUserSlot(slot) {
  return (
    typeof slot === "string" &&
    (CORE_BEING_SLOTS.has(slot) || _extBeingSlots.has(slot))
  );
}

export function getAllBeingLlmSlots() {
  return [...CORE_BEING_SLOTS, ..._extBeingSlots];
}

// Core space slot. Extensions register additional via registerRootSpaceLlmSlot().
const CORE_ROOT_SLOTS = new Set(["default"]);
const _extRootSlots = new Set();

export function registerRootSpaceLlmSlot(slot) {
  if (
    typeof slot !== "string" ||
    !SLOT_NAME_PATTERN.test(slot) ||
    slot.length > MAX_SLOT_NAME_LENGTH
  ) {
    log.warn(
      "LLM",
      `Invalid root LLM slot name rejected: ${String(slot).slice(0, 50)}`,
    );
    return;
  }
  _extRootSlots.add(slot);
}

export function isValidRootLlmSlot(slot) {
  return (
    typeof slot === "string" &&
    (CORE_ROOT_SLOTS.has(slot) || _extRootSlots.has(slot))
  );
}

export function getAllRootLlmSlots() {
  return [...CORE_ROOT_SLOTS, ..._extRootSlots];
}

// ─────────────────────────────────────────────────────────────────────────
// CLIENT CACHE
// ─────────────────────────────────────────────────────────────────────────
//
// Cache key shapes:
//   `${beingId}:${slot}` — normal slot-based resolution
//   `conn:${connectionId}` — override path
//   `place:${slot}` — place-level default fallback

const beingClientCache = new Map();

setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of beingClientCache) {
      if (now - entry.fetchedAt > CLIENT_CACHE_TTL * 2)
        beingClientCache.delete(key);
    }
  },
  10 * 60 * 1000,
).unref();

/** Clear cached client(s) for a being. Call when their LLM config changes. */
export function clearBeingClientCache(beingId) {
  for (const key of beingClientCache.keys()) {
    if (key === beingId || key.startsWith(beingId + ":")) {
      beingClientCache.delete(key);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// CONNECTIONS CRUD
// ─────────────────────────────────────────────────────────────────────────

export async function addLlmConnection(
  beingId,
  { name, baseUrl, apiKey, model },
) {
  const being = await Being.findById(beingId).select("qualities").lean();
  if (!being) throw new Error("Being not found");

  const existing = readConnectionsFrom(being);
  if (Object.keys(existing).length >= MAX_CONNECTIONS_PER_USER) {
    throw new Error(
      `Maximum of ${MAX_CONNECTIONS_PER_USER} connections reached`,
    );
  }

  const safeName = validateName(name);
  const safeModel = validateModel(model);
  // apiKey is optional — local LLMs (Ollama, llama.cpp, etc.) commonly
  // accept no auth. Validation still enforces length and string type.
  validateApiKey(apiKey, false);
  const safeBaseUrl = validateBaseUrl(baseUrl);

  // SSRF protection — every connection validated against the allowlist.
  const hostname = new URL(safeBaseUrl).hostname;
  if (!hostInAllowedLlmDomains(hostname)) {
    await resolveAndValidateHost(hostname);
  }

  const connectionId = uuidv4();
  const conn = {
    name:            safeName,
    baseUrl:         safeBaseUrl,
    encryptedApiKey: apiKey ? encrypt(apiKey) : null,
    model:           safeModel,
    createdAt:       new Date(),
    lastUsedAt:      null,
  };

  await Being.updateOne(
    { _id: beingId },
    { $set: { [`qualities.llmConnections.${connectionId}`]: conn } },
  );

  return {
    _id:     connectionId,
    name:    conn.name,
    baseUrl: conn.baseUrl,
    model:   conn.model,
  };
}

export async function updateLlmConnection(
  beingId,
  connectionId,
  { name, baseUrl, apiKey, model },
) {
  const being = await Being.findById(beingId)
    .select("llmDefault qualities")
    .lean();
  if (!being) throw new Error("Being not found");

  const safeConnId = validateConnectionId(connectionId);
  const existing = readConnectionsFrom(being)[safeConnId];
  if (!existing) throw new Error("Connection not found");

  const update = {};

  if (baseUrl !== undefined) {
    const safeBaseUrl = validateBaseUrl(baseUrl);
    const hostname = new URL(safeBaseUrl).hostname;
    if (!hostInAllowedLlmDomains(hostname)) {
      await resolveAndValidateHost(hostname);
    }
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
    return {
      _id:     safeConnId,
      name:    existing.name,
      baseUrl: existing.baseUrl,
      model:   existing.model,
    };
  }

  // Per-field merge into the connection entry — atomic $set on the
  // specific keys so concurrent updates to other connections of the
  // same being don't clobber each other.
  const setPaths = {};
  for (const [k, v] of Object.entries(update)) {
    setPaths[`qualities.llmConnections.${safeConnId}.${k}`] = v;
  }
  await Being.updateOne({ _id: beingId }, { $set: setPaths });

  // Bust cache if this connection is currently assigned
  const beingLlmMeta =
    being.qualities instanceof Map
      ? being.qualities.get("beingLlm")
      : being.qualities?.beingLlm;
  const beingSlots = beingLlmMeta?.slots || {};
  if (
    being.llmDefault === connectionId ||
    Object.values(beingSlots).includes(connectionId)
  ) {
    clearBeingClientCache(beingId);
  }

  return {
    _id:     safeConnId,
    name:    update.name    ?? existing.name,
    baseUrl: update.baseUrl ?? existing.baseUrl,
    model:   update.model   ?? existing.model,
  };
}

export async function deleteLlmConnection(beingId, connectionId) {
  const safeConnId = validateConnectionId(connectionId);
  const being = await Being.findById(beingId)
    .select("llmDefault qualities")
    .lean();
  if (!being) throw new Error("Being not found");

  const conn = readConnectionsFrom(being)[safeConnId];
  if (!conn) throw new Error("Connection not found");

  // Unset the connection entry on this being's qualities.
  await Being.updateOne(
    { _id: beingId },
    { $unset: { [`qualities.llmConnections.${safeConnId}`]: "" } },
  );

  // Clear being's slot assignments that pointed at this connection.
  const updates = {};
  if (being.llmDefault === connectionId) {
    updates.llmDefault = null;
  }
  const beingLlmMeta =
    being.qualities instanceof Map
      ? being.qualities.get("beingLlm")
      : being.qualities?.beingLlm;
  const beingSlots = beingLlmMeta?.slots || {};
  for (const [s, val] of Object.entries(beingSlots)) {
    if (val === connectionId) {
      updates[`qualities.beingLlm.slots.${s}`] = null;
    }
  }
  if (Object.keys(updates).length > 0) {
    await Being.findByIdAndUpdate(beingId, { $set: updates });
    clearBeingClientCache(beingId);
  }

  // Clear tree assignments pointing to deleted connection (batched).
  await Space.updateMany(
    { llmDefault: connectionId },
    { $set: { llmDefault: null } },
  );

  // Clear extension slots on spaces in one pass per slot.
  const extSlots = getAllRootLlmSlots().filter((s) => s !== "default");
  for (const slot of extSlots) {
    await Space.updateMany(
      { [`qualities.llm.slots.${slot}`]: connectionId },
      { $set: { [`qualities.llm.slots.${slot}`]: null } },
    );
  }

  return { removed: true };
}

export async function assignConnection(beingId, slot, connectionId) {
  if (!isValidUserSlot(slot)) {
    throw new Error("Invalid assignment slot: " + slot);
  }

  const safeConnId = validateConnectionId(connectionId);

  if (safeConnId) {
    const conn = await readConnection(beingId, safeConnId);
    if (!conn) throw new Error("Connection not found");
  }

  // "main" slot goes to llmDefault, other slots go to qualities.beingLlm.slots
  if (slot === "main") {
    await Being.findByIdAndUpdate(beingId, {
      $set: { llmDefault: safeConnId },
    });
  } else {
    await Being.findByIdAndUpdate(beingId, {
      $set: { [`qualities.beingLlm.slots.${slot}`]: safeConnId },
    });
  }

  clearBeingClientCache(beingId);

  return { slot, connectionId: safeConnId };
}

/**
 * Space-scope counterpart to `assignConnection`. Writes the
 * tree-level step of the resolution chain. "main" goes to
 * `space.llmDefault`; other slots write to
 * `space.qualities.llm.slots.<slot>`. Pass `connectionId: null` to clear.
 */
export async function assignSpaceConnection(
  spaceId,
  slot,
  connectionId,
  { ownerBeingId } = {},
) {
  if (!isValidUserSlot(slot)) {
    throw new Error("Invalid assignment slot: " + slot);
  }
  const safeConnId = validateConnectionId(connectionId);

  if (safeConnId) {
    // With qualities-based storage, connections are scoped to a being —
    // ownership lookup requires the owner's beingId. Kernel-internal
    // callers without ownerBeingId trust the caller (gate happens
    // upstream); operator callers supply ownerBeingId from their
    // identity so the check runs.
    if (ownerBeingId) {
      const conn = await readConnection(ownerBeingId, safeConnId);
      if (!conn) throw new Error("Connection not found");
    }
  }

  if (slot === "main") {
    if (safeConnId) {
      await Space.updateOne(
        { _id: spaceId },
        { $set: { llmDefault: safeConnId } },
      );
    } else {
      await Space.updateOne({ _id: spaceId }, { $set: { llmDefault: null } });
    }
  } else {
    const path = `qualities.llm.slots.${slot}`;
    if (safeConnId) {
      await Space.updateOne({ _id: spaceId }, { $set: { [path]: safeConnId } });
    } else {
      await Space.updateOne({ _id: spaceId }, { $unset: { [path]: "" } });
    }
  }

  return { spaceId: String(spaceId), slot, connectionId: safeConnId };
}

// ─────────────────────────────────────────────────────────────────────────
// CONNECTION → CLIENT
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build a client entry from a specific connectionId on a specific
 * being. Returns the entry on success, null if the connection is
 * missing / invalid or its baseUrl fails the SSRF gate.
 *
 * @param {string} beingId       owner of the connection
 * @param {string} connectionId  uuid key within being.qualities.llmConnections
 * @param {string} [cacheKey]    optional cache key to memoize the entry
 */
export async function resolveConnection(beingId, connectionId, cacheKey) {
  const conn = await readConnection(beingId, connectionId);
  // baseUrl is required; encryptedApiKey is optional (local LLMs like
  // Ollama / llama.cpp commonly need no auth).
  if (!conn || !conn.baseUrl) return null;

  try {
    const hostname = new URL(conn.baseUrl).hostname;
    if (!hostInAllowedLlmDomains(hostname)) {
      await resolveAndValidateHost(hostname);
    }
  } catch (err) {
    log.error(
      "LLM",
      `Blocked custom LLM connection ${connectionId}: ${err.message}`,
    );
    return null;
  }

  // Empty/missing key → empty string. The OpenAI SDK accepts this for
  // local LLMs that don't authenticate.
  const apiKey = conn.encryptedApiKey ? decrypt(conn.encryptedApiKey) : "";
  let baseURL = conn.baseUrl.replace(/\/+$/, "");
  if (baseURL.endsWith("/chat/completions")) {
    baseURL = baseURL.replace(/\/chat\/completions$/, "");
  }

  const entry = {
    client: new OpenAI({
      baseURL,
      apiKey,
      // SDK-side retry disabled. callWithFailover in call.js handles
      // retry decisions against our own RETRYABLE_CODES set so we can
      // fast-fail on deterministic backend parse failures (500 from
      // local inference stacks) instead of burning 15 minutes retrying.
      maxRetries: 0,
      timeout: LLM_TIMEOUT_MS,
      defaultHeaders: {
        "HTTP-Referer":
          getPlaceConfigValue("placeUrl") ||
          `http://localhost:${process.env.PORT || 3000}`,
        "X-OpenRouter-Title": "TreeOS",
        "X-OpenRouter-Categories": "personal-agent,general-chat",
      },
    }),
    model: conn.model || null,
    isCustom: true,
    connectionId,
    fetchedAt: Date.now(),
  };

  if (cacheKey) beingClientCache.set(cacheKey, entry);

  // lastUsedAt — atomic per-field $set inside the connection entry so
  // concurrent updates to other connections on the same being don't
  // clobber each other.
  Being.updateOne(
    { _id: beingId },
    { $set: { [`qualities.llmConnections.${connectionId}.lastUsedAt`]: new Date() } },
  ).catch(() => {});

  return entry;
}

/**
 * Resolve the LLM client for a being. Chain:
 *   1. overrideConnectionId (from a tree's role-slot resolution)
 *   2. being slot assignment (qualities.beingLlm.slots[slot])
 *   3. being default (Being.llmDefault), if slot wasn't "main"
 *   4. place-level default (placeLlmConnection)
 *   5. noLlm sentinel
 *
 * Returns `{ client, model, isCustom, connectionId, noLlm?, fetchedAt }`.
 */
export async function getClientForBeing(beingId, slot, overrideConnectionId) {
  if (!beingId) {
    return {
      client: null,
      model: null,
      isCustom: false,
      connectionId: null,
      noLlm: true,
      fetchedAt: Date.now(),
    };
  }

  slot = slot || "main";

  // 1. Override (e.g. from a root's role-slot resolution). Highest priority.
  if (overrideConnectionId) {
    const overrideCacheKey = "conn:" + overrideConnectionId;
    const overrideCached = beingClientCache.get(overrideCacheKey);
    if (
      overrideCached &&
      Date.now() - overrideCached.fetchedAt < CLIENT_CACHE_TTL
    ) {
      return overrideCached;
    }
    try {
      const overrideEntry = await resolveConnection(
        beingId,
        overrideConnectionId,
        overrideCacheKey,
      );
      if (overrideEntry) return overrideEntry;
    } catch (err) {
      log.error(
        "LLM",
        `Failed to resolve override connection ${overrideConnectionId}: ${err.message}`,
      );
    }
  }

  // 2 + 3. Slot-based resolution from being's llmDefault + qualities.beingLlm.
  const cacheKey = beingId + ":" + slot;
  const cached = beingClientCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CLIENT_CACHE_TTL) {
    return cached;
  }

  try {
    const being = await Being.findById(beingId)
      .select("llmDefault qualities")
      .lean();
    const quals = being?.qualities || {};
    const extSlots = quals?.beingLlm?.slots || {};
    let connectionId =
      slot === "main" ? being?.llmDefault : extSlots[slot] || null;

    // Fall back to "main" (llmDefault) if the specific slot has no assignment
    if (!connectionId && slot !== "main" && being?.llmDefault) {
      connectionId = being.llmDefault;
    }

    if (connectionId) {
      const entry = await resolveConnection(beingId, connectionId, cacheKey);
      if (entry) return entry;
    }
  } catch (err) {
    log.error(
      "LLM",
      `Failed to load custom LLM for being ${beingId}: ${err.message}`,
    );
  }

  // 4. Place-level default (operator-configured fallback). The
  // connection itself lives on the I-Am being's qualities — placeLlmId
  // is the uuid key, I-Am is the owner. Operator-installed place LLMs
  // are added by writing to I_AM.qualities.llmConnections and
  // pointing `placeLlmConnection` config at the uuid.
  try {
    const placeLlmId = getPlaceConfigValue("placeLlmConnection");
    if (placeLlmId) {
      const iAmId = await getIAmBeingId();
      if (iAmId) {
        const placeCacheKey = "place:" + slot;
        const placeCached = beingClientCache.get(placeCacheKey);
        if (placeCached && Date.now() - placeCached.fetchedAt < CLIENT_CACHE_TTL) {
          return placeCached;
        }
        const placeEntry = await resolveConnection(iAmId, placeLlmId, placeCacheKey);
        if (placeEntry) return placeEntry;
      }
    }
  } catch (err) {
    log.error("LLM", `Failed to resolve place default LLM: ${err.message}`);
  }

  // 5. No LLM available. Cache the sentinel so we don't re-walk.
  const noLlmEntry = {
    client: null,
    model: null,
    isCustom: false,
    connectionId: null,
    noLlm: true,
    fetchedAt: Date.now(),
  };
  beingClientCache.set(cacheKey, noLlmEntry);
  return noLlmEntry;
}

// ─────────────────────────────────────────────────────────────────────────
// RESOLUTION CHAIN (the single authoritative chain)
// ─────────────────────────────────────────────────────────────────────────
//
// Resolution philosophy: position-first, identity-last. *Where* you are
// shapes your tools more than *who* you are — until you say otherwise.
//
// Four layers of authority, evaluated top-down:
//
//   Layer 1 — Lockout (sovereign over everything):
//     ANY ancestor in the space walk has `llmDefault === "none"`, OR
//     ANY ancestor in the being walk has `beingLlm.locked === true`
//     → returns null. "No LLM under this scope, period."
//
//   Layer 2 — Enforcement (sovereign over preferOwn):
//     ANY ancestor in the space walk has `qualities.llm.enforced === true`
//     → use that space's connection. Position locks the LLM in.
//
//     ANY ancestor in the being walk has `beingLlm.enforced === true`
//     → use that being's connection. Parent being locks descendants in.
//
//     When both apply, space enforcement wins (position > identity).
//
//   Layer 3 — Default chain (substrate model; the common case):
//     1. space.qualities.llm.slots[slot]  ← role-LLM at this exact position
//     2. space.llmDefault                 ← default LLM at this position
//     3. walk to parent, repeat 1+2
//     4. ... up to place root ...
//     5. place config: placeLlmConnection  ← operator fallback for the place
//     6. being.qualities.beingLlm.slots[slot] ← being's role-specific LLM
//     7. being.llmDefault                 ← being's "personal" default
//
//   Layer 3′ — Being-preferred chain (user opts in):
//     When `being.qualities.beingLlm.preferOwn === true` AND no
//     enforcement was found, the order inverts: being's LLM ranks
//     above position. Lockout still applies; enforcement still wins
//     over preferOwn.
//
//   Layer 4 — Per-call override (programmatic):
//     Caller passes a connectionId directly into `getClientForBeing`
//     instead of letting it resolve. Tests, special-case dispatch.

const BEING_CHAIN_MAX_DEPTH = 20;
const LOCKDOWN = Symbol("LOCKDOWN");

// Walk `being.parentBeingId` up to root, collecting beings as we go.
// Cycle-guarded + depth-capped. Returns an array starting with the
// passed-in being and ending at the chain root.
async function walkBeingChain(rootBeing) {
  if (!rootBeing) return [];
  const chain = [rootBeing];
  const seen = new Set([String(rootBeing._id)]);
  let curId = rootBeing.parentBeingId || null;
  let depth = 0;
  while (curId && depth < BEING_CHAIN_MAX_DEPTH) {
    const id = String(curId);
    if (seen.has(id)) break;
    seen.add(id);
    const parent = await Being.findById(id)
      .select("llmDefault qualities parentBeingId")
      .lean()
      .catch(() => null);
    if (!parent) break;
    chain.push(parent);
    curId = parent.parentBeingId || null;
    depth++;
  }
  return chain;
}

// Walk the space ancestor chain looking for: a lockout, an enforced
// connection, or a normal hit.
async function spaceChainResolve(spaceId, slot) {
  if (!spaceId) return null;
  let chain;
  try {
    chain = await getAncestorChain(spaceId);
  } catch {
    const single = await Space.findById(spaceId)
      .select("llmDefault qualities")
      .lean();
    chain = single ? [single] : [];
  }
  let firstHit = null;
  for (const space of chain) {
    const a = getSpaceLlmAssignments(space);
    if (a.default === "none") return LOCKDOWN;
    if (a.enforced) {
      const hit = a[slot] || a.default;
      if (hit) return { connectionId: hit, enforced: true };
    }
    if (!firstHit) {
      const hit = a[slot] || a.default;
      if (hit) firstHit = { connectionId: hit, enforced: false };
    }
  }
  return firstHit;
}

// Walk the being ancestor chain (pre-loaded) looking for lockout,
// enforcement, or a normal hit.
function beingChainResolve(beingChain, slot) {
  if (!beingChain.length) return null;
  let firstHit = null;
  for (const being of beingChain) {
    const a = getBeingLlmAssignments(being);
    if (a.locked) return LOCKDOWN;
    if (a.enforced) {
      const hit = a[slot] || a.main;
      if (hit) return { connectionId: hit, enforced: true };
    }
    if (!firstHit) {
      const hit = a[slot] || a.main;
      if (hit) firstHit = { connectionId: hit, enforced: false };
    }
  }
  return firstHit;
}

/**
 * Resolve the LLM connectionId for a call at a specific position by a
 * specific being. Walks the four-layer chain above.
 */
export async function resolveLlmConnection({
  beingId = null,
  spaceId = null,
  slot = "main",
} = {}) {
  const being = beingId
    ? await Being.findById(beingId)
        .select("llmDefault qualities parentBeingId")
        .lean()
        .catch(() => null)
    : null;
  const beingChain = await walkBeingChain(being);

  const spaceHit = await spaceChainResolve(spaceId, slot);
  const beingHit = beingChainResolve(beingChain, slot);

  // Layer 1: Lockout wins over everything.
  if (spaceHit === LOCKDOWN || beingHit === LOCKDOWN) return null;

  // Layer 2: Enforcement wins over preferOwn. Space enforcement beats
  // being enforcement when both apply (position-first philosophy).
  if (spaceHit?.enforced) return spaceHit.connectionId;
  if (beingHit?.enforced) return beingHit.connectionId;

  // Layer 3 / 3′: normal chain. preferOwn (set on the calling being's
  // own qualities) inverts the order.
  const preferOwn = being?.qualities?.beingLlm?.preferOwn === true;
  const placeConnId = getPlaceConfigValue("placeLlmConnection") || null;
  const candidates = preferOwn
    ? [beingHit?.connectionId, spaceHit?.connectionId, placeConnId]
    : [spaceHit?.connectionId, placeConnId, beingHit?.connectionId];

  for (const c of candidates) if (c) return c;
  return null;
}

/**
 * @deprecated Use `resolveLlmConnection({ beingId, spaceId, slot })` instead.
 * Kept as a thin shim for legacy callers that pass a `role` spec and only
 * have the tree root.
 */
export async function resolveRootLlmForRole(rootId, role) {
  if (!rootId) return null;
  return resolveLlmConnection({
    spaceId: rootId,
    slot: role?.llmSlot || "main",
  });
}

// ─────────────────────────────────────────────────────────────────────────
// CAPABILITY CHECK
// ─────────────────────────────────────────────────────────────────────────

/**
 * Does this being have any LLM available? True if they have a default
 * assigned, any saved connections, or a place-level default exists.
 */
export async function beingHasLlm(beingId) {
  if (!beingId) return false;
  const being = await Being.findById(beingId).select("qualities").lean();
  const beingQuals = being?.qualities || {};
  const beingLlm = beingQuals?.beingLlm?.slots || {};
  if (beingLlm.main) return true;
  const conns = readConnectionsFrom(being);
  if (Object.keys(conns).length > 0) return true;
  return !!getPlaceConfigValue("placeLlmConnection");
}
