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
      { command: "wallet [action] [args...]", description: "Solana wallet. Actions: create, send, swap. No action shows info.", method: "GET", endpoint: "/node/:nodeId/values/solana", subcommands: {
        "create": { method: "POST", endpoint: "/node/:nodeId/values/solana", description: "Create a wallet on this node" },
        "send": { method: "POST", endpoint: "/node/:nodeId/0/values/solana/send", args: ["amount", "destination"], description: "Send SOL. Usage: wallet send <amount> <address or nodeId>" },
        "swap": { method: "POST", endpoint: "/node/:nodeId/0/values/solana/transaction", args: ["inputMint", "outputMint", "amountUi"], description: "Swap tokens via Jupiter. Usage: wallet swap <from> <to> <amount>. Use 'sol' for SOL." },
      }},
    ],
  },
};
