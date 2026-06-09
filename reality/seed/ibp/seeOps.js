// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// SEE operations. The named perceptions a being can preload (via
// canSee) or any caller can ask for (via reality.see(name, args)).
//
// SEE / DO are parallel registries. DO is "the words I know how to
// act on"; SEE is "the named perceptions I know how to render." Both
// have handlers, args schemas, owner-extension tracking, and dispatch
// through one place. DO writes a Fact; SEE never does.
//
// One registry. Two consumption paths:
//
//   1. canSee on roles
//        canSee: ["place", "llm-connections", "library"]
//      The role's frame builder looks each name up here, runs the
//      handler under the being's identity, embeds the result as a
//      face block in the LLM prompt.
//
//   2. Direct call from anywhere
//        const conns = await reality.see("llm-connections");
//        const chain = await reality.see("llm-chain", { receiverBeingId, role });
//      Portal, DO handlers, extension code — all reach for named
//      perceptions through the same surface.
//
// Naming. Bare names ("place", "config", "llm-connections") are
// reserved for the seed. Extensions register under "<extName>:<name>"
// (e.g. "food:meal-log"). Same convention as DO ops and roles.
//
// Address vs name. The SEE verb (seeVerb) accepts either:
//   - an IBP address string ("treeos.example/./tools@arrival")
//     → builds a position descriptor through the descriptor pipeline
//   - a registered SEE op name ("place", "llm-chain")
//     → dispatches to the handler in this registry
// Detection: anything containing "/", "<", "@", or ":" with a known
// owner-extension prefix is an address; everything matching the
// bare-name regex is a registry lookup.
//
// The seed's own SEE ops register at module load through
// seed/present/cognition/llm/seedSeeOps.js (place, roles, tools,
// operations, identity, config, peers, extensions). Extensions
// register theirs through the loader reading manifest provides +
// init() return. Both go through registerSeeOperation here; there is
// no privileged seed path.

import log from "../seedReality/log.js";

const REGISTRY = new Map();

// Naming. Bare names for seed; "<ext>:<name>" for extensions.
const SEED_NAME_RE = /^[a-z][a-z0-9-]*$/;
const EXT_NAME_RE = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;

const MAX_REGISTERED = 500;

/**
 * Register a named SEE operation.
 *
 * @param {string} name
 *   Bare for seed ("place"), "<ext>:<name>" for extensions.
 * @param {object} spec
 * @param {Function} spec.handler
 *   async ({ identity, args, ctx, branch }) => any
 *   - identity: the caller's identity object (or null when anonymous)
 *   - args: validated against spec.args
 *   - ctx: when called from a cognition frame, the moment ctx
 *     (carries being, currentSpace, rootId); null otherwise
 *   - branch: the branch the SEE runs on
 *   Return value can be any serializable shape. The cognition
 *   consumption path JSON-stringifies it under a [<label>] header;
 *   direct callers receive it verbatim.
 * @param {object} [spec.args]
 *   Args schema (same shape as DO op args). Used by op-form renderers
 *   in the portal; runtime validation is on the roadmap.
 * @param {string} [spec.ownerExtension="seed"]
 *   Registering extension name.
 * @returns {boolean} true on success
 */
export function registerSeeOperation(name, spec) {
  if (typeof name !== "string" || name.length === 0) {
    log.warn("SeeOps", "registerSeeOperation: name must be a non-empty string");
    return false;
  }
  if (!spec || typeof spec !== "object") {
    log.warn("SeeOps", `registerSeeOperation("${name}"): spec is required`);
    return false;
  }
  if (typeof spec.handler !== "function") {
    log.warn("SeeOps", `registerSeeOperation("${name}"): handler must be a function`);
    return false;
  }

  const ownerExtension = spec.ownerExtension || "seed";

  // Name shape: bare names reserved for seed; extensions prefix.
  if (ownerExtension === "seed") {
    if (!SEED_NAME_RE.test(name)) {
      log.warn(
        "SeeOps",
        `registerSeeOperation("${name}"): seed names must match ${SEED_NAME_RE}.`,
      );
      return false;
    }
  } else {
    if (!EXT_NAME_RE.test(name)) {
      log.warn(
        "SeeOps",
        `registerSeeOperation("${name}"): extension SEE op must be "<ext>:<name>". ` +
        `Extension "${ownerExtension}" should register as "${ownerExtension}:<name>".`,
      );
      return false;
    }
    const prefix = name.slice(0, name.indexOf(":"));
    if (prefix !== ownerExtension) {
      log.warn(
        "SeeOps",
        `registerSeeOperation("${name}"): prefix "${prefix}" doesn't match ownerExtension "${ownerExtension}".`,
      );
      return false;
    }
  }

  if (REGISTRY.has(name)) {
    const existing = REGISTRY.get(name);
    log.warn(
      "SeeOps",
      `registerSeeOperation("${name}"): already registered by "${existing.ownerExtension}"; rejecting from "${ownerExtension}".`,
    );
    return false;
  }

  if (REGISTRY.size >= MAX_REGISTERED) {
    log.warn(
      "SeeOps",
      `registerSeeOperation("${name}"): registry full (${MAX_REGISTERED}).`,
    );
    return false;
  }

  REGISTRY.set(name, {
    name,
    handler: spec.handler,
    args: spec.args || null,
    description: spec.description || null,
    ownerExtension,
  });
  log.verbose("SeeOps", `registered "${name}" (by ${ownerExtension})`);
  return true;
}

export function getSeeOperation(name) {
  return REGISTRY.get(name) || null;
}

export function unregisterSeeOperation(name) {
  return REGISTRY.delete(name);
}

export function unregisterSeeOperationsFromExtension(extName) {
  let removed = 0;
  for (const [name, op] of REGISTRY) {
    if (op.ownerExtension === extName) {
      REGISTRY.delete(name);
      removed++;
    }
  }
  return removed;
}

/**
 * List registered SEE ops, optionally filtered by owner-extension.
 * Returns a lightweight projection: { name, ownerExtension, args, description }.
 */
export function listSeeOperations({ ownerExtension = null } = {}) {
  const out = [];
  for (const op of REGISTRY.values()) {
    if (ownerExtension && op.ownerExtension !== ownerExtension) continue;
    out.push({
      name: op.name,
      ownerExtension: op.ownerExtension,
      args: op.args,
      description: op.description,
    });
  }
  return out;
}

/**
 * Detect whether a string is a registered SEE op name (vs an address).
 * Used by seeVerb to dispatch.
 */
export function isSeeOpName(s) {
  return typeof s === "string" && (SEED_NAME_RE.test(s) || EXT_NAME_RE.test(s)) && REGISTRY.has(s);
}
