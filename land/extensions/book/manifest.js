export default {
  name: "book",
  version: "1.0.0",
  description: "Compile notes into shareable documents per node",

  needs: {
    models: ["Node", "Note"],
  },

  optional: {},

  provides: {
    models: {
      Book: "./model.js",
    },
    routes: "./routes.js",
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    cli: [
      { command: "book", description: "View compiled notes for current tree", method: "GET", endpoint: "/root/:rootId/book" },
    ],
  },
};
