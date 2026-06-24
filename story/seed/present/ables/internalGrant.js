// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// internalGrant.js — BUILD a grant-able record for the grantee's reel.
//
// Bypasses the grant-able op's "caller must have canDo grant-able:X" check — the able's own
// acquisition policy is the gate that already fired. The grant attributes to the taker/asker
// (grantedBy = caller) since the policy decision IS the substrate's authority.
//
//   buildInternalGrant — the NON-emitting builder. Returns the grant RECORD (the SAME
//                        {able, anchorSpaceId, anchorBeingId, grantedBy, grantedAt} the reducer
//                        folds), grantedAt at the wall-clock floor. The acquisition `.word`s `see`
//                        this (no fact); the dispatcher's ONE auto-Fact lays the caller-attributed
//                        do:grant-able.
//
// A pure grant primitive: it carries NO .word and registers NO operation.

import { I } from "../../materials/being/seedBeings.js";

// Build the grant record (no fact). grantedAt at the wall-clock floor when
// the caller doesn't pin one (the story has no clock of its own; the instant
// rides here, never the eval loop — same shape as grant-able's grant-stamp).
export function buildInternalGrant({
  granteeBeingId,
  able,
  anchorSpaceId,
  anchorBeingId = null,
  grantedBy,
  grantedAt = null,
}) {
  return {
    granteeBeingId: String(granteeBeingId),
    grant: {
      able,
      anchorSpaceId: anchorSpaceId ? String(anchorSpaceId) : null,
      anchorBeingId: anchorBeingId ? String(anchorBeingId) : null,
      grantedBy: grantedBy ? String(grantedBy) : I,
      grantedAt: grantedAt || new Date().toISOString(),
    },
  };
}
