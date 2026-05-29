// harmony:step — direction → move.
//
// LLM-friendly step verb. The being's position is read from the
// grid fold (post-bump, authoritative); the cardinal direction
// names one of the 8 compass neighbors or STAY. The op delegates
// to harmony:move with the absolute target cell; the fold
// reducer's bump rule clamps and resolves collisions.

import { doVerb } from "../../../seed/ibp/verbs/do.js";
import { foldGridLive } from "../lib/foldGrid.js";

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
    const gridSpaceId = params?.gridSpaceId;
    if (!gridSpaceId) {
      throw new Error("harmony:step requires params.gridSpaceId");
    }
    const dir = String(params?.direction || "").toUpperCase();
    const delta = DIRS[dir];
    if (!delta) {
      throw new Error(
        `harmony:step: direction must be one of ${Object.keys(DIRS).join(",")}; got "${params?.direction}"`,
      );
    }

    const board = await foldGridLive(gridSpaceId);
    const me = board.get(beingId);
    if (!me) {
      return { stepped: false, reason: "not placed on grid" };
    }
    if (delta.dx === 0 && delta.dy === 0) {
      return { stepped: false, reason: "stay", from: me, direction: dir };
    }

    const to = { x: me.x + delta.dx, y: me.y + delta.dy };
    const r = await doVerb(beingId, "harmony:move", {
      from: me,
      to,
      gridSpaceId,
    }, { identity, summonCtx });

    return { stepped: true, from: me, to, direction: dir, moveResult: r };
  },
};
