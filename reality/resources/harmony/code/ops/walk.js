// harmony:walk . the drummer's step.
//
// One DO op: stamps a walk-fact on the drummer's reel, then delegates
// the actual coord write to do.set-being inside the same moment so
// both facts seal atomically. The walk fact's purpose is the
// semantic action name on the wire: when the rung-3 fact-arrival
// push fan-outs to portals, the dispatcher looks up
// drummer.qualities.render.animations["harmony:walk"] and plays the
// "walk" clip on the AnimationMixer. Without a separate semantic
// fact, the only thing the substrate would carry is "set-being"
// which the portal can't map to a specific animation cleanly.
//
// Params: { coord: { x, y } } . the next cell the drummer is
// stepping into. The op validates only that coord exists; the inner
// set-being:coord call enforces the box-bounds clamp.

export default {
  name: "walk",  // becomes harmony:walk after loader namespacing
  targets: ["being"],

  async handler({ target, params, identity, moment }) {
    const { loadTargetRow, targetIdOf } = await import("../../../seed/materials/_targetShape.js");
    const being = await loadTargetRow(target, "being");
    const coord = params?.coord;
    if (!coord || !Number.isFinite(coord.x) || !Number.isFinite(coord.y)) {
      throw new Error("harmony:walk requires params.coord = { x, y }");
    }

    // Delegate to set-being:coord for the actual position write. The
    // inner doVerb call rides the same moment so the set-being
    // fact joins this moment's deltaF and seals alongside the outer
    // harmony:walk fact . one moment, two facts on the drummer's
    // reel: harmony:walk (semantic) + set-being (coord change).
    const { doVerb } = await import("../../../seed/ibp/verbs/do.js");
    await doVerb(
      { kind: "being", id: String(being._id) },
      "set-being",
      { field: "coord", value: { x: coord.x, y: coord.y } },
      { identity, moment },
    );

    return { coord: { x: coord.x, y: coord.y } };
  },
};
