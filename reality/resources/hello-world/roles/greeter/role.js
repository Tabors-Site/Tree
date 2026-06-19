// hello-world:greeter — scripted role spec.
//
// When summoned, the being looks at its position: who am I, where
// am I, what's around me. Returns one greeting that addresses both
// the asker AND the surroundings.
//
// Scripted cognition. Flipping to LLM is a one-line change in the
// seed (cognition: "llm" + an llm connection on the being); the
// greeting logic stays the same.

import log from "../../../../seed/seedStory/log.js";

export const greeterRole = Object.freeze({
  permissions: ["see"],
  respondMode: "async",
  triggerOn:   ["message"],
  description: "Greets the asker and the world it sees around itself.",

  async call(message, ctx) {
    const me = ctx.toBeing;
    const myPosition = ctx.spaceId || me.position || me.homeSpace;

    // SEE around: my space + the children of my space.
    let myPlaceName = "an unnamed space";
    let surroundings = [];
    try {
      const myPlace = await ctx.read("space", myPosition);
      if (myPlace?.name) myPlaceName = myPlace.name;
      const { default: Projection } = await import("../../../../seed/materials/branch/projection.js");
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
    // Stance shape: "<story>/<path>@<name>". Last @<name> is the asker.
    let askerName = "stranger";
    if (typeof message?.from === "string") {
      const m = message.from.match(/@([a-z][a-z0-9-]*)$/i);
      if (m) askerName = m[1];
    }

    const surroundingsClause = surroundings.length > 0
      ? `and to the world I see — ${myPlaceName}, surrounded by ${surroundings.map(s => `"${s}"`).join(", ")}`
      : `and to "${myPlaceName}", quiet around me`;

    const greeting = `Hello world! Hello to you, ${askerName}, ${surroundingsClause}.`;

    return ctx.act(greeting);
  },
});
