/**
 * Fitness Tools
 *
 * MCP tools for building and modifying the fitness tree.
 * Used by the plan and coach modes during setup and program changes.
 */

import { z } from "zod";
import {
  addGroupNode, addExerciseNode, removeExerciseNode,
  completeSetup, scaffoldGym, scaffoldRunning, scaffoldHome,
  saveProfile,
} from "./setup.js";
import {
  adoptExercise, findFitnessNodes, deliverToExerciseNodes,
  recordSessionHistory, buildWorkoutSummary, checkProgression,
  getExerciseState,
} from "./core.js";
import NodeModel from "../../seed/models/node.js";
import { getExtMeta, setExtMeta } from "../../seed/tree/extensionMetadata.js";

// Token-based match that ignores plural/possessive drift.
// "farmer carry" matches "Farmers Carry", "press" matches "Overhead Press",
// "bench" matches "Bench Press". Every query token (after stripping trailing
// 's/'s) must appear as a stemmed substring of some target token.
function stem(w) {
  const lower = String(w).toLowerCase().replace(/[^a-z0-9]/g, "");
  return lower.replace(/(?:'s|s)$/, "");
}
function tokens(s) {
  return String(s).toLowerCase().split(/[\s\-/_]+/).map(stem).filter(Boolean);
}
function fuzzyNameMatch(query, name) {
  const qt = tokens(query);
  if (qt.length === 0) return false;
  const nt = tokens(name);
  return qt.every(q => nt.some(n => n.includes(q)));
}

export default function getTools() {
  return [
    {
      name: "fitness-add-modality",
      description: "Add a training modality branch (Gym, Running, or Home/bodyweight) to the fitness tree.",
      schema: {
        rootId: z.string().describe("Fitness root node ID."),
        modality: z.enum(["gym", "running", "home"]).describe("Which modality to add."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      handler: async ({ rootId, modality, userId }) => {
        try {
          let result;
          if (modality === "gym") result = await scaffoldGym(rootId, userId);
          else if (modality === "running") result = await scaffoldRunning(rootId, userId);
          else if (modality === "home") result = await scaffoldHome(rootId, userId);
          else return { content: [{ type: "text", text: `Unknown modality: ${modality}` }] };
          return { content: [{ type: "text", text: `Created ${result.name} branch (${result.id})` }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
    {
      name: "fitness-add-group",
      description: "Add a group (muscle group, category, or activity type) under a modality branch.",
      schema: {
        parentId: z.string().describe("Parent node ID (modality branch like Gym or Home)."),
        name: z.string().describe("Group name (e.g. Chest, Push, Morning Routine)."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      handler: async ({ parentId, name, userId }) => {
        try {
          const result = await addGroupNode({ parentId, name, userId });
          return { content: [{ type: "text", text: `Created group "${result.name}" (${result.id})` }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
    {
      name: "fitness-add-exercise",
      description:
        "Add an exercise node under a group. Sets the tracking type, initial values, goals, and progression rules. " +
        "exerciseType: 'weight-reps' for gym lifts, 'reps' for bodyweight, 'duration' for holds/planks, 'distance-time' for running.",
      schema: {
        groupId: z.string().describe("Parent group node ID."),
        name: z.string().describe("Exercise name (e.g. Bench Press, Push-ups, Plank)."),
        exerciseType: z.enum(["weight-reps", "reps", "duration", "distance-time"]).default("weight-reps")
          .describe("How this exercise is tracked."),
        unit: z.string().optional().describe("Unit: lb, kg, bodyweight, seconds, minutes, miles, km."),
        sets: z.number().optional().describe("Number of tracked sets (for weight-reps and reps types)."),
        startingValues: z.record(z.number()).optional()
          .describe("Initial values object (e.g. {weight: 135, set1: 0, set2: 0, set3: 0})."),
        goals: z.record(z.number()).optional()
          .describe("Goal values object (e.g. {set1: 12, set2: 12, set3: 12})."),
        progressionIncrement: z.record(z.number()).optional()
          .describe("How much to increase on goal met (e.g. {weight: 5} or {duration: 10})."),
        progressionPath: z.array(z.string()).optional()
          .describe("Variation progression for bodyweight (e.g. ['standard', 'diamond', 'archer'])."),
        rootId: z.string().describe("Fitness root node ID (for channel creation)."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      handler: async ({ groupId, name, exerciseType, unit, sets, startingValues, goals, progressionIncrement, progressionPath, rootId, userId }) => {
        try {
          const result = await addExerciseNode({
            groupId, name, exerciseType, unit, sets,
            startingValues, goals, progressionIncrement, progressionPath,
            rootId, userId,
          });
          return { content: [{ type: "text", text: `Created exercise "${result.name}" (${result.id})` }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
    {
      name: "fitness-remove-exercise",
      description: "Remove an exercise node from the tree. Pass either exerciseId (node UUID) or exerciseName (case-insensitive substring match inside the fitness tree at rootId). Name mode is easier when the user says 'drop bench from my program' mid-workout.",
      schema: {
        exerciseId: z.string().optional().describe("Exercise node ID to remove."),
        exerciseName: z.string().optional().describe("Exercise name (case-insensitive substring). Requires rootId."),
        rootId: z.string().optional().describe("Fitness root node ID. Required when using exerciseName."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      handler: async ({ exerciseId, exerciseName, rootId, userId }) => {
        try {
          let targetId = exerciseId;
          let targetName = null;
          if (!targetId) {
            if (!exerciseName || !rootId) {
              return { content: [{ type: "text", text: "Pass either exerciseId, or exerciseName+rootId." }] };
            }
            const nodes = await findFitnessNodes(rootId);
            if (!nodes) return { content: [{ type: "text", text: "Fitness tree not found." }] };
            const matches = [];
            for (const list of Object.values(nodes.exercises || {})) {
              for (const ex of list) {
                if (fuzzyNameMatch(exerciseName, ex.name)) matches.push(ex);
              }
            }
            if (matches.length === 0) return { content: [{ type: "text", text: `No exercise matched "${exerciseName}".` }] };
            if (matches.length > 1) return { content: [{ type: "text", text: `Ambiguous: ${matches.map(m => m.name).join(", ")}. Be more specific.` }] };
            targetId = matches[0].id;
            targetName = matches[0].name;
          }
          const ok = await removeExerciseNode(targetId, userId);
          return { content: [{ type: "text", text: ok ? `Removed${targetName ? ` ${targetName}` : " exercise"}.` : "Failed to remove exercise." }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
    {
      name: "fitness-complete-setup",
      description: "Mark fitness setup as complete after all modalities, groups, and exercises have been created.",
      schema: {
        rootId: z.string().describe("Fitness root node ID."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      handler: async ({ rootId }) => {
        try {
          await completeSetup(rootId);
          return { content: [{ type: "text", text: "Fitness setup complete. Ready to track workouts." }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
    {
      name: "fitness-save-profile",
      description: "Save the user's fitness profile (units, weekly goal, modalities, etc.).",
      schema: {
        rootId: z.string().describe("Fitness root node ID."),
        profile: z.object({
          weightUnit: z.enum(["lb", "kg"]).optional(),
          distanceUnit: z.enum(["miles", "km"]).optional(),
          sessionsPerWeek: z.number().optional(),
          modalities: z.array(z.string()).optional(),
          weightIncrement: z.number().optional(),
          weeklyMilesGoal: z.number().optional(),
        }).describe("Profile settings."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      handler: async ({ rootId, profile }) => {
        try {
          await saveProfile(rootId, profile);
          return { content: [{ type: "text", text: "Profile saved." }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
    {
      name: "fitness-adopt-exercise",
      description:
        "Adopt an existing node into the fitness tree as a tracked exercise. " +
        "Use when you see unadopted child nodes that should be tracked. " +
        "Sets the exercise type, unit, and optionally goals on the node.",
      schema: {
        nodeId: z.string().describe("The node ID to adopt as an exercise."),
        exerciseType: z.enum(["weight-reps", "reps", "duration", "distance-time"]).default("weight-reps")
          .describe("How this exercise is tracked."),
        unit: z.string().optional().describe("Unit: lb, kg, bodyweight, seconds, minutes, miles, km."),
        goals: z.record(z.number()).optional().describe("Optional goal values."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      handler: async ({ nodeId, exerciseType, unit, goals }) => {
        try {
          await adoptExercise(nodeId, { exerciseType, unit, goals });
          return { content: [{ type: "text", text: `Adopted as ${exerciseType} exercise.${unit ? ` Unit: ${unit}.` : ""} It will now appear in workout tracking and the dashboard.` }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
    {
      name: "fitness-log-workout",
      description:
        "Log a workout. Delivers data to exercise nodes, records session history, tracks PRs, " +
        "and detects progression. Call this ONCE after parsing the workout into structured data. " +
        "Pass the exercises array from your parsed JSON output.",
      schema: {
        rootId: z.string().describe("Fitness root node ID."),
        exercises: z.array(z.object({
          modality: z.enum(["gym", "running", "home"]).describe("Exercise modality."),
          name: z.string().describe("Exercise name."),
          group: z.string().optional().describe("Muscle group (gym exercises)."),
          sets: z.array(z.object({
            weight: z.number().optional(),
            reps: z.number().optional(),
            duration: z.number().optional(),
            unit: z.string().optional(),
          }).passthrough()).optional().describe("Sets data for gym/home exercises."),
          distance: z.number().optional().describe("Distance for running."),
          distanceUnit: z.string().optional().describe("Distance unit (miles/km)."),
          duration: z.number().optional().describe("Duration in seconds for running or holds."),
          pace: z.number().optional().describe("Pace in seconds per unit for running."),
          type: z.string().optional().describe("Run type: easy, tempo, intervals, race."),
          variation: z.string().optional().describe("Bodyweight variation name."),
        }).passthrough()).describe("Parsed exercises from workout input."),
        date: z.string().optional().describe("Workout date (YYYY-MM-DD). Defaults to today."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      handler: async (args) => {
        try {
          const { rootId, exercises, date, userId, chatId, sessionId } = args;
          const fitnessNodes = await findFitnessNodes(rootId);
          if (!fitnessNodes) return { content: [{ type: "text", text: "Fitness tree not found." }] };

          const parsed = {
            exercises,
            date: date || new Date().toISOString().slice(0, 10),
            _userId: userId,
            _rootId: rootId,
          };

          // Deliver to exercise nodes (updates values, history, PRs)
          const delivered = await deliverToExerciseNodes(fitnessNodes, parsed);

          // Record session to History node
          const historyNodeId = fitnessNodes.history?.id;
          const record = await recordSessionHistory(historyNodeId, parsed, delivered, userId, { chatId, sessionId });

          // Build human-readable summary
          const { lines, summary } = buildWorkoutSummary(parsed, delivered);

          // Check progression on each delivered exercise
          const progressionAlerts = [];
          if (delivered?.length > 0) {
            const Node = (await import("../../seed/models/node.js")).default;
            for (const d of delivered) {
              if (!d.nodeId) continue;
              try {
                const node = await Node.findById(d.nodeId).select("metadata").lean();
                if (!node) continue;
                const prog = checkProgression(node);
                if (prog?.allGoalsMet && prog.suggestion) {
                  progressionAlerts.push(`${d.exercise.name}: All goals met. ${prog.suggestion}`);
                }
              } catch {}
            }
          }

          const parts = [summary];
          if (progressionAlerts.length > 0) {
            parts.push("PROGRESSION: " + progressionAlerts.join(". "));
          }
          if (delivered?.length === 0) {
            parts.push("No matching exercises found in tree. Exercises may need to be added via setup first.");
          }

          return { content: [{ type: "text", text: parts.join("\n") }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
    {
      name: "fitness-get-history",
      description:
        "Look up past workout sessions for an exercise or group. Returns the most recent sessions " +
        "with date, weight, sets, reps, and volume. Call this when the user asks about past workouts " +
        '("when did I last bench?", "what did I lift last Monday?") or when you need to judge progression.',
      schema: {
        rootId: z.string().describe("Fitness root node ID."),
        exerciseName: z.string().optional().describe("Exercise name (case-insensitive substring match). Omit to list across all exercises."),
        group: z.string().optional().describe("Muscle group or modality name. Omit to search all groups."),
        limit: z.number().optional().describe("Max sessions to return per exercise. Default 10."),
        userId: z.string().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      handler: async (args) => {
        try {
          const { rootId, exerciseName, group, limit = 10 } = args;
          const state = await getExerciseState(rootId);
          if (!state) return { content: [{ type: "text", text: "Fitness tree not found." }] };

          const matches = [];
          for (const [gName, gData] of Object.entries(state.groups)) {
            if (group && !fuzzyNameMatch(group, gName) && !fuzzyNameMatch(group, String(gData.modality))) continue;
            for (const ex of gData.exercises) {
              if (exerciseName && !fuzzyNameMatch(exerciseName, ex.name)) continue;
              const recent = (ex.recentHistory || []).slice(-limit).reverse();
              matches.push({ group: gName, modality: gData.modality, name: ex.name, sessions: recent, total: ex.historyCount });
            }
          }

          if (matches.length === 0) {
            return { content: [{ type: "text", text: "No matching exercises or no history yet." }] };
          }

          const lines = matches.map(m => {
            if (m.sessions.length === 0) return `${m.name} (${m.group}): no sessions logged.`;
            const rows = m.sessions.map(h => {
              const d = h.date || "?";
              if (m.modality === "running") {
                const dist = h.distance ?? h.weeklyMiles;
                const dur = h.duration ? `${Math.round(h.duration / 60)}min` : "";
                return `  ${d}: ${dist ?? "?"}mi ${dur}`.trim();
              }
              if (Array.isArray(h.sets) && h.sets.length > 0) {
                const reps = h.sets.map(s => s.reps ?? s.duration ?? "?").join("/");
                const w = h.sets[0]?.weight;
                const vol = h.sets.reduce((a, s) => a + (Number(s.weight) || 0) * (Number(s.reps) || 0), 0);
                return `  ${d}: ${w != null ? `${w}x` : ""}${reps}${vol ? ` (vol ${vol})` : ""}`;
              }
              return `  ${d}: logged`;
            }).join("\n");
            return `${m.name} (${m.group}, ${m.total} total sessions):\n${rows}`;
          });

          return { content: [{ type: "text", text: lines.join("\n\n") }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
    {
      name: "fitness-delete-session",
      description:
        "Remove an incorrectly logged workout session from an exercise's history. " +
        "Match by exerciseName (required) plus date (YYYY-MM-DD) and/or an index in the " +
        "recent-history list (0 = oldest of the displayed window). If multiple sessions " +
        "match, nothing is deleted unless `all: true` is passed.",
      schema: {
        rootId: z.string().describe("Fitness root node ID."),
        exerciseName: z.string().describe("Exercise name (case-insensitive substring match)."),
        date: z.string().optional().describe("Session date YYYY-MM-DD to remove."),
        index: z.number().optional().describe("Absolute index in the full history array (0 = oldest). Use when two sessions share a date."),
        all: z.boolean().optional().describe("If true, delete every session matching exerciseName+date. Default false."),
        userId: z.string().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      handler: async (args) => {
        try {
          const { rootId, exerciseName, date, index, all } = args;
          if (date == null && index == null) {
            return { content: [{ type: "text", text: "Specify at least a date or an index." }] };
          }
          const nodes = await findFitnessNodes(rootId);
          if (!nodes) return { content: [{ type: "text", text: "Fitness tree not found." }] };

          const candidates = [];
          for (const list of Object.values(nodes.exercises || {})) {
            for (const ex of list) {
              if (fuzzyNameMatch(exerciseName, ex.name)) candidates.push(ex);
            }
          }
          if (candidates.length === 0) {
            return { content: [{ type: "text", text: `No exercise matched "${exerciseName}".` }] };
          }
          if (candidates.length > 1) {
            return { content: [{ type: "text", text: `Ambiguous: ${candidates.map(c => c.name).join(", ")}. Be more specific.` }] };
          }
          const exNode = candidates[0];

          const node = await NodeModel.findById(exNode.id);
          if (!node) return { content: [{ type: "text", text: "Exercise node not found." }] };

          const existing = getExtMeta(node, "fitness") || {};
          const history = Array.isArray(existing.history) ? existing.history.slice() : [];
          if (history.length === 0) {
            return { content: [{ type: "text", text: "No sessions to delete." }] };
          }

          let removed = [];
          if (index != null) {
            if (index < 0 || index >= history.length) {
              return { content: [{ type: "text", text: `Index ${index} out of range (0..${history.length - 1}).` }] };
            }
            removed = history.splice(index, 1);
          } else {
            const matchIdx = history
              .map((h, i) => ({ h, i }))
              .filter(({ h }) => h.date === date);
            if (matchIdx.length === 0) {
              return { content: [{ type: "text", text: `No session on ${date} for ${exNode.name}.` }] };
            }
            if (matchIdx.length > 1 && !all) {
              const preview = matchIdx.map(({ h, i }) => {
                const sets = Array.isArray(h.sets) ? h.sets.map(s => `${s.weight ?? "?"}x${s.reps ?? "?"}`).join("/") : "?";
                return `  #${i}: ${sets}`;
              }).join("\n");
              return { content: [{ type: "text", text: `${matchIdx.length} sessions on ${date}:\n${preview}\nPass index or all:true.` }] };
            }
            const idxsDesc = matchIdx.map(({ i }) => i).sort((a, b) => b - a);
            for (const i of idxsDesc) removed.push(...history.splice(i, 1));
          }

          await setExtMeta(node, "fitness", { ...existing, history });

          const desc = removed.map(h => {
            const sets = Array.isArray(h.sets) ? h.sets.map(s => `${s.weight ?? "?"}x${s.reps ?? "?"}`).join("/") : "?";
            return `${h.date}: ${sets}`;
          }).join("; ");
          return { content: [{ type: "text", text: `Removed ${removed.length} session(s) from ${exNode.name}: ${desc}` }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
    {
      name: "fitness-list-program",
      description:
        "List every exercise in the user's fitness program, grouped by modality (gym / running / home) " +
        "and muscle group. Call this when the user asks what workouts they have, what's in their program, " +
        'or anything like "show me my exercises." Returns schema type, unit, current value, and goal per ' +
        "exercise. Read-only.",
      schema: {
        rootId: z.string().describe("Fitness root node ID."),
        modality: z.enum(["gym", "running", "home"]).optional().describe("Filter to one modality. Omit for everything."),
        userId: z.string().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      handler: async (args) => {
        try {
          const { rootId, modality } = args;
          const state = await getExerciseState(rootId);
          if (!state) return { content: [{ type: "text", text: "Fitness tree not found." }] };

          const wantMod = modality ? String(modality).toLowerCase() : null;
          const lines = [];
          let total = 0;
          for (const [groupName, groupData] of Object.entries(state.groups)) {
            if (wantMod && String(groupData.modality).toLowerCase() !== wantMod) continue;
            const rows = groupData.exercises.map((e) => {
              const schema = e.schema;
              const vals = e.values || {};
              const goals = e.goals || {};
              if (schema?.type === "distance-time") {
                const dist = vals.weeklyMiles || vals.lastDistance || 0;
                return `  - ${e.name}: ${dist} ${schema.unit || "mi"} (weekly)`;
              }
              if (schema?.type === "duration") {
                return `  - ${e.name}: ${vals.duration || "?"}s`;
              }
              if (schema?.type === "reps") {
                const g = goals.totalReps ? ` goal ${goals.totalReps}` : "";
                return `  - ${e.name}: ${vals.totalReps ?? vals.set1 ?? "?"} reps${g}`;
              }
              const sets = Object.keys(vals).filter((k) => k.startsWith("set")).map((k) => vals[k]).filter((v) => v != null).join("/");
              const g = goals.weight ? ` goal ${goals.weight}${schema?.unit || "lb"}` : "";
              return `  - ${e.name}: ${vals.weight || "?"}${schema?.unit || "lb"}${sets ? " x " + sets : ""}${g} (${e.historyCount} sessions)`;
            });
            if (rows.length === 0) continue;
            total += rows.length;
            lines.push(`${groupName} [${groupData.modality}]:\n${rows.join("\n")}`);
          }
          if (total === 0) {
            return { content: [{ type: "text", text: wantMod ? `No ${wantMod} exercises configured.` : "No exercises configured yet." }] };
          }
          return { content: [{ type: "text", text: `${total} exercise${total === 1 ? "" : "s"}${wantMod ? ` (${wantMod})` : ""}:\n\n${lines.join("\n\n")}` }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
    {
      name: "fitness-get-recent",
      description:
        "Get recent workout sessions across ALL exercises within a time window. Call this when the user " +
        'asks "what have I done this week", "show me the last few days", or any time-scoped recap. ' +
        "Returns a chronological list (newest first) with date, exercise, sets, and volume. " +
        "Optional modality filter (gym/running/home) or exerciseName filter (fuzzy substring).",
      schema: {
        rootId: z.string().describe("Fitness root node ID."),
        sinceDays: z.number().optional().describe("Days back to include. Default 7. Pass 1 for yesterday+today, 30 for the month."),
        modality: z.enum(["gym", "running", "home"]).optional().describe("Restrict to one modality."),
        exerciseName: z.string().optional().describe("Fuzzy substring to restrict to one exercise."),
        limit: z.number().optional().describe("Max sessions returned. Default 50."),
        userId: z.string().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      handler: async (args) => {
        try {
          const { rootId, sinceDays = 7, modality, exerciseName, limit = 50 } = args;
          const state = await getExerciseState(rootId);
          if (!state) return { content: [{ type: "text", text: "Fitness tree not found." }] };

          const cutoff = new Date(Date.now() - sinceDays * 86400000);
          cutoff.setHours(0, 0, 0, 0);
          const cutoffStr = cutoff.toISOString().slice(0, 10);
          const wantMod = modality ? String(modality).toLowerCase() : null;

          const all = [];
          for (const [groupName, groupData] of Object.entries(state.groups)) {
            if (wantMod && String(groupData.modality).toLowerCase() !== wantMod) continue;
            for (const ex of groupData.exercises) {
              if (exerciseName && !fuzzyNameMatch(exerciseName, ex.name)) continue;
              const history = ex.recentHistory || [];
              for (const h of history) {
                if (!h?.date) continue;
                if (h.date < cutoffStr) continue;
                all.push({ date: h.date, name: ex.name, group: groupName, modality: groupData.modality, entry: h });
              }
            }
          }

          // Sort newest first; stable date compare is enough since dates are YYYY-MM-DD.
          all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
          const capped = all.slice(0, limit);

          if (capped.length === 0) {
            const filt = [
              wantMod ? `modality=${wantMod}` : null,
              exerciseName ? `exercise~${exerciseName}` : null,
            ].filter(Boolean).join(" ");
            return { content: [{ type: "text", text: `No sessions since ${cutoffStr}${filt ? ` (${filt})` : ""}.` }] };
          }

          const summarize = (m) => {
            const h = m.entry;
            if (m.modality === "running") {
              const dist = h.distance ?? h.weeklyMiles;
              const dur = h.duration ? `${Math.round(h.duration / 60)}min` : "";
              return `${dist ?? "?"}mi ${dur}`.trim();
            }
            if (Array.isArray(h.sets) && h.sets.length > 0) {
              const w = h.sets[0]?.weight;
              const reps = h.sets.map((s) => s.reps ?? s.duration ?? "?").join("/");
              const vol = h.sets.reduce((a, s) => a + (Number(s.weight) || 0) * (Number(s.reps) || 0), 0);
              return `${w != null ? `${w}x` : ""}${reps}${vol ? ` (vol ${vol})` : ""}`;
            }
            return "logged";
          };

          // Group by date for readability.
          const byDate = new Map();
          for (const m of capped) {
            if (!byDate.has(m.date)) byDate.set(m.date, []);
            byDate.get(m.date).push(m);
          }
          const dateLines = [];
          for (const [date, entries] of byDate) {
            const rows = entries.map((m) => `  - ${m.name} (${m.group}): ${summarize(m)}`);
            dateLines.push(`${date}:\n${rows.join("\n")}`);
          }

          const header = `${capped.length} session${capped.length === 1 ? "" : "s"} since ${cutoffStr}` +
            (wantMod ? ` (${wantMod})` : "") +
            (exerciseName ? ` matching "${exerciseName}"` : "") +
            (all.length > capped.length ? ` · showing newest ${limit}` : "");

          return { content: [{ type: "text", text: `${header}\n\n${dateLines.join("\n\n")}` }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
  ];
}
