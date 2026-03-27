// TreeOS Seed . AGPL-3.0 . https://treeos.ai
// Land configuration. Single source of truth for all runtime settings.
// Stored in the .config system node's metadata Map.
// Every getLandConfigValue and setLandConfigValue in the entire system
// flows through this file.

import log from "./log.js";
import Node from "./models/node.js";
import { SYSTEM_ROLE } from "./protocol.js";

let configCache = null;
let initialized = false;

// ─────────────────────────────────────────────────────────────────────────
// PROTECTED KEYS
// ─────────────────────────────────────────────────────────────────────────

const PROTECTED_KEYS = new Set([
  "seedVersion",
  "disabledExtensions",
]);

// ─────────────────────────────────────────────────────────────────────────
// KEY / VALUE VALIDATION
// ─────────────────────────────────────────────────────────────────────────

const CONFIG_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype", "toString", "valueOf", "hasOwnProperty"]);
const MAX_VALUE_BYTES = 65536;

function validateKey(key) {
  if (typeof key !== "string") throw new Error("Config key must be a string");
  if (!CONFIG_KEY_RE.test(key)) throw new Error(`Invalid config key "${key}". Must be alphanumeric + underscores, start with letter, max 64 chars.`);
  if (DANGEROUS_KEYS.has(key)) throw new Error(`Config key "${key}" is reserved`);
}

function validateValue(value) {
  if (value === undefined) return;
  try {
    const size = JSON.stringify(value).length;
    if (size > MAX_VALUE_BYTES) {
      throw new Error(`Config value exceeds ${MAX_VALUE_BYTES} byte limit (${size} bytes)`);
    }
  } catch (e) {
    if (e.message.includes("limit")) throw e;
    throw new Error("Config value must be JSON-serializable");
  }
}

// ─────────────────────────────────────────────────────────────────────────
// BOOT-TIME ENV FALLBACK
// ─────────────────────────────────────────────────────────────────────────

const BOOT_ENV_KEYS = new Set([
  "socketMaxBufferSize", "socketPingTimeout", "socketPingInterval", "socketConnectTimeout",
  "maxConnectionsPerIp", "LAND_NAME", "landUrl", "HORIZON_URL",
]);

// ─────────────────────────────────────────────────────────────────────────
// SAFE DEEP COPY
// ─────────────────────────────────────────────────────────────────────────
// Every value returned from getLandConfigValue is a deep copy.
// Callers cannot pollute the cache by mutating returned arrays or objects.

function deepCopy(value) {
  if (value === null || typeof value !== "object") return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value; // non-serializable primitive, return as-is
  }
}

// ─────────────────────────────────────────────────────────────────────────
// LOAD
// ─────────────────────────────────────────────────────────────────────────

async function loadConfigFromDb() {
  try {
    const configNode = await Node.findOne({ systemRole: SYSTEM_ROLE.CONFIG }).lean();
    if (!configNode || !configNode.metadata) {
      log.warn("Land", "No .config system node found or metadata is empty. Using empty config.");
      configCache = {};
      return;
    }
    const raw = configNode.metadata instanceof Map
      ? Object.fromEntries(configNode.metadata)
      : { ...configNode.metadata };

    // Sanitize loaded keys: strip any that would fail validation (manual DB edits,
    // corruption, or proto pollution attempts injected directly into MongoDB).
    const clean = {};
    for (const [k, v] of Object.entries(raw)) {
      if (DANGEROUS_KEYS.has(k)) {
        log.warn("Land", `Dangerous config key "${k}" found in DB. Skipped.`);
        continue;
      }
      // Skip Mongoose internal fields that leak through lean()
      if (k.startsWith("$") || k.startsWith("_")) continue;
      clean[k] = v;
    }
    configCache = clean;
  } catch (err) {
    log.error("Land", `Failed to load config from DB: ${err.message}. Using empty config.`);
    configCache = {};
  }
}

// ─────────────────────────────────────────────────────────────────────────
// GET
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get a config value. Returns a deep copy. Callers cannot mutate the cache.
 * Before init, falls back to process.env for known boot-time keys only.
 */
export function getLandConfigValue(key) {
  if (configCache && key in configCache && configCache[key] != null) {
    return deepCopy(configCache[key]);
  }
  if (!initialized && BOOT_ENV_KEYS.has(key)) {
    return process.env[key] || null;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// SET
// ─────────────────────────────────────────────────────────────────────────

/**
 * Set a config value. Validates key and value. Writes to DB atomically.
 * Verifies the .config node exists (protects against silent no-op on deleted node).
 */
export async function setLandConfigValue(key, value, { internal } = {}) {
  validateKey(key);
  if (PROTECTED_KEYS.has(key) && !internal) {
    throw new Error(`Config key "${key}" is protected and cannot be modified manually`);
  }
  validateValue(value);

  const result = await Node.updateOne(
    { systemRole: SYSTEM_ROLE.CONFIG },
    { $set: { [`metadata.${key}`]: value } }
  );

  // If no document matched, the .config node doesn't exist. This is a critical
  // system integrity issue. Fail loud instead of silently updating only the cache.
  if (result.matchedCount === 0) {
    throw new Error("Config write failed: .config system node not found. Land may need repair.");
  }

  if (!configCache) configCache = {};
  configCache[key] = value;

  log.verbose("Land", `Config set: ${key}`);
}

/**
 * Delete a config key from .config node and cache.
 */
export async function deleteLandConfigValue(key, { internal } = {}) {
  validateKey(key);
  if (PROTECTED_KEYS.has(key) && !internal) {
    throw new Error(`Config key "${key}" is protected and cannot be deleted manually`);
  }

  await Node.updateOne(
    { systemRole: SYSTEM_ROLE.CONFIG },
    { $unset: { [`metadata.${key}`]: 1 } }
  );

  if (configCache) delete configCache[key];
  log.verbose("Land", `Config deleted: ${key}`);
}

// ─────────────────────────────────────────────────────────────────────────
// QUERY
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get all config values. Deep copy. Callers cannot pollute the cache.
 */
export function getAllLandConfig() {
  if (!configCache) return {};
  try {
    return JSON.parse(JSON.stringify(configCache));
  } catch {
    return {};
  }
}

// ─────────────────────────────────────────────────────────────────────────
// INIT / RELOAD
// ─────────────────────────────────────────────────────────────────────────

/**
 * Initialize the config cache from DB. Call after ensureLandRoot().
 * After this runs, process.env fallback is disabled.
 */
export async function initLandConfig() {
  await loadConfigFromDb();
  initialized = true;
  log.verbose("Land", `Config loaded from .config node (${Object.keys(configCache).length} keys)`);
}

/**
 * Reload config from DB without restarting. Use when another process
 * may have modified .config directly (migration, manual repair).
 */
export async function reloadLandConfig() {
  await loadConfigFromDb();
  log.info("Land", `Config reloaded from .config node (${Object.keys(configCache).length} keys)`);
}
