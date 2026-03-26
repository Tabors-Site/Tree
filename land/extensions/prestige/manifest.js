export default {
  name: "prestige",
  version: "1.0.0",
  description: "Node versioning. Complete a version and start a new generation.",

  needs: {
    services: ["contributions", "hooks"],
    models: ["Node"],
  },

  optional: {
    services: ["energy"],
    extensions: ["values", "schedules"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: true,
    jobs: false,
    orchestrator: false,
    energyActions: {
      prestige: { cost: 1 },
    },
    sessionTypes: {},
    cli: [
      { command: "prestige", description: "Add new version to current node", method: "POST", endpoint: "/node/:nodeId/prestige" },
    ],
    hooks: {
      fires: [],
      listens: ["beforeNote", "beforeContribution", "enrichContext"],
    },
  },
};
