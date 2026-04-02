export default {
  name: "inner",
  version: "1.0.1",
  builtFor: "treeos-intelligence",
  description:
    "The tree thinks to itself. One random thought per breath. " +
    "Picks a random node, reads its context, generates one observation. " +
    "Most of it is noise. Some of it is the connection nobody asked for. " +
    "Other extensions read .inner notes for signals they wouldn't find " +
    "through targeted search. The serendipity engine.",

  needs: {
    models: ["Node", "Note"],
    services: ["hooks", "llm"],
  },

  optional: {
    extensions: ["breath", "html-rendering", "treeos-base"],
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
