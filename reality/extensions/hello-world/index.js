// TreeOS extension: hello-world.
//
// init(reality) registers two things:
//   1. The "greeter" role — when summoned, the being SEEs its
//      position + the children around it and returns a greeting
//      addressed to both the asker AND the world it just saw.
//   2. The "greeter" seed — when planted at a target space, spawns
//      one being there with the greeter role. The plant is itself
//      a SUMMON-create-being (the standard primitive in
//      seed/ibp/verbs/summon.js#summonCreateBeing); we don't invent a new
//      creation path.
//
// The role is scripted today. Flipping to LLM cognition is a one-
// line change in the seed (operatingMode: "scripted" → "llm" +
// configuring an llm connection on the being). The greeting logic
// stays the same; the cognition just changes shape.

import log from "../../seed/seedReality/log.js";
import { cognitionSuccess } from "../../seed/present/cognition/cognitionResult.js";

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
  // Full namespaced name. The seed-side registries don't auto-prefix
  // for roles or seeds (only DO operations + push-channel events get
  // loader-wrapped today), so extensions write the full "<ext>:<name>"
  // form and the registries accept it as-is.
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
        const Space = reality.models.Space;
        const myPlace = await Space.findById(myPosition).select("name").lean();
        if (myPlace?.name) myPlaceName = myPlace.name;
        const children = await Space.find({ parent: myPosition })
          .select("name").lean();
        surroundings = children.map(c => c.name).filter(Boolean);
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

      return cognitionSuccess(greeting);
    },
  });

  // ── Seed: greeter ──────────────────────────────────────────────
  // The plant routes through SUMMON-create-being so the canonical
  // atomic-multi-reel birth shape applies: be:register on the new
  // greeter's reel (self-stamped) PLUS be:summon-create on the
  // planter's reel (audit "I summoned the greeter forth") — both
  // committed in ONE transaction with the planter's moment.
  //
  // Idempotent on re-plant: if a being with this name already exists,
  // summonCreateBeing throws RESOURCE_CONFLICT and we surface it.
  reality.seeds.register("hello-world:greeter", {
    description:
      "Spawns one greeter being at the target space. SUMMON it to receive a hello-world greeting.",
    scaffold: async ({ rootSpaceId, identity, summonCtx }) => {
      const beingName = `hello-${String(rootSpaceId).slice(0, 8)}`;
      const password = `seed-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

      const { summonCreateBeing } = await import(
        "../../seed/ibp/verbs/summon.js"
      );
      const result = await summonCreateBeing({
        spec: {
          name:          beingName,
          password,
          operatingMode: "scripted",
          role:          "hello-world:greeter",
          roles:         ["hello-world:greeter"],
          defaultRole:   "hello-world:greeter",
          homeSpace:     String(rootSpaceId),
          position:      String(rootSpaceId),
          parentBeingId: identity?.beingId || null,
        },
        identity,
        summonCtx,
      });

      log.info(
        "HelloWorld",
        `🌱 planted greeter "${beingName}" at ${String(rootSpaceId).slice(0, 8)}`,
      );
      return {
        being: {
          id:   String(result.beingId),
          name: beingName,
        },
      };
    },
  });

  return {};
}
