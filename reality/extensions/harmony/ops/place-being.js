// harmony:place-being — record an initial placement on the grid reel.
//
// Doctrine — single writer per projection. The being's coord is a
// projection of the grid reel's fold (with the bump rule applied
// per PARALLEL FACTS §4). This op records the act of placement;
// the cross-cutting handler in handlers/gridReducer.js folds the
// fact and writes the resolved position to Being.coord and
// PositionProjection.
//
// One fact:
//
//   harmony:grid-event with event="place", beingId, to: starting cell.
//
// Used by the dance-floor seed at plant time to put a dancer at a
// starting cell. The grid reducer applies the bump rule at fold
// time (if two place-facts ever land on the same cell, the
// later-seq is bumped to the nearest free neighbor); the act of
// placement stays honest about what was requested.

import { doVerb } from "../../../seed/ibp/verbs/do.js";

export default {
  name: "place-being",  // becomes harmony:place-being after loader namespacing
  targets: ["being"],

  async handler({ target, params, identity, summonCtx }) {
    const x = Number.isFinite(params?.x) ? Number(params.x) : 0;
    const y = Number.isFinite(params?.y) ? Number(params.y) : 0;
    const gridSpaceId = params?.gridSpaceId;
    if (!gridSpaceId) {
      throw new Error("harmony:place-being requires params.gridSpaceId");
    }
    // Accept three target shapes: bare string id (seed-internal callers
    // like the dance-floor scaffold), Mongoose Being doc (runtime
    // verb-handler shape), or `{ _id }` envelope.
    const beingId = typeof target === "string"
      ? target
      : String(target?._id || target?.id || "");
    if (!beingId || beingId === "undefined") {
      throw new Error("harmony:place-being requires a being target");
    }
    const to = { x, y };

    // One fact on the grid reel. The grid reducer is the writer of
    // Being.coord / PositionProjection.
    await doVerb(gridSpaceId, "harmony:grid-event", {
      event: "place",
      beingId,
      to,
    }, { identity, summonCtx });

    return { placed: true, beingId, to };
  },
};
