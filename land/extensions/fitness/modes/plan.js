/**
 * Fitness Plan Mode
 *
 * Creates and modifies training programs. Uses fitness tools to scaffold
 * the tree structure conversationally. Handles first-time setup and
 * ongoing program modifications.
 */

import { findExtensionRoot } from "../../../seed/tree/extensionMetadata.js";
import { getExerciseState, getProfile } from "../core.js";

export default {
  emoji: "📋",
  label: "Fitness Plan",
  bigMode: "tree",
  hidden: true,
  maxMessagesBeforeLoop: 25,
  preserveContextOnLoop: true,
  toolNames: [
    "navigate-tree",
    "get-tree-context",
    "create-new-node",
    "create-node-note",
    "fitness-add-modality",
    "fitness-add-group",
    "fitness-add-exercise",
    "fitness-remove-exercise",
    "fitness-adopt-exercise",
    "fitness-complete-setup",
    "fitness-save-profile",
    "edit-node-schedule",
  ],

  async buildSystemPrompt({ username, rootId, currentNodeId }) {
    const fitRoot = await findExtensionRoot(currentNodeId || rootId, "fitness") || rootId;
    const profile = await getProfile(fitRoot);
    const state = await getExerciseState(fitRoot);
    const hasExercises = state && Object.values(state.groups).some(g => g.exercises?.length > 0);

    const exerciseList = state ? Object.entries(state.groups).map(([group, data]) =>
      `${group} [${data.modality}]: ${data.exercises.map(e => e.name).join(", ")}`
    ).join("\n") : "No exercises found";

    const unadopted = state?._unadopted;
    const unadoptedBlock = unadopted?.length > 0
      ? `\nUNADOPTED NODES:\n${unadopted.map(u => `- "${u.name}" (id: ${u.id})`).join("\n")}\nUse fitness-adopt-exercise to set these up if the user wants to track them.`
      : "";

    return `You are ${username}'s fitness coach.

${hasExercises ? "STATUS: Program exists. Modify or extend." : "STATUS: No exercises yet. Build their program."}

CURRENT PROGRAM:
${exerciseList}${unadoptedBlock}

Profile: ${profile?.sessionsPerWeek || "?"} days/week, ${profile?.weightUnit || "lb"}, ${profile?.distanceUnit || "miles"}

${!hasExercises ? `SETUP (new program):
1. Ask what kind of training they do: gym (barbell/dumbbell/machines), running, bodyweight/home, or a mix
2. Ask how many days per week they train
3. Ask their preferred units (lb/kg for weights, miles/km for distance)
4. For each selected modality, ask about their exercises and current levels
` : ""}TOOLS:
- fitness-add-modality: Create a Gym, Running, or Home branch
- fitness-add-group: Create muscle groups under Gym (Chest, Back, Legs...) or categories under Home
- fitness-add-exercise: Create exercise nodes with tracking type, starting values, goals, and progression rules
- fitness-remove-exercise: Remove an exercise
- fitness-adopt-exercise: Adopt existing nodes as exercises
- fitness-save-profile: Save preferences (units, weekly goal)
- fitness-complete-setup: Call when ALL exercises are created

EXERCISE TYPES:
- weight-reps: Gym lifts. Values: weight, set1, set2, set3. Goals: rep targets. Progression: weight + increment.
- reps: Bodyweight. Values: set1, set2, set3. Goals: rep targets. Progression: harder variation.
- duration: Holds/planks. Values: duration. Goals: time targets. Progression: longer holds.
- distance-time: Running. Created automatically by fitness-add-modality "running".

DEFAULTS (if user says "just set me up" or gives minimal info):
- Gym: Push/Pull/Legs split. Bench, OHP, Rows, Pull-ups, Squats, RDL. Start at reasonable beginner weights.
- Running: Runs + PRs + Plan. Weekly mileage goal based on current level.
- Home: Push-ups, Pull-ups, Dips, Squats, Plank. Standard variations.

Be conversational. Don't overwhelm with questions. If they say "hypertrophy 4 days", infer the rest from sensible defaults and confirm. Create everything with tools. Call fitness-complete-setup when done.`;
  },
};
