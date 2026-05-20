// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// BE-being registry.
//
// The BE verb routes identity operations (register / claim / release /
// switch / create-being / extension-defined) by the address's @being
// qualifier. This module is the registry of beings that honor BE
// operations: kernel pre-registers `auth` and `llm-assigner`;
// extensions register their own BE-honoring beings here.
//
// Before this registry existed, seed/ibp/verbs.js had a frozen
// `LAND_BEINGS = { auth, "llm-assigner" }` table that no extension
// could extend. That limited BE to those two kernel beings. Now the
// dispatcher consults this registry instead, and any extension can
// ship a BE-honoring being (a court-being's convene/rule/recuse, a
// treasurer-being's transfer/freeze, a federation-being's peer/
// unpeer, etc.). Identity-shaped operations finally have an extension
// point.
//
// **Spec shape.** A BE-being spec carries:
//
//   {
//     name:             "auth" | "llm-assigner" | <ext-being-name>,
//     description:      string,
//     honoredOperations: string[],          // kebab-case op names
//     <methodName>:     async (payload, ctx) => result,
//     ...                                    // one method per honored op
//   }
//
// Method names are derived from operation names via kebab-to-camel
// (the dispatcher in seed/ibp/verbs.js does the conversion). So
// `honoredOperations: ["release", "create-being"]` requires methods
// `release()` and `createBeing()` on the spec.
//
// **Naming.** Bare names ("auth", "llm-assigner") are reserved for
// kernel beings. Extensions register their beings with an
// `<ext>-<name>` shape (e.g. "court-being", "treasurer-being") to
// avoid colliding with kernel reservations or other extensions.

import log from "../system/log.js";

const REGISTRY = new Map();

// Reserved kernel names. Extensions cannot register beings under these.
const KERNEL_RESERVED = new Set(["auth", "llm-assigner"]);

const NAME_RE = /^[a-z][a-z0-9-]*$/;

/**
 * Register a BE-honoring being.
 *
 * @param {string} name              kebab-case identifier
 * @param {object} spec              the being's BE-handler spec
 * @param {string} [extName="kernel"] owning extension; "kernel" for seed pre-registrations
 * @returns {boolean} true on success
 */
export function registerBeBeing(name, spec, extName = "kernel") {
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    log.error("BeRegistry",
      `Invalid BE-being name "${String(name).slice(0, 30)}". ` +
      `Must match /^[a-z][a-z0-9-]*$/.`);
    return false;
  }
  if (KERNEL_RESERVED.has(name) && extName !== "kernel") {
    log.error("BeRegistry",
      `BE-being name "${name}" is reserved for the kernel; extension "${extName}" cannot claim it.`);
    return false;
  }
  if (!spec || typeof spec !== "object") {
    log.error("BeRegistry", `BE-being "${name}" rejected: spec must be an object`);
    return false;
  }
  if (!Array.isArray(spec.honoredOperations) || spec.honoredOperations.length === 0) {
    log.error("BeRegistry",
      `BE-being "${name}" rejected: honoredOperations must be a non-empty array of op names`);
    return false;
  }
  if (REGISTRY.has(name)) {
    const existing = REGISTRY.get(name);
    log.warn("BeRegistry",
      `BE-being "${name}" already registered by "${existing.extName}"; ` +
      `rejecting from "${extName}"`);
    return false;
  }
  REGISTRY.set(name, { spec, extName });
  log.verbose("BeRegistry",
    `Registered BE-being "${name}" (${extName}) ` +
    `[ops: ${spec.honoredOperations.join("/")}]`);
  return true;
}

/**
 * Look up a BE-honoring being's spec by name. Returns null when no
 * being is registered under that name.
 */
export function getBeBeing(name) {
  if (!name) return null;
  return REGISTRY.get(name)?.spec || null;
}

/**
 * Remove a previously-registered BE-being. Returns true when something
 * was removed.
 */
export function unregisterBeBeing(name) {
  return REGISTRY.delete(name);
}

/**
 * Remove every BE-being owned by an extension. Used by the loader
 * during extension uninstall.
 */
export function unregisterBeBeingsForExtension(extName) {
  let n = 0;
  for (const [name, entry] of REGISTRY) {
    if (entry.extName === extName) {
      REGISTRY.delete(name);
      n++;
    }
  }
  return n;
}

/**
 * List every registered BE-being for diagnostics / substrate mirror.
 */
export function listBeBeings(filter = {}) {
  let entries = Array.from(REGISTRY.entries());
  if (filter.extName) entries = entries.filter(([, e]) => e.extName === filter.extName);
  return entries.map(([name, e]) => ({
    name,
    extName: e.extName,
    honoredOperations: [...e.spec.honoredOperations],
    description: e.spec.description || null,
  }));
}
