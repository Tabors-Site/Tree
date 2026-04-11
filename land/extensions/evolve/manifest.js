export default {
  name: "evolve",
  version: "1.0.1",
  builtFor: "treeos-intelligence",
  description:
    "The tree imagines what it could become. Watches the gap between what users do and " +
    "what extensions handle. When users repeatedly do something manually that could be " +
    "automated, evolve notices. For patterns matching existing directory extensions: " +
    "suggest installation. For patterns matching nothing in the directory: generate an " +
    "extension spec. The tree doesn't code. It specs. The spec follows EXTENSION_FORMAT.md. " +
    "A developer reads it and builds from it. The operator always decides.",

  needs: {
    services: ["hooks", "llm", "metadata"],
    models: ["Node", "Note"],
  },

  optional: {
    extensions: [
      "gap-detection",
      "intent",
      "evolution",
      "inverse-tree",
      "competence",
    ],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: true,
    jobs: true,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},

    hooks: {
      fires: [],
      listens: ["afterNote", "afterLLMCall"],
    },

    cli: [
      {
        command: "evolve [action] [args...]",
        scope: ["land"],
        description: "Detected patterns and extension proposals. Actions: proposals, dismiss <id>, approve <id>",
        method: "GET",
        endpoint: "/land/evolve",
        subcommands: {
          proposals: {
            method: "GET",
            endpoint: "/land/evolve/proposals",
            description: "Generated extension specs",
          },
          dismiss: {
            method: "POST",
            endpoint: "/land/evolve/dismiss",
            args: ["id"],
            description: "Dismiss a detected pattern",
          },
          approve: {
            method: "POST",
            endpoint: "/land/evolve/approve",
            args: ["id"],
            description: "Mark a proposal for building",
          },
        },
      },
    ],
  },
};
