import Node from "../db/models/node.js";

let configCache = null;

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
 * Get a config value. Falls back to process.env if not in the .config node.
 */
export function getLandConfigValue(key) {
  if (configCache && key in configCache && configCache[key] != null) {
    return configCache[key];
  }
  return process.env[key] || null;
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
 * Get all config values (merged: .config node overrides, then env fallbacks).
 */
export function getAllLandConfig() {
  return { ...(configCache || {}) };
}

/**
 * Initialize the config cache from DB. Call after ensureLandRoot().
 */
export async function initLandConfig() {
  await loadConfigFromDb();
  console.log("[Land] Config loaded from .config node");
}
