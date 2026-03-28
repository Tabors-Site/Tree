/**
 * Rings Extension
 *
 * The tree remembers every age it has been.
 * Rings form from activity phases, not calendar dates.
 * Growth, peak, hardening, dormancy. The ring solidifies
 * when the tree completes a full cycle.
 *
 * Three temporal layers:
 *   Phase (seconds):  awareness/attention in conversation
 *   Breath (minutes): activity-driven metabolism
 *   Rings (months):   growth -> peak -> hardening -> dormant
 */

import log from "../../seed/log.js";
import {
  configure,
  getRings,
  incrementAccumulator,
  onExhale,
  getDefaultRingState,
} from "./core.js";
import { getExtension } from "../loader.js";

export async function init(core) {
  const { runChat } = await import("../../seed/ws/conversation.js");

  configure({
    Node: core.models.Node,
    Note: core.models.Note,
    runChat,
    metadata: core.metadata,
    getExtension,
  });

  // Register LLM slot
  core.llm.registerRootLlmSlot("rings");

  // ── Initialize ring state on trees that don't have one ──
  core.hooks.register("afterBoot", async () => {
    try {
      const roots = await core.models.Node.find({
        rootOwner: { $exists: true, $ne: null },
        systemRole: null,
      }).select("_id metadata").lean();

      for (const root of roots) {
        const ringState = core.metadata.getExtMeta(root, "rings");
        if (!ringState || !ringState.started) {
          await core.metadata.setExtMeta(root, "rings", getDefaultRingState());
        }
      }
    } catch {}
  }, "rings");

  // ── Accumulate activity via hooks ──

  core.hooks.register("afterNote", async ({ node }) => {
    if (!node) return;
    // Walk to root
    let cursor = node;
    while (cursor && !cursor.rootOwner) {
      cursor = await core.models.Node.findById(cursor.parent).select("_id rootOwner parent").lean();
    }
    if (cursor?.rootOwner) {
      await incrementAccumulator(cursor._id, "notesWritten");
    }
  }, "rings");

  core.hooks.register("afterNodeCreate", async ({ node }) => {
    if (!node) return;
    let cursor = node;
    while (cursor && !cursor.rootOwner) {
      cursor = await core.models.Node.findById(cursor.parent).select("_id rootOwner parent").lean();
    }
    if (cursor?.rootOwner) {
      await incrementAccumulator(cursor._id, "nodesCreated");
    }
  }, "rings");

  core.hooks.register("beforeNodeDelete", async ({ node }) => {
    if (!node) return;
    let cursor = node;
    while (cursor && !cursor.rootOwner) {
      cursor = await core.models.Node.findById(cursor.parent).select("_id rootOwner parent").lean();
    }
    if (cursor?.rootOwner) {
      await incrementAccumulator(cursor._id, "nodesLost");
    }
  }, "rings");

  // Cascade signals
  core.hooks.register("onCascade", async (hookData) => {
    const nodeId = hookData?.nodeId;
    if (!nodeId) return;
    const node = await core.models.Node.findById(nodeId).select("rootOwner").lean();
    if (node?.rootOwner) {
      await incrementAccumulator(node.rootOwner === node._id?.toString() ? node._id : node.rootOwner, "cascadeSignals");
    }
  }, "rings");

  // ── Breath exhale: phase detection + hardening progress ──
  // Listens to breath:exhale via a periodic check
  let _exhaustTimer = null;
  const EXHALE_CHECK_INTERVAL = 10 * 60 * 1000; // 10 min fallback

  async function runExhaleCheck() {
    try {
      const roots = await core.models.Node.find({
        rootOwner: { $exists: true, $ne: null },
        systemRole: null,
      }).select("_id rootOwner metadata").lean();

      for (const root of roots) {
        const ringState = core.metadata.getExtMeta(root, "rings");
        if (!ringState?.started) continue;

        const owner = await core.models.User.findById(root.rootOwner).select("username").lean();
        if (!owner) continue;

        await onExhale(root._id, root.rootOwner, owner.username);
      }
    } catch (err) {
      log.debug("Rings", `Exhale check error: ${err.message}`);
    }
  }

  // Try to sync to breath:exhale. Fallback to timer.
  core.hooks.register("afterBoot", async () => {
    const breath = getExtension("breath");
    if (breath?.exports?.onExhale) {
      // Breath extension fires exhale events. Listen.
      core.hooks.register("afterToolCall", async () => {
        // Piggyback on activity. onExhale handles rate limiting internally.
      }, "rings");
    }
    // Always run periodic check as safety net
    _exhaustTimer = setInterval(runExhaleCheck, EXHALE_CHECK_INTERVAL);
    if (_exhaustTimer.unref) _exhaustTimer.unref();

    // Initial check
    await runExhaleCheck();
  }, "rings");

  // ── enrichContext: inject ring awareness at any position ──
  core.hooks.register("enrichContext", async ({ context, node }) => {
    if (!node) return;

    // Resolve tree root from any position via ancestor walk
    let rootId = null;
    let rootNode = null;
    if (node.rootOwner && String(node.rootOwner) !== "system") {
      // This node has rootOwner: it IS the root, or rootOwner points to the root
      const ownerIdStr = String(node.rootOwner);
      if (ownerIdStr === String(node._id)) {
        rootId = String(node._id);
        rootNode = node;
      } else {
        // rootOwner is a userId, not the root node. Walk up.
        let cursor = node;
        while (cursor) {
          if (cursor.rootOwner && String(cursor._id) !== String(cursor.parent)) {
            // Check if this node owns itself (is a tree root)
            const parent = cursor.parent ? await core.models.Node.findById(cursor.parent).select("_id rootOwner systemRole").lean() : null;
            if (!parent || parent.systemRole) {
              rootId = String(cursor._id);
              rootNode = cursor;
              break;
            }
          }
          if (!cursor.parent) break;
          cursor = await core.models.Node.findById(cursor.parent).select("_id rootOwner parent systemRole").lean();
          if (cursor?.systemRole) break;
        }
      }
    }

    if (!rootId) return;

    // Load root with metadata if we don't have it
    if (!rootNode?.metadata) {
      rootNode = await core.models.Node.findById(rootId).select("metadata dateCreated").lean();
    }
    if (!rootNode) return;

    const ringState = core.metadata.getExtMeta(rootNode, "rings");
    if (!ringState?.started) return;

    const { rings, annual } = await getRings(rootId);

    context.rings = {
      currentPhase: ringState.phase || "unknown",
      ringsCompleted: rings.length + annual.length,
    };

    if (ringState.character) {
      context.rings.currentCharacter = ringState.character;
    }

    const prevRing = rings[0] || annual[0];
    if (prevRing?.essence) {
      context.rings.previousRingEssence = prevRing.essence;
    }

    if (rootNode.dateCreated) {
      const ageMs = Date.now() - new Date(rootNode.dateCreated).getTime();
      const months = Math.floor(ageMs / (30 * 24 * 60 * 60 * 1000));
      context.rings.treeAge = months < 12 ? `${months} months` : `${Math.floor(months / 12)} years, ${months % 12} months`;
    }
  }, "rings");

  // Routes
  const { default: router, resolveHtmlAuth } = await import("./routes.js");
  resolveHtmlAuth();

  return {
    router,
    exports: {
      getRings,
      onExhale,
    },
    jobs: [
      {
        name: "rings-exhale",
        start: () => {}, // timer started in afterBoot
        stop: () => { if (_exhaustTimer) { clearInterval(_exhaustTimer); _exhaustTimer = null; } },
      },
    ],
  };
}
