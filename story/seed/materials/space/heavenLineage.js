// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Heaven lineage classifier.
//
// "Heaven never branches" (FACTORY.md). A space is in heaven if it
// IS `.` (the HEAVEN heaven space) or its parent chain reaches `.`.
// The Tier-3 heaven spaces (`.beings`, `.spaces`, `.matters`,
// `.config`, `.histories`, `.ables`, `.tools`, `.operations`) sit
// directly under `.`; their child spaces are heaven too because
// their lineage walks through `.`.
//
// Domain spaces under the story root are NOT heaven. The
// distinction is structural, not stored: no schema field needed.
//
// The substrate's projection layer consults this to route heaven
// reads / writes to history="0" regardless of caller's history.

import { findByHeavenSpace } from "../projections.js";
import { HEAVEN_SPACE } from "./heavenSpaces.js";
import { getAncestorChain } from "./ancestorCache.js";

const MAIN = "0";

// Cache the HEAVEN heaven space's id for the process lifetime. The
// HEAVEN space is planted once at genesis and its id never changes;
// caching avoids hitting the projections collection on every
// heaven-classification call (and there will be many).
let _heavenIdCache = null;

/**
 * Look up the HEAVEN heaven space's id on MAIN. Cached for the process
 * lifetime. Returns null if heaven hasn't been planted yet
 * (pre-bootstrap), in which case isHeavenSpace conservatively
 * returns false for all callers.
 */
export async function findHeavenRootId() {
  if (_heavenIdCache) return _heavenIdCache;
  try {
    const slot = await findByHeavenSpace(HEAVEN_SPACE.HEAVEN, MAIN);
    if (slot?.id) {
      _heavenIdCache = String(slot.id);
      return _heavenIdCache;
    }
  } catch {
    // Heaven not planted yet; caller treats as not-heaven.
  }
  return null;
}

/**
 * True when this space is in heaven. A space is in heaven when:
 *   . it IS `.` (the HEAVEN heaven space)
 *   . OR `.` appears in its ancestor chain on MAIN
 *
 * Walks the ancestor cache at MAIN. History-agnostic by design:
 * heaven membership is story-level structure, not per-history state.
 *
 * Returns false for unknown spaces (defensive default).
 *
 * @param {string} spaceId
 * @returns {Promise<boolean>}
 */
export async function isHeavenSpace(spaceId) {
  if (!spaceId) return false;
  const id = String(spaceId);
  const heavenId = await findHeavenRootId();
  if (!heavenId) return false;
  if (id === heavenId) return true;
  try {
    const chain = await getAncestorChain(id, MAIN);
    if (!Array.isArray(chain)) return false;
    return chain.some(node => String(node._id || node.id) === heavenId);
  } catch {
    return false;
  }
}

/**
 * Test-only. Forces the cache to refresh on next call. Used by the
 * verify scripts that mint and tear down realities.
 */
export function _resetHeavenCache() {
  _heavenIdCache = null;
}

/**
 * True when `beingId` has story-wide authority via heaven.
 *
 * Heaven is the I-Am's room. Heaven authority is granted in two
 * shapes:
 *
 *   - `owner` of heaven — the bootstrap-axiom ownership field. I_AM
 *     owns heaven; rare other owners exist by transfer.
 *   - `ablesGranted` entry of `{able: "angel", anchorSpaceId: <heavenId>}`
 *     on the being — the delegated authority under AblesAreAuth.
 *     Seed delegates and humans anointed by cherub.birth carry this.
 *
 * I_AM short-circuits true (universal authority on its own story —
 * same doctrine as authorize.js's I_AM bypass).
 *
 * Returns true if EITHER check matches.
 */
export async function hasHeavenAuthority(beingId) {
  if (!beingId) return false;
  const { I_AM } = await import("../being/seedBeings.js");
  if (String(beingId) === String(I_AM)) return true;

  const heavenId = await findHeavenRootId();
  if (!heavenId) return false;
  const { loadProjection } = await import("../projections.js");
  const heaven = await loadProjection("space", heavenId, "0");
  if (!heaven) return false;

  // Owner check — the bootstrap-axiom ownership class.
  const { getSpaceOwner } = await import("./members.js");
  const heavenState = heaven.state || {};
  if (String(getSpaceOwner(heavenState) || "") === String(beingId)) return true;

  // Able-grant check — angel able anchored at heaven (the AblesAreAuth
  // delegated-authority path). Walks the being's ablesGranted for a
  // matching entry. Cherub.birth grants this to the first human; the
  // I_AM grants it to every seed delegate at genesis.
  const beingSlot = await loadProjection("being", String(beingId), "0");
  const grants = beingSlot?.state?.qualities?.ablesGranted;
  if (Array.isArray(grants)) {
    for (const g of grants) {
      if (g?.able === "angel" && String(g?.anchorSpaceId) === String(heavenId)) {
        return true;
      }
    }
  }

  return false;
}

