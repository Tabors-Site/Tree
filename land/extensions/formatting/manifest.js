export default {
  name: "formatting",
  version: "1.0.0",
  description: "Cleans LLM responses. Strips emojis, normalizes whitespace, trims trailing filler.",

  needs: {},

  provides: {
    hooks: {
      listens: ["beforeResponse"],
    },
  },
};
