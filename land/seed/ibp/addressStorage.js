// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Canonical IBP Address helpers for summon storage.
//
// An IBP Address is the protocol's stance-to-stance address grammar:
// `<stance> :: <stance>` where each stance is `<land>/<path>@<being>`.
// Summons are records of one stance addressing another, so the natural
// identifier for grouping summons — "every summon at this IBP Address" —
// is just the IBP Address itself in canonical sorted form.
//
// "Canonical sorted" means the two stances are sorted lexicographically
// so directional IBP Addresses A→B and B→A resolve to the same
// stored key. Storage form mirrors the protocol's format() output
// (joined with ` :: `).
//
// Path form: this module uses spaceId-rooted path form (`/<spaceId>`) so
// stored IBP Addresses survive node renames. Renaming a node would
// otherwise fork every historical IBP Address it appears in, which
// is exactly the kind of provenance break we want to avoid. The protocol
// parser separately handles the human-readable path form; both forms
// are valid expressions of the same address grammar.

import Being from "../models/being.js";
import log from "../system/log.js";

// Cached land domain. Derived from LAND_DOMAIN env (same source the
// ibp/ side uses). Lazily computed to survive boot order.
let cachedLandDomain = null;
export function getLandDomain() {
  if (cachedLandDomain) return cachedLandDomain;
  const raw = process.env.LAND_DOMAIN || "localhost";
  cachedLandDomain = raw
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .replace(/:\d+$/, "");
  return cachedLandDomain;
}

// ─────────────────────────────────────────────────────────────────────
// STANCE STRING
// ─────────────────────────────────────────────────────────────────────

/**
 * Compose a stance into its canonical storage string.
 *
 * Inputs are accepted in two shapes:
 *   - string         — pass-through (assumed already formatted)
 *   - { land?, spaceId, name }
 *
 * Output: `<land>/<spaceId>@<name>` (spaceId-rooted path form).
 * Returns null when spaceId or name is missing — incomplete stances
 * are not addressable as IBP Address halves.
 */
export function stanceString(input) {
  if (input == null) return null;
  if (typeof input === "string") return input.length > 0 ? input : null;
  const { land, spaceId, name } = input;
  if (!spaceId || !name) return null;
  const landPart = land || getLandDomain();
  return `${landPart}/${spaceId}@${name}`;
}

// ─────────────────────────────────────────────────────────────────────
// IBP ADDRESS CANONICAL FORM
// ─────────────────────────────────────────────────────────────────────

const SEPARATOR = " :: ";

/**
 * Canonical sorted IBP Address for a stance pair.
 *
 * Returns `<smaller> :: <larger>` where the two stances are sorted
 * lexicographically. A→B and B→A produce the same string — that's the
 * "canonical" property the storage key needs so both directions group
 * into one record.
 *
 * Returns null when either side is incomplete. Self-addressed (the
 * same stance twice) returns the single stance string — a being
 * talking to itself at the same position has a degenerate IBP
 * Address that's still valid.
 */
export function canonicalIbpAddress(stanceA, stanceB) {
  const a = stanceString(stanceA);
  const b = stanceString(stanceB);
  if (!a || !b) return null;
  if (a === b) return a;
  return a < b ? `${a}${SEPARATOR}${b}` : `${b}${SEPARATOR}${a}`;
}

/**
 * Split a canonical IBP Address back into its two stance strings.
 * Returns [a, b] (sorted, same order as in the stored form), or [s]
 * for self-addressed, or [] for invalid input.
 */
export function parseIbpAddress(ibpAddress) {
  if (typeof ibpAddress !== "string" || ibpAddress.length === 0) return [];
  return ibpAddress.split(SEPARATOR).filter(Boolean);
}

/**
 * Predicate: does this IBP Address include the given stance?
 * Exact stance-string match against either side.
 */
export function ibpAddressIncludes(ibpAddress, stance) {
  if (!ibpAddress) return false;
  const stanceStr = stanceString(stance);
  if (!stanceStr) return false;
  return parseIbpAddress(ibpAddress).includes(stanceStr);
}

// ─────────────────────────────────────────────────────────────────────
// RESOLVE A BEING TO THEIR CURRENT STANCE
// ─────────────────────────────────────────────────────────────────────
//
// Used by chat writers that have a beingId in hand and need to compose
// a stance for the IBP Address. The being's current position is
// looked up; for humans this is wherever they navigated to (cached at
// the conversation layer; persisted lookup may be added later), for
// AI beings it defaults to their homeSpace.

// Bounded LRU cache keyed by beingId. Name + homeSpace rarely
// change; renames are explicit so a stale cache is bounded in damage.
const STANCE_CACHE_MAX = 2048;
const stanceCache = new Map();

async function loadBeingFields(beingId) {
  if (!beingId) return null;
  const key = String(beingId);
  if (stanceCache.has(key)) {
    const v = stanceCache.get(key);
    stanceCache.delete(key);
    stanceCache.set(key, v);
    return v;
  }
  let row = null;
  try {
    row = await Being.findById(key).select("name homeSpace").lean();
  } catch {
    row = null;
  }
  if (!row) return null;
  const value = {
    name:       row.name,
    homeSpace: row.homeSpace || null,
  };
  if (stanceCache.size >= STANCE_CACHE_MAX) {
    const first = stanceCache.keys().next().value;
    stanceCache.delete(first);
  }
  stanceCache.set(key, value);
  return value;
}

/**
 * Invalidate a being's cached stance fields. Call after rename or
 * home change so the next chat write picks up the new values.
 */
export function invalidateStanceCache(beingId) {
  if (!beingId) return;
  stanceCache.delete(String(beingId));
}

/**
 * Resolve a being to a stance.
 *
 * The caller can pass an explicit `currentPosition` (most often the
 * asker's current navigated position from the conversation runtime).
 * If omitted, the being's `homeSpace` is used as fallback. The
 * name is always read from the Being record.
 *
 * Returns `{ land, spaceId, name }` ready to feed into stanceString
 * or canonicalIbpAddress. Returns null when the being cannot be
 * loaded or has no valid position to anchor at.
 */
export async function resolveStance(beingId, { currentPosition = null, land = null } = {}) {
  if (!beingId) return null;
  const fields = await loadBeingFields(beingId);
  if (!fields) return null;
  const spaceId = currentPosition || fields.homeSpace;
  if (!spaceId || !fields.name) return null;
  return {
    land:     land || getLandDomain(),
    spaceId:   String(spaceId),
    name: fields.name,
  };
}

/**
 * Compute the canonical IBP Address for a summon between two beings.
 *
 * Convenience over `resolveStance` + `canonicalIbpAddress` — most
 * writers want both steps as one call. Returns null when either side
 * cannot be resolved (caller should tolerate the null; legacy chats
 * and system tasks without a paired being have always been allowed
 * to skip the IBP Address.)
 */
export async function computeIbpAddressForSummon({
  askerBeingId,
  askerPosition = null,
  addresseeBeingId,
  addresseePosition = null,
  land = null,
}) {
  try {
    const askerStance = await resolveStance(askerBeingId, { currentPosition: askerPosition, land });
    const addresseeStance = await resolveStance(addresseeBeingId, { currentPosition: addresseePosition, land });
    return canonicalIbpAddress(askerStance, addresseeStance);
  } catch (err) {
    log.debug("IbpAddress",
      `computeIbpAddressForSummon failed (asker=${String(askerBeingId).slice(0, 8)}, addressee=${String(addresseeBeingId).slice(0, 8)}): ${err.message}`);
    return null;
  }
}
