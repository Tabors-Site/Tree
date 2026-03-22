export default {
  name: "understanding",
  version: "1.0.0",
  description: "Bottom-up tree compression with LLM summarization",

  // Required: won't load without these
  needs: {
    services: ["llm", "session", "aiChat", "orchestrator", "mcp"],
    models: ["Node", "Contribution"],
  },

  // Optional: works without these, gets no-op stubs if missing
  optional: {
    services: ["energy", "contributions"],
  },

  provides: {
    models: {
      UnderstandingRun: "../../db/models/understandingRun.js",
      UnderstandingNode: "../../db/models/understandingNode.js",
    },
    routes: "../../routes/api/understanding.js",
    tools: false,  // tools still registered in mcp/server.js for now
    jobs: "../../jobs/understandingAutoRun.js",
    orchestrator: "../../orchestrators/pipelines/understand.js",
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
