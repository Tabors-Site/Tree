/**
 * Study Log Mode
 *
 * Universal receiver. Handles queue adds, URL routing, questions.
 * "needlearn X" adds to queue. URLs trigger learn extension. Questions answered.
 */

import { findExtensionRoot } from "../../../seed/tree/extensionMetadata.js";
import { getQueue, getActiveTopics, getStudyProgress } from "../core.js";

export default {
  emoji: "📚",
  label: "Study Log",
  bigMode: "tree",
  hidden: true,
  maxMessagesBeforeLoop: 4,
  preserveContextOnLoop: false,

  toolNames: [
    "study-add-to-queue",
    "navigate-tree",
  ],

  async buildSystemPrompt({ username, rootId, currentNodeId }) {
    const studyRoot = await findExtensionRoot(currentNodeId || rootId, "study") || rootId;
    const queue = await getQueue(studyRoot);
    const progress = await getStudyProgress(studyRoot);

    const queueStr = queue.length > 0
      ? queue.slice(0, 10).map((q, i) => `  ${i + 1}. ${q.name}${q.url ? " (URL)" : ""}${q.status === "active" ? " [active]" : ""}`).join("\n")
      : "  (empty)";

    const activeStr = progress?.active
      ? `Currently studying: ${progress.active.topic} (${progress.active.completion}% complete, current: ${progress.active.currentSubtopic || "none"})`
      : "No active topic.";

    return `You are ${username}'s study companion. Handle incoming study requests.

QUEUE (${queue.length} items):
${queueStr}

${activeStr}

YOUR JOB:
1. If they say "needlearn X" or "I need to learn X" or "add X to queue": Use study-add-to-queue tool. Confirm briefly.
2. If they share a URL: Use study-add-to-queue with the URL. Note that the learn extension will fetch the content.
3. If they say "study" or "continue": Tell them to use the study command (routes to session mode).
4. If they ask a question about a topic: Answer it directly from your knowledge. Be concise.
5. If they ask about progress/status: Summarize their queue and active topics.

STYLE:
- Brief confirmations for queue adds. "Queued: React hooks. 5 items in queue."
- Direct answers for questions. No fluff.
- Never mention node IDs or metadata.`.trim();
  },
};
