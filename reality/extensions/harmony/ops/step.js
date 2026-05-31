// harmony:step . direction → set-being:coord.
//
// The dancer's only op. Takes a compass direction, reads the
// dancer's current coord, calls set-being:coord with the new cell.
// The seed enforces bounds (throws on OOB) and the factory's
// PositionProjection fold writes the cached row. No bump rule, no
// grid-event fact action, no harmony-side reducer . the world is
// the world; if two dancers land on the same cell, they overlap.

import Being from "../../../seed/materials/being/being.js";
import { doVerb } from "../../../seed/ibp/verbs/do.js";

const DIRS = {
  N:    { dx:  0, dy: -1 },
  NE:   { dx:  1, dy: -1 },
  E:    { dx:  1, dy:  0 },
  SE:   { dx:  1, dy:  1 },
  S:    { dx:  0, dy:  1 },
  SW:   { dx: -1, dy:  1 },
  W:    { dx: -1, dy:  0 },
  NW:   { dx: -1, dy: -1 },
  STAY: { dx:  0, dy:  0 },
};

export default {
  name: "step",
  targets: ["being"],

  async handler({ target, params, identity, summonCtx }) {
    const beingId = typeof target === "string"
      ? target
      : String(target?._id || target?.id || "");
    if (!beingId || beingId === "undefined") {
      throw new Error("harmony:step requires a being target");
    }

    const dir = String(params?.direction || "").toUpperCase();
    const delta = DIRS[dir];
    if (!delta) {
      throw new Error(
        `harmony:step: direction must be one of ${Object.keys(DIRS).join(",")}; got "${params?.direction}"`,
      );
    }

    if (delta.dx === 0 && delta.dy === 0) {
      return { stepped: false, reason: "stay", direction: dir };
    }

    const me = await Being.findById(beingId).select("coord").lean();
    const cur = (me?.coord && Number.isFinite(me.coord.x) && Number.isFinite(me.coord.y))
      ? { x: me.coord.x, y: me.coord.y }
      : { x: 0, y: 0 };
    const next = { x: cur.x + delta.dx, y: cur.y + delta.dy };

    // set-being:coord . the seed enforces bounds and the
    // PositionProjection fold writes the cached row. Throws on
    // out-of-bounds; cognition refaces.
    await doVerb(
      { kind: "being", id: beingId },
      "set-being",
      { field: "coord", value: next },
      { identity, summonCtx },
    );

    return { stepped: true, from: cur, to: next, direction: dir };
  },
};
