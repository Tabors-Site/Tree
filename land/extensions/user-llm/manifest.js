export default {
  name: "user-llm",
  version: "1.0.0",
  description: "Custom LLM connections, user/root level LLM assignment",

  needs: {
    models: ["User", "Node"],
  },

  optional: {},

  provides: {
    models: {
      CustomLlmConnection: "./model.js",
    },
    routes: "./routes.js",
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    // CLI commands hardcoded in cli/commands/llm.js (interactive flows)
  },
};
