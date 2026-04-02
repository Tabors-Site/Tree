export default {
  name: "go",
  version: "1.0.2",
  builtFor: "TreeOS",
  description:
    "Navigate by intent. Say where, not how. " +
    "'go workout' finds fitness across all your trees. 'go food' finds the food node. " +
    "'go' with no arguments shows all navigable positions ranked by recency. " +
    "Reads the routing index from tree-orchestrator. Matches extension names, tree names, " +
    "node names. Navigates to the best match. No LLM call. Microseconds.",

  needs: {
    services: ["hooks"],
    models: ["Node"],
  },

  optional: {
    extensions: ["tree-orchestrator", "navigation"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: true,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    env: [],

    cli: [
      {
        command: "go [destination...]",
        scope: ["tree", "home"],
        description: "Navigate to a position by name or intent. No args = show all positions.",
        method: "GET",
        endpoint: "/go?q=:destination",
      },
    ],

    hooks: {
      fires: [],
      listens: [],
    },
  },
};
