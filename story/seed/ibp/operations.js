// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// DO operations. The words I know how to act on.
//
// SEE / SUMMON / BE each have a single execution shape. DO is the
// open-ended verb — its meaning is whatever the caller's action
// name says, and the seed + extensions together teach me a
// growing vocabulary of actions through this registry.
//
// One registry. One gate. Both the IBP wire layer and in-process
// callers (extensions, seed internals) dispatch through here, so
// authorization, schema validation, and Fact stamping run once at one
// place. Bare names ("create-child", "set-qualities") are reserved for
// the seed; extensions register under "<extName>:<action>" so
// every name's owner is structurally evident on the wire.
//
// The seed's own DO ops register at module load through each
// material's ops file (materials/<kind>/ops.js, materials/seeds.js,
// storyConfig.js — services.js imports them for side effects).
// Extensions register theirs through the loader reading manifest
// provides + init() return. Both go through registerOperation here;
// there is no privileged seed path.

import log from "../seedStory/log.js";

const REGISTRY = new Map();

// Naming. Bare names ("create-child", "set-qualities") are reserved for the
// seed. Extensions register under "<extName>:<action>" (e.g.,
// "food:log-meal"). Same convention as modes (tree:fallback,
// tree:food-log) and ables (governing:ruler).
const SEED_NAME_RE = /^[a-z][a-z0-9-]*$/;
const EXT_NAME_RE = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;

const MAX_REGISTERED = 500;

// Target kinds an operation may declare it accepts.
const VALID_TARGETS = new Set([
  "space",
  "being",
  "matter",
  "story",
  "stance",
  "position",
]);

/**
 * Register a DO operation.
 *
 * @param {string} name - "<action>" for seed ops, "<ext>:<action>" for extensions
 * @param {object} spec
 * @param {string[]} spec.targets - target kinds the op accepts: space|being|matter|story|stance|position
 * @param {Function} spec.handler - async ({ target, params, identity, moment }) => result
 * @param {object} [spec.schema] - payload validation (JSON schema). Currently stored only; enforcement is on the roadmap.
 * @param {string} [spec.factAction] - name written into the Fact. Defaults to operation name.
 * @param {string} [spec.ownerExtension] - registering extension name (default "seed")
 * @returns {boolean} true on success
 */
export function registerOperation(name, spec) {
  if (typeof name !== "string" || name.length === 0) {
    log.warn(
      "Operations",
      "registerOperation: name must be a non-empty string",
    );
    return false;
  }
  if (!spec || typeof spec !== "object") {
    log.warn("Operations", `registerOperation("${name}"): spec is required`);
    return false;
  }
  if (typeof spec.handler !== "function") {
    log.warn(
      "Operations",
      `registerOperation("${name}"): handler must be a function`,
    );
    return false;
  }
  if (!Array.isArray(spec.targets) || spec.targets.length === 0) {
    log.warn(
      "Operations",
      `registerOperation("${name}"): targets must be a non-empty array`,
    );
    return false;
  }
  for (const t of spec.targets) {
    if (!VALID_TARGETS.has(t)) {
      log.warn(
        "Operations",
        `registerOperation("${name}"): invalid target "${t}". Use ${[...VALID_TARGETS].join("|")}.`,
      );
      return false;
    }
  }

  const ownerExtension = spec.ownerExtension || "seed";
  const isSeedName = SEED_NAME_RE.test(name);
  const isExtName = EXT_NAME_RE.test(name);

  if (!isSeedName && !isExtName) {
    log.warn(
      "Operations",
      `registerOperation("${name}"): invalid name format. Use "action" (seed) or "ext:action" (extension).`,
    );
    return false;
  }
  if (isSeedName && ownerExtension !== "seed") {
    log.warn(
      "Operations",
      `registerOperation("${name}"): bare names are reserved for the seed. Extension "${ownerExtension}" must register as "${ownerExtension}:${name}".`,
    );
    return false;
  }
  if (isExtName) {
    const declaredPrefix = name.split(":")[0];
    if (declaredPrefix !== ownerExtension) {
      log.warn(
        "Operations",
        `registerOperation("${name}"): prefix "${declaredPrefix}" does not match owner "${ownerExtension}".`,
      );
      return false;
    }
  }
  if (REGISTRY.size >= MAX_REGISTERED) {
    log.error(
      "Operations",
      `Operation registry full (${MAX_REGISTERED}). "${name}" rejected.`,
    );
    return false;
  }
  if (REGISTRY.has(name)) {
    const existing = REGISTRY.get(name);
    log.warn(
      "Operations",
      `Operation "${name}" already registered by "${existing.ownerExtension}". Re-registration from "${ownerExtension}" rejected.`,
    );
    return false;
  }

  REGISTRY.set(name, {
    name,
    targets: [...spec.targets],
    handler: spec.handler,
    schema: spec.schema || null,
    // Field schema for the op's params (type + label per field). Drives
    // the portal's "directing" forms; null for ops that take no input or
    // declare none (callers fall back to a freeform JSON box).
    args: spec.args || null,
    factAction:
      typeof spec.factAction === "string" && spec.factAction.length > 0
        ? spec.factAction
        : name,
    // True when the op's authorize key includes a `namespace` part —
    // e.g. `do:set-space:my-extension`. The seed's set-<kind> ops use
    // this so operators can author per-namespace rules at qualities.
    // permissions.do.set-space:<ns>. authorize.js's buildKeyParts
    // reads it via isNamespaceKeyedAction().
    useNamespaceKey: spec.useNamespaceKey === true,
    // Optional auth-action refinement. doVerb calls
    // `authAction({ params, target })` to derive the action string the
    // able-walk matches against canDo — grant-able authorizes as
    // `grant-able:<ableName>` so canDo entries can scope grantors
    // per-able. Open to extension ops the same way. Falls back to the
    // op name when absent or when the function returns nothing.
    authAction: typeof spec.authAction === "function" ? spec.authAction : null,
    // Optional matter-type gate. An op declaring matterTypes refuses
    // to run against matter of any other type (enforced in doVerb).
    // The advertisement direction lives on the type def (its `ops`
    // list → the descriptor's actions menu); this is the enforcement
    // direction. See materials/matter/types.js.
    matterTypes:
      Array.isArray(spec.matterTypes) && spec.matterTypes.length > 0
        ? Object.freeze([...spec.matterTypes])
        : null,
    ownerExtension,
  });
  log.verbose("Operations", `Registered: ${name} (${ownerExtension})`);
  return true;
}

/**
 * Unregister a single operation by name.
 */
export function unregisterOperation(name) {
  return REGISTRY.delete(name);
}

/**
 * Unregister every operation belonging to one extension. Called by the
 * loader when an extension is unloaded.
 */
export function unregisterOperationsFromExtension(extName) {
  let count = 0;
  for (const [name, op] of REGISTRY) {
    if (op.ownerExtension === extName) {
      REGISTRY.delete(name);
      count++;
    }
  }
  if (count > 0) {
    log.verbose(
      "Operations",
      `Unregistered ${count} operation(s) from "${extName}"`,
    );
  }
  return count;
}

/**
 * Look up an operation by name. Returns null if not registered.
 */
export function getOperation(name) {
  return REGISTRY.get(name) || null;
}

// Legacy unregistered actions the wire dispatcher still routes by
// name (do.js extracts params.namespace for them). They share the
// namespace-keyed lookup behavior with the registered set-<kind> ops
// even though they don't appear in the registry. Add new entries here
// only when retiring the registration-less pattern can't be done.
const _LEGACY_NAMESPACE_KEYED = new Set(["set-qualities", "clear-qualities"]);

/**
 * True when the named action's authorize key includes a namespace
 * part. Used by authorize.js's buildKeyParts to add a per-namespace
 * key segment, and by do.js to extract the namespace from params.
 * Source of truth: the op's `useNamespaceKey` flag, plus the legacy
 * set above for unregistered names.
 */
export function isNamespaceKeyedAction(name) {
  if (_LEGACY_NAMESPACE_KEYED.has(name)) return true;
  const op = REGISTRY.get(name);
  return op?.useNamespaceKey === true;
}

/**
 * List registered operations. Optional filters:
 *   { ownerExtension: "food" }      -> only that extension's ops
 *   { target: "space" }             -> only ops accepting space targets
 */
export function listOperations(filter = {}) {
  let entries = Array.from(REGISTRY.values());
  if (filter.ownerExtension) {
    entries = entries.filter(
      (op) => op.ownerExtension === filter.ownerExtension,
    );
  }
  if (filter.target) {
    entries = entries.filter((op) => op.targets.includes(filter.target));
  }
  return entries.map((op) => ({
    name: op.name,
    targets: [...op.targets],
    factAction: op.factAction,
    ownerExtension: op.ownerExtension,
    args: op.args || null,
  }));
}

/**
 * Sync the operation registry into `<story>/./operations` as child Nodes.
 * One child per registered DO operation; qualities mirrors the op's
 * declaration (targets, owner extension, factAction, skipAudit). Called
 * at boot end after extensions register; idempotent.
 */
export async function syncOperationsToSubstrate() {
  const { HEAVEN_SPACE } = await import("../materials/space/heavenSpaces.js");
  const { manifestItems } = await import("../present/manifest.js");
  const items = [];
  for (const op of REGISTRY.values()) {
    items.push({
      name: op.name,
      qualities: new Map([
        [
          "operation",
          {
            targets: [...op.targets],
            factAction: op.factAction,
            ownerExtension: op.ownerExtension,
            // The field schema rides along so portal clients can build
            // directed forms from `.operations` without a second fetch.
            args: op.args || null,
          },
        ],
      ]),
    });
  }
  return manifestItems({ heavenSpace: HEAVEN_SPACE.OPERATIONS, items });
}
