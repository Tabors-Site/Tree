export default {
  name: "starter-types",
  version: "1.0.0",
  description: "Default node type suggestions for the AI. Configurable per land.",

  needs: {
    services: ["hooks"],
  },

  optional: {},

  provides: {
    models: {},
    routes: false,
    tools: true,
    modes: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    cli: [],
  },
};
