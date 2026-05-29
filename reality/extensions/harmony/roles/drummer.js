// harmony:drummer — the beat-keeper.
//
// Scripted cognition. The drummer's job is exactly one thing:
// stamp a tick-fact on the drum matter. Nothing else.
//
// The drummer does NOT know who the dancers are. It does NOT
// discover them. It does NOT fan SUMMONs. The drum is the
// environment, the tick is a fact about that environment, and
// every being subscribed to drum-ticks on the grid space hears it
// via the seed's afterQualityWrite → subscription fan-out (see
// [seed/present/wakes/subscriptions.js]).
//
// This is the stigmergic shape doctrine asks for. The drummer is
// not a director; it is a drum that is struck. Beings react to
// what they hear. Substrate-self-referential: the tick fact is
// how the substrate tells itself to dance.

import log from "../../../seed/seedReality/log.js";
import { doVerb } from "../../../seed/ibp/verbs/do.js";

export const drummerRole = Object.freeze({
  name: "harmony:drummer",
  description: "Strikes the drum. Dancers react via subscription, not fan-out.",
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

    try {
      const r = await doVerb(drumMatterId, "harmony:tick", {}, { identity, summonCtx: ctx });
      return { ok: true, content: `tick ${r?.tick || 0}` };
    } catch (err) {
      log.warn("Drummer", `tick op failed: ${err.message}`);
      return { ok: false, shape: "internal", reason: err.message };
    }
  },
});
