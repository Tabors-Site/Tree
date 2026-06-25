// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// resetReels.js . the registry of state that cannot be reconciled
// during merge and is reset instead.
//
// Some reels are history-private by nature. The classic example is
// inhabit-state: "who is connected to this being right now." If
// history A says tabor inhabits Alice and history B says tabor inhabits
// Bob, there is no sensible combined state . tabor can only be
// driving one being at a time. The merged history starts these reels
// reset; the original histories' choices stay in their own chains.
//
// V1 registry: ONE rule.
//   - inhabit-state on Being . emit be:release for every being that
//     had any inhabitant on the common ancestor (since the merged
//     history inherits the ancestor's state through reel-lineage).
//
// Future rules go alongside: scheduled timers that don't make sense
// across worlds, transient cognition state, etc. Each rule produces
// fact specs the merge-branches op stamps on the merged history.

import { listByType, loadOrFold } from "../projections.js";

/**
 * Compute the reset fact specs for a freshly-created merged history.
 * Returns an array of fact-spec objects ready for emitFact /
 * sealFacts. Each spec carries the `_merge` metadata for forensic
 * audit.
 *
 * The caller (merge-branches op handler) stamps these inside the
 * merge moment so they ride the same atomic seal as the branch
 * creation fact.
 *
 * @param {object} args
 * @param {string} args.mergedHistory  the new history's path
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
// Read the being snapshots on the ancestor's history from the file
// store and select those with a non-null inhabitedBy under
// qualities.connection. For each, emit a be:release on the merged
// history so the connection-tracking reducer clears the inhabitedBy
// projection in the merged world.
//
// projections.listByType gives the live beings on the ancestor history
// (tombstoned excluded, lineage-aware); loadOrFold reads each folded slot.
// The inhabitedBy field lives at state.qualities.connection.inhabitedBy
// — the same shape the Mongo projection doc held.
// ─────────────────────────────────────────────────────────────────────
async function _inhabitResetFacts({ mergedHistory, ancestor, actorBeingId }) {
  const beings = await listByType("being", ancestor);

  const facts = [];
  for (const occ of beings) {
    const id = occ.id;
    const slot = await loadOrFold("being", id, ancestor);
    if (!slot || slot.tombstoned) continue;
    const inhabitedBy = slot.state?.qualities?.connection?.inhabitedBy;
    if (inhabitedBy == null) continue;
    const beingId = String(id);
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
