export default {
  name: "gateway-telegram",
  version: "1.0.0",
  description: "Telegram channel for gateway. Input, output, or both.",

  needs: {
    models: ["Node", "User"],
    extensions: ["gateway"],
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
    env: [],
    cli: [],

    hooks: {
      fires: [],
      listens: [],
    },
  },
};
