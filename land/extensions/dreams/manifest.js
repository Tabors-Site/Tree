export default {
  name: "dreams",
  version: "1.0.0",
  description: "Background tree maintenance: cleanup, drain, understanding pipelines",

  needs: {
    services: ["llm", "session", "aiChat", "orchestrator"],
    models: ["Node", "Contribution"],
    extensions: ["understanding"],
  },

  optional: {
    services: ["energy"],
  },

  provides: {
    models: {
      ShortMemory: "./model.js",
    },
    routes: false,
    tools: false,
    jobs: "../../jobs/treeDream.js",
    orchestrator: false,
    energyActions: {},
    sessionTypes: {
      DREAM_ORCHESTRATE: "dream-orchestrate",
    },
    cli: [
      { command: "dream-time <time>", description: "Set daily dream time (HH:MM) for current tree", method: "POST", endpoint: "/root/:rootId/dream-time" },
    ],
  },
};
