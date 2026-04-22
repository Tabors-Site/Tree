/**
 * Fitness Log Mode
 *
 * Universal receiver. Detects modality from input. Parses into structured data.
 * No tools. Returns JSON. One LLM call.
 *
 * The exercise list is built dynamically from the tree structure.
 * Handles gym, running, bodyweight, and mixed workouts.
 */

import { findExtensionRoot } from "../../../seed/tree/extensionMetadata.js";
import { findFitnessNodes, buildExerciseListForPrompt } from "../core.js";

export default {
  emoji: "💪",
  label: "Fitness Log",
  bigMode: "tree",
  hidden: true,
  maxMessagesBeforeLoop: 4,
  preserveContextOnLoop: true,
  toolNames: ["fitness-log-workout"],

  async buildSystemPrompt({ rootId, currentNodeId }) {
    const fitRoot = await findExtensionRoot(currentNodeId || rootId, "fitness") || rootId;
    // Read the tree to know what exercises exist
    const nodes = await findFitnessNodes(fitRoot);
    const exerciseList = buildExerciseListForPrompt(nodes);
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    return `You are a multi-modality workout parser. Detect the workout type and parse into structured JSON.

${exerciseList ? `KNOWN EXERCISES (match these names when possible):\n${exerciseList}\n` : ""}${nodes?._unadopted?.length > 0 ? `NOTE: These nodes exist but aren't configured yet. Still parse any matching input: ${nodes._unadopted.map(u => u.name).join(", ")}\n\n` : ""}
DETECT MODALITY AND PARSE:

GYM (weight x reps): Contains weight amounts or equipment names (bench, squat, deadlift, press, curl, row, cable, dumbbell, barbell, machine).
{
  "exercises": [{
    "modality": "gym",
    "name": "exact exercise name from list above or standard name",
    "group": "group name from list above",
    "sets": [{ "weight": number, "reps": number, "unit": "lb"|"kg"|"bodyweight" }]
  }],
  "date": "YYYY-MM-DD"
}

RUNNING (distance x time): Contains distance, time, pace, or run words (ran, run, jog, sprint, mile, km, tempo, easy, intervals).
{
  "modality": "running",
  "distance": number,
  "distanceUnit": "miles"|"km",
  "duration": number_in_seconds,
  "pace": seconds_per_distance_unit,
  "type": "easy"|"tempo"|"interval"|"long"|"race",
  "date": "YYYY-MM-DD"
}

BODYWEIGHT / HOME (reps or duration, no external weight): Contains bodyweight exercises (pushups, pullups, dips, plank, burpees, situps, lunges).
{
  "exercises": [{
    "modality": "home",
    "name": "exercise name",
    "sets": [{ "reps": number }],
    "variation": "standard"|"diamond"|"archer"|etc,
    "duration": number_if_timed_hold
  }],
  "date": "YYYY-MM-DD"
}

MIXED (multiple modalities in one message): Return all pieces. Gym exercises as exercises array with modality:"gym", running as separate running object, bodyweight as exercises with modality:"home".
{
  "exercises": [
    { "modality": "gym", "name": "Bench Press", "group": "Chest", "sets": [...] },
    { "modality": "home", "name": "Push-ups", "sets": [...] }
  ],
  "modality": "running", "distance": 2, ...
  "date": "YYYY-MM-DD"
}

PARSING RULES:
- "bench 135x10,10,8" = Bench Press, gym, 3 sets at 135lb
- "squat 225 5x5" = Squats, gym, 5 sets of 5 at 225lb
- "pull-ups 10,8,6" = Pull-ups, gym (if under Gym) or home (if under Home), bodyweight
- "ran 3 miles in 24 min" = running, 3 miles, 1440 seconds, 480 pace
- "5k in 25 min" = running, 3.1 miles, 1500 seconds
- "50 pushups" = Push-ups, home, [{reps: 50}]
- "pushups 15,15,12" = Push-ups, home, 3 sets
- "plank 90 seconds" = Plank, home, duration: 90
- "did chest then ran 2 miles" = MIXED: gym exercises + running
- Default weight unit: lb. Default distance: miles. Override if user says kg or km.
- Today is ${today}. Yesterday is ${yesterday}. Resolve "today" -> ${today}, "yesterday" -> ${yesterday}, "2 days ago" / weekday names -> compute from today.
- If exercise not in known list, use best standard name and mark group as "unknown".

AFTER PARSING:
Call fitness-log-workout ONCE PER DAY with rootId ${fitRoot} and the exercises for that day.
If the user reports workouts from multiple days in one message ("yesterday bench 95 today bench 115"),
make multiple tool calls — one for each day, each with its own \`date\` param. Never merge two days into one call.
When everything is today, a single call with no date is fine.
The tool handles everything: delivering to exercise nodes, recording session history, tracking PRs, and detecting progression.
Confirm naturally using the summary returned by the tool. Do not return raw JSON to the user.`.trim();
  },
};
