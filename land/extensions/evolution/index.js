import log from "../../seed/log.js";
import tools from "./tools.js";
import { setRunChat, bumpMetric, recordVisit, getPatterns } from "./core.js";
import { startAnalysisJob, stopAnalysisJob } from "./job.js";

export async function init(core) {
  const BG = core.llm.LLM_PRIORITY.BACKGROUND;
  setRunChat(async (opts) => {
    if (opts.userId && opts.userId !== "SYSTEM" && !await core.llm.userHasLlm(opts.userId)) return { answer: null };
    return core.llm.runChat({ ...opts, llmPriority: BG });
  });

  // ── afterNote: track activity ──────────────────────────────────────
  core.hooks.register("afterNote", async ({ nodeId, userId, contentType, action }) => {
    if (contentType !== "text") return;
    if (action !== "create") return;
    if (!userId || userId === "SYSTEM") return;

    try {
      await bumpMetric(nodeId, "notesWritten");
    } catch (err) {
      log.debug("Evolution", "bumpMetric notesWritten failed:", err.message);
    }
  }, "evolution");

  // ── afterNodeCreate: track growth ──────────────────────────────────
  core.hooks.register("afterNodeCreate", async ({ node, userId }) => {
    if (!node?.parent || !userId) return;

    try {
      // Bump growth score on the parent (a child was added)
      await bumpMetric(node.parent.toString(), "childrenCreated");
    } catch (err) {
      log.debug("Evolution", "bumpMetric childrenCreated failed:", err.message);
    }
  }, "evolution");

  // ── afterNavigate: track revisits ──────────────────────────────────
  core.hooks.register("afterNavigate", async ({ userId, rootId, nodeId }) => {
    if (!rootId) return;

    try {
      await recordVisit(rootId);
    } catch (err) {
      log.debug("Evolution", "recordVisit failed:", err.message);
    }
  }, "evolution");

  // ── onCascade: track cascade involvement ───────────────────────────
  core.hooks.register("onCascade", async (hookData) => {
    const { nodeId, source, depth } = hookData;
    if (!nodeId) return;

    try {
      if (depth === 0) {
        // This node originated a cascade
        await bumpMetric(nodeId, "cascadesOriginated");
      } else {
        // This node received a cascade
        await bumpMetric(nodeId, "cascadesReceived");
      }
    } catch (err) {
      log.debug("Evolution", "cascade metric bump failed:", err.message);
    }
  }, "evolution");

  // ── enrichContext: inject relevant patterns ─────────────────────────
  // When the user is at a node, inject patterns from the tree root
  // so the AI can recommend structure based on what actually works.
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    // Find tree root for patterns
    if (!node.rootOwner && !node.parent) return; // land root or orphan
    if (node.systemRole) return;

    let rootId;
    if (node.rootOwner) {
      rootId = node._id;
    } else {
      try {
        const { resolveRootNode } = await import("../../seed/tree/treeFetch.js");
        const root = await resolveRootNode(node._id);
        rootId = root?._id;
      } catch (err) {
        log.debug("Evolution", "resolveRootNode failed:", err.message);
        return;
      }
    }

    if (!rootId) return;

    try {
      const patterns = await getPatterns(rootId);
      if (patterns.length > 0) {
        // Inject top 5 most relevant patterns (keep context lean)
        context.structuralPatterns = patterns.slice(0, 5).map((p) => p.pattern);
      }
    } catch (err) {
      log.debug("Evolution", "pattern injection failed:", err.message);
    }

    // Inject this node's fitness summary if it has evolution data
    const evo = meta.evolution;
    if (evo && (evo.notesWritten || evo.visits || evo.cascadesOriginated)) {
      context.nodeFitness = {
        notesWritten: evo.notesWritten || 0,
        visits: evo.visits || 0,
        cascades: (evo.cascadesOriginated || 0) + (evo.cascadesReceived || 0),
        dormant: evo.lastActivity
          ? Math.round((Date.now() - new Date(evo.lastActivity).getTime()) / (24 * 60 * 60 * 1000))
          : null,
      };
    }
  }, "evolution");

  const { default: router } = await import("./routes.js");

  return {
    router,
    tools,
    jobs: [
      {
        name: "evolution-analysis",
        start: () => { startAnalysisJob(); },
        stop: () => { stopAnalysisJob(); },
      },
    ],
    exports: {
      getPatterns,
      bumpMetric,
      recordVisit,
    },
  };
}
