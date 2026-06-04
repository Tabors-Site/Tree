// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Refs registry — the substrate-wide catalog of ID-bearing fields.
//
// Every action handler that emits a fact may carry references to *other*
// aggregates by ID — `parentBeingId` in a `set-being` write,
// `homeSpace` in a being's qualities, `parent` in a space, etc. Each is
// an `_id` that lives only within the substrate that issued it.
//
// When a replicate is grafted (publishing.md Phase 4 + 5), the graft
// layer needs to know which fields in each fact's params (and which
// paths in each qualities namespace) carry IDs, so it can substitute
// placeholders with the new local IDs in the target.
//
// This module is the registry. The seed contributes its own entries
// (see seedRefs.js); extensions contribute via their manifest's `refs`
// field (loader.js wires this in at extension boot).
//
// The registry is doctrinal infrastructure: substrate-level, declared
// at boot, read-only at runtime. Late-arriving entries (from extension
// loads after first-graft) are accepted but conflicts throw loud.
//
// See REFS_MANIFEST.md for the inventory + contribution shape.

import log from "../seedReality/log.js";

// Valid kind values for ref entries. Every contribution's value must
// be one of these or `null` (explicit "this path is not an ID, but
// listed for clarity"). Anything else throws at registration.
const VALID_KINDS = new Set(["being", "space", "matter", "name", null]);

// Map<actionName, { params: { path: kind } }>
const _opRefs = new Map();

// Map<qualitiesNamespace, { path: kind }>
const _qualitiesRefs = new Map();

// Map<actionName | namespace, ownerName>. Used for error messages
// when two contributors claim the same key.
const _opOwners = new Map();
const _qualitiesOwners = new Map();

/**
 * Register a contribution to the refs manifest. Called by the seed
 * at boot (via seedRefs.js) and by extensions at load time (via the
 * loader's `refs` field handling).
 *
 * Shape:
 *   {
 *     ops: {
 *       "<actionName>": { params: { "<path>": "<kind>" } },
 *     },
 *     qualities: {
 *       "<namespace>": { "<path>": "<kind>" },
 *     },
 *   }
 *
 * Path conventions:
 *   - For `ops.<action>.params`: dot-paths into the fact's `params`
 *     object (e.g., `"value"` for `params.value`, `"spec.parent"` for
 *     `params.spec.parent`).
 *   - For `qualities.<namespace>`: dot-paths into the namespace, with
 *     `*` as a single-segment wildcard (e.g., `"<key>.beingId"`).
 *
 * Conflict policy:
 *   - Two contributions to the same op + same param path with the
 *     SAME kind: no-op (idempotent).
 *   - Two contributions to the same op + same param path with
 *     DIFFERENT kinds: throw with both owners named.
 *   - Same for qualities namespaces.
 *
 * Kind values: "being", "space", "matter", "name", null. "name"
 * is for paths whose value is a name-keyed string (role names,
 * pointer names, signal namespaces) that should NEVER be remapped
 * across substrates. `null` is for paths the contribution lists for
 * clarity but that aren't IDs (rare; usually omit).
 *
 * @param {object} contribution
 * @param {string} ownerName . the seed ("seed") or the extension name
 */
export function registerRefs(contribution, ownerName) {
  if (!contribution || typeof contribution !== "object") {
    throw new Error(
      `registerRefs: contribution must be an object (got ${typeof contribution}) from owner "${ownerName}"`,
    );
  }
  if (typeof ownerName !== "string" || !ownerName.length) {
    throw new Error(`registerRefs: ownerName is required`);
  }

  const { ops, qualities } = contribution;

  if (ops && typeof ops === "object") {
    for (const [actionName, entry] of Object.entries(ops)) {
      _registerOp(actionName, entry, ownerName);
    }
  }

  if (qualities && typeof qualities === "object") {
    for (const [namespace, entry] of Object.entries(qualities)) {
      _registerQualities(namespace, entry, ownerName);
    }
  }
}

function _registerOp(actionName, entry, ownerName) {
  if (!actionName || typeof actionName !== "string") {
    throw new Error(`registerRefs: ops.<actionName> must be a string (from "${ownerName}")`);
  }
  if (!entry || typeof entry !== "object") {
    throw new Error(
      `registerRefs: ops.${actionName} must be an object (from "${ownerName}")`,
    );
  }
  const params = entry.params || {};
  if (typeof params !== "object") {
    throw new Error(
      `registerRefs: ops.${actionName}.params must be an object (from "${ownerName}")`,
    );
  }

  const existing = _opRefs.get(actionName) || { params: {} };
  const existingOwner = _opOwners.get(actionName) || null;

  for (const [path, kind] of Object.entries(params)) {
    if (!VALID_KINDS.has(kind)) {
      throw new Error(
        `registerRefs: ops.${actionName}.params["${path}"]: invalid kind "${kind}" ` +
        `(must be one of ${[...VALID_KINDS].map(k => k === null ? "null" : `"${k}"`).join(", ")}) ` +
        `from "${ownerName}"`,
      );
    }
    if (path in existing.params && existing.params[path] !== kind) {
      throw new Error(
        `registerRefs: ops.${actionName}.params["${path}"] conflict — ` +
        `"${existingOwner}" registered kind "${existing.params[path]}", ` +
        `"${ownerName}" now claims kind "${kind}"`,
      );
    }
    existing.params[path] = kind;
  }

  _opRefs.set(actionName, existing);
  if (!existingOwner) _opOwners.set(actionName, ownerName);
}

function _registerQualities(namespace, entry, ownerName) {
  if (!namespace || typeof namespace !== "string") {
    throw new Error(
      `registerRefs: qualities.<namespace> must be a string (from "${ownerName}")`,
    );
  }
  if (!entry || typeof entry !== "object") {
    throw new Error(
      `registerRefs: qualities.${namespace} must be an object (from "${ownerName}")`,
    );
  }

  const existing = _qualitiesRefs.get(namespace) || {};
  const existingOwner = _qualitiesOwners.get(namespace) || null;

  for (const [path, kind] of Object.entries(entry)) {
    if (!VALID_KINDS.has(kind)) {
      throw new Error(
        `registerRefs: qualities.${namespace}["${path}"]: invalid kind "${kind}" ` +
        `(must be one of ${[...VALID_KINDS].map(k => k === null ? "null" : `"${k}"`).join(", ")}) ` +
        `from "${ownerName}"`,
      );
    }
    if (path in existing && existing[path] !== kind) {
      throw new Error(
        `registerRefs: qualities.${namespace}["${path}"] conflict — ` +
        `"${existingOwner}" registered kind "${existing[path]}", ` +
        `"${ownerName}" now claims kind "${kind}"`,
      );
    }
    existing[path] = kind;
  }

  _qualitiesRefs.set(namespace, existing);
  if (!existingOwner) _qualitiesOwners.set(namespace, ownerName);
}

// ─────────────────────────────────────────────────────────────────────
// Lookup APIs (for the graft layer and any other caller)
// ─────────────────────────────────────────────────────────────────────

/**
 * Get the refs entry for an action. Returns `{ params: { path: kind } }`
 * or null if the action has no registered refs.
 *
 * @param {string} actionName
 */
export function getOpRefs(actionName) {
  if (typeof actionName !== "string") return null;
  const entry = _opRefs.get(actionName);
  if (!entry) return null;
  // Return a deep-frozen shallow copy so callers can't mutate the registry.
  return Object.freeze({ params: Object.freeze({ ...entry.params }) });
}

/**
 * Get the refs entry for a qualities namespace. Returns `{ path: kind }`
 * or null if the namespace has no registered refs.
 *
 * @param {string} namespace
 */
export function getQualitiesRefs(namespace) {
  if (typeof namespace !== "string") return null;
  const entry = _qualitiesRefs.get(namespace);
  if (!entry) return null;
  return Object.freeze({ ...entry });
}

/**
 * Full snapshot of the registry. For debug, introspection, and the
 * SEE catalog at `.refs` (future).
 */
export function getAllRefs() {
  const ops = {};
  for (const [name, entry] of _opRefs) {
    ops[name] = { params: { ...entry.params }, owner: _opOwners.get(name) };
  }
  const qualities = {};
  for (const [ns, entry] of _qualitiesRefs) {
    qualities[ns] = { paths: { ...entry }, owner: _qualitiesOwners.get(ns) };
  }
  return { ops, qualities };
}

// ─────────────────────────────────────────────────────────────────────
// Wildcard path matching (for qualities paths)
// ─────────────────────────────────────────────────────────────────────

/**
 * Resolve a literal qualities-path against the namespace's registered
 * patterns. Returns the kind if matched, null otherwise.
 *
 * Patterns use `*` as a single-segment wildcard.
 *   pattern "<key>.beingId"  matches  "alice.beingId" → "being"
 *   pattern "*.beingId"      matches  "anyKey.beingId" → "being"
 *   pattern "history.*"      does NOT match "history.entry.beingId" (single-segment only)
 *
 * @param {string} namespace
 * @param {string} literalPath  e.g. "alice.beingId"
 * @returns {string|null}  the kind, or null if no pattern matches
 */
export function resolveQualitiesPath(namespace, literalPath) {
  const entry = _qualitiesRefs.get(namespace);
  if (!entry) return null;
  for (const [pattern, kind] of Object.entries(entry)) {
    if (_matchesPattern(pattern, literalPath)) return kind;
  }
  return null;
}

function _matchesPattern(pattern, literal) {
  const pParts = pattern.split(".");
  const lParts = literal.split(".");
  if (pParts.length !== lParts.length) return false;
  for (let i = 0; i < pParts.length; i++) {
    if (pParts[i] === "*") continue;
    if (pParts[i] !== lParts[i]) return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────
// Test-only: clear the registry for verify scripts that need a fresh state
// ─────────────────────────────────────────────────────────────────────

export function _resetRefsForTesting() {
  _opRefs.clear();
  _qualitiesRefs.clear();
  _opOwners.clear();
  _qualitiesOwners.clear();
}

log.verbose("Refs", "registry module loaded");
