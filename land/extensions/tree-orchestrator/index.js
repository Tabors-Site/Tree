import { orchestrateTreeRequest, clearMemory } from "./orchestrator.js";
import { setClearMemoryFn } from "../../seed/ws/websocket.js";
import { rebuildAll, rebuildIndexForRoot, invalidateRoot, queryIndex, getIndexForRoot, getAllIndexedRoots } from "./routingIndex.js";
import { resolveRootNode } from "../../seed/tree/treeFetch.js";
import log from "../../seed/log.js";

export async function init(core) {
  // Wire orchestrator memory cleanup into the WebSocket disconnect/clear path
  setClearMemoryFn(clearMemory);

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

  // ── Routing index: new nodes might get modes set via afterMetadataWrite above ──
  // afterNodeCreate itself doesn't need a handler since modes are set
  // after creation via setExtMeta, which fires afterMetadataWrite.

  // ── Routing index: rebuild when extension scoping changes (ext-allow, ext-block) ──
  core.hooks.register("afterScopeChange", async ({ nodeId }) => {
    try {
      const root = await resolveRootNode(nodeId);
      if (root?._id) await rebuildIndexForRoot(root._id);
    } catch {}
  }, "tree-orchestrator");

  core.hooks.register("afterNodeMove", async ({ nodeId, oldParentId, newParentId }) => {
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
    orchestrator: {
      bigMode: "tree",
      handle: orchestrateTreeRequest,
    },
    exports: {
      orchestrateTreeRequest,
      queryIndex,
      getIndexForRoot,
      getAllIndexedRoots,
      rebuildIndexForRoot,
    },
  };
}
