import log from "../../seed/log.js";
import tools from "./tools.js";
import { setServices, compressToBudget, compressTree, getCompressConfig, getCompressStatus } from "./core.js";

export async function init(core) {
  // Wire services
  const { editStatus } = await import("../../seed/tree/statuses.js");
  core.llm.registerRootLlmSlot("compress");
  const BG = core.llm.LLM_PRIORITY.BACKGROUND;
  setServices({
    runChat: async (opts) => {
      if (opts.userId && opts.userId !== "SYSTEM" && !await core.llm.userHasLlm(opts.userId)) return { answer: null };
      return core.llm.runChat({ ...opts, llmPriority: BG });
    },
    editStatus,
    metadata: core.metadata,
  });

  // ── onTreeTripped: auto-compress as revival strategy ───────────────
  // Read the trip scores and decide whether compression can actually help.
  // The health score has three variables: nodeCount, metadataDensity, errorRate.
  // Compression only reduces metadataDensity. If the tree tripped because of
  // errorRate, compressing won't help. Tell the operator what's actually wrong.
  core.hooks.register("onTreeTripped", async ({ rootId, reason, scores }) => {
    const config = await getCompressConfig();
    if (!config.autoReviveOnTrip) return;

    // Read the actual score breakdown
    const nodeScore = scores?.nodeCount || 0;
    const densityScore = scores?.metadataDensity || 0;
    const errorScore = scores?.errorRate || 0;
    const dominant = densityScore >= nodeScore && densityScore >= errorScore ? "density"
      : errorScore >= nodeScore && errorScore >= densityScore ? "error"
      : "nodes";

    if (dominant === "error") {
      log.warn("TreeCompress",
        `Tree ${rootId} tripped (${reason}) but dominant factor is error rate ` +
        `(error: ${errorScore.toFixed(2)}, density: ${densityScore.toFixed(2)}, nodes: ${nodeScore.toFixed(2)}). ` +
        `Compression cannot help. Investigate the errors.`,
      );
      return;
    }

    if (dominant === "nodes") {
      log.info("TreeCompress",
        `Tree ${rootId} tripped (${reason}). Dominant factor is node count ` +
        `(nodes: ${nodeScore.toFixed(2)}, density: ${densityScore.toFixed(2)}, error: ${errorScore.toFixed(2)}). ` +
        `Compression helps indirectly but the real fix is pruning dead branches. Attempting compression.`,
      );
    } else {
      log.info("TreeCompress",
        `Tree ${rootId} tripped (${reason}). Dominant factor is metadata density ` +
        `(density: ${densityScore.toFixed(2)}, nodes: ${nodeScore.toFixed(2)}, error: ${errorScore.toFixed(2)}). ` +
        `Starting auto-compression.`,
      );
    }

    try {
      const Node = core.models.Node;
      const root = await Node.findById(rootId).select("rootOwner metadata").lean();
      if (!root?.rootOwner) return;

      const User = core.models.User;
      const user = await User.findById(root.rootOwner).select("username").lean();
      if (!user) return;

      // Read the actual max metadata bytes from the circuit config, not a hardcoded guess
      const { getLandConfigValue } = await import("../../seed/landConfig.js");
      const maxMetaBytes = parseInt(getLandConfigValue("maxTreeMetadataBytes") || "1073741824", 10);

      // Target: reduce density contribution below its weight threshold.
      // densityScore = (currentDensity / maxMetaBytes) * densityWeight.
      // We need densityScore low enough that total < 1.0 given the other scores.
      // Target density: (1.0 - nodeScore - errorScore) / densityWeight * maxMetaBytes
      // But simpler: compress until checkTreeHealth says total < 1.0.
      const { checkTreeHealth } = await import("../../seed/tree/treeCircuit.js");

      const result = await compressTree(rootId, root.rootOwner, user.username);

      // After compression, check if health dropped below 1.0
      const postHealth = await checkTreeHealth(rootId);

      if (postHealth.total < 1.0) {
        try {
          await core.tree.reviveTree(rootId, root.rootOwner);
          log.info("TreeCompress",
            `Tree ${rootId} auto-revived after compression. ` +
            `${result.nodesCompressed} nodes compressed. Health: ${postHealth.total.toFixed(2)}`,
          );
        } catch (err) {
          log.warn("TreeCompress", `Tree ${rootId} health is ${postHealth.total.toFixed(2)} but revival failed: ${err.message}`);
        }
      } else {
        log.warn("TreeCompress",
          `Tree ${rootId} compressed ${result.nodesCompressed} nodes but health still ${postHealth.total.toFixed(2)}. ` +
          `Scores: density=${postHealth.metadataDensity.toFixed(2)}, nodes=${postHealth.nodeCount.toFixed(2)}, error=${postHealth.errorRate.toFixed(2)}. ` +
          `Manual intervention needed.`,
        );
      }
    } catch (err) {
      log.error("TreeCompress", `Auto-compression failed for tree ${rootId}: ${err.message}`);
    }
  }, "tree-compress");

  // ── onDocumentPressure: compress deepest branches when tree approaches limits ──
  core.hooks.register("onDocumentPressure", async ({ documentType, documentId, currentSize, maxSize, percent }) => {
    if (documentType !== "node") return;

    try {
      // Find the tree root for this node
      const { resolveRootNode } = await import("../../seed/tree/treeFetch.js");
      let root;
      try { root = await resolveRootNode(documentId); } catch { return; }
      if (!root?._id) return;

      const Node = core.models.Node;
      const User = core.models.User;
      const user = await User.findById(root.rootOwner).select("username").lean();
      if (!user) return;

      log.info("TreeCompress", `Document pressure (${percent}%) on node ${documentId}. Starting targeted compression.`);

      // Compress the pressured node's branch
      const { compressBranch } = await import("./core.js");
      await compressBranch(documentId, root.rootOwner, user.username);
    } catch (err) {
      log.error("TreeCompress", `Pressure-triggered compression failed: ${err.message}`);
    }
  }, "tree-compress");

  // ── enrichContext: inject essence at compressed nodes ───────────────
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const compress = meta.compress || meta["tree-compress"];
    if (compress?.essence) {
      context.compressedEssence = compress.essence;
    }
  }, "tree-compress");

  // ── beforeNote: warn on trimmed nodes ──────────────────────────────
  core.hooks.register("beforeNote", async (hookData) => {
    const Node = core.models.Node;
    const node = await Node.findById(hookData.nodeId).select("status").lean();
    if (node?.status === "trimmed") {
      // Don't block, just annotate. New notes on trimmed nodes will be compressed next run.
      hookData.metadata = hookData.metadata || {};
      hookData.metadata._writtenWhileTrimmed = true;
    }
  }, "tree-compress");

  const { default: router } = await import("./routes.js");

  return {
    router,
    tools,
    exports: {
      compressTree,
      compressToBudget,
      getCompressStatus,
    },
  };
}
