export default {
  name: "market-researcher",
  version: "1.0.0",
  builtFor: "TreeOS",
  scope: "confined",
  description:
    "Research agent for financial markets. Uses browser-bridge to visit financial sites, " +
    "pull live data, and surface opportunities. Track sectors, maintain a watchlist, " +
    "record findings. The AI browses CoinGecko, Yahoo Finance, TradingView, and other " +
    "sources to gather prices, trends, and analysis. Confined scope: must be ext-allowed " +
    "at specific positions because it leverages browser-bridge for web access. " +
    "Never gives financial advice. Reports data, flags moves, notes risks.",

  territory: "market research, stock analysis, crypto prices, financial news, sector trends, market conditions, opportunities",
  classifierHints: [
    /\b(research|look\s*up|check\s*(the\s*)?price|market|trend|sector|news|analysis)\b/i,
    /\b(stock|crypto|bitcoin|btc|eth|token|coin|ticker|equity|commodity)\b/i,
    /\b(bull|bear|rally|dip|correction|ath|all.time.high|volume|rsi|macd)\b/i,
    /\b(what.?s\s+(happening|going\s+on)\s+(in|with)\s+(the\s+)?market)/i,
    /\b(price\s+of|how\s+is\s+.+\s+doing|check\s+on)\b/i,
  ],

  needs: {
    models: ["Node", "Note"],
    services: ["hooks", "llm", "metadata"],
  },

  optional: {
    extensions: [
      "browser-bridge",
      "investor",
      "finance",
      "channels",
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
        command: "research [message...]",
        scope: ["tree"],
        description: "Market research. Look up prices, analyze sectors, surface opportunities.",
        method: "POST",
        endpoint: "/root/:rootId/chat",
        body: ["message"],
      },
    ],
  },
};
