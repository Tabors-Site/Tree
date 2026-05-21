/**
 * Study Session Mode
 *
 * The one mode that handles teaching. The prompt carries all intelligence.
 * The handler sends raw messages. The AI decides what to do.
 */

import { findExtensionRoot } from "../../../seed/tree/extensionMetadata.js";
import { getActiveTopics, getQueue, getProfile, getGaps } from "../core.js";

export default {
  emoji: "🎓",
  label: "Study Session",
  bigMode: "tree",
  hidden: true,
  maxMessagesBeforeLoop: 30,
  preserveContextOnLoop: true,

  toolNames: [
    "study-update-mastery",
    "study-detect-gap",
    "study-add-subtopic",
    "study-add-to-queue",
    "create-node-note",
    "get-tree-context",
  ],

  async buildSystemPrompt({ username, rootId, currentNodeId }) {
    const studyRoot = await findExtensionRoot(currentNodeId || rootId, "study") || rootId;
    const topics = await getActiveTopics(studyRoot);
    const queue = await getQueue(studyRoot);
    const profile = await getProfile(studyRoot);
    const gaps = await getGaps(studyRoot);

    // Current topic: most recently studied
    let currentTopic = null;
    if (topics.length > 0) {
      topics.sort((a, b) => (b.lastStudied || "").localeCompare(a.lastStudied || ""));
      currentTopic = topics[0];
    }

    // Next subtopic: lowest mastery, not complete
    let nextSubtopic = null;
    if (currentTopic?.subtopics?.length > 0) {
      const incomplete = currentTopic.subtopics.filter(s => !s.complete);
      if (incomplete.length > 0) {
        incomplete.sort((a, b) => (a.mastery || 0) - (b.mastery || 0));
        nextSubtopic = incomplete[0];
      }
    }

    // Build state blocks
    const topicBlock = currentTopic
      ? `CURRENT TOPIC: ${currentTopic.name} (${currentTopic.completion}% complete)\n` +
        (currentTopic.subtopics || []).map(s =>
          `  ${s.complete ? "DONE" : s.mastery + "%"} ${s.name} [id: ${s.id}]`
        ).join("\n")
      : "No active topic.";

    const nextBlock = nextSubtopic
      ? `TEACH NEXT: "${nextSubtopic.name}" [subtopicId: ${nextSubtopic.id}] (${nextSubtopic.mastery}%)`
      : currentTopic && (currentTopic.subtopics || []).length === 0
        ? `NO SUBTOPICS: Create 3-8 with study-add-subtopic (topicId: ${currentTopic.id}), then teach the first one.`
        : currentTopic
          ? "ALL SUBTOPICS COMPLETE. Suggest next topic from queue."
          : "";

    const queueBlock = queue.length > 0
      ? `QUEUE: ${queue.map(q => q.name).join(", ")}`
      : "";

    const otherTopics = topics.filter(t => t !== currentTopic);
    const otherBlock = otherTopics.length > 0
      ? `OTHER ACTIVE: ${otherTopics.map(t => `${t.name} (${t.completion}%)`).join(", ")}`
      : "";

    const gapBlock = gaps.length > 0
      ? `GAPS: ${gaps.map(g => g.name).join(", ")}`
      : "";

    const style = profile?.learningStyle || "examples-first";

    return `You are ${username}'s tutor. You teach through dialogue.

${topicBlock}
${nextBlock}
${[queueBlock, otherBlock, gapBlock].filter(Boolean).join("\n")}

RULES:
1. Explain a concept briefly. Use ${style === "theory-first" ? "principles first" : style === "challenge-first" ? "a problem to solve" : "a concrete example"}.
2. Ask ONE question.
3. When they answer, call study-update-mastery with the subtopicId and a score (0-100).
4. Move to the next subtopic when mastery reaches 80%.
5. If they lack a prerequisite, call study-detect-gap.
6. If they want to switch topics, stop studying, learn something new, or navigate away, help them. Tell them available commands: "switch <topic>", "needlearn <topic>", "stop <topic>".
7. If they ask about progress, answer from the data above.
8. Never show IDs, scores, or tool names to the user.
9. Never offer menus or lists of options. Teach or navigate. Nothing else.`.trim();
  },
};
