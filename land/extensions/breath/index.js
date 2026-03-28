/**
 * Breath
 *
 * The tree breathes. Not a metaphor. A literal rhythm that drives
 * all background work. Activity speeds it up. Silence slows it down.
 * Dormancy stops it. Each tree has its own breathing cycle.
 *
 * Extensions listen to breath:exhale instead of running their own
 * setInterval. The tree's metabolism is unified. One rhythm.
 * Every extension feels it.
 */

import log from "../../seed/log.js";
import {
  configure,
  recordActivity,
  resolveRootId,
  getBreathContext,
  getState,
  getAllStates,
  stopAll,
} from "./core.js";

export async function init(core) {
  // Wire core dependencies
  configure({
    hooks: core.hooks,
    Node: core.models.Node,
  });

  // ── Activity hooks ──
  // Every event increments the activity counter for its tree.
  // Trees with no activity slow down and eventually go dormant.
  // First event on a dormant tree wakes it.

  core.hooks.register("afterNote", async ({ nodeId }) => {
    if (!nodeId) return;
    const rootId = await resolveRootId(String(nodeId));
    if (rootId) recordActivity(rootId);
  }, "breath");

  core.hooks.register("afterNodeCreate", async ({ node }) => {
    if (!node) return;
    // Root nodes have no parent. Their _id IS the rootId.
    if (!node.parent) {
      recordActivity(String(node._id));
    } else {
      const rootId = await resolveRootId(String(node._id));
      if (rootId) recordActivity(rootId);
    }
  }, "breath");

  core.hooks.register("afterToolCall", async ({ rootId }) => {
    if (rootId) recordActivity(String(rootId));
  }, "breath");

  core.hooks.register("afterNavigate", async ({ rootId }) => {
    if (rootId) recordActivity(String(rootId));
  }, "breath");

  // ── enrichContext ──
  // Inject breathing state so the AI knows the tree's rhythm.

  core.hooks.register("enrichContext", async ({ context, node }) => {
    if (!node?._id) return;
    const rootId = !node.parent
      ? String(node._id)
      : await resolveRootId(String(node._id));
    if (!rootId) return;

    const breath = getBreathContext(rootId);
    if (breath) {
      context.breath = breath;
    }
  }, "breath");

  log.info("Breath", "Loaded. Trees breathe.");

  return {
    jobs: [
      {
        name: "breath-cycle",
        start: () => {},
        stop: stopAll,
      },
    ],
    exports: {
      getBreathContext,
      getState,
      getAllStates,
      recordActivity,
    },
  };
}
