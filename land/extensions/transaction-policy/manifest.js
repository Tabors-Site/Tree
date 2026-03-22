export default {
  name: "transaction-policy",
  version: "1.0.0",
  description: "Per-root trade policies, approval flows, and value exchange rules",

  needs: {
    models: ["Node"],
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
