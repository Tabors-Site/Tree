/**
 * KB Handler
 *
 * Decides which mode to use. Does NOT call runChat.
 * The orchestrator executes on its own session.
 *
 * Returns { mode, message?, answer?, setup? }
 *   - mode: which mode the orchestrator should switch to
 *   - message: override message for the AI (optional)
 *   - answer: direct response, skip AI call (optional)
 *   - setup: true if this is a first-time scaffold
 */

import { createNote } from "../../seed/tree/notes.js";
import {
  scaffold,
  isInitialized,
  getSetupPhase,
  completeSetup,
  findKbNodes,
  routeKbIntent,
  isMaintainer,
} from "./core.js";

export async function handleMessage(message, { userId, username, rootId, targetNodeId }) {
  const kbRoot = targetNodeId || rootId;

  // ── First use: scaffold if this is the extension's own node (not tree root) ──
  const initialized = await isInitialized(kbRoot);
  if (!initialized) {
    if (String(kbRoot) !== String(rootId)) {
      await scaffold(kbRoot, userId);
    }
    return { mode: "tree:kb-tell", setup: true };
  }

  // ── Auto-complete setup if structural nodes exist ──
  const phase = await getSetupPhase(kbRoot);
  if (phase === "base") {
    const kbNodes = await findKbNodes(kbRoot);
    if (kbNodes && Object.keys(kbNodes).length > 0) {
      await completeSetup(kbRoot);
    }
  }

  // ── "be" / "begin" command ──
  const lower = message.trim().toLowerCase();
  if (lower === "be" || lower === "begin") {
    return { mode: "tree:kb-tell" };
  }

  // ── Review: maintenance mode (maintainers only) ──
  if (/\b(stale|orphan|unplaced|maintain|review|cleanup)\b/i.test(lower)) {
    const maintainer = await isMaintainer(kbRoot, userId);
    if (!maintainer) {
      return { answer: "Only maintainers can review.", mode: "tree:kb-ask" };
    }
    return { mode: "tree:kb-review" };
  }

  // ── Route by intent ──
  const intent = routeKbIntent(message);

  // Tell: only maintainers can add knowledge
  if (intent === "tell") {
    const maintainer = await isMaintainer(kbRoot, userId);
    if (!maintainer) {
      return { answer: "Only maintainers can add knowledge. You can ask questions.", mode: "tree:kb-ask" };
    }

    // Write to log node
    const nodes = await findKbNodes(kbRoot);
    if (nodes?.log) {
      try { await createNote({ nodeId: nodes.log.id, content: message, contentType: "text", userId }); } catch {}
    }

    return { mode: "tree:kb-tell" };
  }

  // Ask: everyone
  return { mode: "tree:kb-ask" };
}
