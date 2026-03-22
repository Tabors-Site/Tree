export default {
  name: "book",
  version: "1.0.0",
  description: "Book view, share links, filtered note compilation per node",

  needs: {
    models: ["Node"],
  },

  optional: {},

  provides: {
    models: {
      Book: "../../db/models/book.js",
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
