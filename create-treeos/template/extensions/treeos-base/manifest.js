export default {
  name: "treeos-base",
  version: "1.0.4",
  builtFor: "TreeOS",
  description:
    "The reference implementation of how the AI thinks inside a tree. Eleven modes, thirty-plus " +
    "MCP tools, and a navigation hook that keeps the frontend synchronized with every operation " +
    "the AI performs. This is the foundation that every tree conversation builds on. " +
    "\n\n" +
    "Converse is the default mode for free-form nodes. It reads the node's notes, children, " +
    "and path, then talks from that position's perspective. Every node has a voice. No extension " +
    "needed. Navigate resolves natural language references to nodes. Librarian walks branches " +
    "and gathers context. Structure creates, moves, and deletes nodes. Edit modifies node fields. " +
    "Notes reads and writes note content. Respond synthesizes a turn into a natural language " +
    "answer. Get Context fetches node data silently. Be mode is focused, present, guided work " +
    "on one step at a time. " +
    "\n\n" +
    "Two home modes handle the space outside of trees. Home Default is a warm, conversational " +
    "landing assistant. Home Reflect reviews notes and contributions across all trees. " +
    "\n\n" +
    "The navigation hook fires afterToolCall and emits a WebSocket navigate event that " +
    "synchronizes the HTML frontend with the AI's actions. " +
    "\n\n" +
    "Every mode and tool is replaceable. Extensions register custom modes that override " +
    "defaults at any node via per-node mode metadata. Remove this extension and the tree " +
    "has no AI behavior. Install it and the tree thinks at every position.",

  needs: {
    services: ["websocket", "llm"],
    models: ["Node", "User", "Note", "Contribution"],
  },

  optional: {
    extensions: ["html-rendering", "navigation"],
  },

  provides: {
    routes: false,
    tools: true,
    modes: true,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    cli: [],
  },
};
