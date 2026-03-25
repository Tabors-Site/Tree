export default {
  name: "user-tiers",
  version: "1.0.0",
  description: "User tier management. Stores plan tier in metadata. Extensions check access through exports.",

  needs: {
    models: ["User"],
  },

  optional: {},

  provides: {
    routes: "./routes.js",
    tools: false,
    modes: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    cli: [
      { command: "tier", description: "Show your current tier", method: "GET", endpoint: "/user/:userId/tier" },
    ],
  },
};
