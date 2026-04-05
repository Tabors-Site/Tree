/**
 * Finance Handler
 *
 * Decides which mode to use. Does NOT call runChat.
 * The orchestrator executes on its own session.
 *
 * Returns { mode, message?, answer?, setup? }
 */

import {
  isInitialized,
  scaffold,
  findFinanceNodes,
  getSetupPhase,
  completeSetup,
} from "./core.js";

export async function handleMessage(message, { userId, username, rootId, targetNodeId }) {
  const finRoot = targetNodeId || rootId;

  // ── First use ──
  const initialized = await isInitialized(finRoot);
  if (!initialized) {
    if (String(finRoot) !== String(rootId)) {
      await scaffold(finRoot, userId);
    }
    return { mode: "tree:finance-coach", setup: true };
  }

  // ── Auto-complete setup ──
  const phase = await getSetupPhase(finRoot);
  if (phase === "base") {
    const nodes = await findFinanceNodes(finRoot);
    if (nodes && Object.keys(nodes).length > 0) {
      await completeSetup(finRoot);
    }
  }

  const lower = message.trim().toLowerCase();

  // ── "be" / "begin": guided check-in ──
  if (lower === "be" || lower === "begin") {
    return { mode: "tree:finance-coach" };
  }

  // ── Review: spending patterns, budget status, net worth ──
  if (/\b(review|budget|summary|how much|spent|spending|net worth|balance|report|month|week|total|overview|status)\b/i.test(message)) {
    return { mode: "tree:finance-review" };
  }

  // ── Planning: goals, savings targets, debt payoff, investment questions ──
  if (/\b(plan|save|saving|goal|target|pay off|debt|invest|should i|afford|worth it|budget.*set|set.*budget)\b/i.test(message)) {
    return { mode: "tree:finance-coach" };
  }

  // ── Questions ──
  if (/\?$/.test(message.trim()) || /\b(how much|what is|do i have|can i)\b/i.test(message)) {
    return { mode: "tree:finance-review" };
  }

  // ── Default: log mode. The AI parses the transaction. ──
  return { mode: "tree:finance-log" };
}
