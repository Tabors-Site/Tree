export default {
  name: "transactions",
  version: "1.0.0",
  description: "Value transactions between nodes with configurable approval policies",

  needs: {
    services: ["contributions", "auth"],
    models: ["Node", "Contribution"],
  },

  optional: {
    services: ["energy"],
  },

  provides: {
    models: {
      Transaction: "./model.js",
    },
    routes: "./routes.js",
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {
      transaction: { cost: 1 },
    },
    sessionTypes: {},
    schemaVersion: 1,
    migrations: "./migrations.js",
    cli: [
      { command: "transactions", description: "List transactions for current node", method: "GET", endpoint: "/node/:nodeId/:version/transactions" },
    ],
  },
};
