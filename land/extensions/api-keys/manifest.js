export default {
  name: "api-keys",
  version: "1.0.0",
  description: "User API keys for programmatic access to the tree API",

  needs: {
    services: ["auth"],
    models: ["User"],
  },

  optional: {},

  provides: {
    models: {},
    routes: "./routes.js",
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    // CLI commands hardcoded in cli/commands/apikeys.js
  },
};
