// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import log from "./log.js";
import Node from "./models/node.js";
import { SYSTEM_ROLE } from "./protocol.js";

let configCache = null;
let initialized = false;

/**
 * Config keys that cannot be written via the public API or CLI.
 * Only kernel internals (e.g. migration runner) may write these
 * by passing { internal: true }.
 */
const PROTECTED_KEYS = new Set(["seedVersion"]);

/**
 * Load config values from the .config system node into cache.
 */
async function loadConfigFromDb() {
  const configNode = await Node.findOne({ systemRole: SYSTEM_ROLE.CONFIG }).lean();
  if (!configNode || !configNode.metadata) {
    configCache = {};
    return;
  }
  configCache =
    configNode.metadata instanceof Map
      ? Object.fromEntries(configNode.metadata)
      : { ...configNode.metadata };
}

/**
 * Get a config value from the .config node.
 * Before initialization (DB not ready), falls back to process.env.
 * After initialization, the .config node is the sole source of truth.
 */
export function getLandConfigValue(key) {
  if (configCache && key in configCache && configCache[key] != null) {
    return configCache[key];
  }
  // Before DB is ready, fall back to env so boot-time code still works
  if (!initialized) {
    return process.env[key] || null;
  }
  return null;
}

/**
 * Set a config value in the .config node and update cache.
 */
export async function setLandConfigValue(key, value, { internal } = {}) {
  if (PROTECTED_KEYS.has(key) && !internal) {
    throw new Error(`Config key "${key}" is protected and cannot be modified manually`);
  }
  await Node.updateOne(
    { systemRole: SYSTEM_ROLE.CONFIG },
    { $set: { [`metadata.${key}`]: value } }
  );
  if (!configCache) configCache = {};
  configCache[key] = value;
}

/**
 * Get all config values from the .config node.
 */
export function getAllLandConfig() {
  return { ...(configCache || {}) };
}

/**
 * Initialize the config cache from DB. Call after ensureLandRoot().
 * After this runs, process.env fallback is disabled for runtime keys.
 */
export async function initLandConfig() {
  await loadConfigFromDb();
  initialized = true;
  log.verbose("Land", "Config loaded from .config node");
}
