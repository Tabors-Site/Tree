// moveHost.js — the ONE host escape for the move op (move/index.js, do:move): the
// source-space READ, `resolve-source`. The four param validators that used to live here
// (require-mode / require-subject-kind / valid-coord-shape / valid-to) are GONE — they were
// conditions wearing a host fn (623/20: control flow IS the conditional Word), and move.word
// now expresses each as a native gate (presence `no coord`, kind `is a space`, and the type
// primitives `is a finite number` / `is a string` the grammar speaks). What stayed is the one
// thing a `see` form cannot yet shape: a multi-step projection read.
//
// callHost invokes resolve-source as `fn({ args: [...] }, ctx)`. It is a READ — it lays NO
// fact (the move fact is the dispatcher's own audit fact) — and throws the SAME IbpError the
// JS handler throws (so the messages/codes are byte-identical and the evaluator propagates it
// to the verb layer exactly as the JS throw would). The bridge binds an absent coord/to to
// null, so the `if (to)` / `if (coord)` guards below read presence directly.

import Space from "../../../materials/space/space.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { detectTargetKind, targetIdOf } from "../../../materials/_targetShape.js";
import { assertCoordWithinSize } from "../../../materials/matter/coordBounds.js";

const historyOf = (ctx) => ctx?.moment?.actorAct?.history || ctx?.history || "0";

// The subject kind from the same {kind,id} / string contract the handler uses.
function subjectKind(subject) {
  return detectTargetKind(subject);
}

export function moveHostEnv() {
  return {
    // resolve-source(subject, coord, to, history) — the source-space READ (the world
    // strand's only substrate touch). Mirrors the JS handler's destExists check, the
    // loadOrFold over the subject to capture fromSpaceId, and the coord bounds check
    // against the container's size. Reuses the SAME Space.exists / loadOrFold; lays NO
    // fact; throws the SAME IbpError on a missing dest / missing subject / out-of-bounds.
    "resolve-source": async ({ args: [subject, coord, to, argHistory] }, ctx) => {
      const history = argHistory || historyOf(ctx);
      const kind = subjectKind(subject);
      const targetId = targetIdOf(subject);
      const { loadOrFold } = await import("../../../materials/projections.js");

      // container-mode: the destination must exist (so the fact doesn't seal pointing
      // at nothing) — the SAME Space.exists the JS handler calls.
      if (to) {
        const destExists = await Space.exists({ _id: String(to) });
        if (!destExists) {
          throw new IbpError(
            IBP_ERR.SPACE_NOT_FOUND,
            `move: destination space "${to}" not found`,
          );
        }
      }

      // capture the source space (the subject's parent for a space, its containing
      // space for matter) so the live-SEE layer can invalidate both ends.
      let fromSpaceId = null;
      if (kind === "space") {
        const slot = await loadOrFold("space", targetId, history);
        if (!slot) {
          throw new IbpError(IBP_ERR.SPACE_NOT_FOUND, `move: space "${targetId}" not found`);
        }
        fromSpaceId = slot.state?.parent || null;
      } else {
        const slot = await loadOrFold("matter", targetId, history);
        if (!slot) {
          throw new IbpError(IBP_ERR.INVALID_INPUT, `move: matter "${targetId}" not found`);
        }
        // state.spaceId is the containing space, or the DELETED sentinel for a
        // soft-deleted matter (the null-check below catches the sentinel naturally).
        const raw = slot.state?.spaceId;
        fromSpaceId = (raw && raw !== "deleted") ? raw : null;
      }

      // coord-mode bounds: throw on out-of-bounds rather than clamping (a silent clamp
      // would lie — the reel would say "moved to (X,Y)" while the row stored a clamped
      // value). This calls the SAME canonical bounds math create-matter / set-matter use
      // (coordBounds.assertCoordWithinSize) — NOT an inline copy, so move can't drift from
      // the matter check. x/y are guaranteed finite by move.word's shape gates and z is
      // finite-or-absent, so the helper's non-finite skip is a no-op here.
      if (coord && fromSpaceId) {
        const containerSlot = await loadOrFold("space", fromSpaceId, history);
        const size = containerSlot?.state?.size || null;
        assertCoordWithinSize(coord, size, { op: "move", noun: "container" });
      }

      return fromSpaceId;
    },
  };
}
