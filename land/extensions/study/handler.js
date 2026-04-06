/**
 * Study Handler
 *
 * Only does data work: mechanical commands (switch, remove, add, deactivate).
 * Returns { answer } for commands that were executed.
 * Returns null for everything else (AI handles it).
 */

import { createNote } from "../../seed/tree/notes.js";
import {
  findStudyNodes,
  getActiveTopics,
  getQueue,
  addToQueue,
  switchToTopic,
  deactivateTopic,
  removeFromQueue,
} from "./core.js";

export async function handleMessage(message, { userId, username, rootId, targetNodeId }) {
  const studyRoot = targetNodeId || rootId;
  const lower = message.trim().toLowerCase();

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

  // Not a command. Let the AI handle it.
  return null;
}
