export default {
  name: "api-keys",
  version: "1.0.0",
  description: "User-generated API keys for programmatic tree access",

  needs: {
    models: ["User"],
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
