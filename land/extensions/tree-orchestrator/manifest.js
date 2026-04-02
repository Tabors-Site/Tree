export default {
  name: "tree-orchestrator",
  version: "1.0.3",
  builtFor: "TreeOS",
  description:
    "Position determines reality. Every message that enters a tree passes through this " +
    "orchestrator. It routes to the right extension or to tree:converse. " +
    "\n\n" +
    "The routing index maps extensions to positions in the tree. If the current node or a " +
    "nearby node has a mode override (modes.respond), and the extension's classifier hints " +
    "match the message, the orchestrator routes directly to that extension's mode. One mode, " +
    "focused tools, domain-specific system prompt. No LLM call for routing. " +
    "\n\n" +
    "When multiple extensions match (classifier hints from two or more extensions in the " +
    "routing index fire on the same message), the orchestrator chains them. Each extension " +
    "runs as a focused agent in its own mode. Results pass from one step to the next. " +
    "Browser-bridge reads a page, KB saves the key points, gateway posts to Reddit. Each " +
    "step has only its own tools. " +
    "\n\n" +
    "When no extension claims the message, tree:converse handles it. Converse reads the " +
    "node's notes, children, and path, then talks from that position's perspective. Every " +
    "node has a voice. No extension needed. " +
    "\n\n" +
    "This is the reference tree orchestrator. Replace it entirely by registering a custom " +
    "orchestrator for bigMode tree.",

  needs: {
    services: ["llm", "session", "chat", "mcp", "websocket", "hooks", "orchestrator"],
    models: ["Node"],
    extensions: ["treeos-base"],
  },

  optional: {
    extensions: ["competence", "explore", "contradiction", "purpose", "evolution", "remember", "understanding"],
  },

  provides: {
    routes: false,
    tools: false,
    jobs: false,
    orchestrator: { bigMode: "tree" },
    hooks: {
      fires: [],
      listens: ["afterBoot", "afterMetadataWrite", "beforeNodeDelete", "afterNodeMove"],
    },
  },
};
