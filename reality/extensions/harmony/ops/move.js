// harmony:move — one act, two facts (dancer reel + grid reel), atomic.
//
// The dancer's role calls this in its summon() after picking its move
// from a board fold. Two facts land in one moment:
//
//   1. do.set on dancer's qualities.harmony.coords (dancer's reel)
//   2. harmony:grid-event with event="move" on the grid reel
//
// Both push to summonCtx.deltaF; sealAct commits them in one
// transaction. Either both land or neither does — the dancer's
// coords and the grid trail can never disagree even on crash.
//
// Clamped to a grid configured via params.gridW / gridH (or seeded
// defaults). Out-of-grid intents become no-op steps in the bounded
// direction.

import { doVerb } from "../../../seed/ibp/verbs.js";

const DEFAULT_GRID_W = 10;
const DEFAULT_GRID_H = 10;

export default {
  name: "move",  // becomes harmony:move
  targets: ["being"],

  async handler({ target, params, identity, summonCtx }) {
    const dx = Number.isFinite(params?.dx) ? Math.sign(params.dx) : 0;
    const dy = Number.isFinite(params?.dy) ? Math.sign(params.dy) : 0;
    const gridSpaceId = params?.gridSpaceId;
    if (!gridSpaceId) {
      throw new Error("harmony:move requires params.gridSpaceId");
    }
    const gridW = Number.isFinite(params?.gridW) ? Number(params.gridW) : DEFAULT_GRID_W;
    const gridH = Number.isFinite(params?.gridH) ? Number(params.gridH) : DEFAULT_GRID_H;

    const beingId = String(target?._id || target?.id);
    if (!beingId) throw new Error("harmony:move requires a being target");

    const cur = (target?.qualities?.harmony?.coords) || { x: 0, y: 0 };
    const next = {
      x: Math.max(0, Math.min(gridW - 1, (cur.x | 0) + dx)),
      y: Math.max(0, Math.min(gridH - 1, (cur.y | 0) + dy)),
    };

    // No-op if clamped to same cell (avoid stamping a "move" with from===to).
    if (next.x === cur.x && next.y === cur.y) {
      return { moved: false, from: cur, to: next, reason: "no-op" };
    }

    // Fact 1: dancer's own reel — coord update.
    await doVerb(beingId, "set", {
      field: "qualities.harmony.coords",
      value: next,
    }, { identity, summonCtx });

    // Fact 2: grid reel — move event for replay.
    await doVerb(gridSpaceId, "harmony:grid-event", {
      event: "move",
      beingId,
      from: cur,
      to:   next,
    }, { identity, summonCtx });

    return { moved: true, from: cur, to: next };
  },
};
