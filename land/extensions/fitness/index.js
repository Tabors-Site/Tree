/**
 * Fitness
 *
 * The tree is the workout. Muscle groups are nodes. Exercises are children.
 * Values track sets, reps, weight. Channels route logged data to exercise
 * nodes. Progressive overload tracked through value goals.
 */

import log from "../../seed/log.js";
import logMode from "./modes/log.js";
import coachMode from "./modes/coach.js";
import reviewMode from "./modes/review.js";
import { getExtMeta } from "../../seed/tree/extensionMetadata.js";
import {
  configure,
  isInitialized,
  findFitnessNodes,
  getExerciseState,
  checkProgression,
} from "./core.js";

export async function init(core) {
  const runChat = core.llm?.runChat || null;
  configure({
    Node: core.models.Node,
    runChat: runChat
      ? async (opts) => {
          if (opts.userId && opts.userId !== "SYSTEM") {
            const hasLlm = await core.llm.userHasLlm(opts.userId);
            if (!hasLlm) return { answer: null };
          }
          return core.llm.runChat({
            ...opts,
            llmPriority: core.llm.LLM_PRIORITY.INTERACTIVE,
          });
        }
      : null,
  });

  // Register modes
  core.modes.registerMode("tree:fitness-log", logMode, "fitness");
  core.modes.registerMode("tree:fitness-coach", coachMode, "fitness");
  core.modes.registerMode("tree:fitness-review", reviewMode, "fitness");

  if (core.llm?.registerModeAssignment) {
    core.llm.registerModeAssignment("tree:fitness-log", "fitnessLog");
    core.llm.registerModeAssignment("tree:fitness-coach", "fitnessCoach");
    core.llm.registerModeAssignment("tree:fitness-review", "fitnessReview");
  }

  // ── onCascade: exercise data accumulation ──
  // When a signal arrives at an exercise node via channel, update its values.

  core.hooks.register("onCascade", async (hookData) => {
    const { node } = hookData;
    if (!node) return;

    const meta = node.metadata instanceof Map
      ? node.metadata.get("fitness")
      : node.metadata?.fitness;
    if (meta?.role !== "exercise") return;

    const payload = hookData.writeContext || hookData.payload || {};
    if (!payload.sets?.length) return;

    // Update exercise values from cascade payload
    const updates = {};
    const weight = payload.sets[0]?.weight || 0;
    updates["metadata.values.weight"] = weight;
    for (let i = 0; i < payload.sets.length; i++) {
      updates[`metadata.values.set${i + 1}`] = payload.sets[i].reps;
    }
    const totalVolume = payload.sets.reduce((sum, s) => sum + (s.weight || 0) * (s.reps || 0), 0);
    updates["metadata.values.totalVolume"] = totalVolume;
    updates["metadata.values.lastWorked"] = payload.date || new Date().toISOString().slice(0, 10);

    await core.models.Node.updateOne({ _id: node._id }, { $set: updates });

    hookData._resultStatus = "SUCCEEDED";
    hookData._resultExtName = "fitness";
  }, "fitness");

  // ── enrichContext: exercise state for the AI ──

  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    if (!node?._id) return;

    const fitMeta = meta?.fitness;
    if (!fitMeta?.role) return;

    const role = fitMeta.role;

    if (role === "exercise") {
      // Show this exercise's current state and history
      const values = meta?.values || {};
      const goals = meta?.goals || {};
      const history = fitMeta.history || [];

      context.fitnessExercise = {
        weight: values.weight || 0,
        sets: [values.set1, values.set2, values.set3].filter(v => v != null),
        goals: [goals.set1, goals.set2, goals.set3].filter(v => v != null),
        lastWorked: values.lastWorked || null,
        totalVolume: values.totalVolume || 0,
        recentHistory: history.slice(-5),
      };

      // Check progression
      const prog = checkProgression(node);
      if (prog?.allGoalsMet) {
        context.fitnessProgression = `All goals met at ${prog.currentWeight}lb. Suggest ${prog.suggestedWeight}lb.`;
      }
    } else if (role === "log" || role === "program") {
      // At Log or Program, show the full exercise state across all groups
      const parentId = node.parent;
      if (parentId) {
        const state = await getExerciseState(String(parentId));
        if (state) context.fitnessState = state;
      }
    } else if (role === "muscle-group") {
      // At a muscle group, show its exercises
      const exercises = await core.models.Node.find({ parent: node._id })
        .select("name metadata").lean();
      context.fitnessExercises = exercises.map(e => {
        const v = e.metadata instanceof Map ? e.metadata.get("values") : e.metadata?.values;
        const g = e.metadata instanceof Map ? e.metadata.get("goals") : e.metadata?.goals;
        return {
          name: e.name,
          weight: v?.weight || 0,
          sets: [v?.set1, v?.set2, v?.set3].filter(x => x != null),
          goals: [g?.set1, g?.set2, g?.set3].filter(x => x != null),
          lastWorked: v?.lastWorked || null,
        };
      });
    }
  }, "fitness");

  // ── Import router ──
  const { default: router, setServices } = await import("./routes.js");
  setServices({ Node: core.models.Node });

  log.info("Fitness", "Loaded. The tree is the workout.");

  return {
    router,
    exports: {
      isInitialized,
      findFitnessNodes,
      getExerciseState,
    },
    jobs: [
      { name: "fitness-noop", start: () => {}, stop: () => {} },
    ],
  };
}
