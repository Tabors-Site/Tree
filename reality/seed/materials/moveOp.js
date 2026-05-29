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

async function moveHandler({ target, params }) {
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
  if (to) {
    if (kind === "space" && String(to) === String(targetId)) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "move: cannot move a space into itself",
      );
    }
    const destExists = await Space.exists({ _id: to });
    if (!destExists) {
      throw new IbpError(
        IBP_ERR.SPACE_NOT_FOUND,
        `move: destination space "${to}" not found`,
      );
    }
  }

  // Capture the source space so the live-SEE layer can invalidate
  // both ends. For coord-mode the source IS the destination (same
  // container); for container-mode they differ. Mutating params
  // means the fact itself records both halves; stamped.js reads
  // params.fromSpaceId to fire the invalidate without an extra
  // post-fold query.
  let fromSpaceId = null;
  if (kind === "space") {
    const row = await Space.findById(targetId).select("parent").lean();
    if (!row) {
      throw new IbpError(IBP_ERR.SPACE_NOT_FOUND, `move: space "${targetId}" not found`);
    }
    fromSpaceId = row.parent ? String(row.parent) : null;
  } else {
    const Matter = (await import("./matter/matter.js")).default;
    const row = await Matter.findById(targetId).select("spaceId").lean();
    if (!row) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, `move: matter "${targetId}" not found`);
    }
    fromSpaceId = row.spaceId ? String(row.spaceId) : null;
  }
  if (fromSpaceId && params) params.fromSpaceId = fromSpaceId;

  // Coord-mode clamping. The containing space's `size` is the
  // bounding box for any coord inside it; an out-of-bounds put-down
  // (client bug, drifted UI, or just a paranoid caller) gets locked
  // to the nearest legal cell. The clamped value rides on
  // params.coord into the fact so the reducer just writes it.
  if (coord) {
    const containerId = fromSpaceId; // coord-mode keeps the same container
    if (containerId) {
      const containerRow = await Space.findById(containerId).select("size").lean();
      const size = containerRow?.size || null;
      if (size) {
        const clamped = { ...coord };
        for (const axis of ["x", "y", "z"]) {
          if (!Number.isFinite(clamped[axis])) continue;
          const cap = typeof size[axis] === "number" && size[axis] > 0 ? size[axis] : null;
          if (cap === null) continue;
          if (Number.isInteger(clamped[axis])) {
            clamped[axis] = Math.max(0, Math.min(Math.trunc(cap) - 1, clamped[axis]));
          } else {
            clamped[axis] = Math.max(0, Math.min(cap - Number.EPSILON, clamped[axis]));
          }
        }
        if (params) params.coord = clamped;
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
