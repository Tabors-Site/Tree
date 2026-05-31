// harmony:dancer-toward . step toward the nearest neighbor each tick.
//
// Scripted cognition. Reads positions in the dancer's grid space
// from the seed's PositionProjection. Picks the nearest other being
// and tries to step toward it. Out-of-bounds throws at
// set-being:coord; the dancer refaces to the secondary axis.

import log from "../../../seed/seedReality/log.js";
import { doVerb } from "../../../seed/ibp/verbs/do.js";
import { readPositionsInSpace } from "../../../seed/past/projections/position/positionProjectionFold.js";

const DEFAULT_GRID_W = 10;
const DEFAULT_GRID_H = 10;

export const dancerTowardRole = Object.freeze({
  name: "harmony:dancer-toward",
  description: "Steps one cell toward the nearest neighbor each tick (toward grid center when alone).",
  permissions: ["do"],
  respondMode: "async",
  triggerOn: ["message"],

  canDo: [],
  canSummon: [],
  canBe: [],
  canSee: [],

  prompt: () => "",

  async summon(message, ctx) {
    const c = message?.content || {};
    const tick = c.tick;
    const gridSpaceId = c.gridSpaceId || c.spaceId || c.events?.[0]?.spaceId;
    const { gridW = DEFAULT_GRID_W, gridH = DEFAULT_GRID_H } = c;
    if (!gridSpaceId) {
      return {
        ok: false,
        shape: "internal",
        reason: "summon missing gridSpaceId/spaceId in content",
      };
    }

    let positions;
    try {
      positions = await readPositionsInSpace(gridSpaceId);
    } catch (err) {
      log.warn("Dancer", `readPositionsInSpace failed: ${err.message}`);
      return { ok: false, shape: "internal", reason: err.message };
    }

    const meId = String(ctx.toBeing._id);
    const me = positions.find((p) => String(p.beingId) === meId);
    if (!me) {
      return { ok: true, content: `tick ${tick ?? "?"}: not placed on grid` };
    }

    const others = positions.filter((p) => String(p.beingId) !== meId);
    const target = others.length
      ? pickNearest(me, others)
      : { x: Math.floor(gridW / 2), y: Math.floor(gridH / 2) };
    const dxTotal = target.x - me.x;
    const dyTotal = target.y - me.y;
    if (dxTotal === 0 && dyTotal === 0) {
      return { ok: true, content: `tick ${tick ?? "?"}: stay at (${me.x},${me.y})` };
    }

    // Try primary axis; on substrate rejection (out-of-bounds), reface
    // to the secondary. If both refused, stay.
    const sx = Math.sign(dxTotal);
    const sy = Math.sign(dyTotal);
    const xFirst = Math.abs(dxTotal) >= Math.abs(dyTotal);
    const attempts = xFirst
      ? [{ dx: sx, dy: 0 }, { dx: 0, dy: sy }]
      : [{ dx: 0, dy: sy }, { dx: sx, dy: 0 }];

    const identity = { beingId: meId, name: ctx.toBeing.name };
    let stepped = null;
    let lastReason = null;
    for (const step of attempts) {
      if (step.dx === 0 && step.dy === 0) continue;
      const to = { x: me.x + step.dx, y: me.y + step.dy };
      try {
        await doVerb(
          { kind: "being", id: meId },
          "set-being",
          { field: "coord", value: to },
          { identity, summonCtx: ctx },
        );
        stepped = to;
        break;
      } catch (err) {
        lastReason = err.message;
      }
    }

    if (!stepped) {
      return {
        ok: true,
        content: `tick ${tick ?? "?"}: stay at (${me.x},${me.y}) (refaced; both axes rejected${lastReason ? `: ${lastReason}` : ""})`,
      };
    }
    return {
      ok: true,
      content: `tick ${tick ?? "?"}: (${me.x},${me.y})→(${stepped.x},${stepped.y})`,
    };
  },
});

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
