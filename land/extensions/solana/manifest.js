export default {
  name: "solana",
  version: "1.1.0",
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
    schemaVersion: 1,
    migrations: "./migrations.js",
    cli: [
      { command: "wallet", description: "Show wallet info for current node", method: "GET", endpoint: "/node/:nodeId/values/solana" },
      { command: "wallet-create", description: "Create wallet for current node", method: "POST", endpoint: "/node/:nodeId/values/solana" },
      { command: "send-sol <amount> <destination>", description: "Send SOL to address or node ID", method: "POST", endpoint: "/node/:nodeId/0/values/solana/send", body: ["amount", "destination"] },
      { command: "swap <inputMint> <outputMint> <amount>", description: "Swap tokens via Jupiter (use 'sol' for SOL)", method: "POST", endpoint: "/node/:nodeId/0/values/solana/transaction", body: ["inputMint", "outputMint", "amountUi"] },
    ],
  },
};
