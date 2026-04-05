/**
 * Recovery
 *
 * The tree grows toward health. Track substances, feelings, cravings,
 * and patterns. Taper schedules that bend around you. Pattern detection
 * that finds what you can't see. A mirror, not a judge.
 */

import log from "../../seed/log.js";
import logMode from "./modes/log.js";
import reflectMode from "./modes/reflect.js";
import planMode from "./modes/plan.js";
import journalMode from "./modes/journal.js";
import getTools from "./tools.js";
import {
  configure,
  scaffold,
  isInitialized,
  findRecoveryNodes,
  getStatus,
  getPatterns,
  getMilestones,
  getHistory,
  checkDailyReset,
  addSubstance,
  recordDoses,
  recordCraving,
  recordMood,
  recordEnergy,
} from "./core.js";
import { handleMessage } from "./handler.js";

export async function init(core) {
  core.llm.registerRootLlmSlot?.("recovery");

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
    hooks: core.hooks,
  });

  // Register modes
  core.modes.registerMode("tree:recovery-log", logMode, "recovery");
  core.modes.registerMode("tree:recovery-review", reflectMode, "recovery");
  core.modes.registerMode("tree:recovery-plan", planMode, "recovery");
  core.modes.registerMode("tree:recovery-journal", journalMode, "recovery");

  if (core.llm?.registerModeAssignment) {
    core.llm.registerModeAssignment("tree:recovery-log", "recovery");
    core.llm.registerModeAssignment("tree:recovery-review", "recovery");
    core.llm.registerModeAssignment("tree:recovery-plan", "recovery");
    core.llm.registerModeAssignment("tree:recovery-journal", "recovery");
  }

  // ── Boot self-heal ──
  core.hooks.register("afterBoot", async () => {
    try {
      const roots = await core.models.Node.find({
        "metadata.recovery.initialized": true,
      }).select("_id metadata").lean();
      for (const root of roots) {
        const modes = root.metadata instanceof Map
          ? root.metadata.get("modes")
          : root.metadata?.modes;
        if (!modes?.respond) {
          const { setNodeMode } = await import("../../seed/modes/registry.js");
          await setNodeMode(root._id, "respond", "tree:recovery-log");
        }
      }
    } catch {}
  }, "recovery");

  // ── breath:exhale: daily reset ──
  let fallbackTimer = null;
  const trackedRoots = new Set();

  core.hooks.register("breath:exhale", async ({ rootId }) => {
    if (!rootId) return;
    try {
      if (await isInitialized(rootId)) {
        trackedRoots.add(rootId);
        await checkDailyReset(rootId);
      }
    } catch {}
  }, "recovery");

  core.hooks.register("afterNavigate", async ({ rootId }) => {
    if (!rootId) return;
    try {
      if (await isInitialized(rootId)) trackedRoots.add(rootId);
    } catch {}
  }, "recovery");

  // Fallback timer
  setTimeout(() => {
    fallbackTimer = setInterval(async () => {
      for (const rootId of trackedRoots) {
        try { await checkDailyReset(rootId); } catch {}
      }
    }, 300000);
    if (fallbackTimer.unref) fallbackTimer.unref();
  }, 60000);

  // ── enrichContext ──
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    if (!node?._id) return;
    const recoveryMeta = meta?.recovery;
    if (!recoveryMeta?.role) return;

    // Find the root
    let rootId = null;
    if (recoveryMeta.initialized) {
      rootId = String(node._id);
    } else {
      let cursor = node;
      while (cursor && !cursor.systemRole) {
        const curMeta = cursor.metadata instanceof Map
          ? cursor.metadata.get("recovery")
          : cursor.metadata?.recovery;
        if (curMeta?.initialized) {
          rootId = String(cursor._id);
          break;
        }
        if (!cursor.parent) break;
        cursor = await core.models.Node.findById(cursor.parent).select("_id metadata parent systemRole").lean();
      }
    }
    if (!rootId) return;

    const status = await getStatus(rootId);
    if (!status) return;

    context.recovery = {
      today: status.substances,
      streaks: status.streaks,
      feelings: status.feelings,
    };

    // Add patterns summary
    const patterns = await getPatterns(rootId);
    if (patterns.length > 0) {
      context.recovery.patterns = patterns.slice(0, 5).map(p => ({
        pattern: p.pattern || p.description,
        confidence: p.confidence,
      }));
    }

    // Cross-domain awareness: find sibling extensions and read their state
    try {
      const { getExtension } = await import("../loader.js");
      const life = getExtension("life");
      if (life?.exports?.getDomainNodes) {
        // Walk up to find the tree root for domain lookup
        const treeRoot = node.rootOwner || rootId;
        const domains = await life.exports.getDomainNodes(treeRoot);

        // Food: what did the user eat today?
        if (domains.food?.id) {
          const food = getExtension("food");
          if (food?.exports?.getDailyPicture) {
            const picture = await food.exports.getDailyPicture(domains.food.id);
            if (picture?.calories) {
              context.recovery.foodToday = {
                calories: picture.calories.today,
                calorieGoal: picture.calories.goal,
              };
            }
          }
        }

        // Fitness: recent workout activity
        if (domains.fitness?.id) {
          const fitness = getExtension("fitness");
          if (fitness?.exports?.getWeeklyStats) {
            const stats = await fitness.exports.getWeeklyStats(domains.fitness.id);
            if (stats?.workoutsThisWeek > 0) {
              context.recovery.fitnessThisWeek = {
                workouts: stats.workoutsThisWeek,
                lastWorkout: stats.lastWorkoutDate,
              };
            }
          }
        }
      }
    } catch {}
  }, "recovery");

  // ── Live dashboard updates ──
  core.hooks.register("afterNote", async ({ nodeId }) => {
    if (!nodeId) return;
    try {
      const node = await core.models.Node.findById(nodeId).select("rootOwner metadata").lean();
      if (!node?.rootOwner) return;
      const fm = node.metadata instanceof Map ? node.metadata.get("recovery") : node.metadata?.recovery;
      if (!fm?.role) return;
      core.websocket?.emitToUser?.(String(node.rootOwner), "dashboardUpdate", { rootId: String(node.rootOwner) });
    } catch {}
  }, "recovery");

  core.hooks.register("afterMetadataWrite", async ({ nodeId, extName }) => {
    if (extName !== "values" && extName !== "recovery") return;
    try {
      const node = await core.models.Node.findById(nodeId).select("rootOwner").lean();
      if (!node?.rootOwner) return;
      core.websocket?.emitToUser?.(String(node.rootOwner), "dashboardUpdate", { rootId: String(node.rootOwner) });
    } catch {}
  }, "recovery");

  // ── Register apps-grid slot ──
  try {
    const { getExtension } = await import("../loader.js");
    const base = getExtension("treeos-base");
    base?.exports?.registerSlot?.("apps-grid", "recovery", ({ userId, rootMap, tokenParam, tokenField, esc: e }) => {
      const entries = rootMap.get("Recovery") || [];
      const existing = entries.map(entry =>
        entry.ready
          ? `<a class="app-active" href="/api/v1/root/${entry.id}/recovery?html${tokenParam}" style="margin-right:8px;margin-bottom:6px;">${e(entry.name)}</a>`
          : `<a class="app-active" style="background:rgba(236,201,75,0.12);border-color:rgba(236,201,75,0.3);color:#ecc94b;margin-right:8px;margin-bottom:6px;" href="/api/v1/root/${entry.id}/recovery?html${tokenParam}">${e(entry.name)} (setup)</a>`
      ).join("");
      return `<div class="app-card">
        <div class="app-header"><span class="app-emoji">🌿</span><span class="app-name">Recovery</span></div>
        <div class="app-desc">Check in, journal, track patterns. Substance taper plans, mood, cravings, milestones.</div>
        ${existing ? `<div style="display:flex;flex-wrap:wrap;margin-bottom:10px;">${existing}</div>` : ""}
        <form class="app-form" method="POST" action="/api/v1/user/${userId}/apps/create">
          ${tokenField}<input type="hidden" name="app" value="recovery" />
          <input class="app-input" name="message" placeholder="What are you working on? (e.g. alcohol, nicotine, general wellness)" required />
          <button class="app-start" type="submit">${entries.length > 0 ? "New" : "Start"} Recovery</button>
        </form>
      </div>`;
    }, { priority: 30 });
  } catch {}

  // ── Router ──
  const { default: router } = await import("./routes.js");

  log.info("Recovery", "Loaded. The tree grows toward health.");

  const tools = getTools();

  return {
    router,
    tools,
    modeTools: [
      { modeKey: "tree:recovery-log", toolNames: ["recovery-add-substance"] },
      { modeKey: "tree:recovery-plan", toolNames: ["recovery-add-substance", "recovery-complete-setup"] },
    ],
    exports: {
      scaffold,
      isInitialized,
      findRecoveryNodes,
      getStatus,
      getPatterns,
      getMilestones,
      addSubstance,
      handleMessage,
    },
    jobs: [
      {
        name: "recovery-daily-reset",
        start: () => {},
        stop: () => { if (fallbackTimer) clearInterval(fallbackTimer); },
      },
    ],
  };
}
