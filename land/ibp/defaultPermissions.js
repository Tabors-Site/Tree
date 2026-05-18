// TreeOS IBP — default permission registry.
//
// Layer 3 fallback: when no explicit metadata.permissions rule matches
// at the target position or any ancestor, the authorize function checks
// here for an installed-extension-provided default.
//
// Populated by extensions through their manifest:
//
//   // extensions/<name>/manifest.js
//   export default {
//     name: "position",
//     provides: {
//       defaultPermissions: {
//         "do:set-meta:position": { requires: { contributor: true } },
//       },
//     },
//   };
//
// Lifecycle:
//   - Built at boot when the extension loader sees `provides.defaultPermissions`.
//   - Rebuilt when an extension is installed / uninstalled at runtime.
//   - Missing entries return null. Never throws — uninstalled extensions
//     simply contribute nothing, and the authorize function falls
//     through to default deny.
//
// Data shape on the registry is just `Map<key, rule>`. Keys are the
// same shape as metadata.permissions entries:
//
//   "do:set-meta:position"
//   "summon:@planner*"
//   "summon:@auth:be"
//   "do:create-child"
//
// Rules carry `requires` (stance property requirements). The registry
// also stores an `_extName` so an uninstall can remove only the
// affected entries.

import log from "../seed/log.js";

const _registry = new Map();

/**
 * Register one extension's default permission rules. Idempotent —
 * re-registering replaces any prior rules from the same extension.
 *
 * @param {string} extName
 * @param {object} perms  map of `<key>` → { requires: {...} }
 */
export function registerDefaultPermissions(extName, perms) {
  if (!extName || !perms || typeof perms !== "object") return;
  // Remove any prior rules from this extension first (idempotent reload).
  unregisterDefaultPermissions(extName);
  let count = 0;
  for (const [key, rule] of Object.entries(perms)) {
    if (!key || typeof key !== "string") continue;
    if (!rule || typeof rule !== "object") continue;
    const safe = {
      requires: rule.requires && typeof rule.requires === "object" ? { ...rule.requires } : {},
      _extName: extName,
    };
    _registry.set(key, safe);
    count++;
  }
  if (count > 0) {
    log.verbose("Authorize", `registered ${count} default permission rule(s) for "${extName}"`);
  }
}

/**
 * Remove all default permission rules contributed by an extension.
 * Called when the extension is uninstalled at runtime.
 */
export function unregisterDefaultPermissions(extName) {
  if (!extName) return;
  for (const [key, rule] of Array.from(_registry.entries())) {
    if (rule._extName === extName) _registry.delete(key);
  }
}

/**
 * Look up a default permission rule by exact key. Returns null when
 * no extension currently contributes a default for this key.
 */
export function lookupDefault(key) {
  if (!key) return null;
  return _registry.get(key) || null;
}

/**
 * Enumerate the registered keys (diagnostic — used by introspection
 * tools that show "what default permissions are active on this land").
 */
export function listDefaultPermissions() {
  const out = {};
  for (const [key, rule] of _registry) {
    out[key] = { requires: rule.requires, fromExtension: rule._extName };
  }
  return out;
}

export function _clearAll() {
  _registry.clear();
}
