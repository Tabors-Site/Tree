export default {
  name: "compare-inner",
  version: "1.0.1",
  builtFor: "treeos-intelligence",
  description:
    "Layer 3 of the inner monologue. Compares this week's themes to last week's. " +
    "'New: study stagnation appeared. Gone: kb gaps resolved. Persistent: recovery avoidance " +
    "(3 weeks running).' Three weeks of the same theme means the tree has a pattern, not a blip. " +
    "Persistent themes become character traits. New themes are emerging concerns. Gone themes " +
    "are resolved or forgotten. The tree tracks its own evolution by watching what it keeps noticing. " +
    "\n\n" +
    "Reads Layer 2 (reflect-inner) daily theme summaries. Produces a weekly comparison with " +
    "three sections: NEW (just appeared), GONE (resolved or abandoned), PERSISTENT (with duration " +
    "in weeks). Persistence tracking accumulates across comparisons. When compare-inner says " +
    "'recovery avoidance (3 weeks running)' it's because it read its own previous comparison " +
    "that said '2 weeks running' and incremented. The tree's memory of its own patterns deepens " +
    "with each weekly cycle.",

  needs: {
    models: ["Node", "Note"],
    services: ["hooks", "llm"],
  },

  optional: {
    extensions: ["breath", "inner", "reflect-inner"],
  },

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    env: [],
    cli: [],

    hooks: {
      fires: [],
      listens: ["breath:exhale"],
    },
  },
};
