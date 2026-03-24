/**
 * Spatial Extension Scoping
 *
 * Extensions can be blocked per-node with parent-to-child inheritance.
 * A tree owner blocks extensions at the root. Branch owners block within.
 * When an extension is blocked at a position, its tools don't appear,
 * its hooks don't fire, its modes don't resolve, and its metadata
 * doesn't get written at that node or any descendant.
 *
 * Storage: node.metadata.extensions = { blocked: ["solana", "scripts"] }
 * Inheritance: walks parent chain, accumulates blocked sets.
 *
 * This is the final abstraction layer. Position determines capability.
 */

import Node from "../../db/models/node.js";

// Per-request cache to avoid repeated parent walks within the same operation
const _cache = new Map();
const CACHE_TTL_MS = 5000;

function cacheKey(extName, nodeId) {
  return `${extName}:${nodeId}`;
}

/**
 * Check if an extension is blocked at a node position.
 * Walks the parent chain accumulating blocked extensions.
 * Results are cached for 5 seconds per request cycle.
 *
 * @param {string} extName - extension name to check
 * @param {string} nodeId - node to check at
 * @returns {Promise<boolean>} true if blocked
 */
export async function isExtensionBlockedAtNode(extName, nodeId) {
  if (!extName || !nodeId) return false;

  const key = cacheKey(extName, nodeId);
  const cached = _cache.get(key);
  if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
    return cached.blocked;
  }

  const blockedSet = await getBlockedExtensionsAtNode(nodeId);
  const blocked = blockedSet.has(extName);

  _cache.set(key, { blocked, time: Date.now() });
  return blocked;
}

/**
 * Get the full set of blocked extensions at a node position.
 * Walks parent chain, accumulates all blocked extensions.
 *
 * @param {string} nodeId
 * @returns {Promise<Set<string>>}
 */
export async function getBlockedExtensionsAtNode(nodeId) {
  const blocked = new Set();
  let cursor = nodeId;
  const visited = new Set();

  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    const n = await Node.findById(cursor).select("metadata parent systemRole").lean();
    if (!n || n.systemRole) break;

    const meta = n.metadata instanceof Map ? Object.fromEntries(n.metadata) : (n.metadata || {});
    const extConfig = meta.extensions;
    if (extConfig?.blocked && Array.isArray(extConfig.blocked)) {
      for (const name of extConfig.blocked) blocked.add(name);
    }

    cursor = n.parent;
  }

  return blocked;
}

/**
 * Clear the spatial scope cache. Called at the end of each request
 * or when extension config changes.
 */
export function clearScopeCache() {
  _cache.clear();
}

/**
 * Get tool names owned by a specific extension.
 * Used to filter tools when an extension is blocked.
 */
const _toolOwnership = new Map(); // toolName -> extName

export function registerToolOwner(toolName, extName) {
  _toolOwnership.set(toolName, extName);
}

export function getToolOwner(toolName) {
  return _toolOwnership.get(toolName) || null;
}

/**
 * Filter a list of tool names, removing any owned by blocked extensions.
 *
 * @param {string[]} toolNames - tool names to filter
 * @param {Set<string>} blockedExtensions - set of blocked extension names
 * @returns {string[]} filtered tool names
 */
export function filterToolNamesByScope(toolNames, blockedExtensions) {
  if (!blockedExtensions || blockedExtensions.size === 0) return toolNames;
  return toolNames.filter(name => {
    const owner = _toolOwnership.get(name);
    return !owner || !blockedExtensions.has(owner);
  });
}

/**
 * Filter resolved tool objects (from resolveTools), removing any owned by blocked extensions.
 * Tool objects have shape { type: "function", function: { name, ... } }
 */
export function filterToolsByScope(tools, blockedExtensions) {
  if (!blockedExtensions || blockedExtensions.size === 0) return tools;
  return tools.filter(tool => {
    const name = tool?.function?.name || tool?.name;
    if (!name) return true;
    const owner = _toolOwnership.get(name);
    return !owner || !blockedExtensions.has(owner);
  });
}

// Mode ownership tracking
const _modeOwnership = new Map(); // modeKey -> extName

export function registerModeOwner(modeKey, extName) {
  _modeOwnership.set(modeKey, extName);
}

export function getModeOwner(modeKey) {
  return _modeOwnership.get(modeKey) || null;
}

/**
 * Check if a mode is blocked at a node position.
 */
export function isModeBlockedByScope(modeKey, blockedExtensions) {
  if (!blockedExtensions || blockedExtensions.size === 0) return false;
  const owner = _modeOwnership.get(modeKey);
  return owner && blockedExtensions.has(owner);
}
