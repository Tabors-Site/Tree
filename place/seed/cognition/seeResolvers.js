// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// seeResolver registry.
//
// A role's `see` field lists names of preloaded content blocks that
// must be embedded in the prompt at build time. Each name maps to a
// resolver registered through this module. At prompt-build time, the
// assembler walks the role's `see` list, runs each resolver against
// the current ctx, joins the non-empty results, and inlines them
// between "seeing and doing this:" and the "and can:" capability list.
//
// **Naming + namespacing.** Same pattern as the DO operation registry
// (seed/ibp/operations.js):
//
//   Kernel resolvers register bare names ("ruler-snapshot",
//   "this-scope"). Bare names are reserved for the kernel.
//
//   Extension resolvers are auto-namespaced to "<ext>:<name>". An
//   extension calling `registerSeeResolver("snapshot", fn)` from inside
//   its init gets recorded as `<extName>:snapshot`. The loader supplies
//   the extName via the scoped core; direct callers from seed pass
//   "kernel" explicitly.
//
//   Lookup is exact-key first, then a fallback search for `:<name>`
//   suffix. A role declaring `see: ["snapshot"]` resolves to the
//   kernel's `snapshot` if one exists, else falls through to a unique
//   extension-owned `:snapshot`. If multiple extensions register a
//   resolver of the same suffix, the bare lookup logs an ambiguity
//   warning and asks the role to use the qualified name.
//
// Resolvers are registered by the extension that owns the data shape.
// The Ruler's `ruler-snapshot` resolver lives in the governing
// extension. Workspace extensions register their own. Seed itself
// registers a small set of universal resolvers so every role can
// reach for them.
//
// A resolver returns either a string (rendered into the prompt) or
// null / "" (skipped). Returning null is the correct way to opt out
// for a ctx where the resolver does not apply.
//
// Resolvers are async-tolerant; the assembler awaits each one in
// parallel and collects the results in declaration order.

import log from "../system/log.js";

const RESOLVERS = new Map();

const NAME_RE = /^[a-z][a-z0-9-]*$/;
const QUALIFIED_RE = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;

/**
 * Register a named see-resolver. Kernel resolvers (extName === "kernel")
 * keep their bare name; extension resolvers are auto-prefixed to
 * `<extName>:<name>` and roles can resolve them by either the qualified
 * key or the bare suffix.
 *
 * @param {string} name      kebab-case identifier
 * @param {function} fn      async (ctx) => string | null
 * @param {string} [extName] owner; defaults to "kernel"
 * @returns {string|null}    the registered key on success, else null
 */
export function registerSeeResolver(name, fn, extName = "kernel") {
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    log.error(
      "SeeResolvers",
      `Invalid resolver name "${String(name).slice(0, 30)}". Must match /^[a-z][a-z0-9-]*$/`,
    );
    return null;
  }
  if (typeof fn !== "function") {
    log.error("SeeResolvers", `Resolver "${name}" must be a function`);
    return null;
  }

  const key = extName === "kernel" ? name : `${extName}:${name}`;
  if (RESOLVERS.has(key)) {
    const existing = RESOLVERS.get(key);
    log.warn(
      "SeeResolvers",
      `Resolver "${key}" already registered by "${existing.extName}"; rejecting from "${extName}"`,
    );
    return null;
  }
  RESOLVERS.set(key, { fn, extName });
  log.verbose("SeeResolvers", `Registered "${key}"`);
  return key;
}

/**
 * Remove a previously-registered resolver. Accepts either the qualified
 * key (`coders:source-tree`) or — for kernel resolvers — the bare name.
 */
export function unregisterSeeResolver(key) {
  return RESOLVERS.delete(key);
}

/**
 * Remove every resolver owned by an extension. Used by the loader on
 * extension uninstall.
 */
export function unregisterResolversForExtension(extName) {
  let n = 0;
  for (const [key, entry] of RESOLVERS) {
    if (entry.extName === extName) {
      RESOLVERS.delete(key);
      n++;
    }
  }
  return n;
}

/**
 * Look up a resolver. Accepts both qualified (`ext:name`) and bare
 * names. Bare lookups try the exact key first (kernel resolvers) then
 * search for a `:<name>` suffix among extension resolvers. Ambiguous
 * bare lookups (two extensions own the same suffix) log a warning and
 * return null so the role file uses the qualified name.
 */
export function getSeeResolver(name) {
  if (typeof name !== "string" || name.length === 0) return null;

  // Qualified: direct lookup.
  if (QUALIFIED_RE.test(name)) {
    return RESOLVERS.get(name)?.fn || null;
  }

  // Bare: kernel match wins outright.
  if (RESOLVERS.has(name)) return RESOLVERS.get(name).fn;

  // Otherwise scan extensions for a `:<name>` suffix.
  const suffix = `:${name}`;
  const matches = [];
  for (const key of RESOLVERS.keys()) {
    if (key.endsWith(suffix)) matches.push(key);
  }
  if (matches.length === 0) return null;
  if (matches.length === 1) return RESOLVERS.get(matches[0]).fn;

  log.warn(
    "SeeResolvers",
    `Ambiguous see-resolver "${name}" — matches ${matches.join(", ")}. ` +
      `Use the qualified name in the role spec.`,
  );
  return null;
}

/**
 * Resolve every name in the list against the given ctx. Runs in
 * parallel; returns the non-empty results in declaration order.
 * Unknown names log a warning and contribute nothing.
 *
 * @param {string[]} names  the role's `see` list (qualified or bare)
 * @param {object} ctx      runChat ctx (carries being, position, message, etc.)
 * @returns {Promise<string[]>}
 */
export async function resolveSeeList(names, ctx) {
  if (!Array.isArray(names) || names.length === 0) return [];
  const settled = await Promise.all(
    names.map(async (name) => {
      const fn = getSeeResolver(name);
      if (!fn) {
        log.warn("SeeResolvers", `Unknown see-resolver "${name}"; skipping`);
        return null;
      }
      try {
        const out = await fn(ctx);
        return typeof out === "string" && out.length > 0 ? out : null;
      } catch (err) {
        log.warn("SeeResolvers", `Resolver "${name}" failed: ${err.message}`);
        return null;
      }
    }),
  );
  return settled.filter(Boolean);
}

/**
 * List registered resolvers (diagnostics).
 */
export function listSeeResolvers(filter = {}) {
  let entries = Array.from(RESOLVERS.entries());
  if (filter.extName)
    entries = entries.filter(([, e]) => e.extName === filter.extName);
  return entries.map(([key, e]) => ({ key, extName: e.extName }));
}
