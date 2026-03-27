import { z } from "zod";
import { analyze, preview, execute, getHistory } from "./core.js";

export default [
  {
    name: "split-analyze",
    description:
      "Analyze all branches of the current tree to find split candidates. Scores each " +
      "branch on activity, boundary cohesion, purpose coherence, persona divergence, " +
      "codebook isolation, and cascade containment.",
    schema: {
      rootId: z.string().describe("Tree root to analyze."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async ({ rootId, userId }) => {
      try {
        const result = await analyze(rootId, userId);
        const summary = {
          rootName: result.rootName,
          branchesAnalyzed: result.branches.length,
          topCandidate: result.topCandidate ? {
            name: result.topCandidate.branchName,
            score: result.topCandidate.averageScore,
            nodeCount: result.topCandidate.nodeCount,
            recommendation: result.topCandidate.recommendation,
          } : null,
          allBranches: result.branches.map(b => ({
            name: b.branchName,
            score: b.averageScore,
            nodeCount: b.nodeCount,
            recommendation: b.recommendation,
          })),
        };
        return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Analysis failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "split-preview",
    description:
      "Preview what would happen if a specific branch splits into its own tree. " +
      "Shows node count, metadata carried, and connections created.",
    schema: {
      nodeId: z.string().describe("Branch node to preview splitting."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ nodeId, userId }) => {
      try {
        const result = await preview(nodeId, userId);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Preview failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "split-execute",
    description:
      "Execute a branch split. The branch becomes its own root tree. All nodes and " +
      "metadata move with it. A channel is created back to the parent.",
    schema: {
      nodeId: z.string().describe("Branch node to split into a new tree."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: async ({ nodeId, userId }) => {
      try {
        const User = (await import("../../seed/models/user.js")).default;
        const user = await User.findById(userId).select("username").lean();
        const result = await execute(nodeId, userId, user?.username || "system");
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Split failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "split-history",
    description: "Show past splits from this tree.",
    schema: {
      rootId: z.string().describe("Tree root to check."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ rootId }) => {
      try {
        const result = await getHistory(rootId);
        if (result.history.length === 0) {
          return { content: [{ type: "text", text: "No splits have occurred from this tree." }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
];
