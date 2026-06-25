// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// internalGrant.js — BUILD a grant-able record for the grantee's reel.
//
// Bypasses the grant-able op's "caller must have canDo grant-able:X" check — the able's own
// acquisition policy is the gate that already fired. The grant attributes to the taker/asker
// (grantedBy = caller) since the policy decision IS the substrate's authority.
//
//   buildInternalGrant — the NON-emitting builder. Returns the grant RECORD (the SAME
//                        {able, anchorSpaceId, anchorBeingId, grantedBy} the reducer folds).
//                        The acquisition `.word`s `see` this (no fact); the dispatcher's ONE
//                        auto-Fact lays the caller-attributed do:grant-able. No grantedAt: a
//                        grant's WHEN is its place in the chain (the fact's seq), never a clock.
//
// A pure grant primitive: it carries NO .word and registers NO operation.

import { I } from "../../materials/being/seedBeings.js";

// Build the grant record (no fact). No timestamp: the grant's when is the chain position of
// the do:grant-able fact the dispatcher lays, ordered by seq/lineage (the time-purge removed
// the wall-clock from grant ordering entirely).
export function buildInternalGrant({
  granteeBeingId,
  able,
  anchorSpaceId,
  anchorBeingId = null,
  grantedBy,
}) {
  return {
    granteeBeingId: String(granteeBeingId),
    grant: {
      able,
      anchorSpaceId: anchorSpaceId ? String(anchorSpaceId) : null,
      anchorBeingId: anchorBeingId ? String(anchorBeingId) : null,
      grantedBy: grantedBy ? String(grantedBy) : I,
    },
  };
}
