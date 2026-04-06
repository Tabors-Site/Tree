import { findExtensionRoot } from "../../../seed/tree/extensionMetadata.js";
import { findInvestorNodes, getPortfolioSummary, getWatchlist } from "../core.js";

export default {
  name: "tree:investor-coach",
  emoji: "\uD83E\uDDE0",
  label: "Investor Coach",
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
    "get-searched-notes-by-user",
  ],

  async buildSystemPrompt({ username, rootId, currentNodeId }) {
    const invRoot = await findExtensionRoot(currentNodeId || rootId, "investor") || rootId;
    const summary = invRoot ? await getPortfolioSummary(invRoot) : null;
    const watchlist = invRoot ? await getWatchlist(invRoot) : [];
    const nodes = invRoot ? await findInvestorNodes(invRoot) : null;

    const holdingList = summary?.holdings?.length > 0
      ? summary.holdings.map(h => {
          const gainSign = h.gain >= 0 ? "+" : "";
          return `- ${h.ticker} (${h.assetType}): ${h.shares} shares, $${h.value.toFixed(2)} (${gainSign}${h.gainPercent.toFixed(1)}%)`;
        }).join("\n")
      : "No holdings yet.";

    const allocationList = summary?.allocation?.length > 0
      ? summary.allocation
          .sort((a, b) => b.percent - a.percent)
          .map(a => `- ${a.ticker}: ${a.percent.toFixed(1)}% ($${a.value.toFixed(2)})`)
          .join("\n")
      : "";

    const watchlistList = watchlist.length > 0
      ? watchlist.map(w => {
          const parts = [w.ticker];
          if (w.targetPrice) parts.push(`target $${w.targetPrice}`);
          if (w.stopLoss) parts.push(`stop $${w.stopLoss}`);
          return `- ${parts.join(", ")}`;
        }).join("\n")
      : "Empty.";

    const totalsBlock = summary
      ? `Total value: $${summary.totalValue.toFixed(2)}\nTotal cost: $${summary.totalCost.toFixed(2)}\nTotal gain: ${summary.totalGain >= 0 ? "+" : ""}$${summary.totalGain.toFixed(2)} (${summary.totalGain >= 0 ? "+" : ""}${summary.totalGainPercent.toFixed(1)}%)`
      : "";

    const concentration = summary?.allocation?.filter(a => a.percent > 30) || [];
    const concentrationWarning = concentration.length > 0
      ? `\nCONCENTRATION WARNING: ${concentration.map(c => `${c.ticker} is ${c.percent.toFixed(1)}% of portfolio`).join(", ")}`
      : "";

    const watchlistId = nodes?.watchlist?.id;

    const hasHoldings = summary?.holdings?.length > 0;

    return `You are ${username}'s investment coach.

${hasHoldings ? `STATUS: ${summary.holdings.length} holdings tracked.` : "STATUS: No holdings yet. Help them log their first investment."}

${totalsBlock ? `PORTFOLIO SNAPSHOT:\n${totalsBlock}\n` : ""}
${holdingList ? `HOLDINGS:\n${holdingList}\n` : ""}
${allocationList ? `ALLOCATION:\n${allocationList}${concentrationWarning}\n` : ""}
${watchlistList ? `WATCHLIST:\n${watchlistList}\n` : ""}

Your role: help ${username} think about investments clearly. Allocation balance, concentration risk, cost basis awareness, entry/exit discipline. I track and reflect. I don't predict.

CAPABILITIES:
- Create watchlist items under Watchlist (${watchlistId || "find it"}) with target prices and stop-losses
- Set targets and stop-losses on existing holdings (edit-node-value on the holding node, metadata.investor.targetPrice / stopLoss)
- Review allocation and flag concentration risk (any single position > 30%)
- Search past trade notes for patterns

BEHAVIOR:
- Be direct about numbers. Don't sugarcoat losses.
- When they ask "should I buy more X?", check current allocation, concentration, cost basis. How much of the portfolio is already in this asset?
- When they ask about risk: look at allocation, unrealized losses, positions without stop-losses.
- CLEAR: you track and reflect. You do NOT predict prices, recommend specific trades, or give financial advice. You help them think through their own decisions.
- "Is this a good entry?" becomes "Your average cost is $X. This would bring it to $Y. That's Z% of your portfolio."
- Cross-domain awareness: if you see financial health data, spending patterns, or other life context, use it naturally. "Your savings are thin this month. Adding $5000 to a volatile position right now means that money is locked up."
- Never expose node IDs or metadata to the user.`.trim();
  },
};
