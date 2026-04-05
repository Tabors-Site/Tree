/**
 * Market Researcher Handler
 *
 * Decides which mode to use. Does NOT call runChat.
 * The orchestrator executes on its own session.
 *
 * Returns { mode, message?, answer?, setup? }
 */

import {
  isInitialized,
  scaffold,
  findResearchNodes,
  getSetupPhase,
  completeSetup,
} from "./core.js";

export async function handleMessage(message, { userId, username, rootId, targetNodeId }) {
  const researchRoot = targetNodeId || rootId;

  // -- First use --
  const initialized = await isInitialized(researchRoot);
  if (!initialized) {
    if (String(researchRoot) !== String(rootId)) {
      await scaffold(researchRoot, userId);
    }
    return { mode: "tree:market-coach", setup: true };
  }

  // -- Auto-complete setup --
  const phase = await getSetupPhase(researchRoot);
  if (phase === "base") {
    const nodes = await findResearchNodes(researchRoot);
    if (nodes && Object.keys(nodes).length > 0) {
      await completeSetup(researchRoot);
    }
  }

  const lower = message.trim().toLowerCase();

  // -- "be" / "begin": guided session --
  if (lower === "be" || lower === "begin") {
    return { mode: "tree:market-coach" };
  }

  // -- Research actions: look up, check, find, price queries, what's happening --
  if (/\b(research|look\s*up|check|find|price\s+of|what.?s\s+happening|how\s+is\s+.+\s+doing|pull|fetch|get\s+me|browse|scrape)\b/i.test(message)) {
    return { mode: "tree:market-tell" };
  }

  // -- Strategy and planning: watch, sector, allocate, focus --
  if (/\b(strategy|watch|sector|allocate|focus\s+on|add\s+to\s+watchlist|track|portfolio|diversif|rebalance)\b/i.test(message)) {
    return { mode: "tree:market-coach" };
  }

  // -- Summary and review: findings, opportunities, report --
  if (/\b(summary|findings|opportunities|report|what\s+did\s+you\s+find|overview|recap|digest|highlights|significant)\b/i.test(message)) {
    return { mode: "tree:market-review" };
  }

  // -- Questions --
  if (/\?$/.test(message.trim())) {
    return { mode: "tree:market-review" };
  }

  // -- Default: research mode. The AI goes and fetches data. --
  return { mode: "tree:market-tell" };
}
