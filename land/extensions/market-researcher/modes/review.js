import { findExtensionRoot } from "../../../seed/tree/extensionMetadata.js";
import { findResearchNodes, getSectors, getRecentFindings, getWatchlist } from "../core.js";

export default {
  name: "tree:market-review",
  emoji: "📋",
  label: "Market Review",
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

  async buildSystemPrompt({ username, rootId, currentNodeId }) {
    const resRoot = await findExtensionRoot(currentNodeId || rootId, "market-researcher") || rootId;
    const nodes = resRoot ? await findResearchNodes(resRoot) : null;
    const sectors = resRoot ? await getSectors(resRoot) : [];
    const findings = resRoot ? await getRecentFindings(resRoot, 20) : [];
    const watchlist = resRoot ? await getWatchlist(resRoot) : [];

    const sectorList = sectors.length > 0
      ? sectors.map(s => `- ${s.name}`).join("\n")
      : "No sectors tracked.";

    const findingsList = findings.length > 0
      ? findings.slice(0, 20).map(f => `- ${f.content}`).join("\n")
      : "No findings recorded yet.";

    const watchlistItems = watchlist.length > 0
      ? watchlist.map(w => `- ${w.name}`).join("\n")
      : "Watchlist is empty.";

    return `You are reviewing ${username}'s market research. Summarize what's been found. Be factual.

SECTORS TRACKED:
${sectorList}

WATCHLIST:
${watchlistItems}

RECENT FINDINGS:
${findingsList}

BEHAVIOR:
- Answer their question directly with data from the findings.
- "What did you find?" = summarize recent findings organized by sector.
- "Any opportunities?" = highlight significant moves, unusual volume, breaking developments from the findings.
- "How is X doing?" = pull relevant findings about that asset or sector.
- Organize by sector when summarizing multiple findings.
- Highlight significant moves: large price changes, volume spikes, trend reversals, breaking news.
- Note the age of findings. "BTC was at $67,400 as of the last check" not "BTC is $67,400" unless you just fetched it.
- If findings are stale or sparse, say so. "Last research was 3 days ago. Want me to pull fresh data?"
- Be factual. No predictions. No advice. Report what the research shows.
- If they ask something the findings don't cover, say so directly.
- Never expose node IDs or metadata to the user.`.trim();
  },
};
