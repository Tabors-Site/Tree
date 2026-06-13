// TreeOS extension: hello-world.
//
// init(reality) registers the "greeter" role — when summoned, the
// being SEEs its position + the children around it and returns a
// greeting addressed to both the asker AND the world it just saw.
//
// The role is scripted today. Flipping to LLM cognition is a one-
// line change in the spec (cognition: "scripted" → "llm" + an
// llm connection on the being). The greeting logic stays the same.
//
// The greeter being itself was previously planted via an extension
// seed-scaffold (reality.seeds.register / plant-seed). That system
// retired 2026-06-07 in favor of the clone+graft primitive. A future
// rev ships the greeter as a clone bundle in provides.clones.

import log from "../../seed/seedReality/log.js";

export async function init(reality) {
  const realityDomain = process.env.REALITY_DOMAIN || "localhost";

  // ── Role: greeter ──────────────────────────────────────────────
  // When summoned, the being looks at its position: who am I, where
  // am I, what's around me. Returns one greeting that addresses both
  // the asker AND the surroundings — "hello world" to both.
  //
  // Returns a CognitionResult (Round 5 contract). On any internal
  // failure (e.g., the position can't be resolved), returns
  // cognitionFailure — the moment then releases with no Act,
  // structurally clean.
  // Full namespaced name. The substrate's role registry doesn't
  // auto-prefix (only DO operations + push-channel events get
  // loader-wrapped today), so extensions write the full "<ext>:<name>"
  // form and the registry accepts it as-is.
  reality.declare.registerRole("hello-world:greeter", {
    permissions: ["see"],
    respondMode: "async",
    triggerOn:   ["message"],
    async summon(message, ctx) {
      const me = ctx.toBeing;
      const myPosition = ctx.spaceId || me.position || me.homeSpace;

      // SEE around: my space + the children of my space.
      // Direct model queries here because the role is scripted;
      // the LLM variant would let the LLM use a SEE tool instead.
      let myPlaceName = "an unnamed space";
      let surroundings = [];
      try {
        const myPlace = await ctx.read("space", myPosition);
        if (myPlace?.name) myPlaceName = myPlace.name;
        const { default: Projection } = await import("../../seed/materials/branch/projection.js");
        const children = await Projection.find({
          branch: ctx.branch, type: "space",
          "state.parent": myPosition,
          tombstoned: { $ne: true },
        }).select("state").lean();
        surroundings = children.map(c => c.state?.name).filter(Boolean);
      } catch (err) {
        log.warn("HelloWorld", `greeter SEE failed: ${err.message}`);
      }

      // Parse the asker's name out of message.from (a stance string).
      // Stance shape: "<reality>/<path>@<name>". Last @<name> is the asker.
      let askerName = "stranger";
      if (typeof message?.from === "string") {
        const m = message.from.match(/@([a-z][a-z0-9-]*)$/i);
        if (m) askerName = m[1];
      }

      // The greeting. Hello world to both:
      //   - the asker (you)
      //   - the world around me (the position + its children)
      const surroundingsClause = surroundings.length > 0
        ? `and to the world I see — ${myPlaceName}, surrounded by ${surroundings.map(s => `"${s}"`).join(", ")}`
        : `and to "${myPlaceName}", quiet around me`;

      const greeting = `Hello world! Hello to you, ${askerName}, ${surroundingsClause}.`;

      return ctx.act(greeting);
    },
  });

  // Extension seed-scaffolds retired 2026-06-07. The hello-world
  // greeter previously planted via reality.seeds.register(...) — that
  // surface is gone. To ship the greeter as installable structure,
  // future work declares a clone bundle in manifest.provides.clones
  // (per Chain-Rebuild doctrine: a static bundle of facts an operator
  // grafts at a position).

  return {};
}
