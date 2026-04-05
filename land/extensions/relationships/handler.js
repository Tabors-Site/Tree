/**
 * Relationships Handler
 *
 * Decides which mode to use. Does NOT call runChat.
 * The orchestrator executes on its own session.
 *
 * Returns { mode, message?, answer?, setup? }
 */

import {
  isInitialized,
  scaffold,
  findRelNodes,
  getSetupPhase,
  completeSetup,
} from "./core.js";

export async function handleMessage(message, { userId, username, rootId, targetNodeId }) {
  const relRoot = targetNodeId || rootId;

  // ── First use: scaffold if this is the extension's own node ──
  const initialized = await isInitialized(relRoot);
  if (!initialized) {
    if (String(relRoot) !== String(rootId)) {
      await scaffold(relRoot, userId);
    }
    return { mode: "tree:relationships-coach", setup: true };
  }

  // ── Auto-complete setup ──
  const phase = await getSetupPhase(relRoot);
  if (phase === "base") {
    const nodes = await findRelNodes(relRoot);
    if (nodes && Object.keys(nodes).length > 0) {
      await completeSetup(relRoot);
    }
  }

  const lower = message.trim().toLowerCase();

  // ── "be" / "begin": guided check-in ──
  if (lower === "be" || lower === "begin") {
    return { mode: "tree:relationships-coach" };
  }

  // ── Review: who haven't I talked to, patterns, history ──
  if (/\b(who haven|haven't talked|lost touch|neglect|review|how.*doing|check on|overdue|forget)\b/i.test(message)) {
    return { mode: "tree:relationships-review" };
  }

  // ── Ideas: things to do for people ──
  if (/\b(idea|gift|surprise|do for|plan for|should i|birthday|anniversary)\b/i.test(message)) {
    return { mode: "tree:relationships-coach", message: `The user wants to think about something nice for someone. They said: "${message}". Help them brainstorm and log the idea.` };
  }

  // ── Default: log mode. The AI processes the interaction. ──
  return { mode: "tree:relationships-log" };
}
