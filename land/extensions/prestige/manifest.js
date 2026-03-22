export default {
  name: "prestige",
  version: "1.0.0",
  description: "Node versioning system with generation cycling",

  needs: {
    models: ["Node", "Contribution"],
  },

  optional: {
    services: ["energy"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {
      prestige: { cost: 1 },
    },
    sessionTypes: {},
  },
};
