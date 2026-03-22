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
    routes: "./routes.js",
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    // CLI commands hardcoded in cli/commands/apikeys.js
  },
};
