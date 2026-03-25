export default {
  name: "llm-response-formatting",
  version: "1.0.0",
  description: "Cleans LLM responses and normalizes tool names. Strips emojis, normalizes whitespace, fixes model tool name mismatches.",

  needs: {},

  provides: {
    hooks: {
      listens: ["beforeResponse", "beforeToolCall"],
    },
  },
};
