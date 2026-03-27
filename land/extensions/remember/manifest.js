export default {
  name: "remember",
  version: "1.0.0",
  builtFor: "treeos-maintenance",
  description:
    "The tree remembers what it lost. When a child is pruned, split off, or retired, " +
    "remember writes one line to the parent. Not the content. Not the structure. Just " +
    "acknowledgment that something was here and now it isn't. The AI at that position " +
    "knows what used to be below it without being told. It doesn't bring it up unprompted. " +
    "But if you ask what used to be here, it can tell you. The tree's memorial.",

  needs: {
    services: ["hooks", "metadata"],
    models: ["Node"],
  },

  optional: {
    extensions: ["prune", "split"],
  },

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},

    hooks: {
      fires: [],
      listens: ["beforeNodeDelete", "afterMetadataWrite", "enrichContext"],
    },

    cli: [],
  },
};
