export default {
  name: "user-queries",
  version: "1.0.0",
  description: "Saved user queries and public query page for tree interrogation",

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
