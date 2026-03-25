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
import { getAncestorChain, resolveExtensionScopeFromChain, invalidateAll as clearAncestorCache } from "./ancestorCache.js";

/**
 * Check if an extension is blocked at a node position.
 * Uses the shared ancestor cache.
 *
 * @param {string} extName - extension name to check
 * @param {string} nodeId - node to check at
 * @returns {Promise<boolean>} true if blocked
 */
export async function isExtensionBlockedAtNode(extName, nodeId) {
  if (!extName || !nodeId) return false;
  const { blocked } = await getBlockedExtensionsAtNode(nodeId);
  return blocked.has(extName);
}

/**
 * Get blocked and restricted extensions at a node position.
 * Uses the shared ancestor cache instead of walking DB directly.
 *
 * @param {string} nodeId
 * @returns {Promise<{ blocked: Set<string>, restricted: Map<string,string> }>}
 */
export async function getBlockedExtensionsAtNode(nodeId) {
  const ancestors = await getAncestorChain(nodeId);
  if (!ancestors) return { blocked: new Set(), restricted: new Map() };
  return resolveExtensionScopeFromChain(ancestors);
}

/**
 * Clear the scope cache. Delegates to the shared ancestor cache.
 */
export function clearScopeCache() {
  clearAncestorCache();
}

/**
 * Clear cache and fire afterScopeChange hook.
 * Call this instead of clearScopeCache when you have context about what changed.
 */
export function notifyScopeChange({ nodeId, blocked, restricted, userId } = {}) {
  clearAncestorCache();
  import("../hooks.js").then(({ hooks }) => {
    hooks.run("afterScopeChange", { nodeId, blocked, restricted, userId }).catch(() => {});
  }).catch(() => {});
}

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
