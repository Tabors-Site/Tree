/**
 * Fitness Core
 *
 * Multi-modality workout tracking. Three languages:
 *   gym:  weight x reps x sets (progressive overload = weight up)
 *   running: distance x time x pace (progressive overload = mileage up, pace down)
 *   home: reps x sets or duration (progressive overload = reps up, harder variation)
 *
 * One LLM call detects modality and parses. Routing sends to the right branch.
 * The tree structure defines what exercises exist. The code is generic.
 */

import log from "../../seed/log.js";
import { parseJsonSafe } from "../../seed/orchestrators/helpers.js";

let _Node = null;
let _Note = null;
let _runChat = null;
let _metadata = null;

export function configure({ Node, Note, runChat, metadata }) {
  _Node = Node;
  _Note = Note;
  _runChat = runChat;
  _metadata = metadata;
}

// ── Constants ──

const MAX_HISTORY = 50;
const MAX_SESSION_HISTORY = 90; // days of session records on History node

// ── Modalities ──

const MODALITIES = {
  GYM: "gym",
  RUNNING: "running",
  HOME: "home",
};

// ── Adopt an existing node as a tracked exercise ──

export async function adoptExercise(nodeId, { exerciseType, unit, goals }) {
  if (!_metadata || !_Node) throw new Error("Services not configured");
  const node = await _Node.findById(nodeId);
  if (!node) throw new Error("Node not found");
  await _metadata.setExtMeta(node, "fitness", {
    role: "exercise",
    valueSchema: { type: exerciseType || "weight-reps", unit: unit || "lb" },
  });
  if (goals && Object.keys(goals).length > 0) {
    await _metadata.setExtMeta(node, "goals", goals);
  }
  // Initialize empty values
  await _metadata.batchSetExtMeta(nodeId, "values", { today: 0 });
  log.info("Fitness", `Adopted "${node.name}" as exercise (${exerciseType || "weight-reps"})`);
}

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

export async function getSetupPhase(rootId) {
  if (!_Node) return null;
  const root = await _Node.findById(rootId).select("metadata").lean();
  if (!root) return null;
  const meta = root.metadata instanceof Map
    ? root.metadata.get("fitness")
    : root.metadata?.fitness;
  return meta?.setupPhase || (meta?.initialized ? "complete" : null);
}

export async function getProfile(rootId) {
  if (!_Node) return {};
  const root = await _Node.findById(rootId).select("metadata").lean();
  if (!root) return {};
  const meta = root.metadata instanceof Map
    ? root.metadata.get("fitness")
    : root.metadata?.fitness;
  return meta?.profile || {};
}

// ── Find fitness nodes by role ──

export async function findFitnessNodes(rootId) {
  if (!_Node) return null;
  const children = await _Node.find({ parent: rootId }).select("_id name metadata").lean();
  const result = { groups: [], exercises: {}, modalities: [], _rootId: String(rootId) };

  for (const child of children) {
    const meta = child.metadata instanceof Map
      ? child.metadata.get("fitness")
      : child.metadata?.fitness;
    if (!meta?.role) {
      // Unadopted node: child of fitness root with no fitness role
      if (!result._unadopted) result._unadopted = [];
      result._unadopted.push({ id: String(child._id), name: child.name });
      continue;
    }

    if (meta.role === "log") result.log = { id: String(child._id), name: child.name };
    else if (meta.role === "program") result.program = { id: String(child._id), name: child.name };
    else if (meta.role === "history") result.history = { id: String(child._id), name: child.name };
    else if (meta.role === "modality") {
      result.modalities.push({ id: String(child._id), name: child.name, modality: meta.modality });
      // Load groups under modality (gym has muscle groups, running/home have categories)
      const subChildren = await _Node.find({ parent: child._id }).select("_id name metadata").lean();
      for (const sub of subChildren) {
        const subMeta = sub.metadata instanceof Map ? sub.metadata.get("fitness") : sub.metadata?.fitness;
        if (subMeta?.role === "group" || subMeta?.role === "muscle-group") {
          result.groups.push({ id: String(sub._id), name: sub.name, modality: meta.modality, parentModality: child.name });
          const exercises = await _Node.find({ parent: sub._id }).select("_id name metadata").lean();
          result.exercises[sub.name] = exercises.map(e => ({
            id: String(e._id),
            name: e.name,
            modality: meta.modality,
            meta: e.metadata instanceof Map ? Object.fromEntries(e.metadata) : (e.metadata || {}),
          }));
        } else if (subMeta?.role === "exercise") {
          // Direct exercises under modality (running/Runs, running/PRs)
          if (!result.exercises[child.name]) result.exercises[child.name] = [];
          result.exercises[child.name].push({
            id: String(sub._id),
            name: sub.name,
            modality: meta.modality,
            meta: sub.metadata instanceof Map ? Object.fromEntries(sub.metadata) : (sub.metadata || {}),
          });
        }
      }
    }
    // Backward compat: old trees have muscle-group directly under root
    else if (meta.role === "muscle-group" || meta.role === "group") {
      result.groups.push({ id: String(child._id), name: child.name, modality: "gym" });
      const exercises = await _Node.find({ parent: child._id }).select("_id name metadata").lean();
      result.exercises[child.name] = exercises.map(e => ({
        id: String(e._id),
        name: e.name,
        modality: "gym",
        meta: e.metadata instanceof Map ? Object.fromEntries(e.metadata) : (e.metadata || {}),
      }));
    }
  }

  return result;
}

// ── Build exercise list for AI prompt ──

export function buildExerciseListForPrompt(fitnessNodes) {
  if (!fitnessNodes) return "";
  const lines = [];

  for (const [groupName, exercises] of Object.entries(fitnessNodes.exercises)) {
    if (!exercises.length) continue;
    const modality = exercises[0]?.modality || "gym";
    const exList = exercises.map(e => {
      const schema = e.meta?.fitness?.valueSchema;
      const type = schema?.type || (modality === "running" ? "distance-time" : modality === "home" ? "reps" : "weight-reps");
      const unit = schema?.unit || "lb";
      return `    ${e.name} (${type}, ${unit})`;
    }).join("\n");
    lines.push(`  ${groupName} [${modality}]:\n${exList}`);
  }

  if (fitnessNodes._unadopted?.length > 0) {
    lines.push(`\n  UNADOPTED (found but not yet configured):\n${fitnessNodes._unadopted.map(u => `    ${u.name} (id: ${u.id})`).join("\n")}`);
  }

  return lines.join("\n");
}

// ── Workout parsing (one LLM call, all modalities) ──

export async function parseWorkout(message, userId, username, rootId) {
  if (!_runChat) return null;

  const { answer } = await _runChat({
    userId,
    username,
    message,
    mode: "tree:fitness-log",
    rootId,
    slot: "fitness",
    // Parser sub-call inside a coach turn. Takes the default ephemeral
    // session so the parse prompt never merges into the user's thread.
  });

  if (!answer) return null;
  const parsed = parseJsonSafe(answer);
  if (!parsed) return null;

  // Normalize: ensure we have either exercises array or running data
  if (!parsed.exercises?.length && !parsed.distance && !parsed.modality) return null;

  // Default date to today
  if (!parsed.date) parsed.date = new Date().toISOString().slice(0, 10);

  // If running data returned as top-level (not in exercises array), wrap it
  if (parsed.modality === "running" && !parsed.exercises) {
    parsed.exercises = [{
      modality: "running",
      name: "Run",
      distance: parsed.distance,
      distanceUnit: parsed.distanceUnit || "miles",
      duration: parsed.duration,
      pace: parsed.pace,
      type: parsed.type || "easy",
    }];
  }

  return parsed;
}

// ── Route parsed data to exercise nodes ──

export async function deliverToExerciseNodes(fitnessNodes, parsed) {
  if (!_Node || !fitnessNodes) return [];

  const delivered = [];

  for (const exercise of (parsed.exercises || [])) {
    const modality = exercise.modality || detectModality(exercise);

    if (modality === "running") {
      // Find running exercise nodes by schema type, not hardcoded name
      let runsNode = null;
      let prsNode = null;
      for (const [, exs] of Object.entries(fitnessNodes.exercises)) {
        for (const e of exs) {
          if (e.modality !== "running") continue;
          const schema = e.meta?.fitness?.valueSchema;
          if (schema?.type === "distance-time") {
            if (e.name.toLowerCase().includes("pr") || e.name.toLowerCase().includes("record")) prsNode = e;
            else if (!runsNode) runsNode = e;
          }
        }
      }
      if (runsNode) {
        await deliverRunData(runsNode, exercise, parsed.date);
        if (prsNode) await updateRunPRs(prsNode, exercise);
        delivered.push({ exercise, nodeId: runsNode.id, modality });
      }
      continue;
    }

    // Gym and home: match exercise name to node
    let match = null;
    const groupName = exercise.group;
    if (groupName && fitnessNodes.exercises[groupName]) {
      match = fuzzyMatchExercise(fitnessNodes.exercises[groupName], exercise.name);
    }
    // Search all groups if no direct match
    if (!match) {
      for (const [gn, exs] of Object.entries(fitnessNodes.exercises)) {
        match = fuzzyMatchExercise(exs, exercise.name);
        if (match) break;
      }
    }

    if (!match) {
      // Auto-create the exercise node. Find or create the group, then create the exercise.
      try {
        const { addGroupNode, addExerciseNode } = await import("./setup.js");
        const group = exercise.group || "General";

        // Find the modality node (gym or home)
        let modalityNodeId = null;
        for (const [, info] of Object.entries(fitnessNodes.modalities || {})) {
          if (info.modality === modality || info.name?.toLowerCase() === modality) {
            modalityNodeId = info.id;
            break;
          }
        }
        if (!modalityNodeId) {
          log.verbose("Fitness", `No ${modality} modality node for "${exercise.name}". Skipping.`);
          continue;
        }

        // Find or create the group
        let groupNode = null;
        const groupChildren = await _Node.find({ parent: modalityNodeId }).select("_id name").lean();
        groupNode = groupChildren.find(c => c.name.toLowerCase() === group.toLowerCase());
        if (!groupNode) {
          const created = await addGroupNode({ parentId: modalityNodeId, name: group, userId: parsed._userId || "SYSTEM" });
          groupNode = { _id: created.id, name: created.name };
          log.info("Fitness", `Auto-created group "${group}" under ${modality}`);
        }

        // Create the exercise
        const schemaType = modality === "home" ? "reps" : "weight-reps";
        const sets = exercise.sets?.length || 3;
        const created = await addExerciseNode({
          groupId: String(groupNode._id),
          name: exercise.name,
          exerciseType: schemaType,
          unit: modality === "home" ? "bodyweight" : (parsed._weightUnit || "lb"),
          sets,
          rootId: fitnessNodes._rootId,
          userId: parsed._userId || "SYSTEM",
        });
        log.info("Fitness", `Auto-created exercise "${exercise.name}" under ${group}`);

        // Now deliver data to the new node
        match = { id: created.id, name: created.name, meta: { fitness: { valueSchema: { type: schemaType, sets } } } };
      } catch (err) {
        log.warn("Fitness", `Auto-create failed for "${exercise.name}": ${err.message}`);
        continue;
      }
    }

    const schema = match.meta?.fitness?.valueSchema;
    const fields = buildValueFields(exercise, schema);
    fields.lastWorked = parsed.date;

    await _metadata.batchSetExtMeta(match.id, "values", fields);

    // Record to exercise history
    const node = await _Node.findById(match.id);
    if (node) {
      const existing = _metadata.getExtMeta(node, "fitness") || {};
      const history = Array.isArray(existing.history) ? existing.history : [];
      history.push({ date: parsed.date, ...fields, sets: exercise.sets });
      while (history.length > MAX_HISTORY) history.shift();
      await _metadata.setExtMeta(node, "fitness", { ...existing, history });
    }

    delivered.push({ exercise, nodeId: match.id, modality });
    log.verbose("Fitness", `Updated ${exercise.name} (${modality})`);
  }

  return delivered;
}

function fuzzyMatchExercise(exercises, name) {
  if (!exercises || !name) return null;
  const lower = name.toLowerCase();
  return exercises.find(e =>
    e.name.toLowerCase() === lower ||
    e.name.toLowerCase().includes(lower) ||
    lower.includes(e.name.toLowerCase())
  ) || null;
}

function detectModality(exercise) {
  if (exercise.distance || exercise.pace || exercise.distanceUnit) return "running";
  if (exercise.sets?.[0]?.weight > 0) return "gym";
  if (exercise.duration && !exercise.sets?.length) return "home";
  return exercise.modality || "gym";
}

export function buildValueFields(exercise, schema) {
  const fields = {};
  const type = schema?.type || detectModality(exercise);

  if (type === "weight-reps" || type === "gym") {
    const weight = exercise.sets?.[0]?.weight || 0;
    fields.weight = weight;
    for (let i = 0; i < (exercise.sets?.length || 0); i++) {
      fields[`set${i + 1}`] = exercise.sets[i].reps || 0;
    }
    fields.totalVolume = (exercise.sets || []).reduce((sum, s) => sum + (s.weight || 0) * (s.reps || 0), 0);
  } else if (type === "duration" || type === "home") {
    if (exercise.duration != null) {
      fields.duration = exercise.duration;
    }
    if (exercise.sets?.length) {
      for (let i = 0; i < exercise.sets.length; i++) {
        fields[`set${i + 1}`] = exercise.sets[i].reps || exercise.sets[i].duration || 0;
      }
      fields.totalReps = exercise.sets.reduce((sum, s) => sum + (s.reps || 0), 0);
    }
    if (exercise.variation) fields.variation = exercise.variation;
  } else if (type === "distance-time" || type === "running") {
    if (exercise.distance) fields.distance = exercise.distance;
    if (exercise.duration) fields.time = exercise.duration;
    if (exercise.pace) fields.pace = exercise.pace;
  }

  return fields;
}

async function deliverRunData(runsNode, exercise, date) {
  const fields = {
    lastRun: date,
  };
  if (exercise.distance) fields.lastDistance = exercise.distance;
  if (exercise.duration) fields.lastDuration = exercise.duration;
  if (exercise.pace) fields.lastPace = exercise.pace;

  // Increment weekly stats
  const node = await _Node.findById(runsNode.id);
  if (node) {
    const vals = _metadata.getExtMeta(node, "values") || {};
    fields.weeklyMiles = (vals.weeklyMiles || 0) + (exercise.distance || 0);
    fields.runsThisWeek = (vals.runsThisWeek || 0) + 1;
    await _metadata.batchSetExtMeta(runsNode.id, "values", fields);

    // Record to history
    const existing = _metadata.getExtMeta(node, "fitness") || {};
    const history = Array.isArray(existing.history) ? existing.history : [];
    history.push({
      date,
      distance: exercise.distance,
      distanceUnit: exercise.distanceUnit || "miles",
      duration: exercise.duration,
      pace: exercise.pace,
      type: exercise.type || "easy",
    });
    while (history.length > MAX_HISTORY) history.shift();
    await _metadata.setExtMeta(node, "fitness", { ...existing, history });
  }
}

async function updateRunPRs(prsNode, exercise) {
  if (!exercise.distance || !exercise.duration) return;
  const node = await _Node.findById(prsNode.id);
  if (!node) return;
  const prs = _metadata.getExtMeta(node, "values") || {};
  const pace = exercise.duration / exercise.distance; // seconds per unit

  // Check common race distances
  const dist = exercise.distance;
  const dur = exercise.duration;
  if (dist >= 1 && (!prs.mile || dur / dist < prs.mile)) prs.mile = Math.round(dur / dist);
  if (dist >= 3.1 && (!prs.fiveK || dur < prs.fiveK)) prs.fiveK = Math.round(dur);
  if (dist >= 6.2 && (!prs.tenK || dur < prs.tenK)) prs.tenK = Math.round(dur);
  if (dist >= 13.1 && (!prs.half || dur < prs.half)) prs.half = Math.round(dur);
  if (dist >= 26.2 && (!prs.marathon || dur < prs.marathon)) prs.marathon = Math.round(dur);

  await _metadata.setExtMeta(node, "values", prs);
}

// ── Write session to History node ──

export async function recordSessionHistory(historyNodeId, parsed, delivered, userId, ctx = {}) {
  if (!historyNodeId) return null;

  const modalities = [...new Set(delivered.map(d => d.modality))];

  const record = {
    date: parsed.date,
    modalities,
  };

  // Gym data
  const gymExercises = delivered.filter(d => d.modality === "gym");
  if (gymExercises.length > 0) {
    record.gym = {
      muscleGroups: [...new Set(gymExercises.map(d => d.exercise.group))],
      exercises: gymExercises.map(d => ({
        name: d.exercise.name,
        group: d.exercise.group,
        sets: d.exercise.sets,
        totalVolume: (d.exercise.sets || []).reduce((s, set) => s + (set.weight || 0) * (set.reps || 0), 0),
      })),
      totalVolume: gymExercises.reduce((sum, d) =>
        sum + (d.exercise.sets || []).reduce((s, set) => s + (set.weight || 0) * (set.reps || 0), 0), 0),
    };
  }

  // Running data
  const runs = delivered.filter(d => d.modality === "running");
  if (runs.length > 0) {
    const run = runs[0].exercise;
    record.running = {
      distance: run.distance,
      distanceUnit: run.distanceUnit || "miles",
      duration: run.duration,
      pace: run.pace,
      type: run.type || "easy",
    };
  }

  // Home/bodyweight data
  const homeExercises = delivered.filter(d => d.modality === "home");
  if (homeExercises.length > 0) {
    record.home = {
      exercises: homeExercises.map(d => ({
        name: d.exercise.name,
        sets: d.exercise.sets,
        totalReps: (d.exercise.sets || []).reduce((s, set) => s + (set.reps || 0), 0),
      })),
    };
  }

  try {
    const { createNote } = await import("../../seed/tree/notes.js");
    await createNote({
      nodeId: historyNodeId,
      content: JSON.stringify(record),
      contentType: "text",
      userId,
      wasAi: ctx.chatId != null || ctx.wasAi === true,
      chatId: ctx.chatId ?? null,
      sessionId: ctx.sessionId ?? null,
    });
  } catch (err) {
    log.warn("Fitness", `History note failed: ${err.message}`);
  }

  return record;
}

// ── Progressive overload check (generic, all modalities) ──

export function checkProgression(exerciseNode) {
  const values = exerciseNode.metadata instanceof Map
    ? exerciseNode.metadata.get("values")
    : exerciseNode.metadata?.values;
  const goals = exerciseNode.metadata instanceof Map
    ? exerciseNode.metadata.get("goals")
    : exerciseNode.metadata?.goals;
  const fitMeta = exerciseNode.metadata instanceof Map
    ? exerciseNode.metadata.get("fitness")
    : exerciseNode.metadata?.fitness;

  if (!values || !goals) return null;

  const schema = fitMeta?.valueSchema;
  const increment = fitMeta?.progressionIncrement;

  // Check if all goal keys are met
  let allMet = true;
  let goalCount = 0;
  for (const [key, goalVal] of Object.entries(goals)) {
    if (goalVal == null) continue;
    goalCount++;
    const currentVal = values[key];
    if (currentVal == null || currentVal < goalVal) {
      allMet = false;
      break;
    }
  }

  if (goalCount === 0) return null;

  const result = { allGoalsMet: allMet, modality: schema?.type || "gym" };

  if (allMet && increment) {
    result.suggestedIncrements = increment;
    // Build human-readable suggestion
    const parts = [];
    for (const [key, val] of Object.entries(increment)) {
      parts.push(`${key}: +${val}`);
    }
    result.suggestion = parts.join(", ");
  }

  // Bodyweight variation progression
  if (allMet && fitMeta?.progressionPath && values.variation) {
    const path = fitMeta.progressionPath;
    const idx = path.indexOf(values.variation);
    if (idx >= 0 && idx < path.length - 1) {
      result.nextVariation = path[idx + 1];
      result.suggestion = (result.suggestion ? result.suggestion + ". " : "") +
        `Ready for ${path[idx + 1]} variation`;
    }
  }

  return result;
}

// ── Build workout summary for response ──

export function buildWorkoutSummary(parsed, delivered) {
  const lines = [];

  for (const d of delivered) {
    const ex = d.exercise;
    if (d.modality === "running") {
      const pace = ex.pace ? formatPace(ex.pace) : null;
      lines.push(`Run: ${ex.distance}${ex.distanceUnit || "mi"} in ${formatDuration(ex.duration)}${pace ? ` (${pace}/mi)` : ""}`);
    } else if (d.modality === "home" && ex.duration && !ex.sets?.length) {
      lines.push(`${ex.name}: ${ex.duration}s`);
    } else {
      const setsStr = (ex.sets || []).map(s =>
        s.weight > 0 ? `${s.weight}x${s.reps}` : `${s.reps}`
      ).join("/");
      const volume = (ex.sets || []).reduce((sum, s) => sum + (s.weight || 0) * (s.reps || 0), 0);
      lines.push(`${ex.name}: ${setsStr}${volume > 0 ? ` (vol: ${volume.toLocaleString()})` : ""}`);
    }
  }

  const modalities = [...new Set(delivered.map(d => d.modality))];
  return {
    lines,
    modalities,
    summary: lines.join("\n"),
  };
}

function formatPace(secondsPerUnit) {
  const min = Math.floor(secondsPerUnit / 60);
  const sec = Math.round(secondsPerUnit % 60);
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function formatDuration(totalSeconds) {
  if (!totalSeconds) return "?";
  const min = Math.floor(totalSeconds / 60);
  const sec = Math.round(totalSeconds % 60);
  return sec > 0 ? `${min}:${String(sec).padStart(2, "0")}` : `${min}min`;
}

// ── Read exercise state for enrichContext / AI prompt ──

export async function getExerciseState(rootId) {
  if (!_Node) return null;

  const nodes = await findFitnessNodes(rootId);
  if (!nodes) return null;

  const state = { modalities: [], groups: {} };

  for (const mod of nodes.modalities) {
    state.modalities.push(mod.modality);
  }
  // Backward compat: if no modalities but has groups, it's gym-only
  if (state.modalities.length === 0 && nodes.groups.length > 0) {
    state.modalities.push("gym");
  }

  for (const group of nodes.groups) {
    const exercises = nodes.exercises[group.name] || [];
    state.groups[group.name] = {
      modality: group.modality || "gym",
      exercises: exercises.map(ex => {
        const values = ex.meta.values || {};
        const goals = ex.meta.goals || {};
        const fitMeta = ex.meta.fitness || {};
        return {
          name: ex.name,
          id: ex.id,
          modality: ex.modality || group.modality || "gym",
          schema: fitMeta.valueSchema || null,
          values,
          goals,
          lastWorked: values.lastWorked || null,
          historyCount: fitMeta.history?.length || 0,
          recentHistory: (fitMeta.history || []).slice(-5),
        };
      }),
    };
  }

  // Include direct modality exercises (Running/Runs, Running/PRs)
  for (const mod of nodes.modalities) {
    const directExercises = nodes.exercises[mod.name] || [];
    if (directExercises.length > 0 && !state.groups[mod.name]) {
      state.groups[mod.name] = {
        modality: mod.modality,
        exercises: directExercises.map(ex => ({
          name: ex.name,
          id: ex.id,
          modality: mod.modality,
          schema: ex.meta?.fitness?.valueSchema || null,
          values: ex.meta.values || {},
          goals: ex.meta.goals || {},
          lastWorked: (ex.meta.values || {}).lastWorked || null,
          historyCount: (ex.meta.fitness || {}).history?.length || 0,
        })),
      };
    }
  }

  if (nodes._unadopted?.length > 0) {
    state._unadopted = nodes._unadopted;
  }

  return state;
}

// ── Weekly stats ──

export async function getWeeklyStats(rootId) {
  if (!_Node) return null;
  const nodes = await findFitnessNodes(rootId);
  if (!nodes?.history) return null;

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  try {
    const { getNotes } = await import("../../seed/tree/notes.js");
    const notes = await _Note.find({
      nodeId: nodes.history.id,
      createdAt: { $gte: weekAgo },
    }).select("content").lean();

    const stats = { sessions: 0, gymSessions: 0, runs: 0, runMiles: 0, homeSessions: 0, totalVolume: 0 };
    for (const note of notes) {
      try {
        const record = JSON.parse(note.content);
        stats.sessions++;
        if (record.gym) { stats.gymSessions++; stats.totalVolume += record.gym.totalVolume || 0; }
        if (record.running) { stats.runs++; stats.runMiles += record.running.distance || 0; }
        if (record.home) stats.homeSessions++;
      } catch {}
    }
    return stats;
  } catch {
    return null;
  }
}

// ── Set resolver for FANOUT ──
//
// The extension is the authority on what "all my X" means inside the fitness domain.
// Dispatches based on keywords in the message to different sub-resolvers:
//
//   "exercises" / "lifts" / "movements"  -> every tracked exercise node (leaves)
//   "workouts" / "sessions" / "trainings" -> session notes from History
//   "runs" / "running" / "miles"          -> Running modality exercises only
//   "gym" / "lifts"                       -> Gym modality exercises only
//   "home"                                -> Home modality exercises only
//   "groups" / "muscle groups"            -> group nodes (Chest, Back, Legs)
//   (no match, default)                   -> every tracked exercise

export async function resolveSet({ rootId, quantifier, temporalScope, userId, message }) {
  if (!_Node) return [];

  const msg = (message || "").toLowerCase();

  // Workouts / sessions: session history notes
  if (/\b(workouts?|sessions?|trainings?)\b/.test(msg)) {
    return resolveWorkoutSessions(rootId, temporalScope, userId);
  }

  // Groups / muscle groups: group nodes (intermediate depth)
  if (/\b(muscle\s+groups?|groups?)\b/.test(msg)) {
    return resolveGroups(rootId, userId);
  }

  // Modality-specific filters
  if (/\b(runs?|running|miles?|mileage|jogs?)\b/.test(msg)) {
    return resolveExercisesByModality(rootId, "running", userId, quantifier);
  }
  if (/\b(gym|lifts?|lifting|weights?)\b/.test(msg)) {
    return resolveExercisesByModality(rootId, "gym", userId, quantifier);
  }
  if (/\bhome\b/.test(msg)) {
    return resolveExercisesByModality(rootId, "home", userId, quantifier);
  }

  // Default: every tracked exercise across all modalities
  return resolveAllExercises(rootId, userId, quantifier);
}

async function resolveAllExercises(rootId, userId, quantifier) {
  const nodes = await findFitnessNodes(rootId);
  if (!nodes) return [];

  const seen = new Set();
  const exerciseIds = [];
  for (const groupName of Object.keys(nodes.exercises)) {
    for (const ex of nodes.exercises[groupName]) {
      if (!seen.has(ex.id)) {
        seen.add(ex.id);
        exerciseIds.push({ id: ex.id, name: ex.name, modality: ex.modality });
      }
    }
  }
  return enrichItems(exerciseIds, userId, quantifier);
}

async function resolveExercisesByModality(rootId, modality, userId, quantifier) {
  const nodes = await findFitnessNodes(rootId);
  if (!nodes) return [];

  const seen = new Set();
  const exerciseIds = [];
  for (const groupName of Object.keys(nodes.exercises)) {
    for (const ex of nodes.exercises[groupName]) {
      if (ex.modality === modality && !seen.has(ex.id)) {
        seen.add(ex.id);
        exerciseIds.push({ id: ex.id, name: ex.name, modality });
      }
    }
  }
  return enrichItems(exerciseIds, userId, quantifier);
}

async function resolveGroups(rootId, userId) {
  const nodes = await findFitnessNodes(rootId);
  if (!nodes?.groups?.length) return [];
  const items = nodes.groups.map(g => ({ id: g.id, name: g.name, modality: g.modality }));
  return enrichItems(items, userId, null);
}

async function resolveWorkoutSessions(rootId, temporalScope, userId) {
  const nodes = await findFitnessNodes(rootId);
  if (!nodes?.history) return [];

  const historyId = nodes.history.id;

  // Determine time window from temporalScope
  const now = new Date();
  let startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // default: last 7 days
  if (temporalScope?.type === "relative" && temporalScope.unit) {
    const unitMs = {
      day: 86400000, week: 7 * 86400000, month: 30 * 86400000, year: 365 * 86400000,
    }[temporalScope.unit] || 7 * 86400000;
    startDate = new Date(now.getTime() - unitMs);
  } else if (temporalScope?.type === "duration" && temporalScope.count && temporalScope.unit) {
    const unit = temporalScope.unit.replace(/s$/, "");
    const unitMs = { day: 86400000, week: 7 * 86400000, month: 30 * 86400000 }[unit] || 86400000;
    startDate = new Date(now.getTime() - temporalScope.count * unitMs);
  }

  try {
    const notes = await _Note.find({
      nodeId: historyId,
      createdAt: { $gte: startDate },
    }).sort({ createdAt: -1 }).select("_id content createdAt").lean();

    return notes.map((n, i) => {
      let parsed = null;
      try { parsed = JSON.parse(n.content); } catch {}
      return {
        nodeId: String(n._id),
        name: `Session ${i + 1} (${new Date(n.createdAt).toLocaleDateString()})`,
        context: {
          name: `Workout session`,
          date: n.createdAt,
          ...parsed,
        },
      };
    });
  } catch {
    return [];
  }
}

async function enrichItems(items, userId, quantifier) {
  if (items.length === 0) return [];

  const { getContextForAi } = await import("../../seed/tree/treeFetch.js");
  const enriched = [];
  for (const item of items) {
    try {
      const ctx = await getContextForAi(item.id, { userId });
      enriched.push({ nodeId: item.id, name: item.name, context: ctx });
    } catch {
      enriched.push({ nodeId: item.id, name: item.name, context: { name: item.name, modality: item.modality } });
    }
  }

  if (quantifier?.type === "numeric" && quantifier.count > 0) {
    return enriched.slice(0, quantifier.count);
  }
  return enriched;
}
