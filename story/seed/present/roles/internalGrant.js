// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// internalGrant.js — emit a grant-role fact on the grantee's reel.
//
// Bypasses the grant-role op's "caller must have canDo grant-role:X"
// check — the role's own acquisition policy is the gate that already
// fired. The substrate writes the grant on I-Am's authority since
// the policy decision IS the substrate's authority.
//
// A pure grant-emit primitive: it carries NO .word and registers NO
// operation. The core SEE verb (auto-on-entry) and the acquisition
// word bundle both reach this shared module — SEE never imports a
// word bundle.

import { I_AM } from "../../materials/being/seedBeings.js";

export async function emitInternalGrant({
  granteeBeingId,
  role,
  anchorSpaceId,
  grantedBy,
  moment,
  history = null,
}) {
  const { emitFact } = await import("../../past/fact/facts.js");
  await emitFact({
    verb:    "do",
    act:     "grant-role",
    through: I_AM,
    of:      { kind: "being", id: String(granteeBeingId) },
    params:  {
      role,
      anchorSpaceId: anchorSpaceId ? String(anchorSpaceId) : null,
      anchorBeingId: null,
      grantedBy:     grantedBy ? String(grantedBy) : I_AM,
      grantedAt:     new Date().toISOString(),
    },
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
