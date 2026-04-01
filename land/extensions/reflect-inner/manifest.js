export default {
  name: "reflect-inner",
  version: "1.0.0",
  builtFor: "treeos-intelligence",
  description:
    "Layer 2 of the inner monologue. Every 24 hours, compresses the tree's raw thoughts " +
    "into 5 themes. 200 scattered observations become a concise summary. Other extensions " +
    "(intent, purpose, evolve, rings) read themes instead of parsing individual notes. " +
    "The tree notices patterns in its own thinking.",

  needs: {
    models: ["Node", "Note"],
    services: ["hooks", "llm"],
  },

  optional: {
    extensions: ["breath", "inner"],
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
