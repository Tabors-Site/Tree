import Node from "../db/models/node.js";

let configCache = null;
let initialized = false;

/**
 * Load config values from the .config system node into cache.
 */
async function loadConfigFromDb() {
  const configNode = await Node.findOne({ systemRole: "config" }).lean();
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
export async function setLandConfigValue(key, value) {
  await Node.updateOne(
    { systemRole: "config" },
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
  console.log("[Land] Config loaded from .config node");
}
