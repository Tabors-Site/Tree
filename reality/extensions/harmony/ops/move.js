// harmony:move — one fact: the dancer's intended move on the grid reel.
//
// Doctrine — single writer per projection.
//
// Position on the grid is a projection field. Its reducer is the
// fold over harmony:grid-event facts plus the bump rule (PARALLEL
// FACTS §4 Strategy A). The reducer is the only place that knows
// the post-bump resolved cell, because the bump rule needs seq
// order to be deterministic — and seq order only exists after the
// fact lands on the reel.
//
// Therefore the move op stamps ONE fact:
//
//   harmony:grid-event with event="move", beingId, to: intended
//
// It does NOT write Being.coord. It does NOT compute a bump. It
// records the act of intent ("the dancer wanted to step to (x,y)").
// The resolved post-bump position is produced downstream by the
// cross-cutting handler in handlers/gridReducer.js — the single
// writer of Being.coord and PositionProjection for grid beings.
//
// Two param shapes are accepted (same as before — the role layer
// hasn't changed):
//
//   PRIMARY (Rung 5):   { from: {x,y}, to: {x,y}, gridSpaceId }
//     Caller computed from + to against the live grid fold.
//
//   LEGACY (Rung 2-4):  { dx, dy, gridSpaceId }
//     Caller hands signed deltas; the op reads cur from Being.coord.

import { doVerb } from "../../../seed/ibp/verbs/do.js";

export default {
  name: "move",  // becomes harmony:move
  targets: ["being"],

  async handler({ target, params, identity, summonCtx }) {
    const gridSpaceId = params?.gridSpaceId;
    if (!gridSpaceId) {
      throw new Error("harmony:move requires params.gridSpaceId");
    }

    // Accept bare string id (seed-internal callers) OR Mongoose Being
    // doc (runtime verb-handler shape). String(undefined) would yield
    // the literal "undefined", which downstream lookups can't resolve.
    const beingId = typeof target === "string"
      ? target
      : String(target?._id || target?.id || "");
    if (!beingId || beingId === "undefined") {
      throw new Error("harmony:move requires a being target");
    }

    // Choose param shape. Absolute `from`+`to` from the dancer's live
    // fold wins over dx/dy+coord-read.
    let cur, next;
    if (params?.to && Number.isFinite(params.to.x) && Number.isFinite(params.to.y)) {
      cur = (params?.from && Number.isFinite(params.from.x) && Number.isFinite(params.from.y))
        ? { x: Number(params.from.x), y: Number(params.from.y) }
        : (target?.coord && Number.isFinite(target.coord.x) && Number.isFinite(target.coord.y))
          ? { x: target.coord.x, y: target.coord.y }
          : { x: 0, y: 0 };
      next = { x: Number(params.to.x), y: Number(params.to.y) };
    } else {
      const dx = Number.isFinite(params?.dx) ? Math.sign(params.dx) : 0;
      const dy = Number.isFinite(params?.dy) ? Math.sign(params.dy) : 0;
      cur = (target?.coord && Number.isFinite(target.coord.x) && Number.isFinite(target.coord.y))
        ? { x: target.coord.x, y: target.coord.y }
        : { x: 0, y: 0 };
      next = { x: (cur.x | 0) + dx, y: (cur.y | 0) + dy };
    }

    // One fact, the act of intent. The grid reducer is what walks
    // the reel, applies the bump, and writes the projection.
    await doVerb(gridSpaceId, "harmony:grid-event", {
      event: "move",
      beingId,
      from: cur,
      to:   next,
    }, { identity, summonCtx });

    return { moved: true, from: cur, to: next };
  },
};
