import { z } from "zod";
import Node from "../../seed/models/node.js";
import { getReviewConfig, getReviewHistory } from "./core.js";

let _metadata = null;
export function setMetadata(metadata) { _metadata = metadata; }

export default [
  {
    name: "peer-review-set-partner",
    description:
      "Set a review partner for a node. When a note is written at this node, the content " +
      "is sent to the partner node for AI review. The partner's AI reviews against its own " +
      "context and returns structured feedback.",
    schema: {
      nodeId: z.string().describe("The node to configure review for."),
      partnerId: z.string().describe("The node that will review this node's work."),
      maxRounds: z.number().optional().describe("Max consensus loop rounds. Default 5."),
      autoApply: z.boolean().optional().describe("Automatically revise based on feedback. Default false."),
      reviewPrompt: z.string().nullable().optional().describe("Custom review instructions. Null for default."),
      userId: z.string().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ nodeId, partnerId, maxRounds, autoApply, reviewPrompt }) => {
      const node = await Node.findById(nodeId);
      if (!node) return { content: [{ type: "text", text: "Node not found." }] };
      if (node.systemRole) return { content: [{ type: "text", text: "Cannot set review on system nodes." }] };

      const partner = await Node.findById(partnerId).select("name systemRole").lean();
      if (!partner) return { content: [{ type: "text", text: "Partner node not found." }] };
      if (partner.systemRole) return { content: [{ type: "text", text: "Cannot use system node as reviewer." }] };
      if (partnerId === nodeId) return { content: [{ type: "text", text: "A node cannot review itself." }] };

      const existing = getReviewConfig(node);
      const config = {
        ...existing,
        partner: partnerId,
        trigger: "afterNote",
        status: existing.status === "paused" ? "paused" : "idle",
      };
      if (maxRounds !== undefined) config.maxRounds = Math.max(1, Math.min(maxRounds, 20));
      if (autoApply !== undefined) config.autoApply = autoApply;
      if (reviewPrompt !== undefined) config.reviewPrompt = reviewPrompt;

      await _metadata.setExtMeta(node, "peer-review", config);

      return {
        content: [{
          type: "text",
          text: `Review partner set to "${partner.name}" (${partnerId}). Notes written here will be reviewed by the AI at that position.` +
            (config.autoApply ? " Auto-apply is ON. Revisions will loop until consensus." : " Feedback will be surfaced to the user."),
        }],
      };
    },
  },

  {
    name: "peer-review-status",
    description: "Show the current peer review configuration and status at a node.",
    schema: {
      nodeId: z.string().describe("The node to check."),
      userId: z.string().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ nodeId }) => {
      const node = await Node.findById(nodeId).select("metadata").lean();
      if (!node) return { content: [{ type: "text", text: "Node not found." }] };

      const config = getReviewConfig(node);
      if (!config.partner) {
        return { content: [{ type: "text", text: "No review partner configured at this node." }] };
      }

      let partnerName = config.partner;
      try {
        const p = await Node.findById(config.partner).select("name").lean();
        if (p?.name) partnerName = `${p.name} (${config.partner})`;
      } catch {}

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            partner: partnerName,
            status: config.status,
            maxRounds: config.maxRounds,
            autoApply: config.autoApply,
            reviewPrompt: config.reviewPrompt || "(default)",
            reviewsCompleted: (config.history || []).filter((h) => h.completedAt).length,
            currentReviewId: config.currentReviewId || null,
          }, null, 2),
        }],
      };
    },
  },

  {
    name: "peer-review-history",
    description: "Show past review sessions at a node. Each session includes rounds, verdicts, and summaries.",
    schema: {
      nodeId: z.string().describe("The node to check."),
      limit: z.number().optional().describe("Number of recent sessions. Default 5."),
      userId: z.string().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ nodeId, limit }) => {
      const node = await Node.findById(nodeId).select("metadata").lean();
      if (!node) return { content: [{ type: "text", text: "Node not found." }] };

      const history = getReviewHistory(node, limit || 5);
      if (history.length === 0) {
        return { content: [{ type: "text", text: "No review history at this node." }] };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(history, null, 2) }],
      };
    },
  },

  {
    name: "peer-review-clear",
    description: "Remove review configuration from a node. Stops all future reviews.",
    schema: {
      nodeId: z.string().describe("The node to clear review from."),
      userId: z.string().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    handler: async ({ nodeId }) => {
      const node = await Node.findById(nodeId);
      if (!node) return { content: [{ type: "text", text: "Node not found." }] };

      await _metadata.setExtMeta(node, "peer-review", null);
      return { content: [{ type: "text", text: "Review configuration removed." }] };
    },
  },

  {
    name: "peer-review-pause",
    description: "Pause automatic reviews at a node. Keeps configuration. Resume later.",
    schema: {
      nodeId: z.string().describe("The node to pause reviews on."),
      userId: z.string().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ nodeId }) => {
      const node = await Node.findById(nodeId);
      if (!node) return { content: [{ type: "text", text: "Node not found." }] };

      const config = getReviewConfig(node);
      if (!config.partner) return { content: [{ type: "text", text: "No review partner configured." }] };

      await _metadata.setExtMeta(node, "peer-review", { ...config, status: "paused" });
      return { content: [{ type: "text", text: "Reviews paused. Notes will not trigger review until resumed." }] };
    },
  },

  {
    name: "peer-review-resume",
    description: "Resume automatic reviews at a node after pausing.",
    schema: {
      nodeId: z.string().describe("The node to resume reviews on."),
      userId: z.string().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ nodeId }) => {
      const node = await Node.findById(nodeId);
      if (!node) return { content: [{ type: "text", text: "Node not found." }] };

      const config = getReviewConfig(node);
      if (!config.partner) return { content: [{ type: "text", text: "No review partner configured." }] };

      await _metadata.setExtMeta(node, "peer-review", { ...config, status: "idle" });
      return { content: [{ type: "text", text: "Reviews resumed. Next note write will trigger review." }] };
    },
  },
];
