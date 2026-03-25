export default {
  name: "recent-roots",
  version: "1.0.0",
  description: "Tracks recently visited trees. Stores navigation history in user metadata. Emits to frontend for sidebar display.",

  needs: {
    services: ["websocket"],
    models: ["User", "Node"],
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
