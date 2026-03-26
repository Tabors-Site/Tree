export default {
  name: "gateway-discord",
  version: "1.0.0",
  description: "Discord channel for gateway. Input, output, or both. Input requires Standard or Premium tier.",

  needs: {
    models: ["Node", "User"],
    extensions: ["gateway"],
  },

  optional: {},

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    env: [],
    cli: [],

    hooks: {
      fires: [],
      listens: [],
    },
  },
};
