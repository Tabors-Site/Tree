export default {
  name: "solana",
  version: "1.1.0",
  description:
    "Every node in the tree can own a Solana wallet. The extension generates keypairs " +
    "on demand, encrypts private keys with AES-256-GCM using a server-side master key, " +
    "and stores them in node metadata. No private key ever leaves the server unencrypted. " +
    "Wallets are per-node: a Finance branch holds SOL, a Rewards node holds tokens, a " +
    "project node accepts payments. Each wallet is a real Solana address on mainnet.\n\n" +
    "Three operations: create a wallet on any node, send SOL or SPL tokens to a Solana " +
    "address or another node (auto-creates the destination wallet if needed), and swap " +
    "tokens through Jupiter's Ultra API with configurable slippage. Sends are fee-aware " +
    "and auto-adjust amounts to cover rent exemption and transaction fees. Swaps handle " +
    "the full Jupiter flow: order creation, server-side transaction signing, and execution.\n\n" +
    "Balance sync reads on-chain SOL balance and Jupiter token holdings, then writes them " +
    "to the values namespace using the _auto__ prefix convention so they appear alongside " +
    "user-set values. USD prices fetch from Jupiter's price API. Stale token entries " +
    "auto-cleanup when holdings change. CLI commands expose wallet info, send, and swap " +
    "without touching the AI conversation. HTML views available when html-rendering is " +
    "installed.",

  needs: {
    models: ["Node"],
  },

  optional: {
    services: ["energy"],
    extensions: ["html-rendering"],
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
