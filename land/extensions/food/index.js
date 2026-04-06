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
import dailyMode from "./modes/daily.js";
import {
  configure,
  scaffold,
  isInitialized,
  findFoodNodes,
  STRUCTURAL_ROLES,
  handleMacroCascade,
  checkDailyReset,
  getDailyPicture,
  getHistory,
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
  core.modes.registerMode("tree:food-daily", dailyMode, "food");

  if (core.llm?.registerModeAssignment) {
    core.llm.registerModeAssignment("tree:food-log", "foodLog");
    core.llm.registerModeAssignment("tree:food-review", "foodReview");
    core.llm.registerModeAssignment("tree:food-coach", "foodCoach");
    core.llm.registerModeAssignment("tree:food-daily", "foodDaily");
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
    if (STRUCTURAL_ROLES.includes(meta.role)) return;

    // This is a food metric node receiving a cascade signal
    const payload = hookData.writeContext || hookData.payload || {};
    await handleMacroCascade(node, payload);

    // Mark cascade as handled
    hookData._resultStatus = "SUCCEEDED";
    hookData._resultExtName = "food";
    hookData._resultPayload = { role: meta.role, handled: true };
  }, "food");

  // ── afterNote: decrement values when a food log note is deleted externally ──
  core.hooks.register("afterNote", async ({ nodeId, action, note }) => {
    if (action !== "delete" || !nodeId) return;
    // Check if this note belongs to a food Log node
    try {
      const node = await core.models.Node.findById(nodeId).select("metadata parent").lean();
      if (!node) return;
      const foodMeta = node.metadata instanceof Map ? node.metadata.get("food") : node.metadata?.food;
      if (foodMeta?.role !== "log") return;
      // Try to parse totals from the deleted note
      let totals = null;
      try {
        const data = JSON.parse(note?.content || "");
        totals = data.totals || null;
      } catch {}
      if (!totals) return;
      // Decrement metric values
      const rootId = node.parent ? String(node.parent) : null;
      if (!rootId) return;
      const foodNodes = await findFoodNodes(rootId);
      for (const [role, info] of Object.entries(foodNodes)) {
        if (STRUCTURAL_ROLES.includes(role) || !info?.id) continue;
        const amount = totals[role] || 0;
        if (amount > 0) {
          await core.metadata.incExtMeta(info.id, "values", "today", -amount);
        }
      }
    } catch {}
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
        // Render all value-tracked nodes (core macros + user-created)
        for (const role of (picture._valueRoles || ["protein", "carbs", "fats"])) {
          const m = picture[role];
          if (m) {
            const label = m.name || role;
            const pct = m.goal > 0 ? Math.round((m.today / m.goal) * 100) : 0;
            const weekPart = m.weeklyAvg > 0 ? `, weekly avg ${m.weeklyAvg}g (${Math.round(m.weeklyHitRate * 100)}% hit rate)` : "";
            lines.push(`${label}: ${m.today}/${m.goal}g (${pct}%)${weekPart}`);
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
    } else if (meta?.values?.today != null) {
      // Any value-tracked node (core macros or user-created)
      const values = meta?.values;
      const goals = meta?.goals;
      context.foodMacro = {
        type: foodMeta.role,
        name: node.name,
        today: values.today,
        goal: goals?.today || 0,
      };
    }

    // Cross-domain: fitness and recovery state (coach-level nodes only)
    if (role === "log" || role === "daily") {
      try {
        const { getExtension } = await import("../loader.js");
        const life = getExtension("life");
        if (life?.exports?.getDomainNodes) {
          const treeRoot = node.rootOwner || String(node._id);
          const domains = await life.exports.getDomainNodes(treeRoot);

          if (domains.fitness?.id) {
            const fitness = getExtension("fitness");
            if (fitness?.exports?.getWeeklyStats) {
              const stats = await fitness.exports.getWeeklyStats(domains.fitness.id);
              if (stats?.workoutsThisWeek > 0) {
                context.fitnessThisWeek = { workouts: stats.workoutsThisWeek, lastWorkout: stats.lastWorkoutDate };
              }
            }
          }

          if (domains.recovery?.id) {
            const recovery = getExtension("recovery");
            if (recovery?.exports?.getStatus) {
              const status = await recovery.exports.getStatus(domains.recovery.id);
              if (status?.feelings) {
                context.recoveryToday = { mood: status.feelings.mood, energy: status.feelings.energy };
              }
            }
          }
        }
      } catch {}
    }
  }, "food");

  // ── Live dashboard updates ──
  core.hooks.register("afterNote", async ({ nodeId }) => {
    if (!nodeId) return;
    try {
      const node = await core.models.Node.findById(nodeId).select("rootOwner metadata").lean();
      if (!node?.rootOwner) return;
      const fm = node.metadata instanceof Map ? node.metadata.get("food") : node.metadata?.food;
      if (!fm?.role) return;
      core.websocket?.emitToUser?.(String(node.rootOwner), "dashboardUpdate", { rootId: String(node.rootOwner) });
    } catch {}
  }, "food");

  core.hooks.register("afterMetadataWrite", async ({ nodeId, extName }) => {
    if (extName !== "values" && extName !== "food" && extName !== "goals") return;
    try {
      const node = await core.models.Node.findById(nodeId).select("rootOwner").lean();
      if (!node?.rootOwner) return;
      core.websocket?.emitToUser?.(String(node.rootOwner), "dashboardUpdate", { rootId: String(node.rootOwner) });
    } catch {}
  }, "food");

  // ── Register apps-grid slot ──
  try {
    const { getExtension } = await import("../loader.js");
    const base = getExtension("treeos-base");
    base?.exports?.registerSlot?.("apps-grid", "food", ({ userId, rootMap, tokenParam, tokenField, esc: e }) => {
      const entries = rootMap.get("Food") || [];
      const existing = entries.map(entry =>
        entry.ready
          ? `<a class="app-active" href="/api/v1/root/${entry.id}/food?html${tokenParam}" style="margin-right:8px;margin-bottom:6px;">${e(entry.name)}</a>`
          : `<a class="app-active" style="background:rgba(236,201,75,0.12);border-color:rgba(236,201,75,0.3);color:#ecc94b;margin-right:8px;margin-bottom:6px;" href="/api/v1/root/${entry.id}/food?html${tokenParam}">${e(entry.name)} (setup)</a>`
      ).join("");
      return `<div class="app-card">
        <div class="app-header"><span class="app-emoji">🍎</span><span class="app-name">Food</span></div>
        <div class="app-desc">Say what you ate. One LLM call parses macros. Daily totals tracked. History archives daily summaries.</div>
        ${existing ? `<div style="display:flex;flex-wrap:wrap;margin-bottom:10px;">${existing}</div>` : ""}
        <form class="app-form" method="POST" action="/api/v1/user/${userId}/apps/create">
          ${tokenField}<input type="hidden" name="app" value="food" />
          <input class="app-input" name="message" placeholder="What did you eat? (or just say hi to set up your goals)" required />
          <button class="app-start" type="submit">${entries.length > 0 ? "New" : "Start"} Food</button>
        </form>
      </div>`;
    }, { priority: 20 });
  } catch {}

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
      { modeKey: "tree:food-log", toolNames: ["food-log-entry"] },
      { modeKey: "tree:food-coach", toolNames: ["food-save-profile", "food-adopt-node"] },
      { modeKey: "tree:edit", toolNames: ["food-adopt-node"] },
    ],
    exports: {
      scaffold,
      isInitialized,
      findFoodNodes,
      getDailyPicture,
      getHistory,
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
