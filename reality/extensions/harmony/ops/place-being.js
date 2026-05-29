// harmony:place-being — set initial coord on a being + record on grid.
//
// Used by the seed at plant time to put a dancer at a starting cell.
// Stamps TWO facts in one moment (atomic via summonCtx.deltaF):
//
//   1. do.set-being on the being's `coord` schema field (its own reel).
//      The seed clamps to the grid's `size` automatically.
//   2. do.set-like emission on the grid space's reel as a
//      "harmony:grid-event" with event="place" (the canonical record
//      from which any dancer's position can be folded with the
//      Strategy A bump rule).
//
// Both facts share the same actId. sealAct commits them in one
// transaction. The dancer's own reel and the grid's reel agree from
// the first frame; replay-from-the-grid-reel matches live coord.

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

    // Fact 1 — dancer's coord (schema field; seed clamps to space size).
    await doVerb(beingId, "set-being", {
      field: "coord",
      value: to,
    }, { identity, summonCtx });

    // Fact 2 — grid reel record of the placement.
    await doVerb(gridSpaceId, "harmony:grid-event", {
      event: "place",
      beingId,
      to,
    }, { identity, summonCtx });

    return { placed: true, beingId, to };
  },
};
