/**
 * Fitness Review Mode
 *
 * Cross-modality analysis. Weekly summary, progression tracking,
 * PR detection, consistency patterns, overdue exercises, nutrition correlation.
 */

import { getExerciseState, getProfile, getWeeklyStats } from "../core.js";

export default {
  emoji: "📊",
  label: "Fitness Review",
  bigMode: "tree",
  hidden: true,
  maxMessagesBeforeLoop: 30,
  preserveContextOnLoop: true,

  toolNames: [
    "navigate-tree",
    "get-tree-context",
    "get-node-notes",
  ],

  async buildSystemPrompt({ username, rootId }) {
    const state = await getExerciseState(rootId);
    const profile = await getProfile(rootId);
    const weekly = await getWeeklyStats(rootId);

    const exerciseSummary = state ? Object.entries(state.groups).map(([group, data]) => {
      const exs = data.exercises.map(e => {
        const vals = e.values || {};
        const goals = e.goals || {};
        if (data.modality === "gym") {
          const sets = Object.keys(vals).filter(k => k.startsWith("set")).map(k => vals[k]).filter(v => v != null);
          const goalVals = Object.keys(goals).filter(k => k.startsWith("set")).map(k => goals[k]).filter(v => v != null);
          return `${e.name}: ${vals.weight || "?"}lb ${sets.join("/")} (goals: ${goalVals.join("/")}) last: ${vals.lastWorked || "never"} [${e.historyCount} sessions]`;
        }
        if (data.modality === "running") {
          return `${e.name}: ${JSON.stringify(vals)}`;
        }
        return `${e.name}: ${JSON.stringify(vals)} goals: ${JSON.stringify(goals)}`;
      }).join("\n    ");
      return `  ${group} [${data.modality}]:\n    ${exs}`;
    }).join("\n") : "No data.";

    const weeklyStr = weekly
      ? `Sessions: ${weekly.sessions}, Gym: ${weekly.gymSessions}, Runs: ${weekly.runs} (${weekly.runMiles}mi), Home: ${weekly.homeSessions}, Volume: ${weekly.totalVolume}lb`
      : "No data this week.";

    return `You are ${username}'s fitness analyst. Analyze their training data across all modalities.

CURRENT STATE:
${exerciseSummary}

THIS WEEK: ${weeklyStr}
Profile: ${profile?.sessionsPerWeek || "?"} days/week target

ANALYZE:
1. Progressive overload: Which exercises are progressing? Which are stalled?
2. Consistency: Sessions this week vs target. Missed modalities.
3. Volume trends: Is total volume trending up, flat, or down?
4. PRs: Any new personal records (gym lifts, run times)?
5. Overdue: Exercises not worked in 7+ days.
6. Balance: Are they neglecting any modality or muscle group?
7. Recovery: Training too many consecutive days? Enough rest?
8. Cross-modality: Running affecting leg day recovery? Bodyweight complementing gym?

Use navigate-tree and get-node-notes to read History notes for trends over time.
Read exercise node notes for detailed session history.

STYLE:
- Lead with what's working. Then what needs attention.
- Use actual numbers and percentages. "Bench: 130->140 (+7.7%) in 4 weeks."
- Compare to their goals. "15.5/20 weekly miles (78%)."
- Be direct. If something is stalling, say so and suggest a fix.
- Never mention node IDs, metadata, or tools.`.trim();
  },
};
