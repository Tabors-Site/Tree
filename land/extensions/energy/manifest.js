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
    routes: "./routes.js",
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    cli: [
      { command: "energy", description: "Show your energy balance and reset time", method: "GET", endpoint: "/user/:userId/energy" },
    ],
  },
};
