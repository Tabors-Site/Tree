// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// myInnerFace.js . the human-portal-facing SEE op that returns the
// canonical inner face for the caller's active stance.
//
// Per philosophy/names/innerFace.md: every moment computes ONE inner
// face; all three souls (LLM, scripted, human) read the same shape.
// The LLM mouth reads it from summonCtx; the scripted role reads it
// from ctx.innerFace; the human portal calls this SEE op to see the
// same role-filtered, canSee-resolved view at the caller's current
// stance.
//
// The op is read-only. Builds the face fresh:
//   1. Resolve the caller's being.
//   2. Resolve the active role (caller's defaultRole; portal-side role
//      switching writes to the being and reflects automatically).
//   3. Run foldPlace at forward orientation against the caller's
//      current position.
//   4. Call buildInnerFace with the folded face on hand.
//   5. Return the canonical inner face shape.
//
// Failure modes: the caller has no being row, the being has no role,
// the position is missing . return null. The portal renders "no live
// face" rather than crashing.

import log from "../../../seedReality/log.js";
import { registerSeeOperation } from "../../../ibp/seeOps.js";
import { buildInnerFace } from "../../stamper/2-fold/innerFace.js";
import { foldPlace } from "../../stamper/2-fold/foldPlace.js";
import { loadOrFold } from "../../../materials/projections.js";
import { getRole } from "../../roles/registry.js";

registerSeeOperation("my-inner-face", {
  ownerExtension: "seed",
  description: "The canonical inner face for the caller's active stance . orientation + role + position + capabilities + canSee blocks.",
  handler: async ({ identity, ctx, branch }) => {
    const beingId = identity?.beingId || ctx?.beingId || null;
    if (!beingId) return null;

    const _branch = branch || ctx?.branch || "0";

    let beingSlot = null;
    try {
      beingSlot = await loadOrFold("being", String(beingId), _branch);
    } catch (err) {
      log.warn("MyInnerFace", `loadOrFold being failed: ${err.message}`);
      return null;
    }
    if (!beingSlot) return null;

    const being = { _id: beingSlot.id, position: beingSlot.position, ...(beingSlot.state || {}) };
    const roleName = being.activeRole || being.defaultRole || null;
    if (!roleName) return null;

    const role = getRole(roleName);
    if (!role) return null;

    const positionId = being.position || null;

    // Forward orientation . the human portal looks at "right now".
    // Inward / half are operations the soul invokes via self-summon
    // with an orientation parameter; the SEE op stays forward.
    //
    // Role is threaded in so foldPlace gates occupant folds against
    // role.canSee . the foldedFace returns with a weave that
    // matches what was actually read. buildInnerFace then merges that
    // with the canSee-side weave so the face the portal subscribes
    // against is the exact residue of what perception admitted.
    let foldedFace = null;
    try {
      foldedFace = await foldPlace(String(beingId), "forward", { branch: _branch, role });
    } catch (err) {
      log.debug("MyInnerFace", `foldPlace failed: ${err.message}`);
      foldedFace = null;
    }

    try {
      const buildCtx = {
        being:        { _id: being._id, name: being.name || null },
        beingId:      String(beingId),
        role,
        orientation:  "forward",
        branch:       _branch,
        currentSpace: positionId,
        rootId:       null,
        name:         being.name || null,
        foldedFace,
      };
      const face = await buildInnerFace(role, buildCtx);
      return face;
    } catch (err) {
      log.warn("MyInnerFace", `buildInnerFace failed: ${err.message}`);
      return null;
    }
  },
});
