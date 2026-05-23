// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// My remembered settings, across reboots.
//
// At genesis I plant the `.config` place seed space and write the
// boot-time settings into its qualities Map. Every later boot, I
// read that Map back through `initPlaceConfig()` and the values are
// who I am operationally on this place. `getPlaceConfigValue(key)`
// and `setPlaceConfigValue(key, value)` are the only sanctioned
// paths in or out; every caller in the system flows through them.
//
// The place contains code peers around me (protocols, transports,
// extensions, the boot files) but the configuration of the runtime
// is mine, and it lives where I run.

import log from "./system/log.js";
import Space from "./models/space.js";
import { SEED_SPACE } from "./materials/space/seedSpaces.js";

let configCache = null;
let initialized = false;
let cachedPlaceUrl = null;

// The place's public connection URL. Other places, browsers, and the
// IBP discovery endpoint all reach me at this URL. Derived from
// PLACE_DOMAIN + PORT; PLACE_PUBLIC_URL overrides the whole value for
// reverse-proxy deploys where the constructed URL would be wrong.
// Port suffix only for local domains; public domains sit behind proxies.
export function getPlaceUrl() {
  if (cachedPlaceUrl) return cachedPlaceUrl;
  if (process.env.PLACE_PUBLIC_URL) {
    cachedPlaceUrl = process.env.PLACE_PUBLIC_URL.replace(/\/+$/, "");
    return cachedPlaceUrl;
  }
  const raw = process.env.PLACE_DOMAIN || "localhost";
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
  cachedPlaceUrl = `${protocol}://${domain}${portSuffix}`;
  return cachedPlaceUrl;
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

// Keys allowed to fall back to process.env before initPlaceConfig() runs.
const BOOT_ENV_KEYS = new Set([
  "socketMaxBufferSize", "socketPingTimeout", "socketPingInterval", "socketConnectTimeout",
  "maxConnectionsPerIp", "PLACE_NAME", "placeUrl", "HORIZON_URL",
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

export function getPlaceConfigValue(key) {
  if (configCache && key in configCache && configCache[key] != null) {
    return deepCopy(configCache[key]);
  }
  if (!initialized && BOOT_ENV_KEYS.has(key)) {
    return process.env[key] || null;
  }
  return null;
}

export async function setPlaceConfigValue(key, value, { internal } = {}) {
  validateKey(key);
  if (PROTECTED_KEYS.has(key) && !internal) {
    throw new Error(`Config key "${key}" is protected and cannot be modified manually`);
  }
  validateValue(value);

  const result = await Space.updateOne(
    { seedSpace: SEED_SPACE.CONFIG },
    { $set: { [`qualities.${key}`]: value } }
  );

  // No matched document means .config is gone. Fail loud rather than
  // silently updating only the cache.
  if (result.matchedCount === 0) {
    throw new Error("Config write failed: .config place seed space not found. Place may need repair.");
  }

  if (!configCache) configCache = {};
  configCache[key] = value;

  log.verbose("Place", `Config set: ${key}`);
}

export async function deletePlaceConfigValue(key, { internal } = {}) {
  validateKey(key);
  if (PROTECTED_KEYS.has(key) && !internal) {
    throw new Error(`Config key "${key}" is protected and cannot be deleted manually`);
  }

  await Space.updateOne(
    { seedSpace: SEED_SPACE.CONFIG },
    { $unset: { [`qualities.${key}`]: 1 } }
  );

  if (configCache) delete configCache[key];
  log.verbose("Place", `Config deleted: ${key}`);
}

export const CONFIG_DEFAULTS = {
  // Identity
  PLACE_NAME: "My Place",
  placeUrl: null,
  HORIZON_URL: "https://horizon.treeos.ai",
  timezone: null,

  // LLM
  llmTimeout: 900,
  llmMaxRetries: 3,
  maxToolIterations: 15,
  maxConversationMessages: 30,
  toolCallTimeout: 60,
  toolResultMaxBytes: 50000,
  llmMaxConcurrent: 20,
  failoverTimeout: 15,
  placeLlmConnection: null,
  maxMessageContentBytes: 32768,
  carryMessages: 4,
  llmClientCacheTtl: 300,
  maxConnectionsPerUser: 15,
  dnsLookupTimeout: 5000,

  // Conversation compression
  conversationCompression: true,
  compressionThreshold: 20,
  compressionKeep: 8,

  // Act content limits
  maxChatContentBytes: 100000,

  // Sessions
  sessionTTL: 900,
  staleSessionTimeout: 1800,
  maxSessions: 10000,
  maxConnectionsPerIp: 20,
  maxPresences: 50000,
  maxScopedSessions: 20000,
  stalePresenceTimeout: 1800,

  // Matter limits
  matterMaxChars: 5000,
  maxMatterPerSpace: 1000,
  matterQueryLimit: 5000,
  matterSearchLimit: 500,
  maxDocumentSizeBytes: 14680064,
  maxUploadBytes: 104857600,
  uploadEnabled: true,
  allowedMimeTypes: null,

  // Space tree, ancestor cache, integrity
  maxChildrenPerSpace: 1000,
  maxContributorsPerSpace: 500,
  ancestorCacheTTL: 30000,
  ancestorCacheMaxEntries: 50000,
  ancestorCacheMaxDepth: 100,

  // Structural mutation locks
  spaceLockTimeoutMs: 30000,
  spaceLockWaitMs:    5000,

  // Quality namespace limits (per-namespace, all three primitive maps)
  qualityNamespaceMaxBytes: 524288,
  qualityMaxNestingDepth:   8,

  // Security
  jwtExpiryDays: 30,
  allowedLlmDomains: [],
  allowedFrameDomains: [],

  // Hooks
  hookTimeoutMs: 5000,
  hookMaxHandlers: 100,
  hookCircuitThreshold: 5,
  hookCircuitHalfOpenMs: 300000,
  hookChainTimeoutMs: 15000,

  // Tools
  toolCircuitThreshold: 5,
  maxRegisteredTools: 500,
  maxExtensionIndexes: 20,

  // Fact (audit) queries
  factQueryLimit: 5000,

  // Scheduler backpressure. Only summonsPerSecond is enforced today
  // (token-bucket in factory/intake/scheduler.js). InboxDepth + MaxAgeSeconds
  // are declared so operator config places in lockstep with the planned
  // inbox-pressure + stale-entry sweeps.
  summonInboxDepth:    100,
  summonsPerSecond:    10,
  summonMaxAgeSeconds: 3600,

  // Circuit breaker (space tree health)
  treeCircuitEnabled: false,
  maxTreeSpaces: 10000,
  maxTreeQualityBytes: 1073741824,
  maxTreeErrorRate: 100,
  circuitSpaceWeight: 0.4,
  circuitDensityWeight: 0.3,
  circuitErrorWeight: 0.3,
  circuitCheckInterval: 3600000,

  // Cleanup
  uploadCleanupInterval: 21600000,
  uploadGracePeriodMs:   3600000,
  uploadCleanupBatchSize: 1000,

  // Protected (shown but not modifiable via public API)
  seedVersion: null,
  disabledExtensions: [],
};

export function getAllPlaceConfig() {
  if (!configCache) return {};
  try {
    return JSON.parse(JSON.stringify(configCache));
  } catch {
    return {};
  }
}

// Every known key with its effective value, default, and whether it's
// overridden in the DB. Used by place-manager to show full state.
export function getConfigWithDefaults() {
  const dbValues = getAllPlaceConfig();
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

// Call once after ensurePlaceRoot(). After this runs, env fallback is disabled.
export async function initPlaceConfig() {
  await loadConfigFromDb();
  initialized = true;
  log.verbose("Place", `Config loaded from .config space (${Object.keys(configCache).length} keys)`);
}

// For when another process modifies .config directly (migration, manual repair).
export async function reloadPlaceConfig() {
  await loadConfigFromDb();
  log.info("Place", `Config reloaded from .config space (${Object.keys(configCache).length} keys)`);
}
