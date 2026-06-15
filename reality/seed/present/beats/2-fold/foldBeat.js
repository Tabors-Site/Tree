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
// all consume the same face via summonCtx.innerFace. canSee resolution
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
// Both rid on summonCtx so beat 3 (momentum) and beat 4 (stamped)
// can read them without touching the fold seam again.

import { foldPlace } from "./foldPlace.js";
import { buildInnerFace } from "./innerFace.js";

/**
 * Run the 2-fold beat. Mounts the face on summonCtx.
 *
 * @param {object} setup . the result of assign(...)
 *   setup.role          . active role spec
 *   setup.summonCtx     . the moment ctx assign built
 * @returns {Promise<{foldedFace, innerFace}>}
 */
export async function runFoldBeat(setup = {}) {
  const { role, summonCtx } = setup;
  if (!summonCtx) return { foldedFace: null, innerFace: null };

  // Inputs the fold needs: who is acting, where, on what branch, at
  // what orientation. assign seated these on summonCtx; we read them
  // through.
  const beingId =
    (summonCtx.toBeing && String(summonCtx.toBeing._id)) ||
    (summonCtx.being && summonCtx.being._id ? String(summonCtx.being._id) : null);
  const orientation = summonCtx.orientation || "forward";
  const branch = summonCtx.actorAct?.branch || summonCtx.branch || null;

  // foldPlace runs the spatial weave. summonCtx is threaded through so
  // foldPlace can stash foldedSeqs (PARALLEL FACTS §1.3) and read the
  // moment's branch from summonCtx.actorAct.
  let foldedFace = null;
  if (beingId && branch) {
    try {
      foldedFace = await foldPlace(beingId, orientation, { summonCtx, branch });
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
      summonCtx.toBeing
        ? { _id: summonCtx.toBeing._id, name: summonCtx.toBeing.name || null }
        : (summonCtx.being || null);
    const buildCtx = {
      being:        beingState,
      beingId,
      role,
      orientation,
      branch,
      currentSpace: summonCtx.spaceId || null,
      rootId:       summonCtx.rootId || null,
      name:         summonCtx.toBeing?.name || null,
      foldedFace,
    };
    innerFace = await buildInnerFace(role, buildCtx);
  } catch {
    innerFace = null;
  }

  summonCtx.foldedFace = foldedFace;
  summonCtx.innerFace  = innerFace;

  return { foldedFace, innerFace };
}
