// harmony:drummer — the beat-keeper.
//
// Scripted cognition. The drummer has two jobs that take turns:
// walk toward the drum, and strike it when adjacent. Dancers react
// to the strike via the seed's afterQualityWrite subscription fan-
// out — the drummer doesn't know who's listening.
//
// Movement rule. Each wake checks the drum's current coord. If the
// drum has no coord (it's never been moved), the drummer just
// strikes in place. If it has a coord and the drummer isn't within
// one cell of it (Chebyshev distance ≤ 1, i.e. same cell or any of
// the 8 neighbors), the drummer steps one cell toward the drum and
// the wake ends without a strike. Next wake, walk or strike again.
// Operators carrying the drum to a new spot will see the drummer
// follow.
//
// This is the stigmergic shape doctrine asks for. The drummer is
// not a director; it is a drum that is struck. Beings react to
// what they hear. Substrate-self-referential: the tick fact is
// how the substrate tells itself to dance.

import mongoose from "mongoose";
import log from "../../../seed/seedReality/log.js";
import { doVerb } from "../../../seed/ibp/verbs/do.js";

export const drummerRole = Object.freeze({
  name: "harmony:drummer",
  description: "Walks to the drum and strikes it. Dancers react via subscription, not fan-out.",
  permissions: ["do"],
  respondMode: "async",
  triggerOn: ["message"],

  canDo: ["harmony:tick"],
  canSummon: [],
  canBe: [],
  canSee: [],

  prompt: () => "",

  async summon(message, ctx) {
    const wakeContent = message?.content || {};
    const roleCfg = ctx?.toBeing?.qualities?.harmony?.role || {};
    const drumMatterId = wakeContent.drumMatterId || roleCfg.drumMatterId;
    if (!drumMatterId) {
      log.warn("Drummer", "tick fired but missing drumMatterId");
      return { ok: false, shape: "internal", reason: "missing drumMatterId" };
    }

    const drummerId = String(ctx.toBeing._id);
    const identity = { beingId: drummerId, name: ctx.toBeing.name };

    // Read the drum's current coord. The drummer cannot strike
    // unless he's within one cell of the drum, so no coord on the
    // drum means he has no destination — and no rule for ticking
    // either. Stay, log, and try again next wake.
    let drumCoord = null;
    try {
      const Matter = mongoose.model("Matter");
      const drum = await Matter.findById(drumMatterId).select("coord").lean();
      if (drum?.coord && Number.isFinite(drum.coord.x) && Number.isFinite(drum.coord.y)) {
        drumCoord = { x: drum.coord.x, y: drum.coord.y };
      }
    } catch (err) {
      log.warn("Drummer", `drum lookup failed: ${err.message}`);
    }

    if (!drumCoord) {
      return {
        ok: true,
        content: "drum has no coord; staying put until someone places it",
      };
    }

    // The drummer also needs a coord to compute distance. If he
    // doesn't have one, he can't reason about approach. Stay.
    const myCoordRaw = ctx.toBeing.coord;
    if (!myCoordRaw ||
        !Number.isFinite(myCoordRaw.x) ||
        !Number.isFinite(myCoordRaw.y)) {
      return {
        ok: true,
        content: "drummer has no coord; staying put",
      };
    }
    const myCoord = { x: myCoordRaw.x, y: myCoordRaw.y };

    // Adjacency: Chebyshev distance <= 1 (same cell or any 8-neighbor).
    const dx = drumCoord.x - myCoord.x;
    const dy = drumCoord.y - myCoord.y;
    const adjacent = Math.max(Math.abs(dx), Math.abs(dy)) <= 1;

    if (!adjacent) {
      // Out of range. The drummer's whole focus this wake is closing
      // the gap. No tick. Step one cell on the axis of greater
      // distance. If the seed throws (out of bounds), reface to the
      // other axis. If both rejected, stay this wake and try again.
      const sx = Math.sign(dx);
      const sy = Math.sign(dy);
      const xFirst = Math.abs(dx) >= Math.abs(dy);
      const attempts = xFirst
        ? [{ dx: sx, dy: 0 }, { dx: 0, dy: sy }]
        : [{ dx: 0, dy: sy }, { dx: sx, dy: 0 }];

      let stepped = null;
      for (const step of attempts) {
        if (step.dx === 0 && step.dy === 0) continue;
        const nextCoord = { x: myCoord.x + step.dx, y: myCoord.y + step.dy };
        try {
          await doVerb(
            { kind: "being", id: drummerId },
            "set-being",
            { field: "coord", value: nextCoord },
            { identity, summonCtx: ctx },
          );
          stepped = nextCoord;
          break;
        } catch (err) {
          // Refacing on rejection IS the design. Try the other axis.
          log.info("Drummer", `step rejected (${step.dx},${step.dy}): ${err.message}`);
        }
      }

      if (stepped) {
        return {
          ok: true,
          content: `walking toward drum (${myCoord.x},${myCoord.y})→(${stepped.x},${stepped.y})`,
        };
      }
      return {
        ok: true,
        content: `stuck at (${myCoord.x},${myCoord.y}) approaching drum`,
      };
    }

    // Adjacent to the drum — strike.
    try {
      const r = await doVerb(
        { kind: "matter", id: String(drumMatterId) },
        "harmony:tick",
        {},
        { identity, summonCtx: ctx },
      );
      return { ok: true, content: `tick ${r?.tick || 0}` };
    } catch (err) {
      log.warn("Drummer", `tick op failed: ${err.message}`);
      return { ok: false, shape: "internal", reason: err.message };
    }
  },
});
