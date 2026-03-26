export default {
  name: "understanding",
  version: "1.0.0",
  description: "Bottom up tree compression. Summarizes node layers with LLM for navigational context.",

  // Required: won't load without these
  needs: {
    services: ["llm", "session", "chat", "orchestrator", "mcp", "contributions", "hooks"],
    models: ["Node", "Contribution"],
  },

  optional: {
    services: ["energy"],
    extensions: ["html-rendering"],
  },

  provides: {
    hooks: {
      listens: ["enrichContext"],
    },
    models: {
      UnderstandingRun: "./understandingRun.js",
      UnderstandingNode: "./understandingNode.js",
    },
    routes: "./routes.js",
    tools: true,
    jobs: "./autoRunJob.js",
    orchestrator: "./pipeline.js",
    energyActions: {
      understanding: { cost: 1, unit: "per-node" },
    },
    sessionTypes: {
      UNDERSTANDING_ORCHESTRATE: "understanding-orchestrate",
    },
    cli: [
      { command: "understand", description: "Start an understanding run on current tree", method: "POST", endpoint: "/root/:rootId/understandings" },
      { command: "understandings", description: "List understanding runs", method: "GET", endpoint: "/root/:rootId/understandings" },
    ],
  },
};
