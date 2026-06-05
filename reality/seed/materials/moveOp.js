// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// `do move` — pick up a space or matter and put it somewhere else.
//
// One unified relocation action with two modes, discriminated by
// which param the caller passes.
//
//   coord mode (`params.coord = { x, y[, z] }`)
//     The everyday case. Move the subject to a different spot inside
//     its current containing space. The matter on the dance floor
//     moves from cell (3,4) to (7,2). The child tree moves to a
//     different spot in its parent. No container change.
//
//   container mode (`params.to = <spaceId>`)
//     The "carry across a doorway" case. Move the subject into a
//     different space. The matter follows the carrier into the next
//     room. The child tree gets reparented under another tree.
//
// `params.target = { kind, id }` names the subject. The wire DO can't
// carry the actual subject through the address (the cross-kind op
// strips the @qualifier and resolves only a space), so the portal
// passes the subject explicitly. In-process callers can omit it and
// rely on the dispatcher target.
//
// Beings are not a move target. Beings move themselves through
// set-being:coord (in-space) and set-being:position (cross-space).
// `move` is what beings do TO things in their world.

import Space from "./space/space.js";
import { registerOperation } from "../ibp/operations.js";
import { IbpError, IBP_ERR } from "../ibp/protocol.js";
import { detectTargetKind, targetIdOf } from "./_targetShape.js";

async function moveHandler({ target, params, summonCtx }) {
  const { coord, to, target: explicitTarget } = params || {};

  if (!coord && !to) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "move: must specify either `coord` (in-space) or `to` (cross-space)",
    );
  }
  if (coord && to) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "move: `coord` and `to` are mutually exclusive; pick one mode",
    );
  }

  const actualTarget = explicitTarget || target;
  const kind = detectTargetKind(actualTarget);
  if (kind !== "space" && kind !== "matter") {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `move: target must be a space or matter (got ${kind})`,
    );
  }
  const targetId = targetIdOf(actualTarget);

  // Coord-mode validation. Reducer clamps later; here we just sanity
  // check the shape so the fact doesn't seal with garbage.
  if (coord) {
    if (typeof coord !== "object" ||
        !Number.isFinite(coord.x) || !Number.isFinite(coord.y)) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "move: `coord` must be { x, y[, z] } with finite numbers",
      );
    }
  }

  // Container-mode validation. Self-move on space is degenerate;
  // dest must exist so the fact doesn't seal pointing at nothing.
  // params.to is a typed space-Ref (REFS.md); extract bare id for
  // the existence + self-move checks. The fact's params.to STAYS a
  // Ref so applyMove can write the Ref directly to state.parent
  // (space target) or state.spaceId (matter target).
  let toId = null;
  if (to) {
    const { isAggregateRef, refKind, refId } = await import("./ref.js");
    if (!isAggregateRef(to) || refKind(to) !== "space") {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `move: \`to\` requires a space-Ref . got ${typeof to === "object" ? JSON.stringify(to) : typeof to}. Wrap with ref("space", id).`,
      );
    }
    toId = refId(to);
    if (kind === "space" && toId === String(targetId)) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "move: cannot move a space into itself",
      );
    }
    const destExists = await Space.exists({ _id: toId });
    if (!destExists) {
      throw new IbpError(
        IBP_ERR.SPACE_NOT_FOUND,
        `move: destination space "${toId}" not found`,
      );
    }
  }

  // Capture the source space so the live-SEE layer can invalidate
  // both ends. For coord-mode the source IS the destination (same
  // container); for container-mode they differ. Mutating params
  // means the fact itself records both halves; stamped.js reads
  // params.fromSpaceId to fire the invalidate without an extra
  // post-fold query. fromSpaceId is a bare-string id (the live-SEE
  // pipeline uses it as a Mongo key); state-field writes stay
  // Ref-typed via params.to.
  let fromSpaceId = null;
  const { loadOrFold } = await import("./projections.js");
  const branch = summonCtx?.branch || "0";
  if (kind === "space") {
    const slot = await loadOrFold("space", targetId, branch);
    if (!slot) {
      throw new IbpError(IBP_ERR.SPACE_NOT_FOUND, `move: space "${targetId}" not found`);
    }
    // state.parent is a typed space-Ref (REFS.md).
    const { refId } = await import("./ref.js");
    fromSpaceId = refId(slot.state?.parent);
  } else {
    const slot = await loadOrFold("matter", targetId, branch);
    if (!slot) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, `move: matter "${targetId}" not found`);
    }
    // state.spaceId is a typed space-Ref (REFS.md) OR the DELETED
    // sentinel for soft-deleted matter (matter.js comment). The
    // DELETED case shouldn't reach move (deletion is a terminal
    // state) but refId returns null on non-Refs, so the downstream
    // null-check naturally rejects the case rather than threading
    // the sentinel through.
    const { refId } = await import("./ref.js");
    fromSpaceId = refId(slot.state?.spaceId);
  }
  if (fromSpaceId && params) params.fromSpaceId = fromSpaceId;

  // Coord-mode bounds check. Throw on out-of-bounds rather than
  // clamping. The substrate is the floor for what's legal; cognition
  // catches the rejection and refaces. Silent clamping was a lie —
  // the reel said "moved to (X,Y)" while the row stored a different
  // (clamped) value, and replay diverged from live. Throwing keeps
  // the chain honest: if a fact seals saying "moved to (X,Y)," the
  // row reflects (X,Y).
  if (coord) {
    const containerId = fromSpaceId;
    if (containerId) {
      const containerSlot = await loadOrFold("space", containerId, branch);
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
  }

  // _factTarget overrides the dispatcher's audit-target resolution
  // so the fact's target IS the moved subject, not the room it was
  // moved from. The reducer for that kind reads the move fact and
  // updates the right field (coord, parent, or spaceId).
  return {
    moved: true,
    kind,
    mode: coord ? "coord" : "container",
    fromSpaceId,
    _factTarget: { kind, id: String(targetId) },
  };
}

registerOperation("move", {
  targets: ["space", "matter"],
  ownerExtension: "seed",
  factAction: "move",
  handler: moveHandler,
});
