export default {
  name: "instructions",
  version: "1.1.1",
  builtFor: "TreeOS",
  description:
    "AI behavioral constraints at two layers. Per-node: set metadata.llm.instructions " +
    "on any node, walks the ancestor chain, prepends to the system prompt. Inherits " +
    "down the tree. Per-user: set instructions on the user that follow them across " +
    "every tree, every position, every extension. Two scopes: 'global' applies " +
    "everywhere; per-extension applies only when that extension's mode is active. " +
    "Both layers stack: user instructions appear before node instructions in the " +
    "system prompt, broadest scope first, narrowest last.\n\n" +
    "Capture is conversational. The add-instruction tool is injected into every " +
    "conversation mode. The AI calls it when the user says 'remember to...', " +
    "'I'm vegetarian', 'always use kg', 'from now on...'. The user never thinks " +
    "about scoping. The AI picks the right scope from context.",

  needs: {
    services: ["hooks", "tree", "metadata"],
    models: ["Node", "User"],
  },

  provides: {
    tools: true,
    cli: [
      // Node-level (existing)
      { command: "instruct <text...>", scope: ["tree"], description: "Set AI instructions at current node", method: "POST", endpoint: "/node/:nodeId/instructions", bodyMap: { instructions: 0 } },
      { command: "instruct-clear", scope: ["tree"], description: "Clear instructions at current node", method: "DELETE", endpoint: "/node/:nodeId/instructions" },
      { command: "instruct-show", scope: ["tree"], description: "Show instructions at current node (including inherited)", method: "GET", endpoint: "/node/:nodeId/instructions" },
      // User-level (new)
      { command: "instruct-me <text...>", scope: ["home", "tree"], description: "Add a personal instruction the AI follows everywhere", method: "POST", endpoint: "/user/:userId/instructions", bodyMap: { text: 0 } },
      { command: "instruct-me-show", scope: ["home", "tree"], description: "Show all your personal instructions", method: "GET", endpoint: "/user/:userId/instructions" },
      { command: "instruct-me-remove <id>", scope: ["home", "tree"], description: "Remove a personal instruction by id", method: "DELETE", endpoint: "/user/:userId/instructions/:id" },
    ],
  },
};
