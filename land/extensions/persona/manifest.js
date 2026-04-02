export default {
  name: "persona",
  version: "1.0.2",
  builtFor: "seed",
  description: "AI identity at every position. Name, voice, traits, boundaries. Inherits down the tree. Override at any branch.",

  needs: {
    services: ["hooks", "tree", "metadata"],
    models: ["Node"],
    extensions: [],
  },

  optional: {
    extensions: ["codebook"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: true,
    jobs: false,
    energyActions: {},
    sessionTypes: {},
    env: [],
    cli: [
      {
        command: "persona [action] [args...]", scope: ["tree"],
        description: "AI identity. No action shows persona. Actions: set, clear, tree.",
        method: "GET",
        endpoint: "/persona?nodeId=:nodeId",
        subcommands: {
          set: { method: "POST", endpoint: "/persona/set?nodeId=:nodeId", args: ["field", "value"], description: "Set a persona field directly" },
          clear: { method: "DELETE", endpoint: "/persona?nodeId=:nodeId", description: "Remove persona, inherit from parent" },
          tree: { method: "GET", endpoint: "/persona/tree?rootId=:rootId", description: "Persona map across the whole tree" },
        },
      },
    ],
  },
};
