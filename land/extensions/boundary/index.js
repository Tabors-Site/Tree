import log from "../../seed/log.js";
import tools from "./tools.js";
import {
  setServices,
  analyze,
  analyzeBranch,
  getBoundaryReport,
  getOrphanedNodes,
  markStale,
} from "./core.js";

export async function init(core) {
  const BG = core.llm.LLM_PRIORITY.BACKGROUND;
  setServices({
    models: core.models,
    contributions: core.contributions,
    llm: { ...core.llm, runChat: async (opts) => {
      if (opts.userId && opts.userId !== "SYSTEM" && !await core.llm.userHasLlm(opts.userId)) return { answer: null };
      return core.llm.runChat({ ...opts, llmPriority: BG });
    } },
    energy: core.energy || null,
  });

  // ── afterNote: mark boundary analysis as stale ──────────────────────
  core.hooks.register("afterNote", async ({ nodeId, userId, action }) => {
    if (action !== "create" && action !== "edit") return;
    if (!userId || userId === "SYSTEM") return;

    // Skip system nodes
    try {
      const node = await core.models.Node.findById(nodeId).select("systemRole").lean();
      if (node?.systemRole) return;
    } catch { return; }

    // Find the tree root and mark its boundary analysis as stale
    try {
      const { resolveRootNode } = await import("../../seed/tree/treeFetch.js");
      const root = await resolveRootNode(nodeId);
      if (root?._id) {
        markStale(root._id.toString()).catch(() => {});
      }
    } catch (err) {
      log.debug("Boundary", "Failed to mark stale after note:", err.message);
    }
  }, "boundary");

  // ── enrichContext: inject boundary findings ──────────────────────────
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const boundary = meta.boundary;
    if (!boundary || !boundary.findings) return;

    const activeFindings = boundary.findings;
    if (activeFindings.length === 0 && boundary.overallCoherence == null) return;

    // Only inject findings relevant to the current node's branch
    const nodeId = node._id?.toString();
    const relevant = activeFindings.filter(f =>
      (f.nodes && f.nodes.includes(nodeId)) ||
      (f.branches && f.branches.includes(nodeId))
    );

    if (relevant.length > 0) {
      context.boundaryIssues = relevant.map(f => ({
        type: f.type,
        severity: f.severity,
        description: f.description,
        suggestion: f.suggestion,
      }));
    }

    // Always include overall coherence
    if (boundary.overallCoherence != null) {
      context.treeCoherence = boundary.overallCoherence;
      if (boundary.stale) {
        context.treeCoherenceStale = true;
      }
    }
  }, "boundary");

  // ── Jobs ────────────────────────────────────────────────────────────
  const { setModels: setJobModels, startBoundaryJob, stopBoundaryJob } = await import("./boundaryJob.js");
  setJobModels(core.models);

  // ── Routes ──────────────────────────────────────────────────────────
  const { default: router } = await import("./routes.js");

  log.info("Boundary", "Structural cohesion analysis loaded");

  return {
    router,
    tools,
    jobs: [
      {
        name: "boundary-cycle",
        start: () => startBoundaryJob(),
        stop: () => stopBoundaryJob(),
      },
    ],
    exports: {
      analyze,
      analyzeBranch,
      getBoundaryReport,
      getOrphanedNodes,
    },
  };
}
