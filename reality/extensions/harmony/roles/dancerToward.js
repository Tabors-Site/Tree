// harmony:dancer-toward — step toward the nearest neighbor each tick.
//
// Scripted cognition. Wakes on a SUMMON from the drummer carrying
// { tick, tickSeq, gridSpaceId }. The dancer folds the LIVE grid
// (no seq ceiling — PARALLEL FACTS Rung 5), reads its own resolved
// coords from the fold, picks a primary axis to step on, and asks
// the seed via harmony:move.
//
// Cognition tries, the seed enforces. Out-of-bounds coords throw at
// set-being:coord — no fact seals, the moment unwinds with whatever
// ΔF had accumulated discarded. This dancer catches the rejection
// and refaces to the secondary axis, then tries one more time. If
// both axes are refused, it stays. The dancer does not know the
// rules; it just asks. The substrate is the floor.
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
    // The wake content shape varies by source:
    //   - direct SUMMON from a scheduler (legacy/test path) carries
    //     { gridSpaceId, tick, ... } explicitly.
    //   - DO-trigger SUMMON from afterQualityWrite (the drum tick
    //     subscription) carries { event:"afterQualityWrite",
    //     spaceId, actorBeingId, action, ... } per the seed's
    //     _renderTriggerContent. `spaceId` IS the drum's spaceId,
    //     which IS the dance-floor grid space.
    // Accept either shape; the rule logic only needs to know which
    // grid to fold.
    const tick = c.tick;
    const gridSpaceId = c.gridSpaceId || c.spaceId;
    const { gridW = DEFAULT_GRID_W, gridH = DEFAULT_GRID_H } = c;
    if (!gridSpaceId) {
      return {
        ok: false,
        shape: "internal",
        reason: "summon missing gridSpaceId/spaceId in content",
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
      return { ok: true, content: `tick ${tick ?? "?"}: not placed on grid` };
    }

    // 2. Rule: step toward nearest neighbor; default to grid center if alone.
    const others = [];
    for (const [id, pos] of board.entries()) {
      if (id !== meId) others.push(pos);
    }
    const target = others.length
      ? pickNearest(me, others)
      : { x: Math.floor(gridW / 2), y: Math.floor(gridH / 2) };
    const dxTotal = target.x - me.x;
    const dyTotal = target.y - me.y;
    if (dxTotal === 0 && dyTotal === 0) {
      return { ok: true, content: `tick ${tick ?? "?"}: stay at (${me.x},${me.y})` };
    }

    // 3. Try primary axis first; on rejection (seed throws on out-of-
    //    bounds), reface to the secondary axis and try once more.
    //    Cognition doesn't know the rules — it just tries. The
    //    substrate enforces. If both axes are rejected, stay.
    const sx = Math.sign(dxTotal);
    const sy = Math.sign(dyTotal);
    const xFirst = Math.abs(dxTotal) >= Math.abs(dyTotal);
    const attempts = xFirst
      ? [{ dx: sx, dy: 0 }, { dx: 0, dy: sy }]
      : [{ dx: 0, dy: sy }, { dx: sx, dy: 0 }];

    const identity = { beingId: meId, name: ctx.toBeing.name };
    let moveResult = null;
    let lastReason = null;
    for (const step of attempts) {
      if (step.dx === 0 && step.dy === 0) continue;
      const to = { x: me.x + step.dx, y: me.y + step.dy };
      try {
        moveResult = await doVerb(meId, "harmony:move", {
          from: me, to, gridSpaceId, gridW, gridH,
        }, { identity, summonCtx: ctx });
        break;
      } catch (err) {
        lastReason = err.message;
        // Refacing on rejection IS the design. The seed threw, so
        // nothing was committed; try the other axis.
      }
    }

    if (!moveResult) {
      return {
        ok: true,
        content: `tick ${tick ?? "?"}: stay at (${me.x},${me.y}) (refaced; both axes rejected${lastReason ? `: ${lastReason}` : ""})`,
      };
    }
    return {
      ok: true,
      content: `tick ${tick ?? "?"}: ${stringify(me)}→${stringify(moveResult.to)}`,
    };
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

// The axis choice + reface lives inline in summon now. The seed
// asserts coord bounds; the cognition just tries primary, catches
// the rejection, and tries secondary.

function stringify(p) { return `(${p.x},${p.y})`; }
