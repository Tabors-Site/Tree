/**
 * Study Plan Mode
 *
 * Curriculum builder. Breaks topics into subtopics using AI knowledge.
 * Scaffolds the Active tree with study tools. Handles first-time setup.
 */

import { getActiveTopics, getQueue, getStudyProgress, findStudyNodes } from "../core.js";

export default {
  emoji: "📋",
  label: "Study Plan",
  bigMode: "tree",
  hidden: true,
  maxMessagesBeforeLoop: 25,
  preserveContextOnLoop: true,

  toolNames: [
    "study-create-topic",
    "study-add-subtopic",
    "study-move-to-active",
    "study-add-to-queue",
    "study-complete-setup",
    "study-save-profile",
    "navigate-tree",
    "get-tree-context",
    "create-node-note",
  ],

  async buildSystemPrompt({ username, rootId }) {
    const nodes = await findStudyNodes(rootId);
    const queue = await getQueue(rootId);
    const topics = await getActiveTopics(rootId);
    const progress = await getStudyProgress(rootId);

    const activeNodeId = nodes?.active?.id || "unknown";

    const queueStr = queue.length > 0
      ? queue.map(q => `  ${q.name}${q.url ? " (URL)" : ""}`).join("\n")
      : "  (empty)";

    const activeStr = topics.length > 0
      ? topics.map(t => `  ${t.name}: ${t.subtopics.length} subtopics, ${t.completion}%`).join("\n")
      : "  (none yet)";

    if (!progress?.active && queue.length === 0 && topics.length === 0) {
      // First time: help them get started
      return `You are ${username}'s curriculum builder. This is a fresh study tree.

Active node ID: ${activeNodeId}

FIRST TIME SETUP:
1. Ask what they want to learn. Could be a technology, a subject, a skill.
2. Ask about their learning style: theory-first, examples-first, or challenge-first.
3. Ask about daily study time goal (in minutes).
4. Save profile with study-save-profile.
5. Add their first topic to the queue with study-add-to-queue.
6. Move it to active with study-move-to-active.
7. Break it into subtopics with study-add-subtopic (5-10 concepts, ordered by prerequisite).
8. Call study-complete-setup.

BUILDING A CURRICULUM:
When breaking a topic into subtopics, think about:
- What are the fundamental concepts? (learn these first)
- What builds on what? (prerequisites as ordering)
- What's the natural learning progression? (simple to complex)
- 5-10 subtopics per topic is ideal. Too few = too broad. Too many = overwhelming.

Example: "React Hooks" breaks into:
  1. useState (fundamentals, start here)
  2. useEffect (side effects, after useState)
  3. useContext (state sharing, after useEffect)
  4. useRef (DOM and values, parallel to useContext)
  5. useMemo/useCallback (optimization, after basics)
  6. useReducer (complex state, after useState)
  7. Custom Hooks (composition, after all above)

Be conversational. Don't dump a list. Ask what they know, then build from there.`;
    }

    // Existing setup: modify curriculum
    return `You are ${username}'s curriculum builder. Help them organize their studies.

Active node ID: ${activeNodeId}

QUEUE:
${queueStr}

ACTIVE TOPICS:
${activeStr}

You can:
- Move queue items to active study (study-move-to-active)
- Create new topics directly (study-create-topic, needs activeNodeId)
- Break topics into subtopics (study-add-subtopic)
- Add to queue (study-add-to-queue)
- Write study plans as notes (create-node-note on topic nodes)

When the user says "break down X" or "build curriculum for X":
1. Use study-create-topic to create it under Active
2. Use study-add-subtopic for each concept (5-10 per topic)
3. Order by prerequisites (order param, lower = learn first)

Ask what they want to work on. Build it.`.trim();
  },
};
