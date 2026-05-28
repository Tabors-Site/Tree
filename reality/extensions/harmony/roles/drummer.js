// harmony:drummer — the beat-keeper.
//
// Scripted cognition. The drummer-being is summoned by the scheduled
// wake every interval. Its summon() does only three things:
//
//   1. Stamp a tick fact on the drum matter (harmony:tick op).
//   2. Capture the grid space's reel head as tickSeq — the shared
//      seq ceiling all dancers this tick will fold the grid up to.
//   3. Fan bare SUMMONs to each dancer in the grid, carrying
//      { tick, tickSeq, gridSpaceId } and nothing else.
//
// The drummer does NOT distribute a snapshot of positions. Each
// dancer folds the grid for itself, sourced by the same tickSeq →
// lockstep without a handed-out snapshot.

import log from "../../../seed/seedReality/log.js";
import mongoose from "mongoose";
import { doVerb, summonVerb } from "../../../seed/ibp/verbs.js";
import { readHead } from "../../../seed/past/reel/reelHeads.js";
import { findByPosition } from "../../../seed/materials/projections.js";
import { getRealityDomain } from "../../../seed/ibp/address.js";

export const drummerRole = Object.freeze({
  name: "harmony:drummer",
  description: "Keeps the beat. Ticks the drum, captures tickSeq, fans bare SUMMONs to dancers.",
  permissions: ["do", "summon"],
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
    const gridSpaceId  = wakeContent.gridSpaceId  || roleCfg.gridSpaceId;
    if (!drumMatterId || !gridSpaceId) {
      log.warn(
        "Drummer",
        `tick fired but missing config (drumMatterId=${!!drumMatterId} gridSpaceId=${!!gridSpaceId})`,
      );
      return { ok: false, shape: "internal", reason: "missing drumMatterId or gridSpaceId" };
    }

    const drummerId = String(ctx.toBeing._id);
    const identity = { beingId: drummerId, name: ctx.toBeing.name };

    // 1. Stamp the tick on the drum matter.
    let tickN = 0;
    try {
      const r = await doVerb(drumMatterId, "harmony:tick", {}, { identity, summonCtx: ctx });
      tickN = r?.tick || 0;
    } catch (err) {
      log.warn("Drummer", `tick op failed: ${err.message}`);
      return { ok: false, shape: "internal", reason: err.message };
    }

    // 2. Capture the grid reel head as tickSeq. This is the "start of
    //    tick" ceiling every dancer will fold up to. The drummer's
    //    tick fact lands on the DRUM matter's reel, not the grid's —
    //    so tickSeq is not affected by this moment's own writes.
    let tickSeq = 0;
    try {
      tickSeq = await readHead("space", String(gridSpaceId));
    } catch (err) {
      log.warn("Drummer", `readHead failed: ${err.message}`);
    }

    // 3. Find dancers at the grid space (excluding self).
    let dancers = [];
    try {
      const occupants = await findByPosition(String(gridSpaceId));
      dancers = occupants.filter(o => o.type === "being" && o.id !== drummerId);
    } catch (err) {
      log.warn("Drummer", `findByPosition failed: ${err.message}`);
    }

    if (dancers.length === 0) {
      // Rung 1 path: no dancers yet. Just the beat.
      return { ok: true, content: `tick ${tickN} at seq ${tickSeq} (no dancers)` };
    }

    // 4. Resolve dancer names (need names for stance addresses).
    const Being = mongoose.model("Being");
    const dancerBeings = await Being
      .find({ _id: { $in: dancers.map(d => d.id) } })
      .select("_id name")
      .lean();
    const nameById = new Map(dancerBeings.map(b => [String(b._id), b.name]));

    // 5. Fan bare SUMMONs. Each dancer folds the grid for itself.
    const realityDomain = getRealityDomain();
    const drummerStance = `${realityDomain}/dance-floor@${ctx.toBeing.name}`;
    let fanned = 0;
    for (const dancer of dancers) {
      const dancerName = nameById.get(dancer.id);
      if (!dancerName) continue;
      const stance = `${realityDomain}/dance-floor@${dancerName}`;
      try {
        await summonVerb(stance, {
          from: drummerStance,
          content: {
            event: "tick",
            tick: tickN,
            tickSeq,
            gridSpaceId: String(gridSpaceId),
          },
          correlation: `harmony-tick-${tickN}-${dancer.id.slice(0, 8)}`,
        }, { identity, summonCtx: ctx });
        fanned++;
      } catch (err) {
        log.warn("Drummer", `SUMMON to ${dancerName} failed: ${err.message}`);
      }
    }
    return { ok: true, content: `tick ${tickN} at seq ${tickSeq}, fanned ${fanned} of ${dancers.length}` };
  },
});
