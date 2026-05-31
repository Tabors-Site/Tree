// harmony:tick — the drummer's beat.
//
// One DO op: stamps a tick-fact on the drum matter's reel. The fact
// shape is do:set-matter on qualities.harmony.tick = { n, at }. Each
// call increments n. The drum's reel becomes the timeline of beats.
//
// The drum is just matter — done-to, no act-chain. The drummer-being
// is the actor; the drum is the surface the beat lands on.

export default {
  name: "tick",  // becomes harmony:tick after loader namespacing
  targets: ["matter"],

  async handler({ target, identity, summonCtx }) {
    // Load the drum row so we can read its current tick count. The
    // verb layer hands handlers a typed identity ({kind,id}) or a
    // string id — not the row. The previous code read
    // `target?.qualities?.harmony?.tick` directly on whatever shape
    // arrived; on a typed target there's no `qualities` field, so
    // prevN was always 0 and every tick said "tick 1." Load the row
    // and read from it.
    const { loadTargetRow } = await import("../../../seed/materials/_targetShape.js");
    const drum = await loadTargetRow(target, "matter");

    const harmonyQuals = drum.qualities instanceof Map
      ? drum.qualities.get("harmony")
      : drum.qualities?.harmony;
    const cur = harmonyQuals?.tick;
    const prevN = (cur && typeof cur === "object" && Number.isFinite(cur.n)) ? cur.n : 0;
    const next = { n: prevN + 1, at: new Date().toISOString() };

    // Defer the actual emit to the seed do.set-matter op (single
    // canonical write surface for matter qualities). The drummer role
    // calls this op via place.do(drumMatterId, "harmony:tick", ...);
    // the wire shape stays uniform with other state changes by routing
    // through do.set-matter explicitly. The handler runs inside doVerb
    // already, so opts.summonCtx is what threads the moment's actId
    // and deltaF accumulator.
    const { doVerb } = await import("../../../seed/ibp/verbs/do.js");
    await doVerb(
      { kind: "matter", id: String(drum._id) },
      "set-matter",
      {
        field: "qualities.harmony.tick",
        value: next,
      },
      { identity, summonCtx },
    );

    return { tick: next.n, at: next.at };
  },
};
