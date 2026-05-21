export default {
  name: "dynamic-rename",
  version: "1.0.1",
  builtFor: "TreeOS",
  description:
    "Renames tree roots after setup completes. Reads the tree content and generates " +
    "a short descriptive name via one background LLM call. Non-blocking. Works with any " +
    "extension that follows the setupPhase pattern. Silent failure if LLM unavailable.",

  needs: {
    services: ["hooks", "llm"],
    models: ["Node"],
  },

  optional: {},

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: false,
    modes: false,

    hooks: {
      fires: [],
      listens: ["afterMetadataWrite"],
    },
  },
};
