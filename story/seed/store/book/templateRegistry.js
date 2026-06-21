// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Clone registry — extension-shipped clone bundles, available for graft.
//
// Replaces the retired seed-scaffold registry (registerSeed/listSeeds).
// Extensions declare clones in `manifest.provides.clones`:
//
//   provides: {
//     clones: {
//       "greeter":     "./clones/greeter.seed.json",
//       "dance-floor": "./clones/dance-floor.seed.json",
//     },
//   }
//
// The loader reads the JSON at load time, validates the bundle, and
// calls `registerTemplate(<ext>:<localName>, bundle, <ext>)` for each.
// The portal queries `list-clones` to populate the graft UI; an
// operator picks one and dispatches `plant-template` against the
// position they want it grafted at.

import { assertValidBundle } from "./bundle.js";

// Map<fullName, { bundle, ownerExtension, manifestParams }>
//   fullName = "<ext>:<localName>"  (auto-namespaced by the loader)
const _byName = new Map();

// Set<ownerExtension>  fast extension-scoped unregister.
const _byOwner = new Map(); // ext -> Set<fullName>

/**
 * Register a clone bundle. Throws on invalid bundle. Idempotent on
 * fullName (re-registering replaces the prior entry; the old one's
 * owner indexing is updated).
 *
 * @param {string} fullName       "<ext>:<localName>"
 * @param {object} bundle         the parsed clone bundle JSON
 * @param {string} ownerExtension extension that shipped it
 */
export function registerTemplate(fullName, bundle, ownerExtension) {
  if (typeof fullName !== "string" || !fullName.length) {
    throw new Error("registerTemplate: fullName required");
  }
  // Validate the bundle shape up front so a malformed clone fails at
  // load time, not at graft time.
  assertValidBundle(bundle);

  // Drop prior owner indexing if this fullName already lived under a
  // different extension.
  const prior = _byName.get(fullName);
  if (prior && prior.ownerExtension !== ownerExtension) {
    _byOwner.get(prior.ownerExtension)?.delete(fullName);
  }

  _byName.set(fullName, { bundle, ownerExtension });
  let set = _byOwner.get(ownerExtension);
  if (!set) {
    set = new Set();
    _byOwner.set(ownerExtension, set);
  }
  set.add(fullName);
}

/**
 * Unregister one clone by fullName. Returns true when something was
 * removed.
 */
export function unregisterTemplate(fullName) {
  const entry = _byName.get(fullName);
  if (!entry) return false;
  _byName.delete(fullName);
  _byOwner.get(entry.ownerExtension)?.delete(fullName);
  return true;
}

/**
 * Drop every clone owned by an extension. Called when an extension
 * unloads / reinstalls.
 */
export function unregisterTemplatesFromExtension(extName) {
  const set = _byOwner.get(extName);
  if (!set) return 0;
  let n = 0;
  for (const fullName of set) {
    _byName.delete(fullName);
    n++;
  }
  _byOwner.delete(extName);
  return n;
}

/**
 * Look up a clone by full name. Returns the registry entry or null.
 *
 * @returns {{ bundle, ownerExtension } | null}
 */
export function getTemplate(fullName) {
  return _byName.get(fullName) || null;
}

/**
 * Wire-shape list of every registered clone — the surface portals
 * read to populate the graft UI. Each entry surfaces just enough
 * metadata to render the picker: name, owner, the bundle's declared
 * parameters (so the UI can build a form), and the source scope name
 * (a hint for what the bundle plants).
 */
export function listTemplates() {
  const out = [];
  for (const [name, { bundle, ownerExtension }] of _byName) {
    out.push({
      name,
      ownerExtension,
      sourceScopeName: bundle.meta?.sourceScopeName || null,
      parameters: Array.isArray(bundle.parameters) ? bundle.parameters : [],
      counts: {
        spaces: bundle.content?.spaces?.length || 0,
        beings: bundle.content?.beings?.length || 0,
        matter: bundle.content?.matter?.length || 0,
      },
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Diagnostic — count of registered clones.
 */
export function getTemplateCount() {
  return _byName.size;
}
