import { getPortfolioSummary, getWatchlist } from "../core.js";

export default {
  name: "tree:investor-review",
  emoji: "\uD83D\uDD0D",
  label: "Investor Review",
  bigMode: "tree",
  hidden: true,

  maxMessagesBeforeLoop: 6,
  preserveContextOnLoop: true,

  toolNames: [
    "navigate-tree",
    "get-tree-context",
    "get-tree",
    "get-node-notes",
    "get-searched-notes-by-user",
  ],

  async buildSystemPrompt({ username, rootId }) {
    const summary = rootId ? await getPortfolioSummary(rootId) : null;
    const watchlist = rootId ? await getWatchlist(rootId) : [];

    const holdingList = summary?.holdings?.length > 0
      ? summary.holdings
          .sort((a, b) => b.value - a.value)
          .map(h => {
            const gainSign = h.gain >= 0 ? "+" : "";
            const pct = summary.totalValue > 0 ? ((h.value / summary.totalValue) * 100).toFixed(1) : "0.0";
            return `- ${h.ticker} (${h.assetType}): ${h.shares} shares @ $${h.entryPrice} avg, current $${h.currentPrice}, value $${h.value.toFixed(2)} (${gainSign}$${h.gain.toFixed(2)}, ${gainSign}${h.gainPercent.toFixed(1)}%), allocation ${pct}%`;
          }).join("\n")
      : "No holdings.";

    const totalsBlock = summary
      ? `Total value: $${summary.totalValue.toFixed(2)}\nTotal cost: $${summary.totalCost.toFixed(2)}\nTotal gain: ${summary.totalGain >= 0 ? "+" : ""}$${summary.totalGain.toFixed(2)} (${summary.totalGain >= 0 ? "+" : ""}${summary.totalGainPercent.toFixed(1)}%)`
      : "";

    // Flags
    const flags = [];
    if (summary?.allocation) {
      const concentrated = summary.allocation.filter(a => a.percent > 30);
      if (concentrated.length > 0) {
        flags.push(`CONCENTRATION RISK: ${concentrated.map(c => `${c.ticker} at ${c.percent.toFixed(1)}%`).join(", ")}`);
      }
      const losers = summary.holdings.filter(h => h.gain < 0);
      if (losers.length > 0) {
        flags.push(`UNREALIZED LOSSES: ${losers.map(l => `${l.ticker} ${l.gain >= 0 ? "+" : ""}$${l.gain.toFixed(2)}`).join(", ")}`);
      }
    }

    // Check for holdings without stop-losses
    const holdingsWithoutStops = summary?.holdings?.filter(h => {
      // Holdings don't have stopLoss in the standard fields, but we flag the concern
      return true;
    }) || [];

    const watchlistList = watchlist.length > 0
      ? watchlist.map(w => {
          const parts = [w.ticker];
          if (w.targetPrice) parts.push(`target $${w.targetPrice}`);
          if (w.stopLoss) parts.push(`stop $${w.stopLoss}`);
          if (w.notes) parts.push(w.notes);
          return `- ${parts.join(", ")}`;
        }).join("\n")
      : "Empty watchlist.";

    const flagBlock = flags.length > 0 ? `\nFLAGS:\n${flags.map(f => `! ${f}`).join("\n")}\n` : "";

    return `You are reviewing ${username}'s investment portfolio. Show the full picture. Be honest.

${totalsBlock ? `PORTFOLIO:\n${totalsBlock}\n` : ""}
HOLDINGS:
${holdingList}
${flagBlock}
WATCHLIST:
${watchlistList}

BEHAVIOR:
- Answer their question directly with numbers.
- "How is my portfolio doing?" = show total value, gain/loss, top and bottom performers.
- "What's my allocation?" = show each holding's percentage of total.
- "How much am I up/down?" = total unrealized gain/loss with per-holding breakdown.
- Flag concentration risk: any single holding over 30% of portfolio.
- Flag unrealized losses with the exact dollar amount.
- Note if holdings lack stop-losses set. Disciplined investors define their exit.
- Show watchlist items and how current prices compare to targets.
- Be factual. Don't moralize. Just show the numbers and let them decide.
- Never expose node IDs or metadata to the user.`.trim();
  },
};
