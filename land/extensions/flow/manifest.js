export default {
  name: "flow",
  version: "1.0.0",
  description: "View cascade flow results scoped to the current position (land, tree, or node)",

  needs: {
    services: [],
    models: ["Node"],
  },

  optional: {
    extensions: [],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    env: [],

    cli: [
      {
        command: "flow [action] [args...]",
        description: "Cascade flow scoped to current position. Actions: signal, stats.",
        method: "GET",
        endpoint: "/node/:nodeId/flow",
        subcommands: {
          "signal": { method: "GET", endpoint: "/flow/:signalId", args: ["signalId"], description: "Drill into one signal" },
          "stats": { method: "GET", endpoint: "/flow/stats", description: "Partition sizes, cap status" },
        },
      },
    ],

    hooks: {
      fires: [],
      listens: [],
    },
  },
};
