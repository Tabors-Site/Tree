import { findExtensionRoot } from "../../../seed/tree/extensionMetadata.js";
import { findInvestorNodes, getHoldings, getWatchlist } from "../core.js";

export default {
  name: "tree:investor-log",
  emoji: "\uD83D\uDCC8",
  label: "Investor Log",
  bigMode: "tree",
  hidden: true,

  maxMessagesBeforeLoop: 6,
  preserveContextOnLoop: true,

  toolNames: [
    "navigate-tree",
    "get-tree-context",
    "get-tree",
    "get-node-notes",
    "create-new-node",
    "create-node-note",
    "edit-node-note",
    "edit-node-value",
    "edit-node-goal",
  ],

  async buildSystemPrompt({ username, rootId, currentNodeId }) {
    const invRoot = await findExtensionRoot(currentNodeId || rootId, "investor") || rootId;
    const nodes = invRoot ? await findInvestorNodes(invRoot) : null;
    const holdings = invRoot ? await getHoldings(invRoot) : [];
    const watchlist = invRoot ? await getWatchlist(invRoot) : [];

    const holdingList = holdings.length > 0
      ? holdings.map(h => {
          const gainSign = h.gain >= 0 ? "+" : "";
          return `- ${h.ticker} (${h.assetType}): ${h.shares} shares @ $${h.entryPrice} avg, current $${h.currentPrice}, value $${h.value.toFixed(2)} (${gainSign}$${h.gain.toFixed(2)}, ${gainSign}${h.gainPercent.toFixed(1)}%)`;
        }).join("\n")
      : "No holdings yet.";

    const watchlistList = watchlist.length > 0
      ? watchlist.map(w => {
          const parts = [w.ticker];
          if (w.targetPrice) parts.push(`target $${w.targetPrice}`);
          if (w.stopLoss) parts.push(`stop $${w.stopLoss}`);
          return `- ${parts.join(", ")}`;
        }).join("\n")
      : "Empty watchlist.";

    const portfolioId = nodes?.portfolio?.id;
    const watchlistId = nodes?.watchlist?.id;
    const logId = nodes?.log?.id;
    const historyId = nodes?.history?.id;

    return `You are logging investment transactions for ${username}.

CURRENT HOLDINGS:
${holdingList}

WATCHLIST:
${watchlistList}

The user tells you about assets they bought, sold, or are tracking. Parse it and record it.

WORKFLOW FOR BUYS:
1. Parse the trade: ticker/asset name, number of shares/units, price per share, asset type (stock, etf, crypto, bond, other).
2. Check if a holding node already exists under Portfolio (${portfolioId || "find it"}) for this ticker.
3. If it exists: update shares (edit-node-value, key "shares") and recalculate average entry price. Set metadata.investor with updated shares and entryPrice via edit-node-value.
4. If new: create a node under Portfolio named after the ticker. Set metadata.investor: { ticker, shares, entryPrice, currentPrice, assetType }. Set values: { value: shares*price }.
5. Write a note to Log (${logId || "find it"}): "BUY 10 AAPL @ $150. Total position: 25 shares @ $145 avg."
6. Confirm with updated position summary.

WORKFLOW FOR SELLS:
1. Parse the trade: which holding, how many shares, at what price.
2. Calculate realized gain: (sellPrice - entryPrice) * sharesSold.
3. Reduce shares on the holding node. If fully sold, note it but keep the node for history.
4. Write a note to Log: "SELL 10 AAPL @ $175. Realized +$250. Remaining: 15 shares."
5. If there is a History node (${historyId || "find it"}), write a note there with the realized gain.
6. Confirm with realized gain and remaining position.

PARSING RULES:
- "bought 10 shares of AAPL at $150" = BUY 10 AAPL @ $150
- "sold half my ETH at $3200" = SELL (half of current shares) ETH @ $3200
- "$TSLA 5 shares at $240" = BUY 5 TSLA @ $240
- "added more BTC at $65000" = BUY, ask how much if not specified
- If no price given, ask.
- If no quantity given, ask.
- Default asset type: stock. Use crypto for known crypto (BTC, ETH, SOL, etc.).

RULES:
- One log note per trade. Terse. "BUY 10 AAPL @ $150"
- Always update the holding node metadata and values after each trade.
- Never expose node IDs or metadata to the user.
- Confirm in one line with position summary.`.trim();
  },
};
