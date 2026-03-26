export default {
  name: "llm-response-formatting",
  version: "1.0.0",
  description: "Cleans LLM responses and normalizes tool names. Strips emojis, normalizes whitespace, fixes model tool name mismatches.",

  needs: {
    services: ["hooks"],
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

    hooks: {
      fires: [],
      listens: ["beforeResponse", "beforeToolCall"],
    },
  },
};
