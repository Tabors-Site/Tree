// TreeOS Seed . AGPL-3.0 . https://treeos.ai
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

import log from "../log.js";
import { getAncestorChain, resolveExtensionScopeFromChain, invalidateAll as clearAncestorCache } from "./ancestorCache.js";
import { hooks } from "../hooks.js";

// ─────────────────────────────────────────────────────────────────────────
// SCOPE RESOLUTION
// ─────────────────────────────────────────────────────────────────────────

/**
 * Check if an extension is blocked at a node position.
 */
export async function isExtensionBlockedAtNode(extName, nodeId) {
  if (!extName || typeof extName !== "string") return false;
  if (!nodeId) return false;
  const { blocked } = await getBlockedExtensionsAtNode(nodeId);
  return blocked.has(extName);
}

/**
 * Get blocked and restricted extensions at a node position.
 */
export async function getBlockedExtensionsAtNode(nodeId) {
  if (!nodeId) return { blocked: new Set(), restricted: new Map() };
  const ancestors = await getAncestorChain(nodeId);
  if (!ancestors) return { blocked: new Set(), restricted: new Map() };
  return resolveExtensionScopeFromChain(ancestors);
}

/**
 * Clear the scope cache.
 */
export function clearScopeCache() {
  clearAncestorCache();
}

/**
 * Clear cache and fire afterScopeChange hook.
 */
export function notifyScopeChange({ nodeId, blocked, restricted, userId } = {}) {
  clearAncestorCache();
  hooks.run("afterScopeChange", { nodeId, blocked, restricted, userId })
    .catch(err => log.debug("Scope", `afterScopeChange hook error: ${err.message}`));
}

// ─────────────────────────────────────────────────────────────────────────
// TOOL OWNERSHIP
// ─────────────────────────────────────────────────────────────────────────

import { getLandConfigValue } from "../landConfig.js";

const _toolOwnership = new Map(); // toolName -> { extName, readOnly }
function maxToolOwners() { return Number(getLandConfigValue("maxRegisteredTools")) || 1000; }

export function registerToolOwner(toolName, extName, readOnly = false) {
  if (typeof toolName !== "string" || toolName.length === 0 || toolName.length > 64) return;
  if (typeof extName !== "string" || extName.length === 0) return;
  if (_toolOwnership.size >= maxToolOwners() && !_toolOwnership.has(toolName)) {
    log.warn("Scope", `Tool ownership cap reached (${maxToolOwners()}). "${toolName}" rejected.`);
    return;
  }
  _toolOwnership.set(toolName, { extName, readOnly: !!readOnly });
}

export function getToolOwner(toolName) {
  return _toolOwnership.get(toolName)?.extName || null;
}

/**
 * Remove all tool ownership entries for an extension.
 * Called during extension uninstall.
 */
export function clearToolOwnersForExtension(extName) {
  for (const [name, info] of _toolOwnership) {
    if (info.extName === extName) _toolOwnership.delete(name);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// TOOL FILTERING
// ─────────────────────────────────────────────────────────────────────────

/**
 * Filter tool names by scope.
 * Removes tools from blocked extensions.
 * For restricted extensions (access mode "read"), only keeps read-only tools.
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

// ─────────────────────────────────────────────────────────────────────────
// MODE OWNERSHIP
// ─────────────────────────────────────────────────────────────────────────

const _modeOwnership = new Map(); // modeKey -> extName
function maxModeOwners() { return Number(getLandConfigValue("maxRegisteredModes")) || 500; }

export function registerModeOwner(modeKey, extName) {
  if (typeof modeKey !== "string" || modeKey.length === 0 || modeKey.length > 64) return;
  if (typeof extName !== "string" || extName.length === 0) return;
  if (_modeOwnership.size >= maxModeOwners() && !_modeOwnership.has(modeKey)) {
    log.warn("Scope", `Mode ownership cap reached (${maxModeOwners()}). "${modeKey}" rejected.`);
    return;
  }
  _modeOwnership.set(modeKey, extName);
}

export function getModeOwner(modeKey) {
  return _modeOwnership.get(modeKey) || null;
}

/**
 * Remove all mode ownership entries for an extension.
 * Called during extension uninstall.
 */
export function clearModeOwnersForExtension(extName) {
  for (const [key, owner] of _modeOwnership) {
    if (owner === extName) _modeOwnership.delete(key);
  }
}

/**
 * Check if a mode is blocked at a node position.
 */
export function isModeBlockedByScope(modeKey, blockedExtensions) {
  if (!blockedExtensions || blockedExtensions.size === 0) return false;
  const owner = _modeOwnership.get(modeKey);
  return !!owner && blockedExtensions.has(owner);
}
