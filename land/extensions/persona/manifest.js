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
      {
        command: "persona [action] [args...]",
        description: "AI identity. No action shows persona. Actions: set, clear, tree.",
        method: "GET",
        endpoint: "/persona",
        subcommands: {
          set: { method: "POST", endpoint: "/persona/set", args: ["field", "value"], description: "Set a persona field directly" },
          clear: { method: "DELETE", endpoint: "/persona", description: "Remove persona, inherit from parent" },
          tree: { method: "GET", endpoint: "/persona/tree", description: "Persona map across the whole tree" },
        },
      },
    ],
  },
};
