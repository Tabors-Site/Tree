/**
 * Study handler
 *
 * KB-style. Route by simplest signal. Let the mode prompt carry intelligence.
 * Explicit commands are mechanical (no LLM). Everything else goes to session.
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

export async function handleMessage(message, { userId, username, rootId, res }) {
  const { runChat } = await import("../../seed/llm/conversation.js");

  // ── First use: scaffold + plan mode ──
  if (!(await isInitialized(rootId))) {
    await scaffold(rootId, userId);
    try {
      const { answer, chatId } = await runChat({
        userId, username,
        message: `New study tree. The user said: "${message}". Ask what they want to learn.`,
        mode: "tree:study-plan", rootId, res, slot: "study",
      });
      return { answer, chatId, mode: "tree:study-plan", setup: true };
    } catch {
      return { answer: "Study tree created. What do you want to learn?", mode: "tree:study-plan", setup: true };
    }
  }

  // ── Setup incomplete: no topics yet ──
  const phase = await getSetupPhase(rootId);
  if (phase === "base") {
    const [active, queue] = await Promise.all([getActiveTopics(rootId), getQueue(rootId)]);
    if (active.length > 0 || queue.length > 0) {
      const { completeSetup } = await import("./setup.js");
      await completeSetup(rootId);
    } else {
      try {
        const { answer, chatId } = await runChat({
          userId, username, message, mode: "tree:study-plan", rootId, res, slot: "study",
        });
        return { answer, chatId, mode: "tree:study-plan", setup: true };
      } catch {
        return { answer: "What do you want to learn?", mode: "tree:study-plan", setup: true };
      }
    }
  }

  // ── Explicit commands: mechanical, no LLM ──
  const lower = message.toLowerCase().trim();

  // switch / activate <topic>
  if (/^(switch|activate)\b/i.test(lower)) {
    const topic = message.replace(/^(switch|activate)\s*/i, "").trim();
    if (!topic) {
      const [active, queue] = await Promise.all([getActiveTopics(rootId), getQueue(rootId)]);
      const list = [...active.map(t => `[active] ${t.name}`), ...queue.map(q => `[queued] ${q.name}`)];
      return { answer: list.length > 0 ? `Switch to what?\n${list.join("\n")}` : "Nothing to switch to. Add a topic first." };
    }
    try {
      const result = await switchToTopic(rootId, topic, userId);
      return { answer: result.alreadyActive ? `"${result.name}" is already active.` : `Switched to "${result.name}".` };
    } catch (err) {
      return { answer: err.message };
    }
  }

  // remove / delete / drop <topic>
  if (/^(remove|delete|drop)\s+/i.test(lower)) {
    const topic = message.replace(/^(remove|delete|drop)\s+/i, "").trim();
    try {
      const result = await removeFromQueue(rootId, topic, userId);
      return { answer: `Removed "${result.name}".` };
    } catch (err) {
      return { answer: err.message };
    }
  }

  // stop / pause / deactivate <topic>
  if (/^(stop|pause|deactivate)\s+/i.test(lower)) {
    const topic = message.replace(/^(stop|pause|deactivate)\s+/i, "").trim();
    try {
      const result = await deactivateTopic(rootId, topic, userId);
      return { answer: `Deactivated "${result.name}". Back in queue.` };
    } catch (err) {
      return { answer: err.message };
    }
  }

  // needlearn <topic> or URL
  // needlearn / queue / add <topic> or URL
  if (/^(needlearn|need to learn|want to learn|add to queue|queue|add)\b/i.test(lower) || /^https?:\/\//.test(lower)) {
    const topic = message.replace(/^(needlearn|need to learn|want to learn|add to queue|queue|add)\s*/i, "").trim();
    if (topic) {
      const isUrl = /^https?:\/\//.test(topic);
      const result = await addToQueue(rootId, topic, userId, { url: isUrl ? topic : null });
      const nodes = await findStudyNodes(rootId);
      if (nodes?.log) {
        try { await createNote({ nodeId: nodes.log.id, content: `Queued: ${topic}`, contentType: "text", userId }); } catch {}
      }
      return { answer: `Queued: "${result.name}".` };
    }
  }

  // plan / curriculum / progress / status / review / gaps
  if (/^(plan|curriculum|progress|status|review|gaps)\b/i.test(lower)) {
    try {
      const { answer, chatId } = await runChat({
        userId, username, message, mode: "tree:study-plan", rootId, res, slot: "study",
      });
      return { answer, chatId, mode: "tree:study-plan" };
    } catch {
      return { answer: "What do you want to add to your curriculum?" };
    }
  }

  // ── Everything else: session mode. Raw message. No wrapping. ──
  try {
    const { answer, chatId } = await runChat({
      userId, username, message, mode: "tree:study-coach", rootId, res, slot: "study",
    });
    return { answer, chatId, mode: "tree:study-coach" };
  } catch {
    return { answer: "Session failed. Check LLM connection." };
  }
}
