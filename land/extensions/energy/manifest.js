export default {
  name: "energy",
  version: "1.0.0",
  description: "Daily energy budget system with tier-based limits and per-action costs",

  needs: {
    models: ["User"],
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
  },
};
