/**
 * Fitness Core
 *
 * Parse workout input, route to exercise nodes, track progression,
 * record history. The tree does the orchestration.
 */

import log from "../../seed/log.js";
import { parseJsonSafe } from "../../seed/orchestrators/helpers.js";

let _Node = null;
let _runChat = null;
let _metadata = null;

export function configure({ Node, runChat, metadata }) {
  _Node = Node;
  _runChat = runChat;
  _metadata = metadata;
}

// ── Constants ──

const MAX_HISTORY = 50;

const DEFAULT_CONFIG = {
  defaultSets: 3,
  repRangeMin: 8,
  repRangeMax: 12,
  weightIncrementLb: 5,
  restTimerSeconds: 90,
  maxHistoryPerExercise: 50,
};

// ── Initialization check ──

export async function isInitialized(rootId) {
  if (!_Node) return false;
  const root = await _Node.findById(rootId).select("metadata").lean();
  if (!root) return false;
  const meta = root.metadata instanceof Map
    ? root.metadata.get("fitness")
    : root.metadata?.fitness;
  return !!meta?.initialized;
}

// ── Find fitness nodes by role ──

export async function findFitnessNodes(rootId) {
  if (!_Node) return null;
  const children = await _Node.find({ parent: rootId }).select("_id name metadata").lean();
  const result = { muscleGroups: [], exercises: {} };

  for (const child of children) {
    const meta = child.metadata instanceof Map
      ? child.metadata.get("fitness")
      : child.metadata?.fitness;
    if (!meta?.role) continue;

    if (meta.role === "log") result.log = { id: String(child._id), name: child.name };
    else if (meta.role === "program") result.program = { id: String(child._id), name: child.name };
    else if (meta.role === "history") result.history = { id: String(child._id), name: child.name };
    else if (meta.role === "muscle-group") {
      result.muscleGroups.push({ id: String(child._id), name: child.name });
      // Load exercises under this group
      const exercises = await _Node.find({ parent: child._id }).select("_id name metadata").lean();
      result.exercises[child.name] = exercises.map(e => ({
        id: String(e._id),
        name: e.name,
        meta: e.metadata instanceof Map ? Object.fromEntries(e.metadata) : (e.metadata || {}),
      }));
    }
  }

  return result;
}

// ── Workout parsing ──

const PARSE_PROMPT = `You are a workout log parser. Parse the user's exercise input into structured data.

Return ONLY JSON:
{
  "exercises": [
    {
      "name": "exercise name (match common names: Bench Press, Squats, Pull-ups, etc)",
      "group": "muscle group (Chest, Back, Legs, Shoulders, Core, Additional)",
      "sets": [
        { "weight": number_or_0, "reps": number, "unit": "lb" | "kg" | "bodyweight" }
      ]
    }
  ],
  "date": "YYYY-MM-DD"
}

Parsing rules:
- "bench 135x10,10,8" = Bench Press, 3 sets at 135lb: 10 reps, 10 reps, 8 reps
- "squat 225 5x5" = Squats, 5 sets of 5 reps at 225lb
- "pull-ups 10,8,6" = Pull-ups, bodyweight, 3 sets
- "ran 3 miles in 25 min" = Running, { distance: 3, duration: 25, unit: "miles" }
- "plank 3x60s" = Plank, 3 sets of 60 seconds
- Default unit is lb unless the user says kg
- Keep exercise names standard and recognizable
- "date" is today if not specified
- Return ONLY the JSON. No explanation.`;

export async function parseWorkout(message, userId, username, rootId) {
  if (!_runChat) return null;

  const { answer } = await _runChat({
    userId,
    username,
    message,
    mode: "tree:fitness-log",
    rootId,
  });

  if (!answer) return null;
  const parsed = parseJsonSafe(answer);
  if (!parsed?.exercises?.length) return null;

  // Default date to today
  if (!parsed.date) parsed.date = new Date().toISOString().slice(0, 10);

  return parsed;
}

// ── Route exercise data to nodes ──

export async function deliverToExerciseNodes(fitnessNodes, parsed) {
  if (!_Node || !fitnessNodes) return;

  for (const exercise of parsed.exercises) {
    // Find the exercise node by matching name against known exercises
    const groupExercises = fitnessNodes.exercises[exercise.group] || [];
    const match = groupExercises.find(e =>
      e.name.toLowerCase() === exercise.name.toLowerCase() ||
      e.name.toLowerCase().includes(exercise.name.toLowerCase()) ||
      exercise.name.toLowerCase().includes(e.name.toLowerCase())
    );

    if (!match) {
      log.verbose("Fitness", `No node found for "${exercise.name}" in ${exercise.group}. Skipping cascade.`);
      continue;
    }

    // Build value updates
    const fields = {};
    const weight = exercise.sets[0]?.weight || 0;
    fields.weight = weight;

    for (let i = 0; i < exercise.sets.length; i++) {
      fields[`set${i + 1}`] = exercise.sets[i].reps;
    }

    // Calculate total volume
    const totalVolume = exercise.sets.reduce((sum, s) => sum + (s.weight || 0) * (s.reps || 0), 0);
    fields.totalVolume = totalVolume;
    fields.lastWorked = parsed.date;

    // Atomic update on the exercise node
    await _metadata.batchSetExtMeta(match.id, "values", fields);

    // Record to exercise history
    const node = await _Node.findById(match.id);
    if (node) {
      const existing = _metadata.getExtMeta(node, "fitness");
      const history = Array.isArray(existing.history) ? existing.history : [];
      const bestSet = Math.max(...exercise.sets.map(s => s.reps));

      history.push({
        date: parsed.date,
        weight,
        bestSet,
        totalVolume,
        sets: exercise.sets,
      });

      while (history.length > MAX_HISTORY) history.shift();
      await _metadata.setExtMeta(node, "fitness", { ...existing, history, role: existing.role });
    }

    log.verbose("Fitness", `Updated ${exercise.name}: ${exercise.sets.map(s => `${s.weight}x${s.reps}`).join("/")}`);
  }
}

// ── Write workout to history node ──

export async function recordWorkoutHistory(historyNodeId, parsed, userId) {
  if (!historyNodeId) return;

  const totalVolume = parsed.exercises.reduce((sum, ex) =>
    sum + ex.sets.reduce((s, set) => s + (set.weight || 0) * (set.reps || 0), 0), 0
  );

  const muscleGroups = [...new Set(parsed.exercises.map(e => e.group))];

  const record = {
    date: parsed.date,
    exercises: parsed.exercises.map(ex => ({
      name: ex.name,
      group: ex.group,
      sets: ex.sets,
      totalVolume: ex.sets.reduce((s, set) => s + (set.weight || 0) * (set.reps || 0), 0),
    })),
    totalVolume,
    muscleGroups,
  };

  try {
    const { createNote } = await import("../../seed/tree/notes.js");
    await createNote({
      nodeId: historyNodeId,
      content: JSON.stringify(record),
      contentType: "text",
      userId,
    });
  } catch (err) {
    log.warn("Fitness", `History note failed: ${err.message}`);
  }

  return record;
}

// ── Progression check ──

/**
 * Check if an exercise has met all set goals (progressive overload trigger).
 */
export function checkProgression(exerciseNode) {
  const values = exerciseNode.metadata instanceof Map
    ? exerciseNode.metadata.get("values")
    : exerciseNode.metadata?.values;
  const goals = exerciseNode.metadata instanceof Map
    ? exerciseNode.metadata.get("goals")
    : exerciseNode.metadata?.goals;

  if (!values || !goals) return null;

  let allMet = true;
  let totalSets = 0;
  for (let i = 1; i <= 5; i++) {
    const setVal = values[`set${i}`];
    const setGoal = goals[`set${i}`];
    if (setGoal == null) continue;
    totalSets++;
    if (setVal == null || setVal < setGoal) {
      allMet = false;
      break;
    }
  }

  if (totalSets === 0) return null;

  return {
    allGoalsMet: allMet,
    currentWeight: values.weight || 0,
    suggestedWeight: allMet ? (values.weight || 0) + DEFAULT_CONFIG.weightIncrementLb : null,
  };
}

// ── Build summary for response ──

export function buildWorkoutSummary(parsed, fitnessNodes) {
  const lines = [];
  for (const ex of parsed.exercises) {
    const setsStr = ex.sets.map(s =>
      s.weight > 0 ? `${s.weight}x${s.reps}` : `${s.reps}`
    ).join("/");
    const volume = ex.sets.reduce((sum, s) => sum + (s.weight || 0) * (s.reps || 0), 0);
    lines.push(`${ex.name}: ${setsStr}${volume > 0 ? ` (vol: ${volume.toLocaleString()})` : ""}`);
  }

  const totalVolume = parsed.exercises.reduce((sum, ex) =>
    sum + ex.sets.reduce((s, set) => s + (set.weight || 0) * (set.reps || 0), 0), 0
  );
  const groups = [...new Set(parsed.exercises.map(e => e.group))].join(" + ");

  return {
    lines,
    totalVolume,
    groups,
    summary: `Logged: ${groups}\n${lines.join("\n")}${totalVolume > 0 ? `\nTotal volume: ${totalVolume.toLocaleString()}lb` : ""}`,
  };
}

// ── Read exercise state for enrichContext ──

export async function getExerciseState(rootId) {
  if (!_Node) return null;

  const nodes = await findFitnessNodes(rootId);
  if (!nodes?.muscleGroups?.length) return null;

  const state = {};
  for (const group of nodes.muscleGroups) {
    const exercises = nodes.exercises[group.name] || [];
    state[group.name] = exercises.map(ex => {
      const values = ex.meta.values || {};
      const goals = ex.meta.goals || {};
      const fitMeta = ex.meta.fitness || {};
      return {
        name: ex.name,
        weight: values.weight || 0,
        sets: [values.set1, values.set2, values.set3].filter(v => v != null),
        goals: [goals.set1, goals.set2, goals.set3].filter(v => v != null),
        lastWorked: values.lastWorked || null,
        historyCount: fitMeta.history?.length || 0,
      };
    });
  }
  return state;
}
