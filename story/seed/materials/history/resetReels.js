// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// resetReels.js . the registry of state that cannot be reconciled
// during merge and is reset instead.
//
// Some reels are branch-private by nature. The classic example is
// inhabit-state: "who is connected to this being right now." If
// branch A says tabor inhabits Alice and branch B says tabor inhabits
// Bob, there is no sensible combined state . tabor can only be
// driving one being at a time. The merged branch starts these reels
// reset; the original branches' choices stay in their own chains.
//
// V1 registry: ONE rule.
//   - inhabit-state on Being . emit be:release for every being that
//     had any inhabitant on the common ancestor (since the merged
//     branch inherits the ancestor's state through reel-lineage).
//
// Future rules go alongside: scheduled timers that don't make sense
// across worlds, transient cognition state, etc. Each rule produces
// fact specs the merge-branches op stamps on the merged branch.

import mongoose from "mongoose";

/**
 * Compute the reset fact specs for a freshly-created merged branch.
 * Returns an array of fact-spec objects ready for emitFact /
 * sealFacts. Each spec carries the `_merge` metadata for forensic
 * audit.
 *
 * The caller (merge-branches op handler) stamps these inside the
 * merge moment so they ride the same atomic seal as the branch
 * creation fact.
 *
 * @param {object} args
 * @param {string} args.mergedHistory  the new branch's path
 * @param {string} args.ancestor      the common ancestor's path
 * @param {string} args.actorBeingId  who is performing the merge
 * @returns {Promise<Array<object>>}  fact specs (verb, action, target, ...)
 */
export async function computeMergeResetFacts({ mergedHistory, ancestor, actorBeingId }) {
  if (typeof mergedHistory !== "string" || !mergedHistory.length) {
    throw new Error("computeMergeResetFacts: mergedHistory required");
  }
  if (typeof ancestor !== "string" || !ancestor.length) {
    throw new Error("computeMergeResetFacts: ancestor required");
  }
  if (!actorBeingId) {
    throw new Error("computeMergeResetFacts: actorBeingId required");
  }

  // V1: just the inhabit-state reset.
  return await _inhabitResetFacts({ mergedHistory, ancestor, actorBeingId });
}

// ─────────────────────────────────────────────────────────────────────
// Rule 1: inhabit-state reset.
//
// Query the projections collection for being rows on the ancestor's
// branch that have a non-null inhabitedBy under qualities.connection.
// For each, emit a be:release on the merged branch so the connection-
// tracking reducer clears the inhabitedBy projection in the merged
// world.
//
// The query uses the unified projections collection (`projections`)
// keyed by `${branch}:${type}:${id}`. We filter by branch=ancestor +
// the inhabitedBy field path under state.qualities.
// ─────────────────────────────────────────────────────────────────────
async function _inhabitResetFacts({ mergedHistory, ancestor, actorBeingId }) {
  const Projection = mongoose.connection.collection("projections");
  const rows = await Projection.find({
    type: "being",
    history: ancestor,
    "state.qualities.connection.inhabitedBy": { $ne: null, $exists: true },
  }).project({ id: 1, "state.qualities.connection.inhabitedBy": 1 }).toArray();

  const facts = [];
  for (const row of rows) {
    const beingId = String(row.id);
    facts.push({
      verb:    "be",
      act:     "release",
      through: String(actorBeingId),
      history:  mergedHistory,
      of:      { kind: "being", id: beingId },
      params:  {
        inhabitedBy: null,
        _merge: {
          strategy:    "reset",
          rule:        "inhabit-state",
          sourceHistory: ancestor,
          note:        "history-private reel reset on merge",
        },
      },
    });
  }
  return facts;
}
