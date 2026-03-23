export default {
  name: "solana",
  version: "1.1.0",
  description: "Solana wallets, token holdings, and Jupiter swaps per node",

  needs: {
    models: ["Node"],
    middleware: ["resolveTreeAccess"],
  },

  optional: {
    services: ["energy"],
  },

  provides: {
    env: [
      { key: "NODE_WALLET_MASTER_KEY", required: true, secret: true, description: "32-byte hex key for server-side wallets. Back this up." },
      { key: "SOLANA_RPC_URL", required: true, description: "Solana RPC endpoint", default: "https://api.mainnet-beta.solana.com" },
      { key: "JUP_API_KEY", required: false, description: "Jupiter API key for swaps and price data" },
    ],
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
        "swap": { method: "POST", endpoint: "/node/:nodeId/0/values/solana/transaction", args: ["inputMint", "outputMint", "amountUi"], description: "Swap tokens via Jupiter. Usage: wallet swap <fromMint> <toMint> <amount>. Type 'sol' instead of SOL's full mint address." },
      }},
    ],
  },
};
