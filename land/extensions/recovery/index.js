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

    // Fitness channel data
    try {
      const { getExtension } = await import("../loader.js");
      const ch = getExtension("channels");
      if (ch?.exports?.getChannelData) {
        const fitnessData = await ch.exports.getChannelData(rootId, "fitness");
        if (fitnessData?.lastWorkout) {
          context.recovery.lastWorkout = fitnessData.lastWorkout;
        }
      }
    } catch {}

    // Food channel data
    try {
      const { getExtension } = await import("../loader.js");
      const ch = getExtension("channels");
      if (ch?.exports?.getChannelData) {
        const foodData = await ch.exports.getChannelData(rootId, "food");
        if (foodData?.calories) {
          context.recovery.caloriestoday = foodData.calories;
        }
      }
    } catch {}
  }, "recovery");

  // HTML dashboard is now inline in routes.js (GET with ?html check)

  // ── Router ──
  const { default: router } = await import("./routes.js");

  log.info("Recovery", "Loaded. The tree grows toward health.");

  return {
    router,
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
