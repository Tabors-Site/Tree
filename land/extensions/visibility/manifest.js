export default {
  name: "visibility",
  version: "1.0.0",
  description: "Public/private tree visibility, share tokens, public query access",

  needs: {
    models: ["Node", "User"],
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
