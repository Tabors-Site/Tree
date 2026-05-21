// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// DO operations. The words I know how to act on.
//
// SEE / SUMMON / BE each have a single execution shape. DO is the
// open-ended verb — its meaning is whatever the caller's action
// name says, and the kernel + extensions together teach me a
// growing vocabulary of actions through this registry.
//
// One registry. One gate. Both the IBP wire layer and in-process
// callers (extensions, kernel internals) dispatch through here, so
// authorization, schema validation, and Did audit run once at one
// place. Bare names ("create-child", "set-meta") are reserved for
// the kernel; extensions register under "<extName>:<action>" so
// every name's owner is structurally evident on the wire.
//
// The kernel's own DO ops register at module load through
// coreOperations.js. Extensions register theirs through the loader
// reading manifest provides + init() return. Both go through
// registerOperation here; there is no privileged kernel path.

import log from "../system/log.js";

const REGISTRY = new Map();

// Naming. Bare names ("create-child", "set-meta") are reserved for the
// kernel. Extensions register under "<extName>:<action>" (e.g.,
// "food:log-meal"). Same convention as modes (tree:fallback,
// tree:food-log) and roles (governing:ruler).
const KERNEL_NAME_RE = /^[a-z][a-z0-9-]*$/;
const EXT_NAME_RE = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;

const MAX_REGISTERED = 500;

// Target kinds an operation may declare it accepts.
const VALID_TARGETS = new Set([
  "space",
  "being",
  "matter",
  "land",
  "stance",
  "position",
]);

/**
 * Register a DO operation.
 *
 * @param {string} name - "<action>" for kernel ops, "<ext>:<action>" for extensions
 * @param {object} spec
 * @param {string[]} spec.targets - target kinds the op accepts: space|being|matter|land|stance|position
 * @param {Function} spec.handler - async ({ target, params, identity, summonCtx }) => result
 * @param {object} [spec.schema] - payload validation (Zod / JSON schema). Currently stored only; enforcement is on the roadmap.
 * @param {string} [spec.didAction] - name written into the Did. Defaults to operation name.
 * @param {boolean} [spec.skipAudit] - if true, no Did is written. Reserve for ops where audit adds nothing.
 * @param {string} [spec.ownerExtension] - registering extension name (default "kernel")
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

  const ownerExtension = spec.ownerExtension || "kernel";
  const isKernelName = KERNEL_NAME_RE.test(name);
  const isExtName = EXT_NAME_RE.test(name);

  if (!isKernelName && !isExtName) {
    log.warn(
      "Operations",
      `registerOperation("${name}"): invalid name format. Use "action" (kernel) or "ext:action" (extension).`,
    );
    return false;
  }
  if (isKernelName && ownerExtension !== "kernel") {
    log.warn(
      "Operations",
      `registerOperation("${name}"): bare names are reserved for the kernel. Extension "${ownerExtension}" must register as "${ownerExtension}:${name}".`,
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
    didAction:
      typeof spec.didAction === "string" && spec.didAction.length > 0
        ? spec.didAction
        : name,
    skipAudit: spec.skipAudit === true,
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
    didAction: op.didAction,
    skipAudit: op.skipAudit,
    ownerExtension: op.ownerExtension,
  }));
}

/**
 * Sync the operation registry into `<land>/.operations` as child Nodes.
 * One child per registered DO operation; qualities mirrors the op's
 * declaration (targets, owner extension, didAction, skipAudit). Called
 * at boot end after extensions register; idempotent.
 */
export async function syncOperationsToSubstrate() {
  const { SEED_SPACE } = await import("./protocol.js");
  const { syncRegistryToSubstrate } = await import("../land/registryMirror.js");
  const items = [];
  for (const op of REGISTRY.values()) {
    items.push({
      name: op.name,
      qualities: new Map([
        [
          "operation",
          {
            targets: [...op.targets],
            didAction: op.didAction,
            skipAudit: op.skipAudit,
            ownerExtension: op.ownerExtension,
          },
        ],
      ]),
    });
  }
  return syncRegistryToSubstrate({ seedSpace: SEED_SPACE.OPERATIONS, items });
}
