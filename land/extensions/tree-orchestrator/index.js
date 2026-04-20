import { orchestrateTreeRequest, clearMemory, getLastRouting, getLastRoutingRing, clearLastRouting, getActiveRequest } from "./orchestrator.js";
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

  // ── Mode-list presence filter ──
  // Seed fires `filterAvailableModes` right before emitting the
  // mode dropdown. We use the routing index + classifier-hint
  // metadata to drop modes whose owning extension isn't scaffolded
  // in this tree. Baseline (treeos-base) and background-only
  // extensions (no classifier vocab — dream, understanding, etc.)
  // stay visible. Result: a fresh code-only tree shows just the
  // code-workspace + baseline + background modes, not KB/Study/
  // fitness/food/etc. that were registered globally but never
  // instantiated here.
  core.hooks.register("filterAvailableModes", async (payload) => {
    try {
      if (payload?.bigMode !== "tree" || !payload?.rootId) return;
      const modes = Array.isArray(payload.modes) ? payload.modes : [];
      if (modes.length === 0) return;

      const { getExtension } = await import("../loader.js");
      const { getModeOwner } = await import("../../seed/modes/registry.js");
      const { getClassifierHintsForMode } = await import("../loader.js");

      const treeIndex = getIndexForRoot(payload.rootId);

      payload.modes = modes.filter((m) => {
        const owner = getModeOwner(m.key);
        if (!owner) return true;                     // kernel mode
        if (owner === "treeos-base") return true;    // baseline
        if (treeIndex && treeIndex.has(owner)) return true; // scaffolded here

        // Background-only extensions (no classifier vocab) stay visible;
        // they never compete for chat routing and are useful to invoke
        // explicitly (dream-summary, understanding-review, etc.).
        const hints = getClassifierHintsForMode(m.key);
        if (!hints || hints.length === 0) return true;
        return false;
      });
    } catch (err) {
      log.debug("TreeOrchestrator", `filterAvailableModes skipped: ${err.message}`);
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
      // Routing decision history (used by misroute extension to detect corrections)
      getLastRouting,
      getLastRoutingRing,
      clearLastRouting,
      // Active request context (used by misroute extension to redispatch on
      // the same socket without going through the websocket layer).
      getActiveRequest,
    },
  };
}
