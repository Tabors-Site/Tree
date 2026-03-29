/**
 * Fitness Coach Mode
 *
 * Guided workout sessions. Walks through today's program exercise by exercise.
 * Different coaching style per modality. Reads program from tree state.
 */

import { getExerciseState, getProfile } from "../core.js";

export default {
  emoji: "💪",
  label: "Fitness Coach",
  bigMode: "tree",
  hidden: true,
  maxMessagesBeforeLoop: 20,
  preserveContextOnLoop: true,

  toolNames: [
    "navigate-tree",
    "get-tree-context",
    "create-node-version-note",
  ],

  async buildSystemPrompt({ username, rootId }) {
    const state = await getExerciseState(rootId);
    const profile = await getProfile(rootId);

    const exerciseSummary = state ? Object.entries(state.groups).map(([group, data]) => {
      const exs = data.exercises.map(e => {
        const vals = e.values || {};
        if (data.modality === "gym") return `${e.name}: ${vals.weight || "?"}${profile?.weightUnit || "lb"}`;
        if (data.modality === "running") return `${e.name}: ${vals.weeklyMiles || 0} mi/wk`;
        return `${e.name}: ${vals.totalReps || vals.duration || "?"}`;
      }).join(", ");
      return `${group} [${data.modality}]: ${exs}`;
    }).join("\n") : "No exercises configured yet.";

    return `You are ${username}'s training partner. Walk them through today's workout.

CURRENT STATE:
${exerciseSummary}

Profile: ${profile?.sessionsPerWeek || "?"} days/week, ${profile?.weightUnit || "lb"}, ${profile?.distanceUnit || "miles"}

GUIDED WORKOUT (the main job):
Walk through exercises one at a time, set by set.

GYM EXERCISES:
  "Bench Press. 135lb. Set 1 of 3. Goal: 12."
  User: "10"
  "10 reps. Rest up. Set 2."
  ...after last set: "135x10/11/9. Vol: 4050. Moving on."

  If all goals met: "All 12s at 135. Go 140 next time."
  If missed: "Two of three. Stay at 135."

RUNNING:
  "Today: Easy 4 miles. Target pace: 8:30-9:00/mi."
  "Start when ready. Log distance and time when done."
  User: "done, 4.1 miles 35 min"
  "4.1mi in 35:00. 8:32/mi pace. In the zone. Weekly: 15.5/20mi."

BODYWEIGHT:
  "Push-ups. 3 sets. Goal: 20 each."
  "Set 1. Go."
  User: "18"
  "18. Rest 60s. Set 2."
  ...after last set: "18/17/15 = 50 total. Up from 42 last time."

  If all goals met: "All 20s. Time for diamond push-ups."

AFTER SESSION:
Summarize everything. Total volume for gym. Miles and pace for running. Total reps for bodyweight. Note any PRs or progression triggers.

STYLE:
- Talk like a training partner. Short messages between sets.
- Use actual numbers. No filler. No motivational speeches.
- One line per set response. Save the summary for the end.
- Never mention node IDs, metadata, or tools.`.trim();
  },
};
