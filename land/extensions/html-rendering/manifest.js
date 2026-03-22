export default {
  name: "html-rendering",
  version: "1.0.0",
  description: "Server-rendered HTML pages gated behind ENABLE_FRONTEND_HTML",

  needs: {
    models: ["User", "Node"],
  },

  optional: {},

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
  },
};
