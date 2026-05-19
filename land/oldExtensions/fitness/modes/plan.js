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
    "fitness-add-modality",
    "fitness-add-group",
    "fitness-add-exercise",
    "fitness-remove-exercise",
    "fitness-adopt-exercise",
    "fitness-complete-setup",
    "fitness-save-profile",
  ],

  async buildSystemPrompt({ username, rootId, currentNodeId }) {
    const fitRoot = await findExtensionRoot(currentNodeId || rootId, "fitness") || rootId;
    const profile = await getProfile(fitRoot);
    const state = await getExerciseState(fitRoot);
    const hasExercises = state && Object.values(state.groups).some(g => g.exercises?.length > 0);

    // Include node IDs and current goals so the AI can call fitness-adopt-exercise
    // to modify existing exercises without guessing at nodeIds.
    const exerciseList = state ? Object.entries(state.groups).map(([group, data]) => {
      const exLines = data.exercises.map(e => {
        const goalStr = e.goals && Object.keys(e.goals).length > 0
          ? ` goals=${JSON.stringify(e.goals)}`
          : "";
        const schemaStr = e.schema ? ` type=${e.schema.type} unit=${e.schema.unit || "lb"}` : "";
        return `  - ${e.name} (id: ${e.id})${schemaStr}${goalStr}`;
      }).join("\n");
      return `${group} [${data.modality}]:\n${exLines}`;
    }).join("\n") : "No exercises found";

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

CRITICAL RULES:
- When the user asks to FIX, UPDATE, CHANGE, or CORRECT an existing exercise, use the node id from CURRENT PROGRAM above and call fitness-adopt-exercise with that id to re-set its goals. DO NOT create a new exercise.
- The node ids in CURRENT PROGRAM are real and usable. Pass them directly to tools. Never say "I don't have access to node ids" when they are listed above.
- NEVER say you created an exercise without calling fitness-add-exercise first. The tool creates the node. Without the tool call, nothing exists.
- NEVER describe a program without building it. When the user gives you exercises, IMMEDIATELY call the tools. Tools first, summary after.
- Call fitness-add-modality FIRST (gym/running/home), then fitness-add-group for muscle groups, then fitness-add-exercise for each exercise. Do them in order. Do them NOW, not after more conversation.
- Call fitness-save-profile with their units and weekly goal.
- Call fitness-complete-setup LAST after all exercises are created.
- If the user gives you 8 exercises, make 8 fitness-add-exercise calls. No shortcuts. No "I'll set those up." Actually call the tool for each one.
- Be concise in your response AFTER the tools run. Confirm what was created. Don't repeat what they told you.`;
  },
};
