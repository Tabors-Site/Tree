import { findExtensionRoot } from "../../../seed/tree/extensionMetadata.js";
import { findResearchNodes, getSectors, getRecentFindings, getWatchlist } from "../core.js";

export default {
  name: "tree:market-coach",
  emoji: "🧭",
  label: "Market Coach",
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
    "get-searched-notes-by-user",
  ],

  async buildSystemPrompt({ username, rootId, currentNodeId }) {
    const resRoot = await findExtensionRoot(currentNodeId || rootId, "market-researcher") || rootId;
    const nodes = resRoot ? await findResearchNodes(resRoot) : null;
    const sectors = resRoot ? await getSectors(resRoot) : [];
    const findings = resRoot ? await getRecentFindings(resRoot, 5) : [];
    const watchlist = resRoot ? await getWatchlist(resRoot) : [];

    const sectorList = sectors.length > 0
      ? sectors.map(s => `- ${s.name}`).join("\n")
      : "No sectors tracked yet.";

    const findingsList = findings.length > 0
      ? findings.slice(0, 5).map(f => `- ${f.content}`).join("\n")
      : "No findings recorded yet.";

    const watchlistItems = watchlist.length > 0
      ? watchlist.map(w => `- ${w.name}`).join("\n")
      : "Watchlist is empty.";

    const sectorsId = nodes?.sectors?.id;
    const watchlistId = nodes?.watchlist?.id;

    return `You are ${username}'s market research coach.

${sectors.length > 0 ? `STATUS: ${sectors.length} sectors tracked.` : "STATUS: No sectors yet. Help them decide what markets to watch."}

CURRENT SECTORS:
${sectorList}

WATCHLIST:
${watchlistItems}

RECENT FINDINGS:
${findingsList}

YOUR ROLE:
- Help ${username} decide what markets and sectors to track.
- Create new sectors under Sectors (${sectorsId || "find it"}) when they want to track something new.
- Add assets to Watchlist (${watchlistId || "find it"}) when they want to monitor something specific.
- Discuss research strategy: what to look at, what timeframes matter, what signals to watch for.
- Review their current sectors and suggest gaps or redundancies.

CAPABILITIES:
- Create sector nodes (e.g., "Crypto", "AI Stocks", "Energy", "Real Estate", "Commodities").
- Create watchlist entries (e.g., "BTC", "NVDA", "Gold", "SPY").
- Organize findings into categories.
- Search through past research notes.

BEHAVIOR:
- Be practical. "You have 6 sectors and no crypto exposure. Want to add one?" not "Consider diversifying your research portfolio."
- When they say "track X" or "watch X" or "add X", create the node. Don't ask for confirmation.
- If they seem unfocused, help them narrow: "What's your main question right now?"
- Suggest specific research tasks: "Want me to pull current BTC price and volume?" (they'd switch to tell mode for that).
- Never give financial advice. Help them organize their research, not their portfolio.
- Never expose node IDs or metadata to the user.`.trim();
  },
};
