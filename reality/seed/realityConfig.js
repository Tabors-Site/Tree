// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Place identity, remembered across reboots.
//
// What this place IS to the outside world — its name, public URL,
// federation directory, accepted MIME types, boundary security
// domains. Things the discovery payload surfaces, things a peer
// place sees when it reaches in.
//
// At genesis I plant the `.config` place seed space and write the
// boot-time settings into its qualities Map. Every later boot, I
// read that Map back through `initRealityConfig()`.
// `getRealityConfigValue(key)` and `setRealityConfigValue(key, value)`
// are the only sanctioned paths in or out for place-identity keys.
//
// Seed runtime knobs (LLM call shape, scheduler backpressure, hook
// timeouts, cleanup intervals — the apparatus's internal tuning)
// live in [factoryConfig.js](factoryConfig.js). Both files write to the
// SAME underlying store (this file owns the storage primitive);
// the split is conceptual — readers reach the right surface at
// import-site.

import log from "./parentReality/log.js";
import Space from "./materials/space/space.js";
import { SEED_SPACE } from "./materials/space/seedSpaces.js";

let configCache = null;
let initialized = false;
let cachedRealityUrl = null;

// The place's public connection URL. Other places, browsers, and the
// IBP discovery endpoint all reach me at this URL. Derived from
// REALITY_DOMAIN + PORT; REALITY_PUBLIC_URL overrides the whole value for
// reverse-proxy deploys where the constructed URL would be wrong.
// Port suffix only for local domains; public domains sit behind proxies.
export function getRealityUrl() {
  if (cachedRealityUrl) return cachedRealityUrl;
  if (process.env.REALITY_PUBLIC_URL) {
    cachedRealityUrl = process.env.REALITY_PUBLIC_URL.replace(/\/+$/, "");
    return cachedRealityUrl;
  }
  const raw = process.env.REALITY_DOMAIN || "localhost";
  const domain = raw.replace(/^https?:\/\//, "").replace(/\/+$/, "").replace(/:\d+$/, "");
  const port = process.env.PORT || 80;
  const isLocal =
    domain === "localhost"          ||
    domain.startsWith("localhost")  ||
    domain.startsWith("127.")       ||
    domain.startsWith("192.168.")   ||
    domain.startsWith("10.")        ||
    domain.endsWith(".lan")         ||
    domain.endsWith(".local")       ||
    !domain.includes(".");
  const protocol = isLocal ? "http" : "https";
  const portSuffix = isLocal && port != 80 && port != 443 ? `:${port}` : "";
  cachedRealityUrl = `${protocol}://${domain}${portSuffix}`;
  return cachedRealityUrl;
}

const PROTECTED_KEYS = new Set([
  "seedVersion",
  "disabledExtensions",
]);

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

// Keys allowed to fall back to process.env before initRealityConfig() runs.
const BOOT_ENV_KEYS = new Set([
  "socketMaxBufferSize", "socketPingTimeout", "socketPingInterval", "socketConnectTimeout",
  "maxConnectionsPerIp", "REALITY_NAME", "realityUrl", "HORIZON_URL",
]);

// Every returned value is a deep copy so callers can't pollute the cache.
function deepCopy(value) {
  if (value === null || typeof value !== "object") return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

async function loadConfigFromDb() {
  try {
    const configSpace = await Space.findOne({ seedSpace: SEED_SPACE.CONFIG }).lean();
    if (!configSpace || !configSpace.qualities) {
      log.warn("Place", "No .config place seed space found or qualities is empty. Using empty config.");
      configCache = {};
      return;
    }
    const raw = configSpace.qualities instanceof Map
      ? Object.fromEntries(configSpace.qualities)
      : { ...configSpace.qualities };

    // Strip keys that would fail validation (manual DB edits, proto
    // pollution injected directly into MongoDB, Mongoose lean() leaks).
    const clean = {};
    for (const [k, v] of Object.entries(raw)) {
      if (DANGEROUS_KEYS.has(k)) {
        log.warn("Place", `Dangerous config key "${k}" found in DB. Skipped.`);
        continue;
      }
      if (k.startsWith("$") || k.startsWith("_")) continue;
      clean[k] = v;
    }
    configCache = clean;
  } catch (err) {
    log.error("Place", `Failed to load config from DB: ${err.message}. Using empty config.`);
    configCache = {};
  }
}

export function getRealityConfigValue(key) {
  if (configCache && key in configCache && configCache[key] != null) {
    return deepCopy(configCache[key]);
  }
  if (!initialized && BOOT_ENV_KEYS.has(key)) {
    return process.env[key] || null;
  }
  return null;
}

// Cached _id of the .config place seed space. Looked up on first write
// and stable thereafter — the place seed spaces are created once at
// genesis and never deleted. Avoids the seedSpace-marker scan on every
// config write during boot.
let cachedConfigSpaceId = null;
async function getConfigSpace() {
  if (cachedConfigSpaceId) {
    const doc = await Space.findById(cachedConfigSpaceId);
    if (doc) return doc;
    cachedConfigSpaceId = null; // stale; refetch
  }
  const doc = await Space.findOne({ seedSpace: SEED_SPACE.CONFIG });
  if (doc) cachedConfigSpaceId = String(doc._id);
  return doc;
}

export async function setRealityConfigValue(key, value, { internal, identity } = {}) {
  validateKey(key);
  if (PROTECTED_KEYS.has(key) && !internal) {
    throw new Error(`Config key "${key}" is protected and cannot be modified manually`);
  }
  validateValue(value);

  const configSpace = await getConfigSpace();
  if (!configSpace) {
    throw new Error("Config write failed: .config place seed space not found. Place may need repair.");
  }

  // Route through do.set so the write IS a Fact on the .config space's
  // reel. internal=true (boot scaffolding) attributes the Fact to I_AM
  // via the scaffold path; user-driven writes thread the caller's
  // identity for attribution.
  const { doVerb } = await import("./ibp/verbs.js");
  const opts = identity ? { identity } : { scaffold: true };
  await doVerb(
    configSpace,
    "set",
    { field: `qualities.${key}`, value },
    opts,
  );

  if (!configCache) configCache = {};
  configCache[key] = value;

  log.verbose("Place", `Config set: ${key}`);
}

export async function deleteRealityConfigValue(key, { internal, identity } = {}) {
  validateKey(key);
  if (PROTECTED_KEYS.has(key) && !internal) {
    throw new Error(`Config key "${key}" is protected and cannot be deleted manually`);
  }

  const configSpace = await getConfigSpace();
  if (!configSpace) {
    throw new Error("Config delete failed: .config place seed space not found.");
  }

  // value=null on a 2-deep qualities path (qualities.<key>) unsets the
  // leaf — see reducerHelpers.applySetQualities.
  const { doVerb } = await import("./ibp/verbs.js");
  const opts = identity ? { identity } : { scaffold: true };
  await doVerb(
    configSpace,
    "set",
    { field: `qualities.${key}`, value: null },
    opts,
  );

  if (configCache) delete configCache[key];
  log.verbose("Place", `Config deleted: ${key}`);
}

// Place-identity defaults. What this place IS to the outside
// world. Seed runtime knobs (LLM timeout, scheduler limits, hooks,
// caches, etc.) live in [factoryConfig.js](factoryConfig.js).
export const CONFIG_DEFAULTS = {
  // Identity + federation
  REALITY_NAME: "My Place",
  realityUrl: null,
  HORIZON_URL: "https://horizon.treeos.ai",
  timezone: null,
  realityLlmConnection: null,

  // Boundary security (what the place accepts at its edge)
  allowedLlmDomains: [],
  allowedFrameDomains: [],
  allowedMimeTypes: null,
  uploadEnabled: true,
  maxUploadBytes: 104857600,
  jwtExpiryDays: 30,
  cookieDomain: null,

  // Protected (shown but not modifiable via public API)
  seedVersion: null,
  disabledExtensions: [],
};

export function getAllRealityConfig() {
  if (!configCache) return {};
  try {
    return JSON.parse(JSON.stringify(configCache));
  } catch {
    return {};
  }
}

// Every known key with its effective value, default, and whether it's
// overridden in the DB. Used by reality-manager to show full state.
export function getConfigWithDefaults() {
  const dbValues = getAllRealityConfig();
  const result = {};

  for (const [key, defaultValue] of Object.entries(CONFIG_DEFAULTS)) {
    const hasOverride = key in dbValues;
    result[key] = {
      value: hasOverride ? dbValues[key] : defaultValue,
      default: defaultValue,
      custom: hasOverride,
    };
  }

  for (const [key, value] of Object.entries(dbValues)) {
    if (!(key in result)) {
      result[key] = { value, default: null, custom: true };
    }
  }

  return result;
}

// Call once after ensureSpaceRoot(). After this runs, env fallback is disabled.
export async function initRealityConfig() {
  await loadConfigFromDb();
  initialized = true;
  log.verbose("Place", `Config loaded from .config space (${Object.keys(configCache).length} keys)`);
}

// For when another process modifies .config directly (migration, manual repair).
export async function reloadRealityConfig() {
  await loadConfigFromDb();
  log.info("Place", `Config reloaded from .config space (${Object.keys(configCache).length} keys)`);
}
