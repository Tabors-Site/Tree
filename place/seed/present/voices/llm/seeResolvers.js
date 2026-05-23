// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The see-resolver registry — preloaded sight for the moment. A
// role's `see` field lists named content blocks the being must
// already be looking at the instant its frame goes through the
// inference. These are not tool calls the being decides to make;
// they are things the being IS seeing as part of how the frame
// is built. When buildPrompt assembles the frame, I walk the
// role's `see` list in parallel, run each resolver against the
// ctx, and inline the non-empty results between "seeing and
// doing this:" and the capabilities list. The being's first
// sight is whatever I produce.
//
// Naming and namespacing follow the DO operation registry
// (seed/ibp/operations.js):
//
//   Seed resolvers register bare names ("ruler-snapshot",
//   "this-scope"). Bare names are reserved for me.
//
//   Extension resolvers are auto-namespaced to "<ext>:<name>". The
//   loader's scoped place bundle supplies the extName; direct seed
//   callers pass "seed".
//
//   Lookup is exact-key first, then a fallback search for `:<name>`
//   suffix. A role declaring `see: ["snapshot"]` resolves to the
//   seed's `snapshot` if one exists, otherwise the first unique
//   extension-owned `:snapshot`. If multiple extensions register
//   the same suffix the bare lookup logs an ambiguity warning and
//   asks the role to use the qualified name.
//
// Resolvers are owned by the extension whose data they render. The
// governing extension owns `ruler-snapshot`. Workspace extensions
// own their own. I register a small seed set so every role has
// something to reach for.
//
// A resolver returns a string (inlined) or null/"" (skipped).
// Returning null is the correct opt-out for a ctx where the
// resolver doesn't apply.
//
// Resolvers are async-tolerant; I await them in parallel and
// collect results in declaration order.

import log from "../../../system/log.js";

const RESOLVERS = new Map();

const NAME_RE = /^[a-z][a-z0-9-]*$/;
const QUALIFIED_RE = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;

/**
 * Register a named see-resolver. Seed resolvers (extName === "seed")
 * keep their bare name; extension resolvers are auto-prefixed to
 * `<extName>:<name>` and roles can resolve them by either the qualified
 * key or the bare suffix.
 *
 * @param {string} name      kebab-case identifier
 * @param {function} fn      async (ctx) => string | null
 * @param {string} [extName] owner; defaults to "seed"
 * @returns {string|null}    the registered key on success, else null
 */
export function registerSeeResolver(name, fn, extName = "seed") {
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

  const key = extName === "seed" ? name : `${extName}:${name}`;
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
 * key (`coders:source-tree`) or — for seed resolvers — the bare name.
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
 * names. Bare lookups try the exact key first (seed resolvers) then
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

  // Bare: seed match wins outright.
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
 * @param {object} ctx      runTurn ctx (carries being, position, message, etc.)
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
