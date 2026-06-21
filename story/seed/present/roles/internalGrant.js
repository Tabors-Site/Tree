// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// internalGrant.js — BUILD (and, for the one non-dispatcher caller, EMIT)
// a grant-role record for the grantee's reel.
//
// Bypasses the grant-role op's "caller must have canDo grant-role:X"
// check — the role's own acquisition policy is the gate that already
// fired. The grant attributes to the taker/asker (grantedBy = caller)
// since the policy decision IS the substrate's authority.
//
// TWO surfaces, one record shape:
//   buildInternalGrant  — the NON-emitting builder. Returns the grant
//                          RECORD (the SAME {role, anchorSpaceId,
//                          anchorBeingId, grantedBy, grantedAt} the
//                          reducer folds), with grantedAt at the
//                          wall-clock floor (the grant-stamp instant,
//                          reached like grant-role's grant-stamp). The
//                          acquisition `.word`s `see` this (no fact);
//                          the dispatcher's ONE auto-Fact lays the
//                          caller-attributed do:grant-role.
//   emitInternalGrant   — a THIN emitting wrapper over the builder, for
//                          the ONE caller that has no dispatcher to lay
//                          its fact: the core SEE verb's auto-on-entry
//                          hook (see.js), which self-emits the silent
//                          grant when a commons admits a visitor. SEE
//                          never imports a word bundle, so this shared
//                          module keeps the emit path for it.
//
// A pure grant primitive: it carries NO .word and registers NO operation.

import { I_AM } from "../../materials/being/seedBeings.js";

// Build the grant record (no fact). grantedAt at the wall-clock floor when
// the caller doesn't pin one (the story has no clock of its own; the instant
// rides here, never the eval loop — same shape as grant-role's grant-stamp).
export function buildInternalGrant({
  granteeBeingId,
  role,
  anchorSpaceId,
  anchorBeingId = null,
  grantedBy,
  grantedAt = null,
}) {
  return {
    granteeBeingId: String(granteeBeingId),
    grant: {
      role,
      anchorSpaceId: anchorSpaceId ? String(anchorSpaceId) : null,
      anchorBeingId: anchorBeingId ? String(anchorBeingId) : null,
      grantedBy:     grantedBy ? String(grantedBy) : I_AM,
      grantedAt:     grantedAt || new Date().toISOString(),
    },
  };
}

export async function emitInternalGrant({
  granteeBeingId,
  role,
  anchorSpaceId,
  grantedBy,
  moment,
  history = null,
}) {
  const { grant } = buildInternalGrant({
    granteeBeingId,
    role,
    anchorSpaceId,
    grantedBy,
  });
  const { emitFact } = await import("../../past/fact/facts.js");
  await emitFact({
    verb:    "do",
    act:     "grant-role",
    through: I_AM,
    of:      { kind: "being", id: String(granteeBeingId) },
    params:  grant,
    // The world this acquisition happened in. Callers pass it
    // explicitly (the op's moment history, the SEE's history for
    // auto-on-entry). The actorAct fallback covers in-moment ops; SEE
    // has no moment, and its old fallback stamped every history-side
    // auto-grant onto main — invisible on the history where the
    // commons lives (the fork predates the grant), and a
    // foreign-world write onto main's reel.
    history: history || moment?.actorAct?.history || "0",
    actId:  moment?.actId || null,
  }, moment);
}
