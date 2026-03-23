export default {
  name: "user-llm",
  version: "1.0.0",
  description: "Custom LLM connections with per user and per tree model assignment",

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
  },
};
