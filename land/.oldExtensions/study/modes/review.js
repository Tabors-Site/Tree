/**
 * Study Review Mode
 *
 * Progress analysis. Mastery across topics, gaps, streaks, time spent.
 */

import { findExtensionRoot } from "../../../seed/tree/extensionMetadata.js";
import { getActiveTopics, getStudyProgress, getGaps, getProfile } from "../core.js";

export default {
  emoji: "📊",
  label: "Study Review",
  bigMode: "tree",
  hidden: true,
  maxMessagesBeforeLoop: 20,
  preserveContextOnLoop: true,

  toolNames: [
    "navigate-tree",
    "get-tree-context",
    "get-node-notes",
  ],

  async buildSystemPrompt({ username, rootId, currentNodeId }) {
    const studyRoot = await findExtensionRoot(currentNodeId || rootId, "study") || rootId;
    const topics = await getActiveTopics(studyRoot);
    const progress = await getStudyProgress(studyRoot);
    const gaps = await getGaps(studyRoot);
    const profile = await getProfile(studyRoot);

    const topicsStr = topics.length > 0
      ? topics.map(t => {
          const subs = t.subtopics.map(s =>
            `    ${s.complete ? "done" : s.mastery + "%"} ${s.name}`
          ).join("\n");
          return `  ${t.name} (${t.completion}% complete)\n${subs}`;
        }).join("\n\n")
      : "  No active topics.";

    const gapsStr = gaps.length > 0
      ? gaps.map(g => `  ${g.name} (found during ${g.detectedDuring})`).join("\n")
      : "  None detected.";

    return `You are ${username}'s learning analyst. Review their study progress.

ACTIVE TOPICS:
${topicsStr}

COMPLETED: ${progress?.completed?.allTime || 0} topics all time
QUEUED: ${progress?.queue?.count || 0} topics waiting
GAPS:
${gapsStr}

Daily goal: ${profile?.dailyStudyMinutes || "not set"} minutes

ANALYZE:
1. Which concepts are they strongest in? Weakest?
2. Are there patterns in what they struggle with?
3. How are the gaps affecting progress?
4. Is the curriculum order working? Should anything be reordered?
5. What should they study next?

Use navigate-tree and get-node-notes to read History for session details and time tracking.

STYLE:
- Lead with progress. What's working.
- Then gaps and what needs attention.
- Suggest next steps concretely.
- Use percentages for mastery, but phrase naturally: "You've got closures down solid but useEffect cleanup is shaky."
- Never mention node IDs or tools.`.trim();
  },
};
