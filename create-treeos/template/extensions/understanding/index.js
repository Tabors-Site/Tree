import log from "../../seed/log.js";
import UnderstandingRun from "./understandingRun.js";
import UnderstandingNode from "./understandingNode.js";
import tools from "./tools.js";

import understand from "./modes/understand.js";
import understandSummarize from "./modes/understandSummarize.js";

/**
 * Build a Map of nodeId -> encoding string from the latest understanding run.
 * Called by tree-orchestrator, raw-ideas, dreams when building tree summaries.
 * The seed's buildDeepTreeSummary accepts this map as a parameter.
 */
async function getEncodingMap(rootId) {
  try {
    const latestRun = await UnderstandingRun.findOne({
      rootNodeId: rootId,
      perspective: { $regex: /^Summarize this section/ },
    }).sort({ createdAt: -1 }).select("_id nodeMap").lean();

    if (!latestRun) return null;

    // Scope to nodes in this run only. nodeMap has realNodeId -> understandingNodeId.
    const runId = String(latestRun._id);
    const uNodeIds = latestRun.nodeMap instanceof Map
      ? [...latestRun.nodeMap.values()]
      : Object.values(latestRun.nodeMap || {});

    if (uNodeIds.length === 0) return null;

    const uNodes = await UnderstandingNode.find({ _id: { $in: uNodeIds } })
      .select("realNodeId perspectiveStates").lean();

    const map = new Map();
    for (const uNode of uNodes) {
      const state = uNode.perspectiveStates?.get?.(runId)
        || (uNode.perspectiveStates && uNode.perspectiveStates[runId]);
      if (state?.encoding) {
        map.set(uNode.realNodeId, state.encoding);
      }
    }
    return map.size > 0 ? map : null;
  } catch {
    return null;
  }
}

export async function init(core) {
  // Wire core services into core.js and routes.js
  const understanding = await import("./core.js");
  understanding.setServices({ models: core.models, contributions: core.contributions });
  if (core.energy) understanding.setEnergyService(core.energy);

  const { default: router, setModels, resolveHtmlAuth } = await import("./routes.js");
  setModels(core.models);
  resolveHtmlAuth();

  const orchestrator = await import("./pipeline.js");

  // Register understanding modes + LLM slot mappings
  core.modes.registerMode("tree:understand", understand, "understanding");
  core.modes.registerMode("tree:understand-summarize", understandSummarize, "understanding");
  if (core.llm?.registerModeAssignment) {
    core.llm.registerModeAssignment("tree:understand", "understanding");
    core.llm.registerModeAssignment("tree:understand-summarize", "understanding");
    core.llm.registerRootLlmSlot?.("understanding");
  }

  // Inject latest understanding encoding into every AI prompt at this tree.
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    if (!node?.rootOwner || node.rootOwner === "SYSTEM") return;
    const rootId = meta?.rootId || (node.rootOwner && node.rootOwner !== "SYSTEM" ? node._id : null);
    if (!rootId) return;
    try {
      const latestRun = await UnderstandingRun.findOne({
        rootNodeId: String(rootId),
        status: "completed",
      }).sort({ lastCompletedAt: -1 }).select("encodingHistory perspective").lean();
      if (!latestRun?.encodingHistory?.length) return;
      const latest = latestRun.encodingHistory[latestRun.encodingHistory.length - 1];
      if (latest?.encoding) {
        context.understanding = `[Understanding: ${latestRun.perspective || "general"}] ${latest.encoding}`;
      }
    } catch (err) { log.debug("Understanding", "Failed to enrich context with understanding:", err.message); }
  }, "understanding");

  return {
    models: { UnderstandingRun, UnderstandingNode },
    router,
    tools,
    exports: {
      orchestrateUnderstanding: orchestrator.orchestrateUnderstanding,
      createUnderstandingRun: understanding.createUnderstandingRun,
      findOrCreateUnderstandingRun: understanding.findOrCreateUnderstandingRun,
      prepareIncrementalRun: understanding.prepareIncrementalRun,
      getEncodingMap,
    },
  };
}
