// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// myInnerFace.js . the human-portal-facing SEE op that returns the
// canonical inner face for the caller's active stance.
//
// Per philosophy/names/innerFace.md: every moment computes ONE inner
// face; all three souls (LLM, scripted, human) read the same shape.
// The LLM mouth reads it from moment; the scripted able reads it
// from ctx.innerFace; the human portal calls this SEE op to see the
// same able-filtered, canSee-resolved view at the caller's current
// stance.
//
// The op is read-only. Builds the face fresh:
//   1. Resolve the caller's being.
//   2. Resolve the active able (caller's defaultAble; portal-side able
//      switching writes to the being and reflects automatically).
//   3. Run foldPlace at forward orientation against the caller's
//      current position.
//   4. Call buildInnerFace with the folded face on hand.
//   5. Return the canonical inner face shape.
//
// Failure modes: the caller has no being row, the being has no able,
// the position is missing . return null. The portal renders "no live
// face" rather than crashing.

import log from "../../../seedStory/log.js";
import { registerSeeOperation } from "../../../ibp/seeOps.js";
import { buildInnerFace } from "../../stamper/2-fold/innerFace.js";
import { foldPlace } from "../../stamper/2-fold/foldPlace.js";
import { loadOrFold } from "../../../materials/projections.js";
import { getAble } from "../../ables/registry.js";

registerSeeOperation("my-inner-face", {
  ownerExtension: "seed",
  description: "The canonical inner face for the caller's active stance . orientation + able + position + capabilities + canSee blocks.",
  handler: async ({ identity, ctx, history }) => {
    const beingId = identity?.beingId || ctx?.beingId || null;
    if (!beingId) return null;

    const _history = history || ctx?.history || "0";

    let beingSlot = null;
    try {
      beingSlot = await loadOrFold("being", String(beingId), _history);
    } catch (err) {
      log.warn("MyInnerFace", `loadOrFold being failed: ${err.message}`);
      return null;
    }
    if (!beingSlot) return null;

    const being = { _id: beingSlot.id, position: beingSlot.position, ...(beingSlot.state || {}) };
    const ableName = being.activeAble || being.defaultAble || null;
    if (!ableName) return null;

    const able = getAble(ableName);
    if (!able) return null;

    const positionId = being.position || null;

    // Forward orientation . the human portal looks at "right now".
    // Inward / half are operations the soul invokes via self-summon
    // with an orientation parameter; the SEE op stays forward.
    //
    // Able is threaded in so foldPlace gates occupant folds against
    // able.canSee . the foldedFace returns with a weave that
    // matches what was actually read. buildInnerFace then merges that
    // with the canSee-side weave so the face the portal subscribes
    // against is the exact residue of what perception admitted.
    let foldedFace = null;
    try {
      // foldPlace (stamper/) consumes the `history` opts key (contract with
      // the untouched stamper module); the local is _history.
      foldedFace = await foldPlace(String(beingId), "forward", { history: _history, able });
    } catch (err) {
      log.debug("MyInnerFace", `foldPlace failed: ${err.message}`);
      foldedFace = null;
    }

    try {
      const buildCtx = {
        being:        { _id: being._id, name: being.name || null },
        beingId:      String(beingId),
        able,
        orientation:  "forward",
        history:      _history,
        currentSpace: positionId,
        rootId:       null,
        name:         being.name || null,
        foldedFace,
      };
      const face = await buildInnerFace(able, buildCtx);
      return face;
    } catch (err) {
      log.warn("MyInnerFace", `buildInnerFace failed: ${err.message}`);
      return null;
    }
  },
});
