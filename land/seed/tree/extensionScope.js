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

import Node from "../models/node.js";

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

  const { blocked: blockedSet } = await getBlockedExtensionsAtNode(nodeId);
  const blocked = blockedSet.has(extName);

  _cache.set(key, { blocked, time: Date.now() });
  return blocked;
}

/**
 * Get blocked and restricted extensions at a node position.
 * Walks parent chain, accumulates.
 *
 * blocked: extension is fully disabled (no tools, hooks, modes, metadata)
 * restricted: extension has limited access (e.g. "read" = read-only tools only)
 *
 * Restricted is overridden by blocked (if a parent blocks and a child restricts, blocked wins).
 *
 * @param {string} nodeId
 * @returns {Promise<{ blocked: Set<string>, restricted: Map<string,string> }>}
 */
export async function getBlockedExtensionsAtNode(nodeId) {
  const blocked = new Set();
  const restricted = new Map(); // extName -> access mode ("read")
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
    if (extConfig?.restricted && typeof extConfig.restricted === "object") {
      for (const [name, access] of Object.entries(extConfig.restricted)) {
        if (!blocked.has(name) && !restricted.has(name)) {
          restricted.set(name, access);
        }
      }
    }

    cursor = n.parent;
  }

  // Remove restricted entries that are also blocked (blocked wins)
  for (const name of blocked) restricted.delete(name);

  return { blocked, restricted };
}

/**
 * Clear the spatial scope cache. Called at the end of each request
 * or when extension config changes.
 */
export function clearScopeCache() {
  _cache.clear();
}

// Periodic cache eviction: remove entries older than TTL to prevent memory leak
const _evictionTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of _cache) {
    if (now - entry.time > CACHE_TTL_MS * 2) _cache.delete(key);
  }
}, CACHE_TTL_MS * 4);
_evictionTimer.unref();

/**
 * Get tool names owned by a specific extension.
 * Used to filter tools when an extension is blocked.
 */
const _toolOwnership = new Map(); // toolName -> { extName, readOnly }

/**
 * Register a tool's owner and read-only status.
 * Called by the loader when wiring extension tools.
 */
export function registerToolOwner(toolName, extName, readOnly = false) {
  _toolOwnership.set(toolName, { extName, readOnly });
}

export function getToolOwner(toolName) {
  return _toolOwnership.get(toolName)?.extName || null;
}

/**
 * Filter tool names by scope.
 * Removes tools from blocked extensions.
 * For restricted extensions (access mode "read"), only keeps read-only tools.
 *
 * @param {string[]} toolNames
 * @param {Set<string>} blockedExtensions - fully blocked
 * @param {Map<string,string>} [restrictedExtensions] - extName -> access mode ("read")
 */
export function filterToolNamesByScope(toolNames, blockedExtensions, restrictedExtensions) {
  if ((!blockedExtensions || blockedExtensions.size === 0) && (!restrictedExtensions || restrictedExtensions.size === 0)) {
    return toolNames;
  }
  return toolNames.filter(name => {
    const info = _toolOwnership.get(name);
    if (!info) return true; // core tool, no owner, always passes
    if (blockedExtensions?.has(info.extName)) return false;
    if (restrictedExtensions?.has(info.extName)) {
      const access = restrictedExtensions.get(info.extName);
      if (access === "read") return info.readOnly;
    }
    return true;
  });
}

/**
 * Filter resolved tool objects by scope.
 * Tool objects have shape { type: "function", function: { name, ... } }
 */
export function filterToolsByScope(tools, blockedExtensions, restrictedExtensions) {
  if ((!blockedExtensions || blockedExtensions.size === 0) && (!restrictedExtensions || restrictedExtensions.size === 0)) {
    return tools;
  }
  return tools.filter(tool => {
    const name = tool?.function?.name || tool?.name;
    if (!name) return true;
    const info = _toolOwnership.get(name);
    if (!info) return true;
    if (blockedExtensions?.has(info.extName)) return false;
    if (restrictedExtensions?.has(info.extName)) {
      const access = restrictedExtensions.get(info.extName);
      if (access === "read") return info.readOnly;
    }
    return true;
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
