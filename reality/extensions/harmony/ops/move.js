// harmony:move — one act, two facts (dancer reel + grid reel), atomic.
//
// The dancer's role calls this in its summon() after picking its move
// from a board fold. Two facts land in one moment:
//
//   1. do.set-being on dancer's `coord` schema field (dancer's reel).
//      The seed clamps to currentSpace.size automatically.
//   2. harmony:grid-event with event="move" on the grid reel.
//
// Both push to summonCtx.deltaF; sealAct commits them in one
// transaction. Either both land or neither does — the dancer's
// coord and the grid trail can never disagree even on crash.
//
// Two param shapes are accepted:
//
//   PRIMARY (Rung 5):   { from: {x,y}, to: {x,y}, gridSpaceId }
//     The dancer computed from + to against the GRID-RESOLVED position
//     (foldGridLive). Used post-PARALLEL-FACTS because the dancer's
//     coord field may be one bump behind the grid (the grid is
//     authoritative for rendered position; coord is the honest
//     intent record).
//
//   LEGACY (Rung 2-4):  { dx, dy, gridSpaceId }
//     Dancer hands signed deltas; the op reads cur from Being.coord.
//     Kept so any other call-site that hasn't migrated still works.
//
// Bounds enforcement now lives in the seed's set-being clamp against
// the space's `size` schema field, so this op no longer needs to
// know the grid dimensions.

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

    // Fact 1: dancer's coord (schema field; seed clamps to space size).
    await doVerb(beingId, "set-being", {
      field: "coord",
      value: next,
    }, { identity, summonCtx });

    // Fact 2: grid reel — move event for replay (the bump rule lives
    // in foldGrid.js and resolves cell collisions across moves).
    await doVerb(gridSpaceId, "harmony:grid-event", {
      event: "move",
      beingId,
      from: cur,
      to:   next,
    }, { identity, summonCtx });

    return { moved: true, from: cur, to: next };
  },
};
