/**
 * Recovery handler
 *
 * Pure message handler. No Express, no HTTP. Returns objects.
 * Routes.js wraps this in sendOk/sendError.
 */

import { createNote } from "../../seed/tree/notes.js";
import {
  isInitialized,
  getSetupPhase,
  completeSetup,
  scaffold,
  findRecoveryNodes,
  parseCheckIn,
  recordDoses,
  recordCraving,
  recordMood,
  recordEnergy,
  getStatus,
} from "./core.js";

/**
 * Handle a recovery message. Returns { answer, chatId?, mode, setup?, parsed?, status? }
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
        message: `First time setup. The user said: "${message}". Use the recovery-add-substance tool to add each substance they mention. Ask about current usage and target goals. Pass rootId "${rootId}". Be warm. This is the beginning.`,
        mode: "tree:recovery-plan",
        rootId, res,
        slot: "recovery",
      });
      return { answer, chatId, mode: "tree:recovery-plan", setup: true };
    } catch (llmErr) {
      return { answer: "Tree created. Set up an LLM connection to start the conversation.", mode: "tree:recovery-log", setup: true };
    }
  }

  // ── PATH 1b: Setup incomplete ──
  const phase = await getSetupPhase(rootId);
  if (phase === "base") {
    const nodes = await findRecoveryNodes(rootId);
    const hasSubstances = nodes?.substances && Object.keys(nodes.substances).length > 0;

    if (hasSubstances) {
      await completeSetup(rootId);
    } else {
      try {
        const { answer, chatId } = await runChat({
          userId, username, message,
          mode: "tree:recovery-plan",
          rootId, res, slot: "recovery",
        });
        return { answer, chatId, mode: "tree:recovery-plan", setup: true };
      } catch (llmErr) {
        return { answer: "What substances are you tracking?", mode: "tree:recovery-plan", setup: true };
      }
    }
  }

  const nodes = await findRecoveryNodes(rootId);

  // ── PATH: "be" command: guided check-in ──
  if (message.trim().toLowerCase() === "be") {
    try {
      const { answer, chatId } = await runChat({
        userId, username, message: "The user said 'be'. Start a guided check-in. Ask how they're feeling today, any substance use, cravings, energy level.",
        mode: "tree:recovery-log", rootId, res, slot: "recovery",
      });
      return { answer, chatId, mode: "tree:recovery-log" };
    } catch (llmErr) {
      return { answer: "How are you doing today?", mode: "tree:recovery-log" };
    }
  }

  // ── PATH 3: Questions/reflection/planning ──
  const isReflect = /\b(how am i|how's my|pattern|trend|week|month|progress|review|doing)\b/i.test(message);
  const isPlan = /\b(taper|plan|schedule|adjust|slow down|speed up|change.*target|set.*target)\b/i.test(message);
  const isJournal = /\b(journal|just writing|need to write|vent)\b/i.test(message);

  if (isJournal && nodes?.journal) {
    try {
      await createNote({ nodeId: nodes.journal.id, content: message, contentType: "text", userId });
    } catch {}
    return { answer: "Written.", mode: "tree:recovery-journal" };
  }

  if (isPlan) {
    try {
      const { answer, chatId } = await runChat({
        userId, username, message,
        mode: "tree:recovery-plan",
        rootId, res, slot: "recovery",
      });
      return { answer, chatId, mode: "tree:recovery-plan" };
    } catch (llmErr) {
      return { answer: "Plan failed. Check LLM connection.", mode: "tree:recovery-plan" };
    }
  }

  if (isReflect) {
    try {
      const { answer, chatId } = await runChat({
        userId, username, message,
        mode: "tree:recovery-review",
        rootId, res, slot: "recovery",
      });
      return { answer, chatId, mode: "tree:recovery-review" };
    } catch (llmErr) {
      return { answer: "Reflect failed. Check LLM connection.", mode: "tree:recovery-review" };
    }
  }

  // ── PATH 2: Check-in (default) ──
  const parsed = await parseCheckIn(message, userId, username, rootId);

  if (parsed) {
    // Record substances
    if (parsed.substances) {
      for (const sub of parsed.substances) {
        if (sub.name && sub.doses != null) {
          try { await recordDoses(nodes, sub.name, sub.doses); } catch {}
        }
      }
    }

    // Record cravings
    if (parsed.cravings) {
      for (const cr of parsed.cravings) {
        try { await recordCraving(nodes, cr.intensity || 0, !!cr.resisted, cr.trigger || null); } catch {}
      }
    }

    // Record mood
    if (parsed.mood?.score != null) {
      try { await recordMood(nodes, parsed.mood.score); } catch {}
    }

    // Record energy
    if (parsed.energy != null) {
      try { await recordEnergy(nodes, parsed.energy); } catch {}
    }

    // Write note to Log
    if (nodes?.log) {
      try {
        const noteContent = parsed.context || message;
        await createNote({ nodeId: nodes.log.id, content: noteContent, contentType: "text", userId });
      } catch {}
    }
  }

  // Get fresh status for response
  const status = await getStatus(rootId);

  // Build natural language response (separate from the JSON parse call)
  let answer = null;
  let chatId = null;
  try {
    const result = await runChat({
      userId, username,
      message: parsed
        ? `The user checked in. Here's what they said: "${message}". Parsed data: ${JSON.stringify(parsed)}. Respond naturally. Acknowledge what's hard. Point out patterns if visible. Keep it short.`
        : message,
      mode: "tree:recovery-log",
      rootId, slot: "recovery",
    });
    answer = result.answer;
    chatId = result.chatId;
  } catch {}

  // If LLM failed, build a simple confirmation
  if (!answer && parsed?.substances?.length > 0) {
    const subs = parsed.substances.map(s => `${s.name}: ${s.doses}`).join(", ");
    answer = `Logged. ${subs}.`;
  }

  return { answer: answer || "Logged.", chatId, mode: "tree:recovery-log", parsed, status };
}
