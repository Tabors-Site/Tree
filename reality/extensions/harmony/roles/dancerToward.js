// harmony:dancer-toward — step toward the nearest neighbor each tick.
//
// Scripted cognition. Wakes on a SUMMON from the drummer carrying
// { tick, tickSeq, gridSpaceId }. The dancer folds the LIVE grid
// (no seq ceiling — PARALLEL FACTS Rung 5), reads its own resolved
// coords from the fold, applies its rule (step toward nearest other),
// computes the absolute target cell, and emits harmony:move with `to`.
//
// LIVE FOLD vs. LOCKSTEP CEILING (Rung 5 cutover):
//   At Rung 2-4 the drummer captured `tickSeq` at start-of-tick and
//   every dancer folded up to that ceiling — guaranteeing all dancers
//   saw the identical board. Collisions were impossible to detect
//   except through end-of-tick replay.
//
//   Rung 5 drops the ceiling. Dancers fold the LIVE board (whatever
//   is on the grid reel right now), which means each dancer sees
//   moves already sealed during this tick. They can "dodge" each
//   other when wake-order is sequential. When two dancers fold-and-
//   decide concurrently and both stamp moves to the same cell, the
//   grid reducer's deterministic bump (foldGrid.js NEIGHBOR_DIRS)
//   resolves at fold time. tickSeq still rides on the SUMMON for
//   audit but is ignored by the fold.
//
// GRID IS AUTHORITATIVE for position. The dancer's qualities.coords
// keep what its last move-fact said ("I stepped to (3,4)") — honest
// about the act. Where the dancer actually IS post-bump lives only
// in the grid fold. The dancer reads from there, not from its own
// qualities, every tick.

import log from "../../../seed/seedReality/log.js";
import { doVerb } from "../../../seed/ibp/verbs/do.js";
import { foldGridLive } from "../lib/foldGrid.js";

const DEFAULT_GRID_W = 10;
const DEFAULT_GRID_H = 10;

export const dancerTowardRole = Object.freeze({
  name: "harmony:dancer-toward",
  description: "Steps one cell toward the nearest neighbor each tick (toward grid center when alone).",
  permissions: ["do"],
  respondMode: "async",
  triggerOn: ["message"],

  canDo: ["harmony:move"],
  canSummon: [],
  canBe: [],
  canSee: [],

  prompt: () => "",

  async summon(message, ctx) {
    const c = message?.content || {};
    const { tick, gridSpaceId, gridW = DEFAULT_GRID_W, gridH = DEFAULT_GRID_H } = c;
    if (!gridSpaceId) {
      return {
        ok: false,
        shape: "internal",
        reason: "summon missing gridSpaceId in content",
      };
    }

    // 1. Fold the LIVE grid (Rung 5 — no seq ceiling). Whoever wakes
    //    after a peer's move sees that peer at its bumped position;
    //    simultaneous wakes collide and the bump rule resolves at
    //    fold time. Either way the grid is the source of truth for
    //    rendered position.
    let board;
    try {
      board = await foldGridLive(gridSpaceId);
    } catch (err) {
      log.warn("Dancer", `foldGridLive failed: ${err.message}`);
      return { ok: false, shape: "internal", reason: err.message };
    }

    const meId = String(ctx.toBeing._id);
    const me = board.get(meId);
    if (!me) {
      // Not yet placed on this grid. This tick is a no-op for us.
      return { ok: true, content: `tick ${tick}: not placed on grid` };
    }

    // 2. Rule: step toward nearest neighbor; default to grid center if alone.
    const others = [];
    for (const [id, pos] of board.entries()) {
      if (id !== meId) others.push(pos);
    }
    const target = others.length
      ? pickNearest(me, others)
      : { x: Math.floor(gridW / 2), y: Math.floor(gridH / 2) };
    const { dx, dy } = stepToward(me, target);
    if (dx === 0 && dy === 0) {
      return { ok: true, content: `tick ${tick}: stay at (${me.x},${me.y})` };
    }

    // 3. Compute the absolute target cell from the GRID-RESOLVED `me`,
    //    not from the dancer's own qualities (which may be stale post-
    //    bump). Pass `to` to harmony:move so the move op stamps from
    //    the authoritative position regardless of any qualities drift.
    const to = {
      x: Math.max(0, Math.min(gridW - 1, me.x + dx)),
      y: Math.max(0, Math.min(gridH - 1, me.y + dy)),
    };

    // 4. Emit the move. The op stamps two facts (dancer + grid) in
    //    one atomic moment seal via summonCtx.deltaF.
    try {
      const r = await doVerb(meId, "harmony:move", {
        from: me, to, gridSpaceId, gridW, gridH,
      }, {
        identity: { beingId: meId, name: ctx.toBeing.name },
        summonCtx: ctx,
      });
      return {
        ok: true,
        content: `tick ${tick}: ${r?.moved ? `${stringify(me)}→${stringify(r.to)}` : `no-op at ${stringify(me)}`}`,
      };
    } catch (err) {
      log.warn("Dancer", `move failed: ${err.message}`);
      return { ok: false, shape: "internal", reason: err.message };
    }
  },
});

// ── pure rule helpers ────────────────────────────────────────────────

function pickNearest(me, others) {
  let best = others[0];
  let bestD = manhattan(me, best);
  for (let i = 1; i < others.length; i++) {
    const d = manhattan(me, others[i]);
    if (d < bestD) { best = others[i]; bestD = d; }
  }
  return best;
}

function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

// One-cell step closer on the axis of greatest distance.
// Tie-break: prefer x-step when |dx| == |dy|.
function stepToward(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return { dx: 0, dy: 0 };
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { dx: Math.sign(dx), dy: 0 };
  }
  return { dx: 0, dy: Math.sign(dy) };
}

function stringify(p) { return `(${p.x},${p.y})`; }
