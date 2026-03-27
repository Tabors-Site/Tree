export default {
  name: "user-queries",
  version: "1.0.0",
  builtFor: "TreeOS",
  description:
    "Cross-tree queries scoped to a single user. The kernel stores notes, contributions, " +
    "and chats per node, but users need to see their own activity across all trees in one " +
    "place. This extension provides three endpoints: /user/:userId/notes returns all notes " +
    "the user has written across every tree they contribute to, with full-text search, date " +
    "filtering, and a 200-note cap per request. /user/:userId/contributions returns the " +
    "user's audit trail across all trees with the same filtering. /user/:userId/chats " +
    "returns conversation history grouped by session (up to 10 sessions per request), " +
    "filterable by session ID or date range.\n\n" +
    "All three endpoints support HTML rendering when the html-rendering extension is " +
    "installed. Notes render with edit and delete controls, file notes show download links, " +
    "and every entry links back to its source node and version. The extension reads from " +
    "kernel data (notes.js, contributions.js, chatHistory.js) and adds no models of its " +
    "own. Pure query layer. No writes. No hooks. No tools. Just the ability to ask " +
    "'what have I done' across the entire land.",

  needs: {
    models: ["User", "Node"],
  },

  optional: {},

  provides: {
    models: {},
    routes: "./routes.js",
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    cli: [
      { command: "contributions", scope: ["tree", "home"], description: "List your contributions across all trees", method: "GET", endpoint: "/user/:userId/contributions" },
    ],
  },
};
