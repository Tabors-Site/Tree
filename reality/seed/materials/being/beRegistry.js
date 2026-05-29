// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Custom BE-verb handlers.
//
// Every being honors BE. register, claim, release, switch are
// universal identity operations; every being has them by default.
// Who is allowed to run any of them against a given being is
// stance-authorization's job, not this module's.
//
// This registry holds the SUBSET of beings whose BE behavior is
// custom. Some beings need a specialized take on the default
// operations (auth's `register` runs the welcome flow); others add
// new operations beyond the default set (llm-assigner's `add-llm`,
// `assign-slot`). The dispatcher in ibp/verbs/be.js consults this
// registry before falling back to the default BE handling.
//
// This is not where Being rows are minted. Identity creation lives
// in [identity.js](identity.js). A handler spec here describes how
// custom BE operations dispatch to a name; the Being row with that
// name is a separate concern.
//
// Spec shape:
//
//   {
//     name:              "cherub" | "llm-assigner" | <ext-name>,
//     description:       string,
//     honoredOperations: string[],          // kebab-case op names
//     <methodName>:      async (payload, ctx) => result,
//     ...                                    // one method per honored op
//   }
//
// Method names derive from operation names via kebab-to-camel (the
// dispatcher in ibp/verbs/be.js does the conversion). So
// `honoredOperations: ["release", "create-being"]` requires methods
// `release()` and `createBeing()` on the spec.
//
// Naming. Bare names ("cherub", "llm-assigner") are reserved for my
// own handlers. Extensions register theirs with an `<ext>-<name>`
// shape (e.g. "court-being", "treasurer-being") to avoid colliding
// with seed reservations or other extensions.

import log from "../../seedReality/log.js";

const REGISTRY = new Map();

// Reserved names. Extensions cannot register handlers under these.
const KERNEL_RESERVED = new Set(["cherub", "llm-assigner"]);

const NAME_RE = /^[a-z][a-z0-9-]*$/;

/**
 * Register a BE-verb handler spec.
 *
 * @param {string} name              kebab-case identifier (the @qualifier in the address)
 * @param {object} spec              the handler spec (see header for shape)
 * @param {string} [extName="seed"] owning extension; "seed" for my pre-registrations
 * @returns {boolean} true on success
 */
export function registerBeHandler(name, spec, extName = "seed") {
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    log.error("BeRegistry",
      `Invalid BE handler name "${String(name).slice(0, 30)}". ` +
      `Must match /^[a-z][a-z0-9-]*$/.`);
    return false;
  }
  if (KERNEL_RESERVED.has(name) && extName !== "seed") {
    log.error("BeRegistry",
      `BE handler name "${name}" is reserved for the seed; extension "${extName}" cannot claim it.`);
    return false;
  }
  if (!spec || typeof spec !== "object") {
    log.error("BeRegistry", `BE handler "${name}" rejected: spec must be an object`);
    return false;
  }
  if (!Array.isArray(spec.honoredOperations) || spec.honoredOperations.length === 0) {
    log.error("BeRegistry",
      `BE handler "${name}" rejected: honoredOperations must be a non-empty array of op names`);
    return false;
  }
  if (REGISTRY.has(name)) {
    const existing = REGISTRY.get(name);
    log.warn("BeRegistry",
      `BE handler "${name}" already registered by "${existing.extName}"; ` +
      `rejecting from "${extName}"`);
    return false;
  }
  REGISTRY.set(name, { spec, extName });
  log.verbose("BeRegistry",
    `Registered BE handler "${name}" (${extName}) ` +
    `[ops: ${spec.honoredOperations.join("/")}]`);
  return true;
}

// Look up a handler spec by name. Returns null when no handler is
// registered under that name.
export function getBeHandler(name) {
  if (!name) return null;
  return REGISTRY.get(name)?.spec || null;
}

// Remove a previously-registered handler. Returns true when something
// was removed.
export function unregisterBeHandler(name) {
  return REGISTRY.delete(name);
}

// Remove every handler owned by an extension. Called by the loader
// during extension uninstall.
export function unregisterBeHandlersForExtension(extName) {
  let n = 0;
  for (const [name, entry] of REGISTRY) {
    if (entry.extName === extName) {
      REGISTRY.delete(name);
      n++;
    }
  }
  return n;
}

// List every registered handler for diagnostics and the substrate mirror.
export function listBeHandlers(filter = {}) {
  let entries = Array.from(REGISTRY.entries());
  if (filter.extName) entries = entries.filter(([, e]) => e.extName === filter.extName);
  return entries.map(([name, e]) => ({
    name,
    extName: e.extName,
    honoredOperations: [...e.spec.honoredOperations],
    description: e.spec.description || null,
  }));
}
