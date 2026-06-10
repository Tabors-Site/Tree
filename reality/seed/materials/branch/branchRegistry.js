// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Branch registry. Per-reality map of named pointers to canonical
// branch paths. The IBP address parser uses this to resolve labels
// like `#main` to canonical paths like `#7`.
//
// Storage: heaven. Pointers live on the `.branches` heaven space's
// `qualities.pointers` map. The `.branches` space is in heaven
// ("heaven never branches" doctrine), so the storage has one
// projection per reality regardless of which branch is querying.
// Pointer mutations land as set-space facts on the `.branches`
// space's reel.
//
// Reads. Pointer resolution reads the `.branches` space's projection
// on MAIN (the only branch heaven spaces live on). The substrate's
// heaven routing also auto-rewrites any branched callers to MAIN,
// but this module reads from MAIN explicitly to stay independent
// of the routing layer.
//
// V1 default pointers. `main` is always present, pointing at `"0"`
// (the canonical canopy). Operators can re-point it after merges;
// they cannot delete it. Other names (`prod`, `release-v2`, etc.)
// can be added freely.

import { findHeavenSpace, loadHeavenProjection } from "../projections.js";
import { HEAVEN_SPACE } from "../space/heavenSpaces.js";
import { MAIN } from "./branches.js";

export const RESERVED_POINTERS = Object.freeze(["main"]);

// Pointer name grammar:
//   . Must start with a lowercase letter (never a digit . canonical
//     paths start with digits; the parser disambiguates structurally).
//   . Middle characters: lowercase letters, digits, single hyphens.
//   . Must end with a lowercase letter or digit (no trailing hyphen,
//     no `m-` shapes).
//   . No consecutive hyphens (no `m--ain`).
//   . Length: 1..64 characters.
//
// Examples that pass: `m`, `main`, `prod`, `release-v2`, `feature-x`,
//                     `feature-x-y-z`, `alpha2`, `beta-3`.
// Examples that fail: `1main` (digit start), `feature-` (trailing -),
//                     `m--ain` (consecutive -), `-main` (leading -),
//                     `Main` (uppercase), `feat ure` (whitespace),
//                     anything over 64 chars.
//
// The regex requires every hyphen to be followed by an alphanumeric,
// which automatically excludes trailing hyphens and consecutive
// hyphens. Combined with the length check, the grammar is tight.
export const POINTER_NAME_RE = /^[a-z](?:[a-z0-9]|-[a-z0-9])*$/;
export const POINTER_NAME_MAX_LENGTH = 64;

/**
 * True when the input matches the named-pointer grammar. Used by the
 * IBP address parser to distinguish pointer references from canonical
 * paths, and by every pointer-writing op to gate its `name` arg.
 */
export function isPointerName(s) {
  return typeof s === "string"
    && s.length >= 1
    && s.length <= POINTER_NAME_MAX_LENGTH
    && POINTER_NAME_RE.test(s);
}

/**
 * Throw an IbpError-shaped Error when the name fails validation. The
 * error message names the specific rule that failed for clarity in
 * the dialog / CLI. Returns the name unchanged on success.
 */
export function assertPointerName(name, opName = "pointer") {
  if (typeof name !== "string") {
    throw new Error(`${opName}: name must be a string; got ${typeof name}`);
  }
  if (name.length === 0) {
    throw new Error(`${opName}: name cannot be empty`);
  }
  if (name.length > POINTER_NAME_MAX_LENGTH) {
    throw new Error(`${opName}: name "${name.slice(0, 16)}..." exceeds max length (${POINTER_NAME_MAX_LENGTH})`);
  }
  if (!POINTER_NAME_RE.test(name)) {
    throw new Error(
      `${opName}: name "${name}" is invalid. ` +
      `Must start with a lowercase letter, end with a letter or digit, ` +
      `and contain only lowercase letters, digits, and single hyphens ` +
      `(no consecutive or trailing hyphens). Max ${POINTER_NAME_MAX_LENGTH} chars.`
    );
  }
  return name;
}

/**
 * Resolve a pointer name to its canonical branch path. Returns the
 * canonical path or null when the pointer doesn't exist.
 *
 * Read-only; safe to call from the parser's resolveBranchPointers
 * step. Throws only on infrastructure failures (DB unreachable).
 */
export async function resolvePointer(name) {
  if (!isPointerName(name)) return null;
  const map = await _readPointerMap();
  const target = map[name];
  return typeof target === "string" && target.length > 0 ? target : null;
}

/**
 * Read the full pointer map from the `.branches` heaven space.
 * Returns `{ main: "0" }` when the space isn't planted yet.
 */
export async function readPointers() {
  return await _readPointerMap();
}

/**
 * The default branch for wire calls that omit a `#branch` segment.
 * Resolves the `#main` pointer through the registry — operators may
 * have re-pointed `main` away from canonical "0" via set-pointer.
 * Falls back to "0" only when the pointer registry is uninitialized
 * (pre-bootstrap). Never hardcode "0" at call sites; route through
 * here so operator overrides take effect everywhere uniformly.
 */
export async function getDefaultBranch() {
  const target = await resolvePointer("main");
  return target || "0";
}

/**
 * Reverse lookup: given a canonical branch path, return every pointer
 * name currently resolving to it. Used by the merge dialog to surface
 * "this source branch had #feature-x attached . want to keep it?"
 *
 * @param {string} canonicalPath
 * @returns {Promise<string[]>}
 */
export async function pointersFor(canonicalPath) {
  if (typeof canonicalPath !== "string" || !canonicalPath.length) return [];
  const map = await _readPointerMap();
  return Object.keys(map).filter(name => map[name] === canonicalPath).sort();
}

/**
 * Return the `.branches` heaven space's id, or null if heaven isn't
 * planted yet. Used by the merge-branches op and the pointer DO ops
 * to address writes at the storage location.
 */
export async function findPointersSpaceId() {
  const slot = await findHeavenSpace(HEAVEN_SPACE.BRANCHES);
  return slot?.id ? String(slot.id) : null;
}

async function _readPointerMap() {
  try {
    const slot = await findHeavenSpace(HEAVEN_SPACE.BRANCHES);
    if (!slot?.id) {
      return { main: MAIN };
    }
    const proj = await loadHeavenProjection("space", String(slot.id));
    const quals = proj?.state?.qualities;
    const ptrs = quals instanceof Map
      ? quals.get("pointers")
      : quals?.pointers;
    if (!ptrs || typeof ptrs !== "object") {
      return { main: MAIN };
    }
    // Ensure main is always present. Defensive default in case the
    // map is somehow missing it.
    if (typeof ptrs.main !== "string" || !ptrs.main.length) {
      ptrs.main = MAIN;
    }
    return ptrs;
  } catch {
    return { main: MAIN };
  }
}
