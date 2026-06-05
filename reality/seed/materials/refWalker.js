// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Ref walker . the deep-traversal helpers that find and remap typed
// Refs anywhere they appear in substrate data.
//
// Replicate (export current state with placeholder Refs) calls
// findRefs to discover what aggregates are referenced. Graft (apply
// content to a target) calls remapRefs to substitute placeholder
// Refs with new local Refs via the remap table.
//
// Both operations are deep: they descend through plain objects,
// arrays, and Maps. Primitives and null pass through unchanged.
// Refs are detected by the structural predicate (isRef from ref.js)
// and treated as leaves . the walker does not descend INTO a Ref.
//
// See seed/REFS.md for the doctrine.

import { isRef } from "./ref.js";

// ─────────────────────────────────────────────────────────────────────
// findRefs . collect every Ref in the input (deep)
// ─────────────────────────────────────────────────────────────────────

/**
 * Walk `value` recursively and return every Ref found. Refs are
 * treated as leaves; the walker does not descend into a Ref's own
 * fields. Order is depth-first; duplicates (the same Ref shape
 * appearing multiple times) are included multiple times. Callers
 * that want uniqueness can dedupe by (`__ref`, `id`) tuple.
 *
 * Handles: plain objects, arrays, Maps, nested combinations.
 * Ignores: primitives, null, undefined, Refs' internals.
 *
 * @param {*} value
 * @returns {Array<object>} list of Ref objects
 */
export function findRefs(value) {
  const out = [];
  _walk(value, (ref) => { out.push(ref); });
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// remapRefs . substitute every Ref via a callback (deep, structure
// preserved)
// ─────────────────────────────────────────────────────────────────────

/**
 * Walk `value` recursively and return a structurally-equivalent
 * value with every Ref substituted by `mapper(ref)`. Plain objects,
 * arrays, and Maps are reconstructed; primitives and null pass
 * through; Refs are passed to the mapper and replaced.
 *
 * The mapper may return any value (another Ref, a different Ref, or
 * something else). Non-Ref return values land as-is in the output.
 *
 * Original input is NOT mutated. Use this both in graft (substitute
 * placeholder Refs with local Refs from the remap table) and in
 * replicate (substitute local Refs with placeholders).
 *
 * @param {*} value
 * @param {(ref: object) => *} mapper
 * @returns {*} structurally-equivalent value with Refs remapped
 */
export function remapRefs(value, mapper) {
  if (typeof mapper !== "function") {
    throw new Error("remapRefs: mapper must be a function");
  }
  return _rewrite(value, mapper);
}

// ─────────────────────────────────────────────────────────────────────
// Internal walkers
// ─────────────────────────────────────────────────────────────────────

function _walk(value, onRef) {
  if (value == null) return;
  if (isRef(value)) {
    onRef(value);
    return;  // Refs are leaves
  }
  if (Array.isArray(value)) {
    for (const item of value) _walk(item, onRef);
    return;
  }
  if (value instanceof Map) {
    for (const v of value.values()) _walk(v, onRef);
    return;
  }
  if (typeof value === "object") {
    // Plain object . iterate own enumerable keys
    for (const k of Object.keys(value)) _walk(value[k], onRef);
    return;
  }
  // primitive (string/number/boolean) . nothing to do
}

function _rewrite(value, mapper) {
  if (value == null) return value;
  if (isRef(value)) {
    return mapper(value);
  }
  if (Array.isArray(value)) {
    return value.map(v => _rewrite(v, mapper));
  }
  if (value instanceof Map) {
    const next = new Map();
    for (const [k, v] of value) next.set(k, _rewrite(v, mapper));
    return next;
  }
  if (typeof value === "object") {
    const next = {};
    for (const k of Object.keys(value)) next[k] = _rewrite(value[k], mapper);
    return next;
  }
  return value;
}

// ─────────────────────────────────────────────────────────────────────
// Higher-level helpers built on the walker
// ─────────────────────────────────────────────────────────────────────

/**
 * Convenience: unique aggregate Ref ids found in `value`, grouped by
 * kind. Sentinels are filtered out. Useful for building the remap
 * table during graft: the keys of the returned map are exactly the
 * placeholder ids needing local-id assignment.
 *
 * Returns:
 *   { being: Set<id>, space: Set<id>, matter: Set<id> }
 */
export function collectUniqueAggregateIds(value) {
  const out = { being: new Set(), space: new Set(), matter: new Set() };
  for (const r of findRefs(value)) {
    if (r.id && out[r.__ref]) {
      out[r.__ref].add(r.id);
    }
  }
  return out;
}
