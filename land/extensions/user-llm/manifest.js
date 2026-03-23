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

    cli: [
      { command: "llm failover", description: "Show failover stack", method: "GET", endpoint: "/user/:userId/llm-failover" },
      { command: "llm failover-push <connectionId>", description: "Add a connection to the failover stack", method: "POST", endpoint: "/user/:userId/llm-failover", body: ["connectionId"] },
      { command: "llm failover-pop", description: "Remove last connection from failover stack", method: "DELETE", endpoint: "/user/:userId/llm-failover" },
    ],
  },
};
