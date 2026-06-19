// moveHost.js — host-escape glue for the move op (moveOp.js, do:move). Wires the
// SAME primitives the JS handler calls into ctx.env.host: the param validators
// (computation over coord/to/subject) and the source-space resolution (a multi-step
// projection read — Space.exists for the dest, loadOrFold over space/matter for the
// subject's parent / containing space, and the coord bounds check against the
// container's size — that the `see` forms cannot yet shape). NO reimplementation;
// the validators mirror the JS handler's checks and resolveSource calls the SAME
// Space.exists / loadOrFold the JS handler imports.
//
// callHost invokes each as `fn({ args: [...] }, ctx)`. The validators are pure
// (return a boolean the `.word` gates on); resolveSource is a READ — it lays NO
// fact (the move fact is the dispatcher's own audit fact) — and throws the SAME
// IbpError the JS handler throws (so the messages/codes are byte-identical and the
// evaluator propagates it to the verb layer exactly as the JS throw would).

import Space from "./space/space.js";
import { IbpError, IBP_ERR } from "../ibp/protocol.js";
import { detectTargetKind, targetIdOf } from "./_targetShape.js";

const historyOf = (ctx) => ctx?.moment?.actorAct?.history || ctx?.history || "0";

// The subject kind from the same {kind,id} / string contract the handler uses.
function subjectKind(subject) {
  return detectTargetKind(subject);
}

// A nullable trigger param (coord / to) that the evaluator could not bind passes
// through as its own literal placeholder ("$coord" / "$to"): resolveValue returns
// the placeholder when the binding is null/undefined (a `?? v` fallthrough). The JS
// handler reads the param as ABSENT in that case, so normalize the placeholder back
// to undefined before the validators run — behavior-preserving, not a new rule.
const absent = (v) => (typeof v === "string" && /^\$\w+$/.test(v) ? undefined : v);

export function moveHostEnv() {
  return {
    // exactly one of coord / to (the SAME mutual-exclusion the JS handler asserts):
    // both-absent and both-present are the two rejected shapes.
    "require-mode": ({ args: [coordArg, toArg] }) => {
      const coord = absent(coordArg), to = absent(toArg);
      return !!(coord ? !to : to);
    },

    // the subject must be a space or matter (beings move themselves, not via move).
    "require-subject-kind": ({ args: [subject] }) => {
      const kind = subjectKind(subject);
      return kind === "space" || kind === "matter";
    },

    // coord-mode shape: { x, y[, z] } with finite numbers (true when coord is absent,
    // so a container-mode move passes this gate untouched — the SAME `if (coord)` guard).
    "valid-coord-shape": ({ args: [coordArg] }) => {
      const coord = absent(coordArg);
      if (!coord) return true;
      return typeof coord === "object" &&
        Number.isFinite(coord.x) && Number.isFinite(coord.y);
    },

    // container-mode dest must be a non-empty string id (true when `to` is absent —
    // a coord-mode move passes untouched, the SAME `if (to)` guard).
    "valid-to": ({ args: [toArg] }) => {
      const to = absent(toArg);
      if (!to) return true;
      return typeof to === "string" && to.length > 0;
    },

    // (notSelfMove COLLAPSED to a native Word gate in move.word: "If the subject's kind
    // equals space and the to equals the subject's id: refuse" — a space-into-itself check
    // is a CONDITION, not a compute. The predecessor host gates fence off the inputs where
    // the plain `equals` would differ from the old String()-coercing host fn. Proven
    // equivalent over the reachable region; subjectKind/targetIdOf stay, resolveSource uses them.)

    // resolveSource(subject, coord, to, branch) — the source-space READ (the world
    // strand's only substrate touch). Mirrors the JS handler's destExists check, the
    // loadOrFold over the subject to capture fromSpaceId, and the coord bounds check
    // against the container's size. Reuses the SAME Space.exists / loadOrFold; lays NO
    // fact; throws the SAME IbpError on a missing dest / missing subject / out-of-bounds.
    "resolve-source": async ({ args: [subject, coordArg, toArg, argHistory] }, ctx) => {
      const coord = absent(coordArg), to = absent(toArg);
      const branch = absent(argHistory) || historyOf(ctx);
      const kind = subjectKind(subject);
      const targetId = targetIdOf(subject);
      const { loadOrFold } = await import("./projections.js");

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
        const slot = await loadOrFold("space", targetId, branch);
        if (!slot) {
          throw new IbpError(IBP_ERR.SPACE_NOT_FOUND, `move: space "${targetId}" not found`);
        }
        fromSpaceId = slot.state?.parent || null;
      } else {
        const slot = await loadOrFold("matter", targetId, branch);
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
      // value). The SAME per-axis check against the container's size.
      if (coord && fromSpaceId) {
        const containerSlot = await loadOrFold("space", fromSpaceId, branch);
        const size = containerSlot?.state?.size || null;
        if (size) {
          for (const axis of ["x", "y", "z"]) {
            if (!Number.isFinite(coord[axis])) continue;
            const cap = typeof size[axis] === "number" && size[axis] > 0 ? size[axis] : null;
            if (cap === null) continue;
            const high = Number.isInteger(coord[axis]) ? Math.trunc(cap) - 1 : cap - Number.EPSILON;
            if (coord[axis] < 0 || coord[axis] > high) {
              throw new IbpError(
                IBP_ERR.INVALID_INPUT,
                `move: coord.${axis}=${coord[axis]} is out of bounds (0..${high} for this container)`,
                { axis, value: coord[axis], cap: high },
              );
            }
          }
        }
      }

      return fromSpaceId;
    },
  };
}
