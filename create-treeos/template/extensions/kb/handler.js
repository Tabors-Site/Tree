/**
 * KB handler
 *
 * Pure message handler. No Express, no HTTP. Returns objects.
 * Routes.js wraps this in sendOk/sendError.
 */

import { createNote } from "../../seed/tree/notes.js";
import {
  scaffold,
  isInitialized,
  getSetupPhase,
  findKbNodes,
  routeKbIntent,
  isMaintainer,
} from "./core.js";

/**
 * Handle a KB message. Returns { answer, chatId?, mode, setup? }
 * or { error: true, status, code, message } on failure.
 */
export async function handleMessage(message, { userId, username, rootId, res }) {
  const { runChat } = await import("../../seed/llm/conversation.js");

  // ── PATH 1: First use ──
  if (!(await isInitialized(rootId))) {
    await scaffold(rootId, userId);
    try {
      const { answer, chatId } = await runChat({
        userId, username,
        message: `Knowledge base just created. The user said: "${message}".\n\nIf they're telling you something, organize it into the Topics tree. If they're asking, explain the kb is empty and invite them to start adding knowledge.`,
        mode: "tree:kb-tell",
        rootId, res, slot: "kb",
      });
      return { answer, chatId, mode: "tree:kb-tell", setup: true };
    } catch (llmErr) {
      return { answer: "Knowledge base created. Set up an LLM connection to start.", mode: "tree:kb-tell", setup: true };
    }
  }

  // ── PATH 1b: Setup incomplete ──
  const phase = await getSetupPhase(rootId);
  if (phase === "base") {
    try {
      const { answer, chatId } = await runChat({
        userId, username, message,
        mode: "tree:kb-tell",
        rootId, res, slot: "kb",
      });
      return { answer, chatId, mode: "tree:kb-tell", setup: true };
    } catch (llmErr) {
      return { answer: "Set up an LLM connection to use the knowledge base.", mode: "tree:kb-tell", setup: true };
    }
  }

  // ── Review: start guided review mode ──
  if (message.trim().toLowerCase() === "review") {
    const maintainer = await isMaintainer(rootId, userId);
    if (!maintainer) {
      return { error: true, status: 403, message: "Only maintainers can review." };
    }
    try {
      const { answer, chatId } = await runChat({
        userId, username,
        message: "Start a guided review of stale notes in this knowledge base.",
        mode: "tree:kb-review",
        rootId, res, slot: "kb",
      });
      return { answer, chatId, mode: "tree:kb-review" };
    } catch (llmErr) {
      return { answer: "Failed to start review. Check LLM connection.", mode: "tree:kb-review" };
    }
  }

  const intent = routeKbIntent(message);

  // ── Tell: only maintainers ──
  if (intent === "tell") {
    const maintainer = await isMaintainer(rootId, userId);
    if (!maintainer) {
      return { error: true, status: 403, message: "Only maintainers can add knowledge. You can ask questions." };
    }

    const nodes = await findKbNodes(rootId);
    if (nodes?.log) {
      try { await createNote({ nodeId: nodes.log.id, content: message, contentType: "text", userId }); } catch {}
    }

    try {
      const { answer, chatId } = await runChat({
        userId, username, message,
        mode: "tree:kb-tell",
        rootId, res, slot: "kb",
      });
      return { answer, chatId, mode: "tree:kb-tell" };
    } catch (llmErr) {
      return { answer: "Failed to process. Check LLM connection.", mode: "tree:kb-tell" };
    }
  }

  // ── Ask: everyone ──
  try {
    const { answer, chatId } = await runChat({
      userId, username, message,
      mode: "tree:kb-ask",
      rootId, res, slot: "kb",
    });
    return { answer, chatId, mode: "tree:kb-ask" };
  } catch (llmErr) {
    return { answer: "Failed to search. Check LLM connection.", mode: "tree:kb-ask" };
  }
}
