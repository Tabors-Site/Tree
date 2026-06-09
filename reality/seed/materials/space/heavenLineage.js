// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Heaven lineage classifier.
//
// "Heaven never branches" (FACTORY.md). A space is in heaven if it
// IS `.` (the HEAVEN heaven space) or its parent chain reaches `.`.
// The Tier-3 heaven spaces (`.beings`, `.spaces`, `.matters`,
// `.config`, `.branches`, `.roles`, `.tools`, `.operations`) sit
// directly under `.`; their child spaces are heaven too because
// their lineage walks through `.`.
//
// Domain spaces under the reality root are NOT heaven. The
// distinction is structural, not stored: no schema field needed.
//
// The substrate's projection layer consults this to route heaven
// reads / writes to branch="0" regardless of caller's branch.

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
 * Walks the ancestor cache at MAIN. Branch-agnostic by design:
 * heaven membership is reality-level structure, not branched state.
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
 * True when `beingId` has reality-wide authority via heaven.
 *
 * Heaven is the I-Am's room. The `angel` membership class is heaven's
 * authority roster — every operator added by cherub.birth or by an
 * existing angel through add-member at heaven is anointed there.
 * Angels can mutate the heaven Tier-3 spaces (.config, .roles, .tools)
 * and act on reality-wide write ops (capture-seed, close-reality,
 * set-reality-llm).
 *
 * The test: `beingId` IS the I-Am, OR appears in heaven's owner
 * class, OR appears in heaven's angel class. One roster, named
 * explicitly (angel), no parallel state.
 *
 * I_AM short-circuits true (universal authority on its own reality —
 * same doctrine as authorize.js's I_AM bypass).
 *
 * The name `isHeavenContributor` is kept because callers across the
 * codebase already use it; semantically it answers "has heaven
 * authority," which is now the angel class plus the owner.
 */
export async function isHeavenContributor(beingId) {
  if (!beingId) return false;
  const { I_AM } = await import("../being/seedBeings.js");
  if (String(beingId) === String(I_AM)) return true;

  const heavenId = await findHeavenRootId();
  if (!heavenId) return false;
  const { loadProjection } = await import("../projections.js");
  const heaven = await loadProjection("space", heavenId, "0");
  if (!heaven) return false;

  const { spaceHasMember } = await import("./members.js");
  const heavenState = heaven.state || {};
  if (spaceHasMember(heavenState, "owner", beingId)) return true;
  if (spaceHasMember(heavenState, "angel", beingId)) return true;
  if (spaceHasMember(heavenState, "contributor", beingId)) return true;
  return false;
}
