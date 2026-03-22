export default {
  name: "dreams",
  version: "1.0.0",
  description: "Background tree maintenance: cleanup, drain, understanding pipelines",

  needs: {
    services: ["llm", "session", "aiChat", "orchestrator"],
    models: ["Node", "Contribution"],
  },

  optional: {
    services: ["energy"],
  },

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: "../../jobs/treeDream.js",
    orchestrator: false,
    energyActions: {},
    sessionTypes: {
      DREAM_ORCHESTRATE: "dream-orchestrate",
    },
  },
};
