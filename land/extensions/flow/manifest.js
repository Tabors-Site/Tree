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
        command: "flow",
        description: "Show cascade flow for current position",
        method: "GET",
        endpoint: "/node/:nodeId/flow",
      },
      {
        command: "flow-signal <signalId>",
        description: "Show details for a specific cascade signal",
        method: "GET",
        endpoint: "/flow/:signalId",
      },
    ],

    hooks: {
      fires: [],
      listens: [],
    },
  },
};
