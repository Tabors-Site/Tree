/**
 * Scheduler
 *
 * The clock that watches the calendar. Syncs to the tree's breathing
 * rhythm. Every exhale, checks what's due, upcoming, or overdue.
 * Signals through enrichContext, notifications, and gateway.
 * Tracks completion patterns over time.
 */

import log from "../../seed/log.js";
import { getUserMeta } from "../../seed/tree/userMetadata.js";
import {
  configure,
  scanTree,
  getCachedTimeline,
  signalDueItems,
  recordCompletion,
  calculateReliability,
  getWeekTimeline,
  clearAll,
} from "./core.js";

export async function init(core) {
  configure({
    Node: core.models.Node,
    hooks: core.hooks,
    metadata: core.metadata,
  });

  let fallbackTimer = null;
  const activeRoots = new Set(); // track trees we've seen for fallback mode

  // ── breath:exhale listener ──
  // Every exhale, scan the tree for schedule changes.
  // If breath is not installed, a fallback timer runs instead.

  let breathConnected = false;

  core.hooks.register("breath:exhale", async ({ rootId }) => {
    breathConnected = true;
    if (!rootId) return;
    try {
      const timeline = await scanTree(rootId);
      if (timeline) {
        // Find an owner to send notifications to
        const root = await core.models.Node.findById(rootId).select("rootOwner").lean();
        if (root?.rootOwner) {
          await signalDueItems(rootId, timeline, String(root.rootOwner));
        }
      }
    } catch (err) {
      log.warn("Scheduler", `Scan failed for ${rootId}: ${err.message}`);
    }
  }, "scheduler");

  // Track active trees for fallback mode
  core.hooks.register("afterNavigate", async ({ rootId }) => {
    if (rootId) activeRoots.add(String(rootId));
  }, "scheduler");

  // Fallback timer: if breath extension is not installed, scan every 60s.
  // Check directly via getExtension instead of waiting for an event.
  setTimeout(async () => {
    if (breathConnected) return;
    try {
      const { getExtension } = await import("../loader.js");
      if (getExtension("breath")) return; // breath is installed, just hasn't fired yet
    } catch {}
    log.info("Scheduler", "Breath not installed. Starting fallback timer (60s).");
    fallbackTimer = setInterval(async () => {
      for (const rootId of activeRoots) {
        try {
          const timeline = await scanTree(rootId);
          if (timeline) {
            const root = await core.models.Node.findById(rootId).select("rootOwner").lean();
            if (root?.rootOwner) {
              await signalDueItems(rootId, timeline, String(root.rootOwner));
            }
          }
        } catch {}
      }
    }, 60000);
    if (fallbackTimer.unref) fallbackTimer.unref();
  }, 30000);

  // ── afterStatusChange ──
  // When a scheduled node is completed, record the completion.

  core.hooks.register("afterStatusChange", async ({ node, status }) => {
    if (status !== "completed") return;
    if (!node) return;

    const meta = node.metadata instanceof Map
      ? Object.fromEntries(node.metadata)
      : (node.metadata || {});

    const schedule = meta.schedule;
    if (!schedule) return;

    await recordCompletion(node, schedule);
  }, "scheduler");

  // ── enrichContext ──
  // Inject timeline and reliability data so the AI knows what's due.

  core.hooks.register("enrichContext", async ({ context, node, meta, userId }) => {
    if (!node?._id) return;

    // Find the root for this node
    let rootId = null;
    if (!node.parent) {
      rootId = String(node._id);
    } else {
      // Walk up via breath's cache or resolve manually
      try {
        const { getExtension } = await import("../loader.js");
        const breathExt = getExtension("breath");
        if (breathExt?.exports?.getBreathContext) {
          // breath has a resolveRootId we can use indirectly
          // but we need to import from breath/core directly
        }
      } catch {}
      // Fallback: check if any cached timeline contains this node
      // For enrichContext, we typically have the root context anyway
      // The orchestrator fetches context at a known position in a known tree
    }

    // If we can't determine rootId, try to get it from meta
    if (!rootId) {
      // Most enrichContext calls happen within a tree context where
      // the orchestrator already knows the rootId. Use a simple parent walk.
      try {
        let current = node;
        for (let depth = 0; depth < 50; depth++) {
          if (!current.parent) {
            rootId = String(current._id);
            break;
          }
          current = await core.models.Node.findById(current.parent).select("_id parent").lean();
          if (!current) break;
        }
      } catch {}
    }

    if (!rootId) return;

    const timeline = getCachedTimeline(rootId);
    if (!timeline) return;

    // Phase suppression: during attention, skip upcoming (only show due/overdue)
    let suppressUpcoming = false;
    if (userId) {
      try {
        const User = core.models.User;
        if (User) {
          const user = await User.findById(userId).select("metadata").lean();
          if (user) {
            const phaseMeta = getUserMeta(user, "phase");
            if (phaseMeta?.currentPhase === "attention") {
              // Check config
              const configNode = await core.models.Node.findOne({
                parent: rootId,
                name: ".config",
              }).select("metadata").lean();
              const schedulerConfig = configNode?.metadata instanceof Map
                ? configNode.metadata.get("scheduler")
                : configNode?.metadata?.scheduler;
              if (schedulerConfig?.suppressDuringAttention !== false) {
                suppressUpcoming = true;
              }
            }
          }
        }
      } catch {}
    }

    const schedulerCtx = {};
    if (timeline.due?.length > 0) schedulerCtx.due = timeline.due;
    if (timeline.overdue?.length > 0) schedulerCtx.overdue = timeline.overdue;
    if (!suppressUpcoming && timeline.upcoming?.length > 0) {
      schedulerCtx.upcoming = timeline.upcoming;
    }

    if (Object.keys(schedulerCtx).length > 0) {
      context.scheduler = schedulerCtx;
    }

    // Node-specific reliability data
    const schedulerMeta = meta?.scheduler;
    if (schedulerMeta?.completions?.length > 0) {
      const reliability = calculateReliability(schedulerMeta.completions);
      if (reliability) {
        context.schedulerReliability = reliability;
      }
    }
  }, "scheduler");

  // ── Import router and tools ──

  const { default: router, setMetadata: setRouteMetadata } = await import("./routes.js");
  setRouteMetadata(core.metadata);
  const { default: tools, setMetadata: setToolMetadata } = await import("./tools.js");
  setToolMetadata(core.metadata);

  log.info("Scheduler", "Loaded. The clock watches the calendar.");

  return {
    router,
    tools,
    exports: {
      scanTree,
      getCachedTimeline,
      getWeekTimeline,
      calculateReliability,
    },
    jobs: [
      {
        name: "scheduler-scan",
        start: () => {},
        stop: () => {
          if (fallbackTimer) clearInterval(fallbackTimer);
          clearAll();
        },
      },
    ],
  };
}
