// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The canonical name of the lane two beings share. When two
// beings exchange moments back and forth, every one of those
// moments belongs to the same presence lane. The natural
// identifier for the lane is the IBP Address itself in canonical
// sorted form: `<smaller-stance> :: <larger>`. Sorting makes A→B
// and B→A resolve to the same key, so both directions group into
// one lane on the reel.
//
// Path form. I store the spaceId-rooted form (`<place>/<spaceId>
// @<name>`) so a saved lane name survives space renames. The
// address grammar's display form (human-readable names) is a
// separate expression of the same grammar — see
// seed/ibp/address.js.
//
// Why I live in cognition. Only cognition needs to name the lane:
// stamped stamps the canonical string onto every Summon
// row, and runTurn uses it as the presenceKey to find the carry
// between moments. This composition is moment-machinery, not
// protocol surface.

import Being from "../models/being.js";
import log from "../system/log.js";
import { getPlaceDomain } from "../ibp/address.js";

// ─────────────────────────────────────────────────────────────────────
// STANCE STRING
// ─────────────────────────────────────────────────────────────────────

const SEPARATOR = " :: ";

/**
 * Compose a stance into its canonical storage string.
 *
 * Inputs are accepted in two shapes:
 *   - string         — pass-through (assumed already formatted)
 *   - { place?, spaceId, name }
 *
 * Output: `<place>/<spaceId>@<name>` (spaceId-rooted path form).
 * Returns null when spaceId or name is missing — incomplete stances
 * are not addressable as IBP Address halves.
 */
function stanceString(input) {
  if (input == null) return null;
  if (typeof input === "string") return input.length > 0 ? input : null;
  const { place, spaceId, name } = input;
  if (!spaceId || !name) return null;
  const placePart = place || getPlaceDomain();
  return `${placePart}/${spaceId}@${name}`;
}

/**
 * Canonical sorted IBP Address for a stance pair.
 *
 * Returns `<smaller> :: <larger>` where the two stances are sorted
 * lexicographically. A→B and B→A produce the same string. Self-
 * addressed (the same stance twice) returns the single stance string
 * — a being talking to itself at the same position has a degenerate
 * IBP Address that's still valid.
 */
function canonicalIbpAddress(stanceA, stanceB) {
  const a = stanceString(stanceA);
  const b = stanceString(stanceB);
  if (!a || !b) return null;
  if (a === b) return a;
  return a < b ? `${a}${SEPARATOR}${b}` : `${b}${SEPARATOR}${a}`;
}

// ─────────────────────────────────────────────────────────────────────
// BEING → STANCE
// ─────────────────────────────────────────────────────────────────────
//
// Used by summon writers that have a beingId in hand and need to
// compose a stance for the IBP Address. The being's current position
// comes from the caller (most often the asker's navigated position);
// when omitted, the being's homeSpace is used as fallback. The name
// is always read from the Being record.
//
// Bounded LRU cache keyed by beingId. Name + homeSpace rarely change;
// renames are explicit so a stale cache is bounded in damage.

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
    name: row.name,
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
 * home change so the next summon write picks up the new values.
 */
export function invalidateStanceCache(beingId) {
  if (!beingId) return;
  stanceCache.delete(String(beingId));
}

/**
 * Compose a stance descriptor for a being. Returns `{ place, spaceId,
 * name }` ready to feed into stanceString or canonicalIbpAddress.
 * Returns null when the being cannot be loaded or has no valid
 * position to anchor at.
 *
 * Renamed from `resolveStance` to clear the name collision with
 * `resolveStance(stance, opts)` in seed/ibp/resolver.js — different
 * function, totally different signature.
 */
async function composeStanceForBeing(beingId, { currentPosition = null, place = null } = {}) {
  if (!beingId) return null;
  const fields = await loadBeingFields(beingId);
  if (!fields) return null;
  const spaceId = currentPosition || fields.homeSpace;
  if (!spaceId || !fields.name) return null;
  return {
    place: place || getPlaceDomain(),
    spaceId: String(spaceId),
    name: fields.name,
  };
}

/**
 * Compute the canonical IBP Address for a summon between two beings.
 * Returns null when either side cannot be resolved.
 */
export async function computeIbpAddressForSummon({
  askerBeingId,
  askerPosition = null,
  addresseeBeingId,
  addresseePosition = null,
  place = null,
}) {
  try {
    const askerStance = await composeStanceForBeing(askerBeingId, {
      currentPosition: askerPosition,
      place,
    });
    const addresseeStance = await composeStanceForBeing(addresseeBeingId, {
      currentPosition: addresseePosition,
      place,
    });
    return canonicalIbpAddress(askerStance, addresseeStance);
  } catch (err) {
    log.debug(
      "SummonAddress",
      `computeIbpAddressForSummon failed (asker=${String(askerBeingId).slice(0, 8)}, addressee=${String(addresseeBeingId).slice(0, 8)}): ${err.message}`,
    );
    return null;
  }
}
