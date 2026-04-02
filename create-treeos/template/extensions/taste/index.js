import log from "../../seed/log.js";
import {
  configure,
  recordCreateSignal,
  recordEditSignal,
  recordDeleteSignal,
  recordFeedbackSignal,
  synthesize,
} from "./core.js";

export async function init(core) {
  const BG = core.llm.LLM_PRIORITY.BACKGROUND;

  const { runChat: _runChatDirect } = await import("../../seed/llm/conversation.js");
  configure({
    metadata: core.metadata,
    runChat: async (opts) => _runChatDirect({ ...opts, llmPriority: BG }),
    Contribution: core.models.Contribution,
    Node: core.models.Node,
  });

  // ── afterNote: track AI-generated content signals ──────────────────
  core.hooks.register("afterNote", async ({ note, nodeId, action }) => {
    if (action === "create") {
      await recordCreateSignal(nodeId, note._id);
    } else if (action === "edit") {
      await recordEditSignal(nodeId, note._id);
    }
  }, "taste");

  // ── beforeNodeDelete: negative signal to parent if AI content deleted ─
  core.hooks.register("beforeNodeDelete", async ({ node }) => {
    await recordDeleteSignal(node);
    // Never cancel deletion. Taste observes, it does not block.
  }, "taste");

  // ── afterToolCall: explicit feedback signals ───────────────────────
  core.hooks.register("afterToolCall", async ({ toolName, args, success, nodeId }) => {
    if (!success) return;
    if (toolName === "rate-response" && args?.rating !== undefined) {
      const targetNodeId = args.nodeId || nodeId;
      if (targetNodeId) {
        await recordFeedbackSignal(targetNodeId, args.rating > 0);
      }
    }
  }, "taste");

  // ── onNodeNavigate: implicit preference from visit frequency ───────
  core.hooks.register("onNodeNavigate", async ({ nodeId }) => {
    try {
      await core.metadata.incExtMeta(nodeId, "taste", "visitCount", 1);
    } catch {}
  }, "taste");

  // ── enrichContext: inject learned taste into AI context ─────────────
  core.hooks.register("enrichContext", async ({ context, node }) => {
    const taste = node.metadata instanceof Map
      ? node.metadata.get("taste")
      : node.metadata?.taste;

    if (!taste?.learned) return;

    context.taste = {
      preference: taste.learned,
      score: taste.score,
      tags: taste.tags,
    };
  }, "taste");

  // ── breath:exhale: synthesize accumulated signals ──────────────────
  core.hooks.register("breath:exhale", async ({ rootId }) => {
    await synthesize(rootId);
  }, "taste");

  log.info("Taste", "Loaded. The tree learns what you like.");
  return {};
}
