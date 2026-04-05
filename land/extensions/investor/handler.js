/**
 * Investor Handler
 *
 * Decides which mode to use. Does NOT call runChat.
 * The orchestrator executes on its own session.
 *
 * Returns { mode, message?, answer?, setup? }
 */

import {
  isInitialized,
  scaffold,
  findInvestorNodes,
  getSetupPhase,
  completeSetup,
} from "./core.js";

export async function handleMessage(message, { userId, username, rootId, targetNodeId }) {
  const invRoot = targetNodeId || rootId;

  // -- First use --
  const initialized = await isInitialized(invRoot);
  if (!initialized) {
    if (String(invRoot) !== String(rootId)) {
      await scaffold(invRoot, userId);
    }
    return { mode: "tree:investor-coach", setup: true };
  }

  // -- Auto-complete setup --
  const phase = await getSetupPhase(invRoot);
  if (phase === "base") {
    const nodes = await findInvestorNodes(invRoot);
    if (nodes && Object.keys(nodes).length > 0) {
      await completeSetup(invRoot);
    }
  }

  const lower = message.trim().toLowerCase();

  // -- "be" / "begin": guided check-in --
  if (lower === "be" || lower === "begin") {
    return { mode: "tree:investor-coach" };
  }

  // -- Buy/sell/trade language: log the transaction --
  if (/\b(bought|sold|buy|sell|buying|selling|traded|trade|added|adding)\b/i.test(message)) {
    return { mode: "tree:investor-log" };
  }

  // -- Portfolio review: performance, allocation, gains --
  if (/\b(portfolio|allocation|gains?|losses?|performance|how|balance|total|value|return|summary|review|overview|status|holdings?)\b/i.test(message)) {
    return { mode: "tree:investor-review" };
  }

  // -- Coaching: should/risk/afford/worth --
  if (/\b(should|risk|afford|worth|diversif|rebalance|strategy|plan|target|stop.?loss)\b/i.test(message)) {
    return { mode: "tree:investor-coach" };
  }

  // -- Questions --
  if (/\?$/.test(message.trim())) {
    return { mode: "tree:investor-review" };
  }

  // -- Default: log mode. The AI parses the trade. --
  return { mode: "tree:investor-log" };
}
