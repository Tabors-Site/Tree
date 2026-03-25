export default {
  name: "treeos",
  version: "1.0.0",
  description: "TreeOS default AI modes and MCP tools. The reference implementation of how the AI thinks, navigates, structures, and responds.",

  needs: {
    services: ["websocket"],
    models: ["Node", "User", "Note", "Contribution"],
  },

  optional: {},

  provides: {
    routes: false,
    tools: true,
    modes: true,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    cli: [],
  },
};
