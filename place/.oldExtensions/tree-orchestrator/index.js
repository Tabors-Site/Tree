// tree-orchestrator — slimmed 2026-05-18.
//
// The orchestration loop (chat/place/query/be dispatch, sub-Ruler
// recursion, plan execution, mode switching, classifier routing) was
// deleted in this slice. Tree-zone CHAT/PLACE/QUERY now route through
// SUMMON; the Ruler being at the tree root receives the message in its
// inbox and the per-being scheduler invokes rulerRole.summon. See
// memories `intents-are-tool-permissions`, `role-subsumes-mode`, and
// `abort-lives-in-summon`.
//
// What remains is substrate-level infrastructure that other extensions
// still consume:
//
//   - routingIndex — "which extensions are scaffolded in which tree."
//     Read by sprout, misroute, treeos-base/htmlRoutes, and go.
//     Eventually replaced by extensionSeeds (see memory `extension-seeds`).
//   - state.js routing-decision ledger + active-request lookup — read
//     by misroute. Becomes dead-on-read once the orchestrator stops
//     recording decisions; kept here so misroute doesn't break.
//
// The extension's name and scope will likely change in a follow-up
// (rename to `tree-routing` or fold into governing / treeos-base);
// for now it carries the same name to minimize churn for consumers.

import { rebuildAll, rebuildIndexForRoot, invalidateRoot, getIndexForRoot, getAllIndexedRoots } from "./routingIndex.js";
import { resolveRootNode } from "../../seed/tree/treeFetch.js";
import { getLastRouting, getLastRoutingRing, clearLastRouting, getActiveRequest } from "./state.js";
import log from "../../seed/log.js";

export async function init(core) {
  // ── Routing index: rebuild on boot ──
  core.hooks.register("afterBoot", async () => {
    try {
      await rebuildAll();
    } catch (err) {
      log.debug("TreeOrchestrator", `Routing index build failed: ${err.message}`);
    }
  }, "tree-orchestrator");

  // ── Routing index: rebuild when modes change on a node ──
  core.hooks.register("afterMetadataWrite", async ({ nodeId, extName }) => {
    if (extName !== "modes") return;
    try {
      const root = await resolveRootNode(nodeId);
      if (root?._id) await rebuildIndexForRoot(root._id);
    } catch {}
  }, "tree-orchestrator");

  // ── Routing index: invalidate on node deletion ──
  core.hooks.register("beforeNodeDelete", async ({ node }) => {
    try {
      if (node.rootOwner) {
        invalidateRoot(node._id);
      } else if (node.parent) {
        const root = await resolveRootNode(node.parent);
        if (root?._id) await rebuildIndexForRoot(root._id);
      }
    } catch {}
    // Never cancel deletion. Return undefined.
  }, "tree-orchestrator");

  // ── Routing index: rebuild when extension scoping changes ──
  core.hooks.register("afterScopeChange", async ({ nodeId }) => {
    try {
      const root = await resolveRootNode(nodeId);
      if (root?._id) await rebuildIndexForRoot(root._id);
    } catch {}
  }, "tree-orchestrator");

  // ── Routing index: rebuild on node move ──
  core.hooks.register("afterNodeMove", async ({ oldParentId, newParentId }) => {
    try {
      const oldRoot = await resolveRootNode(oldParentId);
      const newRoot = await resolveRootNode(newParentId);
      if (oldRoot?._id) await rebuildIndexForRoot(oldRoot._id);
      if (newRoot?._id && String(newRoot._id) !== String(oldRoot?._id)) {
        await rebuildIndexForRoot(newRoot._id);
      }
    } catch {}
  }, "tree-orchestrator");

  return {
    exports: {
      // Routing index — used by sprout, misroute, treeos-base, go.
      getIndexForRoot,
      getAllIndexedRoots,
      rebuildIndexForRoot,
      // Routing decision history — used by misroute. Dead-on-read now
      // that the orchestrator no longer records decisions; kept so
      // misroute doesn't break. Will retire when misroute migrates or
      // is decommissioned.
      getLastRouting,
      getLastRoutingRing,
      clearLastRouting,
      getActiveRequest,
    },
  };
}
