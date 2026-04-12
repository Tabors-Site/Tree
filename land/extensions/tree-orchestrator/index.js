import { orchestrateTreeRequest, clearMemory } from "./orchestrator.js";
import { setClearMemoryFn } from "../../seed/ws/websocket.js";
import { rebuildAll, rebuildIndexForRoot, invalidateRoot, getIndexForRoot, getAllIndexedRoots } from "./routingIndex.js";
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

  // ── Pronoun state: track last modified node for "that"/"same" resolution ──
  core.hooks.register("afterToolCall", async ({ toolName, args, success, userId, rootId }) => {
    if (!success || !userId) return;

    const nodeId = args?.nodeId || args?.parentId || args?.parentNodeID;
    if (!nodeId) return;

    // Read-only tools don't modify state
    const readOnly = new Set(["navigate-tree", "get-tree-context", "get-node-notes", "get-root-nodes", "get-tree"]);
    if (readOnly.has(toolName)) return;

    try {
      const { updatePronounState } = await import("./orchestrator.js");
      // Build visitorId from rootId + userId (same pattern as runOrchestration)
      const visitorId = rootId ? `${rootId}:${userId}` : `user:${userId}`;
      updatePronounState(visitorId, { lastMod: String(nodeId) });
    } catch {}
  }, "tree-orchestrator");

  // Register LLM slots for semantic routing
  // Operators assign cheap/fast models to these for routing decisions
  core.llm.registerRootLlmSlot?.("departure");
  core.llm.registerRootLlmSlot?.("territory");

  return {
    orchestrator: {
      bigMode: "tree",
      handle: orchestrateTreeRequest,
    },
    exports: {
      orchestrateTreeRequest,
      getIndexForRoot,
      getAllIndexedRoots,
      rebuildIndexForRoot,
    },
  };
}
