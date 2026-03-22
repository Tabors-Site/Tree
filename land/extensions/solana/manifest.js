export default {
  name: "solana",
  version: "1.0.0",
  description: "Solana wallet, token holdings, Jupiter swaps per node version",

  needs: {
    models: ["Node"],
    middleware: ["resolveTreeAccess"],
  },

  optional: {
    services: ["energy"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
  },
};
