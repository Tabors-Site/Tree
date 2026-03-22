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
      CustomLlmConnection: "../../db/models/customLlmConnection.js",
    },
    routes: "./routes.js",
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    cli: [
      { command: "llms", description: "List your custom LLM connections", method: "GET", endpoint: "/user/:userId/custom-llm" },
    ],
  },
};
