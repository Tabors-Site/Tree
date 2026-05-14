// TreeOS Seed . AGPL-3.0 . https://treeos.ai
/**
 * Spatial Extension Scoping
 *
 * Two modes per extension:
 *
 * Global (default): Active everywhere. Block to remove at specific positions.
 *   Storage: node.metadata.extensions.blocked[] accumulates up the parent chain.
 *
 * Confined: Active nowhere. Allow to add at specific positions.
 *   Storage: node.metadata.extensions.allowed[] walked up the parent chain.
 *   If not found in allowed[], the extension is treated as blocked.
 *   If found, it's active (but can still be blocked further down).
 *
 * The manifest declares scope: "confined" for dangerous or specialized extensions.
 * The .extensions system node stores scope on each extension's registry node.
 *
 * Resolution: is this extension confined? If yes, walk up looking for allowed[].
 * If not found, blocked. If found, continue to normal blocked[] check.
 * Same ancestor cache. Same snapshot. Zero new queries. One check per confined extension.
 */

import log from "../log.js";
import Node from "../models/node.js";
import { SYSTEM_ROLE } from "../protocol.js";
import { getAncestorChain, resolveExtensionScopeFromChain, invalidateAll as clearAncestorCache } from "./ancestorCache.js";
import { hooks } from "../hooks.js";

// ─────────────────────────────────────────────────────────────────────────
// CONFINED EXTENSIONS REGISTRY
// ─────────────────────────────────────────────────────────────────────────

// Set of extension names with scope: "confined". Loaded once at boot.
let _confinedExtensions = new Set();

// Loader-provided extension-instance lookup. Registered at boot so the
// kernel can offer a scope-aware getExtensionAtScope without importing
// from extensions/loader.js (which would violate the one-way layering
// rule). Null until the loader calls setExtensionInstanceLookup; if a
// caller hits getExtensionAtScope before boot completes, the function
// returns null defensively rather than throwing.
let _extensionInstanceLookup = null;

/**
 * Called by the loader at boot to register the in-memory extension
 * instance lookup. The kernel uses this only via getExtensionAtScope;
 * extensions never call it.
 */
export function setExtensionInstanceLookup(fn) {
  _extensionInstanceLookup = typeof fn === "function" ? fn : null;
}

/**
 * Load confined extension names from .extensions system node.
 * Called once during extension loading, after syncExtensionsToTree.
 */
export async function loadConfinedExtensions() {
  try {
    const extNode = await Node.findOne({ systemRole: SYSTEM_ROLE.EXTENSIONS }).select("children").lean();
    if (!extNode) return;

    const children = await Node.find({ _id: { $in: extNode.children } })
      .select("name metadata")
      .lean();

    const confined = new Set();
    for (const child of children) {
      const meta = child.metadata instanceof Map
        ? Object.fromEntries(child.metadata)
        : (child.metadata || {});
      if (meta.scope === "confined") confined.add(child.name);
    }
    _confinedExtensions = confined;

    if (confined.size > 0) {
      log.verbose("Scope", `Confined extensions: ${[...confined].join(", ")}`);
    }
  } catch (err) {
    log.warn("Scope", `Failed to load confined extensions: ${err.message}`);
  }
}

export function getConfinedExtensions() {
  return _confinedExtensions;
}

export function isExtensionConfined(extName) {
  return _confinedExtensions.has(extName);
}

// ─────────────────────────────────────────────────────────────────────────
// SCOPE RESOLUTION
// ─────────────────────────────────────────────────────────────────────────

/**
 * Check if an extension is blocked at a node position.
 * Handles both global (blocked[]) and confined (allowed[]) modes.
 */
export async function isExtensionBlockedAtNode(extName, nodeId) {
  if (!extName || typeof extName !== "string") return false;
  if (!nodeId) return false;
  const { blocked } = await getBlockedExtensionsAtNode(nodeId);
  return blocked.has(extName);
}

/**
 * Scope-aware extension lookup. Returns the extension's instance ONLY
 * when the extension is active at the given tree position (not
 * blocked by spatial scope resolution). Returns null when blocked,
 * not installed, or when the loader hasn't registered its lookup yet.
 *
 * This is the principled way for one extension to reach into another:
 *
 *   const cw = await core.scope.getExtensionAtScope("code-workspace", nodeId);
 *   if (!cw?.exports?.someApi) return; // not active here
 *   await cw.exports.someApi(...);
 *
 * The legacy getExtension() (in extensions/loader.js) stays for
 * kernel-internal use and for cases where scope is genuinely
 * irrelevant. Extensions reaching across should migrate to this
 * helper over time — it closes the "blocked extension is still
 * callable through getExtension(...).exports" hole.
 *
 * @param {string} extName  extension name
 * @param {string} nodeId   the tree position whose scope governs
 * @returns {object|null}   the extension's loaded instance, or null
 */
export async function getExtensionAtScope(extName, nodeId) {
  if (!extName || !nodeId) return null;
  if (typeof _extensionInstanceLookup !== "function") return null;
  try {
    const blocked = await isExtensionBlockedAtNode(extName, nodeId);
    if (blocked) return null;
  } catch {
    // If scope resolution fails (e.g., node not found), be
    // conservative — return null. Callers that genuinely need the
    // instance without scope can use the loader's getExtension.
    return null;
  }
  try {
    return _extensionInstanceLookup(extName) || null;
  } catch {
    return null;
  }
}

/**
 * Get blocked and restricted extensions at a node position.
 * Confined extensions not found in allowed[] are added to the blocked set.
 */
export async function getBlockedExtensionsAtNode(nodeId) {
  if (!nodeId) return { blocked: new Set(), restricted: new Map(), allowed: new Set() };
  const ancestors = await getAncestorChain(nodeId);
  if (!ancestors) return { blocked: new Set(), restricted: new Map(), allowed: new Set() };
  return resolveExtensionScopeFromChain(ancestors, _confinedExtensions);
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
export function notifyScopeChange({ nodeId, blocked, restricted, allowed, userId } = {}) {
  clearAncestorCache();
  hooks.run("afterScopeChange", { nodeId, blocked, restricted, allowed, userId })
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
 * Check if a tool was registered as read-only (readOnlyHint: true).
 * Used by the kernel's query constraint to filter write tools.
 */
export function isToolReadOnly(toolName) {
  return _toolOwnership.get(toolName)?.readOnly ?? false;
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
 * Get all mode keys owned by an extension.
 * Reverse lookup on the ownership map populated during registration.
 */
export function getModesOwnedBy(extName) {
  const modes = [];
  for (const [modeKey, owner] of _modeOwnership) {
    if (owner === extName) modes.push(modeKey);
  }
  return modes;
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
