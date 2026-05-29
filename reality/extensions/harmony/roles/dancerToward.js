// harmony:dancer-toward — step toward the nearest neighbor each tick.
//
// Scripted cognition. Wakes on a SUMMON from the drummer carrying
// { tick, tickSeq, gridSpaceId }. The dancer folds the grid reel up
// to tickSeq itself (no handed-out snapshot), reads its own coords
// from the fold, applies its rule (step toward nearest other), and
// emits harmony:move with the delta.
//
// On rung 2 there's only ONE dancer in the grid, so "nearest neighbor"
// has no candidates. The rule degrades to "step toward grid center"
// so the lone dancer still moves visibly — proves the fold + move
// pipeline end-to-end. Rung 4 adds 4 more dancers with other rules
// and the toward/away/mirror/box/pulse dance emerges.

import log from "../../../seed/seedReality/log.js";
import { doVerb } from "../../../seed/ibp/verbs/do.js";
import { foldGridUpToSeq } from "../lib/foldGrid.js";

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
    const { tick, tickSeq, gridSpaceId, gridW = DEFAULT_GRID_W, gridH = DEFAULT_GRID_H } = c;
    if (!gridSpaceId || tickSeq == null) {
      return {
        ok: false,
        shape: "internal",
        reason: "summon missing gridSpaceId or tickSeq in content",
      };
    }

    // 1. Fold the grid up to tickSeq. Same ceiling all dancers see → lockstep.
    let board;
    try {
      board = await foldGridUpToSeq(gridSpaceId, tickSeq);
    } catch (err) {
      log.warn("Dancer", `foldGridUpToSeq failed: ${err.message}`);
      return { ok: false, shape: "internal", reason: err.message };
    }

    const meId = String(ctx.toBeing._id);
    const me = board.get(meId);
    if (!me) {
      // Not yet placed by tickSeq. This tick is a no-op for us.
      return { ok: true, content: `tick ${tick}: not placed at tickSeq=${tickSeq}` };
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

    // 3. Emit the move. The op stamps two facts (dancer + grid) in
    //    one atomic moment seal via summonCtx.deltaF.
    try {
      const r = await doVerb(meId, "harmony:move", {
        dx, dy, gridSpaceId, gridW, gridH,
      }, {
        identity: { beingId: meId, name: ctx.toBeing.name },
        summonCtx: ctx,
      });
      return {
        ok: true,
        content: `tick ${tick}: ${r?.moved ? `step(${dx},${dy}) ${stringify(me)}→${stringify(r.to)}` : `clamped at ${stringify(me)}`}`,
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
