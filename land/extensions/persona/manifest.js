export default {
  name: "persona",
  version: "1.0.0",
  builtFor: "kernel",
  description: "AI identity at every position. Name, voice, traits, boundaries. Inherits down the tree. Override at any branch.",

  needs: {
    services: ["hooks"],
    models: ["Node"],
    extensions: [],
  },

  optional: {
    extensions: ["codebook"],
  },

  provides: {
    models: {},
    routes: true,
    tools: true,
    jobs: false,
    energyActions: {},
    sessionTypes: {},
    env: [],
    cli: [
      { command: "persona", description: "Show effective persona at current position", method: "GET", endpoint: "/persona" },
      { command: "persona-set", description: "Set persona field", method: "POST", endpoint: "/persona/set", bodyMap: { field: 0, value: 1 } },
      { command: "persona-clear", description: "Remove persona at current node", method: "DELETE", endpoint: "/persona" },
      { command: "persona-tree", description: "Show persona map across the tree", method: "GET", endpoint: "/persona/tree" },
    ],
  },
};
