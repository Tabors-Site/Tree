/**
 * Food
 *
 * The tree IS the app. One node to talk to (Log), three nodes that count
 * (Protein, Carbs, Fats), one node that sees the picture (Daily).
 * Cascade routes macros. enrichContext assembles the view. The AI reads
 * structure, not a database.
 */

import log from "../../seed/log.js";
import logMode from "./modes/log.js";
import reviewMode from "./modes/review.js";
import coachMode from "./modes/coach.js";
import {
  configure,
  scaffold,
  isInitialized,
  findFoodNodes,
  handleMacroCascade,
  checkDailyReset,
  getDailyPicture,
} from "./core.js";
import { handleMessage } from "./handler.js";

export async function init(core) {
  core.llm.registerRootLlmSlot?.("food");

  // Wire dependencies
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
    Note: core.models.Note,
    metadata: core.metadata,
  });

  // Register modes
  core.modes.registerMode("tree:food-log", logMode, "food");
  core.modes.registerMode("tree:food-review", reviewMode, "food");
  core.modes.registerMode("tree:food-coach", coachMode, "food");

  if (core.llm?.registerModeAssignment) {
    core.llm.registerModeAssignment("tree:food-log", "foodLog");
    core.llm.registerModeAssignment("tree:food-review", "foodReview");
    core.llm.registerModeAssignment("tree:food-coach", "foodCoach");
  }

  // ── onCascade: macro accumulation ──
  // ── Boot self-heal: ensure food roots have mode override ──
  core.hooks.register("afterBoot", async () => {
    try {
      const foodRoots = await core.models.Node.find({
        "metadata.food.initialized": true,
      }).select("_id metadata").lean();
      for (const root of foodRoots) {
        const modes = root.metadata instanceof Map
          ? root.metadata.get("modes")
          : root.metadata?.modes;
        if (!modes?.respond) {
          await core.modes.setNodeMode(root._id, "respond", "tree:food-log");
          log.verbose("Food", `Self-healed mode override on ${String(root._id).slice(0, 8)}...`);
        }
      }
    } catch {}
  }, "food");

  // ── onCascade: macro accumulation ──
  // When a signal arrives at a macro node via channel, increment the value.
  // No LLM call. Pure data routing.

  core.hooks.register("onCascade", async (hookData) => {
    const { node, signalId } = hookData;
    if (!node) return;

    const meta = node.metadata instanceof Map
      ? node.metadata.get("food")
      : node.metadata?.food;
    if (!meta?.role) return;
    if (!["protein", "carbs", "fats"].includes(meta.role)) return;

    // This is a food macro node receiving a cascade signal
    const payload = hookData.writeContext || hookData.payload || {};
    await handleMacroCascade(node, payload);

    // Mark cascade as handled
    hookData._resultStatus = "SUCCEEDED";
    hookData._resultExtName = "food";
    hookData._resultPayload = { role: meta.role, handled: true };
  }, "food");

  // ── breath:exhale: daily reset ──
  // On each exhale, check if midnight has passed. If so, archive and reset.

  let fallbackTimer = null;
  const trackedRoots = new Set();

  core.hooks.register("breath:exhale", async ({ rootId }) => {
    if (!rootId) return;
    // Only check roots that have food trees
    try {
      const initialized = await isInitialized(rootId);
      if (initialized) {
        trackedRoots.add(rootId);
        await checkDailyReset(rootId);
      }
    } catch {}
  }, "food");

  // Track food roots from navigation
  core.hooks.register("afterNavigate", async ({ rootId }) => {
    if (!rootId) return;
    try {
      const initialized = await isInitialized(rootId);
      if (initialized) trackedRoots.add(rootId);
    } catch {}
  }, "food");

  // Fallback daily reset check (if breath not installed)
  setTimeout(() => {
    fallbackTimer = setInterval(async () => {
      for (const rootId of trackedRoots) {
        try { await checkDailyReset(rootId); } catch {}
      }
    }, 300000); // every 5 min
    if (fallbackTimer.unref) fallbackTimer.unref();
  }, 60000);

  // ── enrichContext: assemble the daily picture ──
  // On Daily node: full macro view with goals, history, recent meals.
  // On macro nodes: show the running total.
  // On Log node: show what's been logged today.

  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    if (!node?._id) return;

    const foodMeta = meta?.food;
    if (!foodMeta?.role) return;

    const role = foodMeta.role;

    if (role === "daily") {
      // Assemble the full picture from siblings
      const parent = node.parent;
      if (!parent) return;

      const picture = await getDailyPicture(String(parent));
      if (picture) {
        const lines = [];
        for (const macro of ["protein", "carbs", "fats"]) {
          const m = picture[macro];
          if (m) {
            const pct = m.goal > 0 ? Math.round((m.today / m.goal) * 100) : 0;
            const weekPart = m.weeklyAvg > 0 ? `, weekly avg ${m.weeklyAvg}g (${Math.round(m.weeklyHitRate * 100)}% hit rate)` : "";
            lines.push(`${macro}: ${m.today}/${m.goal}g (${pct}%)${weekPart}`);
          }
        }
        if (picture.calories) {
          const c = picture.calories;
          const pct = c.goal > 0 ? Math.round((c.today / c.goal) * 100) : 0;
          lines.push(`calories: ${c.today}/${c.goal} (${pct}%)`);
        }
        context.foodToday = lines.join(", ");

        if (picture.recentMeals?.length > 0) {
          context.foodRecentMeals = picture.recentMeals.map(m => m.text).join("; ");
        }
        if (picture.profile) {
          context.foodProfile = picture.profile;
        }
        if (picture.recentHistory?.length > 0) {
          context.foodHistory = picture.recentHistory;
        }
      }
    } else if (["protein", "carbs", "fats"].includes(role)) {
      // Show running total for this macro
      const values = meta?.values;
      const goals = meta?.goals;
      if (values?.today != null) {
        context.foodMacro = {
          type: role,
          today: values.today,
          goal: goals?.today || 0,
        };
      }
    }
  }, "food");

  // HTML dashboard is now inline in routes.js (GET with ?html check)

  // ── Import router ──
  const { default: router, setServices } = await import("./routes.js");
  setServices({ Node: core.models.Node });

  const { default: getTools } = await import("./tools.js");
  const tools = getTools();

  log.info("Food", "Loaded. The tree tracks nutrition.");

  return {
    router,
    tools,
    modeTools: [
      { modeKey: "tree:food-coach", toolNames: ["food-save-profile"] },
    ],
    exports: {
      scaffold,
      isInitialized,
      findFoodNodes,
      getDailyPicture,
      handleMessage,
    },
    jobs: [
      {
        name: "food-daily-reset",
        start: () => {},
        stop: () => {
          if (fallbackTimer) clearInterval(fallbackTimer);
        },
      },
    ],
  };
}
