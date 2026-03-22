export default {
  name: "deleted-revive",
  version: "1.0.0",
  description: "Soft delete with parent='deleted' and revive as branch or new root",

  needs: {
    models: ["Node"],
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
      { command: "deleted", description: "List soft-deleted branches", method: "GET", endpoint: "/user/:userId/deleted" },
    ],
  },
};
