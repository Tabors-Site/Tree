export default {
  name: "dashboard",
  version: "1.0.0",
  description: "Session dashboard, tree viewer, and chat history. Registers websocket event handlers for real-time dashboard UI.",

  needs: {
    services: ["websocket", "session"],
    models: ["Node"],
  },

  optional: {},

  provides: {
    routes: false,
    tools: false,
    modes: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    cli: [],
  },
};
