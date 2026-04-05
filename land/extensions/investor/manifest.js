export default {
  name: "investor",
  version: "1.0.0",
  builtFor: "TreeOS",
  description:
    "Investment portfolio tracker. Log buys and sells in natural language, " +
    "track holdings with cost basis, monitor gains and losses, review allocation. " +
    "Each holding is a node with shares, entry price, and current price. " +
    "Say what you bought or sold and the tree updates. Watchlist for targets. " +
    "The AI reflects on concentration risk, unrealized losses, and allocation balance. " +
    "Cross-domain: knows your financial health, how investments relate to your whole life. " +
    "Type 'be' for a guided check-in on your portfolio.",

  territory: "investments, portfolio, stocks, crypto, holdings, shares, buy, sell, position, allocation, gains, losses, dividends",
  classifierHints: [
    /\$[A-Z]{1,5}\b/,                                              // "$AAPL", "$BTC"
    /\b(bought|sold|buy|sell|buying|selling)\b/i,                   // trade language
    /\b(shares?|lots?|position|ticker|stock|etf|bond|crypto|bitcoin|ethereum)\b/i,
    /\b(portfolio|holdings?|allocation|diversif|rebalance)\b/i,
    /\b(gain|loss|return|dividend|yield|cost basis|unrealized|realized)\b/i,
    /\b(watchlist|target|stop.?loss|entry price|exit)\b/i,
  ],

  needs: {
    models: ["Node", "Note"],
    services: ["hooks", "llm", "metadata"],
  },

  optional: {
    extensions: [
      "transactions",
      "solana",
      "channels",
      "browser-bridge",
      "html-rendering",
      "treeos-base",
    ],
  },

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: false,
    modes: true,

    hooks: {
      fires: [],
      listens: ["enrichContext"],
    },

    cli: [
      {
        command: "invest [message...]",
        scope: ["tree"],
        description: "Investments. Log trades, check portfolio, review.",
        method: "POST",
        endpoint: "/root/:rootId/chat",
        body: ["message"],
      },
    ],
  },
};
