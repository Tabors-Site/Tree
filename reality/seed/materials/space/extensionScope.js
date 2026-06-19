// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Extension scope at a position.
//
// An extension on a place is active at every position by default. The
// operator can narrow that by writing scope rules into a Space's
// qualities.extensions namespace, and the rule applies to everything
// at and below that Space (resolved by walking the parent chain).
//
// Two modes per extension:
//
//   Global (default). Active everywhere. Block to remove at specific
//     positions: qualities.extensions.blocked[] accumulates up the
//     parent chain.
//
//   Confined. Active nowhere. Allow to add at specific positions:
//     qualities.extensions.allowed[] is walked up the parent chain.
//     If the name is not found, the extension is treated as blocked
//     here; if it is found, it is active (but can still be blocked
//     further down).
//
// The manifest declares scope: "confined" for dangerous or
// specialized extensions. The `./extensions` Tier-3 heaven space stores
// scope on each extension's registry space; loadConfinedExtensions
// reads it at boot.
//
// Resolution is one walk up the same ancestor cache every chain
// uses. One snapshot per turn; zero new queries; one extra
// allowed[] check per confined extension.
//
// The tool-ownership map lives in the bottom half of this file.
// It supports the scope filter (filterToolNamesByScope drops tools
// owned by blocked extensions) and is colocated here because it
// shares no consumer outside scope resolution.

import log from "../../seedStory/log.js";
import { getInternalConfigValue } from "../../internalConfig.js";
import Space from "./space.js";
import { HEAVEN_SPACE } from "./heavenSpaces.js";
import {
  getAncestorChain,
  resolveExtensionScopeFromChain,
  invalidateAll as clearAncestorCache,
} from "./ancestorCache.js";
import { hooks } from "../../hooks.js";

// ─────────────────────────────────────────────────────────────────────────
// CONFINED EXTENSIONS REGISTRY
// ─────────────────────────────────────────────────────────────────────────

// Set of extension names with scope: "confined". Loaded once at boot.
let _confinedExtensions = new Set();

// Loader-provided extension-instance lookup. Registered at boot so the
// seed can offer a scope-aware getExtensionAtScope without importing
// from extensions/loader.js (which would violate the one-way layering
// rule). Null until the loader calls setExtensionInstanceLookup; if a
// caller hits getExtensionAtScope before boot completes, the function
// returns null defensively rather than throwing.
let _extensionInstanceLookup = null;

/**
 * Called by the loader at boot to register the in-memory extension
 * instance lookup. The seed uses this only via getExtensionAtScope;
 * extensions never call it.
 */
export function setExtensionInstanceLookup(fn) {
  _extensionInstanceLookup = typeof fn === "function" ? fn : null;
}

/**
 * Load confined extension names from `./extensions` heaven space.
 * Called once during extension loading, after syncExtensionsToTree.
 */
export async function loadConfinedExtensions() {
  try {
    const { findByHeavenSpace } = await import("../projections.js");
    const extSpace = await findByHeavenSpace(HEAVEN_SPACE.EXTENSIONS, "0");
    if (!extSpace) return;

    // Query by parent. Direct projection query because we need state.qualities.
    const { default: Projection } = await import("../branch/projection.js");
    const children = (await Projection.find({
      branch: "0", type: "space",
      "state.parent": extSpace.id,
      tombstoned: { $ne: true },
    }).select("state").lean()).map((s) => ({ name: s.state?.name, qualities: s.state?.qualities }));

    const confined = new Set();
    for (const child of children) {
      const quals =
        child.qualities instanceof Map
          ? Object.fromEntries(child.qualities)
          : child.qualities || {};
      const extQuality = quals.extension || {};
      if (extQuality.scope === "confined") confined.add(child.name);
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
 * Check if an extension is blocked at a space position.
 * Handles both global (blocked[]) and confined (allowed[]) modes.
 */
export async function isExtensionBlockedAtSpace(extName, spaceId) {
  if (!extName || typeof extName !== "string") return false;
  if (!spaceId) return false;
  const { blocked } = await getBlockedExtensionsAtSpace(spaceId);
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
 *   const cw = await story.scope.getExtensionAtScope("code-workspace", spaceId);
 *   if (!cw?.exports?.someApi) return; // not active here
 *   await cw.exports.someApi(...);
 *
 * The legacy getExtension() (in extensions/loader.js) stays for
 * seed-internal use and for cases where scope is genuinely
 * irrelevant. Extensions reaching across should migrate to this
 * helper over time — it closes the "blocked extension is still
 * callable through getExtension(...).exports" hole.
 *
 * @param {string} extName  extension name
 * @param {string} spaceId   the tree position whose scope governs
 * @returns {object|null}   the extension's loaded instance, or null
 */
export async function getExtensionAtScope(extName, spaceId) {
  if (!extName || !spaceId) return null;
  if (typeof _extensionInstanceLookup !== "function") return null;
  try {
    const blocked = await isExtensionBlockedAtSpace(extName, spaceId);
    if (blocked) return null;
  } catch {
    // If scope resolution fails (e.g., space not found), be
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
 * Get blocked and restricted extensions at a space position.
 * Confined extensions not found in allowed[] are added to the blocked set.
 */
export async function getBlockedExtensionsAtSpace(spaceId, branch) {
  if (!spaceId)
    return { blocked: new Set(), restricted: new Map(), allowed: new Set() };
  const ancestors = await getAncestorChain(spaceId, branch);
  if (!ancestors)
    return { blocked: new Set(), restricted: new Map(), allowed: new Set() };
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
export function notifyScopeChange({
  spaceId,
  blocked,
  restricted,
  allowed,
  beingId,
} = {}) {
  clearAncestorCache();
  hooks
    .run("afterScopeChange", { spaceId, blocked, restricted, allowed, beingId })
    .catch((err) =>
      log.debug("Scope", `afterScopeChange hook error: ${err.message}`),
    );
}

// ─────────────────────────────────────────────────────────────────────────
// TOOL OWNERSHIP
// ─────────────────────────────────────────────────────────────────────────

import { getStoryConfigValue } from "../../storyConfig.js";

const _toolOwnership = new Map(); // toolName -> { extName, verb }
function maxToolOwners() {
  return Number(getInternalConfigValue("maxRegisteredTools")) || 1000;
}

/**
 * Register a tool's owning extension and its verb tag. The verb tag
 * is what gates scope behavior — `verb: "see"` is read-only by
 * definition; `verb: "do"` mutates. Restricted-access extensions get
 * filtered down to their SEE-tagged tools via this verb.
 */
export function registerToolOwner(toolName, extName, verb = null) {
  if (
    typeof toolName !== "string" ||
    toolName.length === 0 ||
    toolName.length > 64
  )
    return;
  if (typeof extName !== "string" || extName.length === 0) return;
  if (_toolOwnership.size >= maxToolOwners() && !_toolOwnership.has(toolName)) {
    log.warn(
      "Scope",
      `Tool ownership cap reached (${maxToolOwners()}). "${toolName}" rejected.`,
    );
    return;
  }
  _toolOwnership.set(toolName, { extName, verb: verb || null });
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
export function filterToolNamesByScope(
  toolNames,
  blockedExtensions,
  restrictedExtensions,
) {
  if (
    (!blockedExtensions || blockedExtensions.size === 0) &&
    (!restrictedExtensions || restrictedExtensions.size === 0)
  ) {
    return toolNames;
  }
  return toolNames.filter((name) => {
    const info = _toolOwnership.get(name);
    if (!info) return true; // seed tool, no owner, always passes
    if (blockedExtensions?.has(info.extName)) return false;
    if (restrictedExtensions?.has(info.extName)) {
      const access = restrictedExtensions.get(info.extName);
      if (access === "read") return info.verb === "see";
    }
    return true;
  });
}

/**
 * Filter resolved tool objects by scope.
 * Tool objects have shape { type: "function", function: { name, ... } }
 */
export function filterToolsByScope(
  tools,
  blockedExtensions,
  restrictedExtensions,
) {
  if (
    (!blockedExtensions || blockedExtensions.size === 0) &&
    (!restrictedExtensions || restrictedExtensions.size === 0)
  ) {
    return tools;
  }
  return tools.filter((tool) => {
    const name = tool?.function?.name || tool?.name;
    if (!name) return true;
    const info = _toolOwnership.get(name);
    if (!info) return true;
    if (blockedExtensions?.has(info.extName)) return false;
    if (restrictedExtensions?.has(info.extName)) {
      const access = restrictedExtensions.get(info.extName);
      if (access === "read") return info.verb === "see";
    }
    return true;
  });
}

