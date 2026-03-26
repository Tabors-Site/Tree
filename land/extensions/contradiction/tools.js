import { z } from "zod";
import { getContradictions, resolveContradiction, scanTree, detectContradictions, writeContradictions, cascadeContradictions } from "./core.js";

export default [
  {
    name: "node-contradictions",
    description: "Show active contradictions at a node. Surfaces conflicts between this node's content and the broader tree.",
    schema: {
      nodeId: z.string().describe("The node to check."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ nodeId }) => {
      try {
        const all = await getContradictions(nodeId);
        const active = all.filter((c) => c.status === "active");
        if (active.length === 0) {
          return { content: [{ type: "text", text: "No active contradictions at this node." }] };
        }
        return { content: [{ type: "text", text: JSON.stringify({ active: active.length, contradictions: active }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "resolve-contradiction",
    description: "Mark a contradiction as intentionally resolved. The user has decided this conflict is acceptable or has been addressed.",
    schema: {
      nodeId: z.string().describe("The node with the contradiction."),
      contradictionId: z.string().describe("The contradiction ID to resolve."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ nodeId, contradictionId }) => {
      try {
        const entry = await resolveContradiction(nodeId, contradictionId);
        return { content: [{ type: "text", text: `Contradiction resolved: "${entry.claim}" vs "${entry.conflictsWith}"` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "scan-contradictions",
    description: "Force a full-tree contradiction scan. Checks the most recent note on every active node against its context. Token-intensive for large trees. Returns a cost estimate before scanning.",
    schema: {
      rootId: z.string().describe("The tree root to scan."),
      confirm: z.boolean().optional().default(false).describe("Set to true to actually run the scan. Without it, returns only the cost estimate."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: async ({ rootId, confirm, userId }) => {
      try {
        // Estimate cost before scanning
        const { getDescendantIds } = await import("../../seed/tree/treeFetch.js");
        const nodeIds = await getDescendantIds(rootId);
        const { getContradictionConfig } = await import("./core.js");
        const config = await getContradictionConfig();
        const estimatedCalls = nodeIds.length;
        const estimatedTokens = estimatedCalls * Math.round(config.maxContextChars * 0.3); // rough: ~0.3 tokens per char

        if (!confirm) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                warning: "Full tree scan is token-intensive. Review the estimate and call again with confirm: true to proceed.",
                nodes: nodeIds.length,
                estimatedLLMCalls: estimatedCalls,
                estimatedTokens,
                estimatedContextPerCall: `~${config.maxContextChars} chars`,
              }, null, 2),
            }],
          };
        }

        let username = null;
        try {
          const User = (await import("../../seed/models/user.js")).default;
          const user = await User.findById(userId).select("username").lean();
          username = user?.username;
        } catch {}
        const result = await scanTree(rootId, userId, username);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Scan failed: ${err.message}` }] };
      }
    },
  },
];
