// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// foldBeat.js . beat two. The fold mounts the face.
//
// moment.js orchestrates the four beats; foldBeat is just beat 2.
// assign minted actId and planned the Act; fold mounts the face
// (this file); momentum applies the being's motion; stamped seals.
//
// Per philosophy/names/innerFace.md: the fold beat computes the inner
// face exactly once per moment. The three souls (LLM, scripted, human)
// all consume the same face via moment.innerFace. canSee resolution
// happens HERE, not inside the LLM mouth . the kernel owns the face.
//
// The face the fold mounts has two halves:
//
//   foldedFace . the spatial weave (foldPlace). Forward face for
//                 forward and half orientations (space + occupants);
//                 the act-chain for inward; the recalled set for half.
//
//   innerFace . the canonical face the role's canSee declares this
//                 moment. Orientation + role + position + capabilities
//                 + canSee-resolved blocks. origin: "local" (cross-
//                 world overrides supersede post-seal via the responder).
//
// Both rid on moment so beat 3 (momentum) and beat 4 (stamped)
// can read them without touching the fold seam again.

import { foldPlace } from "./foldPlace.js";
import { buildInnerFace } from "./innerFace.js";

/**
 * Run the 2-fold beat. Mounts the face on moment.
 *
 * @param {object} setup . the result of assign(...)
 *   setup.role          . active role spec
 *   setup.moment     . the moment ctx assign built
 * @returns {Promise<{foldedFace, innerFace}>}
 */
export async function runFoldBeat(setup = {}) {
  const { role, moment } = setup;
  if (!moment) return { foldedFace: null, innerFace: null };

  // Inputs the fold needs: who is acting, where, on what history, at
  // what orientation. assign seated these on moment; we read them
  // through.
  const beingId =
    (moment.toBeing && String(moment.toBeing._id)) ||
    (moment.being && moment.being._id ? String(moment.being._id) : null);
  const orientation = moment.orientation || "forward";
  const history = moment.actorAct?.history || moment.history || null;

  // foldPlace runs the spatial weave. moment is threaded through so
  // foldPlace can stash foldedSeqs (PARALLEL FACTS §1.3) and read the
  // moment's history from moment.actorAct. Role rides through so
  // occupant folds are gated pre-fold by role.canSee . the dep set
  // then matches what we actually read.
  let foldedFace = null;
  if (beingId && history) {
    try {
      // SEAM: foldPlace opts key is `history` (shared with non-moment
      // callers like myInnerFace.js); the value is the history slot.
      foldedFace = await foldPlace(beingId, orientation, { moment, history, role });
    } catch {
      foldedFace = null;
    }
  }

  // buildInnerFace resolves role.canSee against the live position and
  // packages the canonical inner face shape. The forward/half folded
  // face's space + occupants ride through as the `place` block when
  // canSee declares one; the position {id, name} stands on its own as
  // a structural field regardless.
  let innerFace = null;
  try {
    const beingState =
      moment.toBeing
        ? { _id: moment.toBeing._id, name: moment.toBeing.name || null }
        : (moment.being || null);
    const buildCtx = {
      being:        beingState,
      beingId,
      role,
      orientation,
      history,
      currentSpace: moment.spaceId || null,
      rootId:       moment.rootId || null,
      name:         moment.toBeing?.name || null,
      foldedFace,
    };
    innerFace = await buildInnerFace(role, buildCtx);
  } catch {
    innerFace = null;
  }

  moment.foldedFace = foldedFace;
  moment.innerFace  = innerFace;

  return { foldedFace, innerFace };
}
