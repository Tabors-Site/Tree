import { orchestrateTreeRequest, clearMemory, getLastRouting, getLastRoutingRing, clearLastRouting, getActiveRequest } from "./orchestrator.js";
import { setClearMemoryFn, registerSocketHandler } from "../../seed/ws/websocket.js";
import { rebuildAll, rebuildIndexForRoot, invalidateRoot, getIndexForRoot, getAllIndexedRoots } from "./routingIndex.js";
import { resolveRootNode } from "../../seed/tree/treeFetch.js";
import { dispatchApprovedSubPlan, archiveSubPlan } from "./dispatch.js";
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

    // ── Manifest vocabulary scan ──
    // Walk every loaded extension. If it owns any non-hidden tree:* mode AND
    // has no classifier vocab (classifierHints + vocabulary.verbs/nouns/
    // adjectives) AND no explicit `background: true`, its modes will be
    // hidden by the presence filter — warn the author so they can either
    // declare vocab (domain extension) or declare background (internal
    // utility). Scanning here, after loader finishes, avoids timing races.
    try {
      const { getLoadedManifests, flattenVocabulary } = await import("../loader.js");
      const { getModesOwnedBy } = await import("../../seed/tree/extensionScope.js");
      const { getMode } = await import("../../seed/modes/registry.js");
      const manifests = getLoadedManifests();
      const warnings = [];
      for (const manifest of manifests) {
        if (!manifest?.name) continue;
        if (manifest.background === true) continue;
        if (manifest.name === "treeos-base") continue;
        const ownedModes = getModesOwnedBy(manifest.name) || [];
        const visibleTreeModes = ownedModes.filter((key) => {
          if (!key.startsWith("tree:")) return false;
          const mode = getMode(key);
          // hidden: true modes still show in the tree dropdown (see
          // registry.getSubModes), so they count here too.
          return !!mode;
        });
        if (visibleTreeModes.length === 0) continue;
        const hints = flattenVocabulary(manifest);
        if (!hints || hints.length === 0) {
          warnings.push(manifest.name);
        }
      }
      if (warnings.length > 0) {
        log.warn(
          "TreeOrchestrator",
          `Extensions own tree modes but declare no classifier vocabulary — their modes will be hidden from the mode picker. ` +
          `Add classifierHints or vocabulary (domain extension) or background: true (utility) to the manifest: ${warnings.join(", ")}`,
        );
      }
    } catch (err) {
      log.debug("TreeOrchestrator", `vocab audit skipped: ${err.message}`);
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

      const { getClassifierHintsForMode, getExtension } = await import("../loader.js");
      const { getModeOwner } = await import("../../seed/tree/extensionScope.js");

      const treeIndex = getIndexForRoot(payload.rootId);

      payload.modes = modes.filter((m) => {
        const owner = getModeOwner(m.key);
        if (!owner) return true;                     // kernel mode
        if (owner === "treeos-base") return true;    // baseline
        if (treeIndex && treeIndex.has(owner)) return true; // scaffolded here

        // Explicit background opt-in from the manifest stays visible even
        // when the extension also declared vocab (rare but allowed).
        const ext = getExtension(owner);
        if (ext?.manifest?.background === true) return true;

        // Missing vocab falls back to "show" so we don't silently hide
        // utility extensions whose authors forgot to declare background.
        // The afterBoot scanner logs a warning listing every manifest in
        // this state so authors can decide: add vocab or add background.
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

  // ── Sub-plan approval handlers ────────────────────────────────────
  // A SUB_PLAN_PROPOSED card in chat gives the user Accept / Cancel
  // buttons scoped to that specific sub-plan. Button click emits one
  // of these events with the sub-plan's node id; the server dispatches
  // (Accept) or archives (Cancel) without needing a chat-message
  // round-trip. Runtime context (socket, signal, rt, slot) comes from
  // the visitor's active request — the session that originally spawned
  // the swarm.
  registerSocketHandler("swarmSubPlanAccept", async ({ socket, userId, visitorId, data }) => {
    const subPlanNodeId = data?.subPlanNodeId;
    if (!subPlanNodeId) return;
    const active = getActiveRequest(visitorId) || {};
    const runtimeCtx = {
      visitorId,
      userId: active.userId || userId,
      username: active.username || null,
      rootId: active.rootId || null,
      sessionId: active.sessionId || null,
      signal: active.signal || null,
      slot: active.slot || null,
      socket: active.socket || socket,
      onToolLoopCheckpoint: active.onToolLoopCheckpoint || null,
      rt: active.rt || null,
      rootChatId: active.rootChatId || null,
    };
    // Fire-and-forget. The dispatch's own emits (SUB_PLAN_DISPATCHED,
    // scout events, branch completion events) surface progress to the
    // user. If dispatch fails the error is logged on the server.
    dispatchApprovedSubPlan({ subPlanNodeId, runtimeCtx }).catch((err) => {
      log.error("TreeOrchestrator", `swarmSubPlanAccept dispatch failed: ${err.message}`);
    });
  });

  registerSocketHandler("swarmSubPlanCancel", async ({ socket, data }) => {
    const subPlanNodeId = data?.subPlanNodeId;
    if (!subPlanNodeId) return;
    await archiveSubPlan({
      subPlanNodeId,
      reason: data?.reason || "user-cancel",
      socket,
    }).catch((err) => {
      log.error("TreeOrchestrator", `swarmSubPlanCancel failed: ${err.message}`);
    });
  });

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
