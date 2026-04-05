/**
 * Fitness
 *
 * Multi-modality workout tracking. Gym, running, bodyweight.
 * The tree is the workout. Modalities are branches. Groups are children.
 * Exercises are leaves. Values track sets/reps/weight/distance/time.
 * Channels route logged data. Progressive overload tracked through goals.
 */

import log from "../../seed/log.js";
import logMode from "./modes/log.js";
import coachMode from "./modes/coach.js";
import reviewMode from "./modes/review.js";
import planMode from "./modes/plan.js";
import getTools from "./tools.js";
import {
  configure,
  isInitialized,
  getSetupPhase,
  findFitnessNodes,
  getExerciseState,
  getWeeklyStats,
  checkProgression,
  buildValueFields,
} from "./core.js";
import { setDeps as setSetupDeps } from "./setup.js";
import { handleMessage } from "./handler.js";

export async function init(core) {
  core.llm.registerRootLlmSlot?.("fitness");

  const runChat = core.llm?.runChat || null;
  configure({
    Node: core.models.Node,
    Note: core.models.Note,
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
    metadata: core.metadata,
  });
  setSetupDeps({ metadata: core.metadata, Node: core.models.Node });

  // ── Register modes ──
  core.modes.registerMode("tree:fitness-log", logMode, "fitness");
  core.modes.registerMode("tree:fitness-coach", coachMode, "fitness");
  core.modes.registerMode("tree:fitness-review", reviewMode, "fitness");
  core.modes.registerMode("tree:fitness-plan", planMode, "fitness");

  if (core.llm?.registerModeAssignment) {
    core.llm.registerModeAssignment("tree:fitness-log", "fitnessLog");
    core.llm.registerModeAssignment("tree:fitness-coach", "fitnessCoach");
    core.llm.registerModeAssignment("tree:fitness-review", "fitnessReview");
    core.llm.registerModeAssignment("tree:fitness-plan", "fitnessPlan");
  }

  // ── Boot self-heal: ensure fitness roots have mode override ──
  core.hooks.register("afterBoot", async () => {
    try {
      const fitnessRoots = await core.models.Node.find({
        "metadata.fitness.initialized": true,
      }).select("_id metadata").lean();
      for (const root of fitnessRoots) {
        const modes = root.metadata instanceof Map
          ? root.metadata.get("modes")
          : root.metadata?.modes;
        if (!modes?.respond) {
          await core.modes.setNodeMode(root._id, "respond", "tree:fitness-log");
          log.verbose("Fitness", `Self-healed mode override on ${String(root._id).slice(0, 8)}...`);
        }
      }
    } catch {}
  }, "fitness");

  // ── onCascade: exercise data accumulation ──
  core.hooks.register("onCascade", async (hookData) => {
    const { node } = hookData;
    if (!node) return;

    const meta = node.metadata instanceof Map
      ? node.metadata.get("fitness")
      : node.metadata?.fitness;
    if (meta?.role !== "exercise") return;

    const payload = hookData.writeContext || hookData.payload || {};
    if (!payload.sets?.length && !payload.distance && !payload.duration) return;

    // Generic: build value fields from whatever the payload contains
    const schema = meta.valueSchema;
    const fields = buildValueFields(payload, schema);
    fields.lastWorked = payload.date || new Date().toISOString().slice(0, 10);

    await core.metadata.batchSetExtMeta(node._id, "values", fields);

    hookData._resultStatus = "SUCCEEDED";
    hookData._resultExtName = "fitness";
  }, "fitness");

  // ── enrichContext: fitness state for the AI ──
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    if (!node?._id) return;

    const fitMeta = meta?.fitness;
    if (!fitMeta?.role) return;

    const role = fitMeta.role;
    const values = meta?.values || {};
    const goals = meta?.goals || {};

    if (role === "exercise") {
      // Build dynamic values/goals (not hardcoded to set1/set2/set3)
      context.fitnessExercise = {
        modality: fitMeta.valueSchema?.type || "gym",
        values,
        goals,
        lastWorked: values.lastWorked || null,
        recentHistory: (fitMeta.history || []).slice(-5),
      };

      const prog = checkProgression(node);
      if (prog?.allGoalsMet) {
        context.fitnessProgression = prog.suggestion || "All goals met. Ready for progression.";
        if (prog.nextVariation) context.fitnessNextVariation = prog.nextVariation;
      }

    } else if (role === "log" || role === "program" || role === "modality") {
      // Show full exercise state across all groups
      const parentId = role === "modality" ? String(node._id) : (node.parent ? String(node.parent) : null);
      if (parentId) {
        const rootId = role === "log" || role === "program" ? parentId : String(node.parent);
        const state = await getExerciseState(rootId);
        if (state) context.fitnessState = state;
      }

    } else if (role === "group" || role === "muscle-group") {
      // Show exercises in this group
      const exercises = await core.models.Node.find({ parent: node._id })
        .select("name metadata").lean();
      context.fitnessExercises = exercises.map(e => {
        const v = e.metadata instanceof Map ? e.metadata.get("values") : e.metadata?.values;
        const g = e.metadata instanceof Map ? e.metadata.get("goals") : e.metadata?.goals;
        const fm = e.metadata instanceof Map ? e.metadata.get("fitness") : e.metadata?.fitness;
        return {
          name: e.name,
          modality: fm?.valueSchema?.type || "gym",
          values: v || {},
          goals: g || {},
          lastWorked: v?.lastWorked || null,
        };
      });
    }

    // Cross-domain: food and recovery state (coach-level nodes only)
    if (role === "log" || role === "program") {
      try {
        const { getExtension } = await import("../loader.js");
        const life = getExtension("life");
        if (life?.exports?.getDomainNodes) {
          const treeRoot = node.rootOwner || String(node._id);
          const domains = await life.exports.getDomainNodes(treeRoot);

          if (domains.food?.id) {
            const food = getExtension("food");
            if (food?.exports?.getDailyPicture) {
              const picture = await food.exports.getDailyPicture(domains.food.id);
              if (picture?.calories) {
                context.foodToday = { calories: picture.calories.today, goal: picture.calories.goal };
              }
            }
          }

          if (domains.recovery?.id) {
            const recovery = getExtension("recovery");
            if (recovery?.exports?.getStatus) {
              const status = await recovery.exports.getStatus(domains.recovery.id);
              if (status) {
                context.recoveryToday = {
                  substances: status.substances,
                  mood: status.feelings?.mood,
                  energy: status.feelings?.energy,
                };
              }
            }
          }
        }
      } catch {}
    }
  }, "fitness");

  // ── Live dashboard updates: push to client when data changes ──
  core.hooks.register("afterNote", async ({ node }) => {
    if (!node?.rootOwner) return;
    const fm = node.metadata instanceof Map ? node.metadata.get("fitness") : node.metadata?.fitness;
    if (!fm?.role) return;
    core.websocket?.emitToUser?.(String(node.rootOwner), "dashboardUpdate", { rootId: String(node.rootOwner) });
  }, "fitness");

  core.hooks.register("afterMetadataWrite", async ({ nodeId, extName }) => {
    if (extName !== "values" && extName !== "fitness" && extName !== "goals") return;
    const node = await core.models.Node.findById(nodeId).select("rootOwner").lean();
    if (!node?.rootOwner) return;
    core.websocket?.emitToUser?.(String(node.rootOwner), "dashboardUpdate", { rootId: String(node.rootOwner) });
  }, "fitness");

  // HTML dashboard is now inline in routes.js (GET with ?html check)

  // ── Register tool navigation (if treeos-base installed) ──
  try {
    const { getExtension } = await import("../loader.js");
    const base = getExtension("treeos-base");
    if (base?.exports?.registerToolNavigations) {
      const nodeNav = ({ args, withToken: t }) => t(`/api/v1/node/${args.nodeId || args.rootId}?html`);
      base.exports.registerToolNavigations({
        "fitness-add-modality": nodeNav,
        "fitness-add-group": nodeNav,
        "fitness-add-exercise": nodeNav,
        "fitness-remove-exercise": nodeNav,
        "fitness-complete-setup": nodeNav,
        "fitness-save-profile": nodeNav,
      });
    }
  } catch {}

  // ── Register apps-grid slot ──
  try {
    const { getExtension } = await import("../loader.js");
    const base = getExtension("treeos-base");
    base?.exports?.registerSlot?.("apps-grid", "fitness", ({ userId, rootMap, tokenParam, tokenField, esc: e }) => {
      const entries = rootMap.get("Fitness") || [];
      const existing = entries.map(entry =>
        entry.ready
          ? `<a class="app-active" href="/api/v1/root/${entry.id}/fitness?html${tokenParam}" style="margin-right:8px;margin-bottom:6px;">${e(entry.name)}</a>`
          : `<a class="app-active" style="background:rgba(236,201,75,0.12);border-color:rgba(236,201,75,0.3);color:#ecc94b;margin-right:8px;margin-bottom:6px;" href="/api/v1/root/${entry.id}/fitness?html${tokenParam}">${e(entry.name)} (setup)</a>`
      ).join("");
      return `<div class="app-card">
        <div class="app-header"><span class="app-emoji">💪</span><span class="app-name">Fitness</span></div>
        <div class="app-desc">Three languages: gym (weight x reps x sets), running (distance x time x pace), bodyweight (reps x sets or duration). Progressive overload tracked per modality.</div>
        ${existing ? `<div style="display:flex;flex-wrap:wrap;margin-bottom:10px;">${existing}</div>` : ""}
        <form class="app-form" method="POST" action="/api/v1/user/${userId}/apps/create">
          ${tokenField}<input type="hidden" name="app" value="fitness" />
          <input class="app-input" name="message" placeholder="What do you train? (e.g. hypertrophy 4 days, running, bodyweight)" required />
          <button class="app-start" type="submit">${entries.length > 0 ? "New" : "Start"} Fitness</button>
        </form>
      </div>`;
    }, { priority: 10 });
  } catch {}

  // ── Import router ──
  const { default: router, setServices } = await import("./routes.js");
  setServices({ Node: core.models.Node });

  const tools = getTools();

  log.info("Fitness", "Loaded. Gym, running, bodyweight. The tree is the workout.");

  return {
    router,
    tools,
    modeTools: [
      { modeKey: "tree:fitness-plan", toolNames: [
        "fitness-add-modality", "fitness-add-group", "fitness-add-exercise",
        "fitness-remove-exercise", "fitness-adopt-exercise", "fitness-complete-setup", "fitness-save-profile",
      ]},
      { modeKey: "tree:fitness-coach", toolNames: [
        "fitness-add-exercise", "fitness-adopt-exercise", "fitness-save-profile",
      ]},
      { modeKey: "tree:edit", toolNames: ["fitness-adopt-exercise", "fitness-add-exercise", "fitness-add-group"] },
    ],
    exports: {
      isInitialized,
      getSetupPhase,
      findFitnessNodes,
      getExerciseState,
      getWeeklyStats,
      handleMessage,
      scaffold: (await import("./setup.js")).scaffoldFitnessBase,
    },
  };
}
