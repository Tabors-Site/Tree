/**
 * Study handler
 *
 * Pure message handler. No Express, no HTTP. Returns objects.
 * Routes.js wraps this in sendOk/sendError.
 */

import { createNote } from "../../seed/tree/notes.js";
import {
  isInitialized,
  getSetupPhase,
  findStudyNodes,
  getActiveTopics,
  getQueue,
  addToQueue,
  switchToTopic,
  deactivateTopic,
  removeFromQueue,
} from "./core.js";
import { scaffold } from "./setup.js";

// ── Intent detection ──

function detectIntent(message) {
  const lower = message.toLowerCase().trim();
  if (lower === "be") return "session";
  if (/^(switch|activate)\s+/i.test(lower)) return "switch";
  if (/^(remove|drop|delete)\s+/i.test(lower)) return "remove";
  if (/^(stop|deactivate|pause)\s+/i.test(lower)) return "deactivate";
  if (/\b(needlearn|need to learn|want to learn|add to queue|queue)\b/.test(lower)) return "queue";
  if (/^study\s*$/i.test(lower) || /\b(study session|continue studying|let's study)\b/.test(lower)) return "session";
  if (/^study\s+\d+$/i.test(lower)) return "switch"; // "study 2" = switch to queue item 2
  if (/\b(progress|mastery|how am i|gaps?|review|status|streak)\b/.test(lower)) return "review";
  if (/\b(curriculum|break.*down|plan|organize|structure|build.*curriculum|teach me|learn|add.*topic|create.*topic)\b/.test(lower)) return "plan";
  if (/^https?:\/\//.test(lower)) return "queue";
  // Default to plan mode so the AI can create topics for unrecognized input.
  // Log mode only has queue-add, plan mode has create-topic and add-subtopic.
  return "plan";
}

/**
 * Handle a study message. Returns { answer, chatId?, mode, setup?, parsed? }
 * or { error: true, status, code, message } on failure.
 */
export async function handleMessage(message, { userId, username, rootId, res }) {
  const { runChat } = await import("../../seed/llm/conversation.js");

  // Normalize: strip "study" prefix since the route already knows this is study.
  message = message.replace(/^study\s+/i, "").trim() || "study";

  // ── PATH 1: First use ──
  if (!(await isInitialized(rootId))) {
    await scaffold(rootId, userId);

    try {
      const { answer, chatId } = await runChat({
        userId, username,
        message: `New study tree. The user said: "${message}". Help them set up. Ask what they want to learn, their learning style, and daily study goal.`,
        mode: "tree:study-plan",
        rootId, res, slot: "study",
      });
      return { answer, chatId, mode: "tree:study-plan", setup: true };
    } catch (llmErr) {
      return { answer: "Tree created. Set up an LLM connection to start the conversation.", mode: "tree:study-plan", setup: true };
    }
  }

  // ── PATH 1b: Setup incomplete ──
  const phase = await getSetupPhase(rootId);
  if (phase === "base") {
    const [activeTopics, queue] = await Promise.all([getActiveTopics(rootId), getQueue(rootId)]);
    const hasContent = activeTopics.length > 0 || queue.length > 0;

    if (hasContent) {
      const { completeSetup } = await import("./setup.js");
      await completeSetup(rootId);
    } else {
      try {
        const { answer, chatId } = await runChat({
          userId, username, message,
          mode: "tree:study-plan",
          rootId, res, slot: "study",
        });
        return { answer, chatId, mode: "tree:study-plan", setup: true };
      } catch (llmErr) {
        return { answer: "What do you want to learn?", mode: "tree:study-plan", setup: true };
      }
    }
  }

  const intent = detectIntent(message);

  // ── PATH 2: Queue add ──
  if (intent === "queue") {
    const topic = message.replace(/^(needlearn|need to learn|want to learn|add to queue)\s*/i, "").trim();
    if (topic) {
      const isUrl = /^https?:\/\//.test(topic);
      const result = await addToQueue(rootId, topic, userId, { url: isUrl ? topic : null });

      const nodes = await findStudyNodes(rootId);
      if (nodes?.log) {
        try { await createNote({ nodeId: nodes.log.id, content: `Queued: ${topic}`, contentType: "text", userId }); } catch {}
      }

      return { answer: `Queued: "${result.name}".${isUrl ? " Content will be fetched by learn extension." : ""}`, mode: "tree:study-log" };
    }
    // Fall through to log mode if no topic extracted
  }

  // ── PATH: Switch topic ──
  if (intent === "switch") {
    const topic = message.replace(/^(switch|activate|study)\s+/i, "").trim();
    if (!topic) {
      return { answer: "Switch to what? Give a topic name or queue number.", mode: "tree:study-log" };
    }
    try {
      const result = await switchToTopic(rootId, topic, userId);
      if (result.alreadyActive) {
        return { answer: `"${result.name}" is already active.`, mode: "tree:study-log" };
      }
      return { answer: `Switched to "${result.name}". Type "study" to start a session.`, mode: "tree:study-log" };
    } catch (err) {
      return { answer: err.message, mode: "tree:study-log" };
    }
  }

  // ── PATH: Deactivate topic ──
  if (intent === "deactivate") {
    const topic = message.replace(/^(stop|deactivate|pause)\s+/i, "").trim();
    if (!topic) {
      return { answer: "Stop what? Give the topic name.", mode: "tree:study-log" };
    }
    try {
      const result = await deactivateTopic(rootId, topic, userId);
      return { answer: `Deactivated "${result.name}". Moved back to queue.`, mode: "tree:study-log" };
    } catch (err) {
      return { answer: err.message, mode: "tree:study-log" };
    }
  }

  // ── PATH: Remove topic ──
  if (intent === "remove") {
    const topic = message.replace(/^(remove|drop|delete)\s+/i, "").trim();
    if (!topic) {
      return { answer: "Remove what? Give the topic name.", mode: "tree:study-log" };
    }
    try {
      const result = await removeFromQueue(rootId, topic, userId);
      return { answer: `Removed "${result.name}".`, mode: "tree:study-log" };
    } catch (err) {
      return { answer: err.message, mode: "tree:study-log" };
    }
  }

  // ── PATH 3: Study session ──
  if (intent === "session") {
    try {
      const { answer, chatId } = await runChat({
        userId, username, message,
        mode: "tree:study-coach",
        rootId, res, slot: "study",
      });
      return { answer, chatId, mode: "tree:study-coach" };
    } catch (llmErr) {
      return { answer: "Session failed. Check LLM connection.", mode: "tree:study-coach" };
    }
  }

  // ── PATH 4: Review ──
  if (intent === "review") {
    try {
      const { answer, chatId } = await runChat({
        userId, username, message,
        mode: "tree:study-review",
        rootId, res, slot: "study",
      });
      return { answer, chatId, mode: "tree:study-review" };
    } catch (llmErr) {
      return { answer: "Review failed. Check LLM connection.", mode: "tree:study-review" };
    }
  }

  // ── PATH 5: Plan/curriculum ──
  if (intent === "plan") {
    try {
      const { answer, chatId } = await runChat({
        userId, username, message,
        mode: "tree:study-plan",
        rootId, res, slot: "study",
      });
      return { answer, chatId, mode: "tree:study-plan" };
    } catch (llmErr) {
      return { answer: "Plan failed. Check LLM connection.", mode: "tree:study-plan" };
    }
  }

  // ── PATH 6: Default log ──
  try {
    const { answer, chatId } = await runChat({
      userId, username, message,
      mode: "tree:study-log",
      rootId, res, slot: "study",
    });
    return { answer, chatId, mode: "tree:study-log" };
  } catch (llmErr) {
    return { answer: "Failed. Check LLM connection.", mode: "tree:study-log" };
  }
}
