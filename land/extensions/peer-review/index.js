import log from "../../seed/log.js";
import tools, { setMetadata as setToolMetadata } from "./tools.js";
import {
  setServices, triggerReview, handleReviewRequest,
  handleReviewResponse, getReviewConfig,
} from "./core.js";
export async function init(core) {
  setToolMetadata(core.metadata);
  const { deliverCascade } = await import("../../seed/tree/cascade.js");
  const BG = core.llm.LLM_PRIORITY.BACKGROUND;

  core.llm.registerRootLlmSlot?.("peerReview");

  setServices({
    runChat: async (opts) => {
      if (opts.userId && opts.userId !== "SYSTEM" && !await core.llm.userHasLlm(opts.userId)) return { answer: null };
      return core.llm.runChat({ ...opts, llmPriority: BG });
    },
    deliverCascade,
    setExtMeta: core.metadata.setExtMeta,
    getExtMeta: core.metadata.getExtMeta,
    mergeExtMeta: core.metadata.mergeExtMeta,
    emitToUser: core.websocket?.emitToUser || (() => {}),
    hooks: core.hooks,
    Node: core.models.Node,
    Note: core.models.Note,
  });

  // Register the review mode
  core.modes.registerMode(
    "tree:review",
    (await import("./modes/review.js")).default,
    "peer-review",
  );
  if (core.llm?.registerModeAssignment) {
    core.llm.registerModeAssignment("tree:review", "review");
  }

  // ── afterNote: trigger review when content is written ──
  core.hooks.register("afterNote", async ({ note, nodeId, userId, contentType, action }) => {
    if (contentType !== "text") return;
    if (action !== "create" && action !== "edit") return;
    if (!userId || userId === "SYSTEM") return;

    const node = await core.models.Node.findById(nodeId).select("systemRole metadata").lean();
    if (!node || node.systemRole) return;

    const config = getReviewConfig(node);
    if (!config.partner) return;
    if (config.status !== "idle") return;
    if (config.trigger !== "afterNote") return;

    // Track userId for notification on completion
    try {
      const fullNode = await core.models.Node.findById(nodeId);
      if (fullNode) {
        const cfg = getReviewConfig(fullNode);
        await core.metadata.setExtMeta(fullNode, "peer-review", { ...cfg, _lastUserId: userId });
      }
    } catch {}

    triggerReview(nodeId, note, userId).catch((err) => {
      log.debug("PeerReview", `Background trigger failed: ${err.message}`);
    });
  }, "peer-review");

  // ── onCascade: receive review requests and responses ──
  core.hooks.register("onCascade", async (hookData) => {
    const { payload } = hookData;
    if (!payload || typeof payload !== "object") return;
    if (!Array.isArray(payload.tags) || !payload.tags.includes("peer-review")) return;

    try {
      if (payload.action === "peer-review:request") {
        await handleReviewRequest(hookData);
        hookData._resultExtName = "peer-review";
      } else if (payload.action === "peer-review:response") {
        await handleReviewResponse(hookData);
        hookData._resultExtName = "peer-review";
      }
    } catch (err) {
      log.warn("PeerReview", `onCascade handler failed: ${err.message}`);
    }
  }, "peer-review");

  // ── enrichContext: surface review state to the AI ──
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const review = meta?.["peer-review"];
    if (!review || typeof review !== "object") return;

    const enrichment = {};

    if (review.partner) {
      enrichment.reviewPartner = review.partner;
      enrichment.reviewStatus = review.status || "idle";
    }

    if (review.status === "awaiting-response" || review.status === "reviewing" || review.status === "revising") {
      enrichment.pendingReview = true;
    }

    // Last completed review summary
    const history = Array.isArray(review.history) ? review.history : [];
    const lastCompleted = history.filter((h) => h.completedAt).slice(-1)[0];
    if (lastCompleted) {
      const lastRound = lastCompleted.rounds?.[lastCompleted.rounds.length - 1];
      enrichment.lastReview = {
        verdict: lastCompleted.finalVerdict,
        completedAt: lastCompleted.completedAt,
        summary: lastRound?.summary || null,
        rounds: lastCompleted.rounds?.length || 0,
      };
    }

    if (Object.keys(enrichment).length > 0) {
      context.peerReview = enrichment;
    }
  }, "peer-review");

  const { default: router, setMetadata: setRouteMetadata } = await import("./routes.js");
  setRouteMetadata(core.metadata);

  return {
    router,
    tools,
    exports: {
      triggerReview,
      getReviewConfig,
    },
  };
}
