// harmony:tick — the drummer's beat.
//
// One DO op: stamps a tick-fact on the drum matter's reel. The fact
// shape is do:set on qualities.harmony.tick = { n, at }. Each call
// increments n. The drum's reel becomes the timeline of beats.
//
// The drum is just matter — done-to, no act-chain. The drummer-being
// is the actor; the drum is the surface the beat lands on.

export default {
  name: "tick",  // becomes harmony:tick after loader namespacing
  targets: ["matter"],

  async handler({ target, params, identity, summonCtx }) {
    // Read current tick count from the matter's qualities.
    const cur = target?.qualities?.harmony?.tick;
    const prevN = (cur && typeof cur === "object" && Number.isFinite(cur.n)) ? cur.n : 0;
    const next = { n: prevN + 1, at: new Date().toISOString() };

    // do:set the inner key. The seed's set op recognizes nested
    // qualities.<ns>.<key> paths and writes the leaf atomically.
    // Since we're inside a moment, this pushes a fact onto
    // summonCtx.deltaF; sealAct commits it with the moment's Act
    // in one transaction.
    const targetId = target?._id || target?.id || params?.targetId;
    if (!targetId) {
      throw new Error("harmony:tick requires a matter target with _id");
    }

    // Defer the actual emit to the seed do.set op (single canonical
    // write surface). Use the place-bound do reference if present on
    // ctx, otherwise import. The drummer role calls this op via
    // place.do(drumMatterId, "harmony:tick", { n: prev+1 }) — but the
    // handler here doesn't need a recursive do.set because the op spec
    // already sets factAction; the auto-Fact would land here as
    // harmony:tick. To keep the wire shape uniform with other state
    // changes, we route through do.set explicitly. The handler runs
    // inside doVerb already, so opts.summonCtx is what threads the
    // moment's actId and deltaF accumulator.
    const { doVerb } = await import("../../../seed/ibp/verbs.js");
    await doVerb(targetId, "set", {
      field: "qualities.harmony.tick",
      value: next,
    }, {
      identity,
      summonCtx,
    });

    return { tick: next.n, at: next.at };
  },
};
