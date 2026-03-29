export default {
  name: "instructions",
  version: "1.0.0",
  builtFor: "TreeOS",
  description:
    "Per-node AI behavioral constraints. Set metadata.llm.instructions on any node. " +
    "Text walks the ancestor chain from root to current, concatenated, and prepended " +
    "to the system prompt via beforeLLMCall. Closest node's instructions appear last " +
    "(highest priority in the prompt). The AI follows all accumulated instructions at " +
    "its current position.\n\n" +
    "Not identity (that's persona). Not mode (that's the mode system). Just operator " +
    "policy at a position. 'Be concise.' 'Respond in Spanish.' 'Never give medical advice.' " +
    "Set it and forget it. Inherits down the tree.",

  needs: {
    services: ["hooks", "tree"],
  },

  provides: {
    cli: [
      { command: "instruct <text...>", scope: ["tree"], description: "Set AI instructions at current node", method: "POST", endpoint: "/node/:nodeId/instructions", bodyMap: { instructions: 0 } },
      { command: "instruct-clear", scope: ["tree"], description: "Clear instructions at current node", method: "DELETE", endpoint: "/node/:nodeId/instructions" },
      { command: "instruct-show", scope: ["tree"], description: "Show instructions at current node (including inherited)", method: "GET", endpoint: "/node/:nodeId/instructions" },
    ],
  },
};
