/**
 * Study Handler
 *
 * KB-style. Route by simplest signal. Let the mode prompt carry intelligence.
 * Explicit commands are mechanical (no LLM). Everything else goes to session.
 * Does NOT call runChat. The orchestrator executes on its own session.
 *
 * Returns { mode, message?, answer?, setup? }
 *   - mode: which mode the orchestrator should switch to
 *   - message: override message for the AI (optional)
 *   - answer: direct response, skip AI call (optional)
 *   - setup: true if this is a first-time scaffold
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

export async function handleMessage(message, { userId, username, rootId, targetNodeId }) {
  const studyRoot = targetNodeId || rootId;

  // ── First use: scaffold if this is the extension's own node (not tree root) ──
  const initialized = await isInitialized(studyRoot);
  if (!initialized) {
    if (String(studyRoot) !== String(rootId)) {
      await scaffold(studyRoot, userId);
    }
    return { mode: "tree:study-plan", setup: true };
  }

  // ── Auto-complete setup if structural nodes exist ──
  const phase = await getSetupPhase(studyRoot);
  if (phase === "base") {
    const studyNodes = await findStudyNodes(studyRoot);
    if (studyNodes && Object.keys(studyNodes).length > 0) {
      const { completeSetup } = await import("./setup.js");
      await completeSetup(studyRoot);
    }
  }

  // ── "be" / "begin" command ──
  const lower = message.trim().toLowerCase();
  if (lower === "be" || lower === "begin") {
    return { mode: "tree:study-coach" };
  }

  // ── Explicit commands: mechanical, no LLM ──

  // switch / activate <topic>
  if (/^(switch|activate)\b/i.test(lower)) {
    const topic = message.replace(/^(switch|activate)\s*/i, "").trim();
    if (!topic) {
      const [active, queue] = await Promise.all([getActiveTopics(studyRoot), getQueue(studyRoot)]);
      const list = [...active.map(t => `[active] ${t.name}`), ...queue.map(q => `[queued] ${q.name}`)];
      return { answer: list.length > 0 ? `Switch to what?\n${list.join("\n")}` : "Nothing to switch to. Add a topic first." };
    }
    try {
      const result = await switchToTopic(studyRoot, topic, userId);
      return { answer: result.alreadyActive ? `"${result.name}" is already active.` : `Switched to "${result.name}".` };
    } catch (err) {
      return { answer: err.message };
    }
  }

  // remove / delete / drop <topic>
  if (/^(remove|delete|drop)\s+/i.test(lower)) {
    const topic = message.replace(/^(remove|delete|drop)\s+/i, "").trim();
    try {
      const result = await removeFromQueue(studyRoot, topic, userId);
      return { answer: `Removed "${result.name}".` };
    } catch (err) {
      return { answer: err.message };
    }
  }

  // stop / pause / deactivate <topic>
  if (/^(stop|pause|deactivate)\s+/i.test(lower)) {
    const topic = message.replace(/^(stop|pause|deactivate)\s+/i, "").trim();
    try {
      const result = await deactivateTopic(studyRoot, topic, userId);
      return { answer: `Deactivated "${result.name}". Back in queue.` };
    } catch (err) {
      return { answer: err.message };
    }
  }

  // needlearn / queue / add <topic> or URL
  if (/^(needlearn|need to learn|want to learn|add to queue|queue|add)\b/i.test(lower) || /^https?:\/\//.test(lower)) {
    const topic = message.replace(/^(needlearn|need to learn|want to learn|add to queue|queue|add)\s*/i, "").trim();
    if (topic) {
      const isUrl = /^https?:\/\//.test(topic);
      const result = await addToQueue(studyRoot, topic, userId, { url: isUrl ? topic : null });
      const nodes = await findStudyNodes(studyRoot);
      if (nodes?.log) {
        try { await createNote({ nodeId: nodes.log.id, content: `Queued: ${topic}`, contentType: "text", userId }); } catch {}
      }
      return { answer: `Queued: "${result.name}".` };
    }
  }

  // ── Plan / curriculum / progress / review ──
  if (/^(plan|curriculum|progress|status|review|gaps)\b/i.test(lower)) {
    return { mode: "tree:study-plan" };
  }

  // ── Everything else: session mode ──
  return { mode: "tree:study-coach" };
}
