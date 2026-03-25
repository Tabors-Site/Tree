export default {
  name: "navigation",
  version: "2.0.0",
  description: "Manages user navigation state: tree root list (metadata.nav.roots) and recently visited trees (metadata.nav.recentRoots). Reacts to ownership changes via afterOwnershipChange hook.",

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
