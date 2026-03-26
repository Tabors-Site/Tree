import { z } from "zod";
import { analyze, analyzeBranch, getBoundaryReport } from "./core.js";

export default [
  {
    name: "boundary-analyze",
    description:
      "Run structural cohesion analysis on the entire tree. Finds blurred boundaries " +
      "between overlapping branches, fragmented concepts spread across multiple branches, " +
      "and orphaned nodes that don't belong where they are. Results stored on root metadata.",
    schema: {
      rootId: z.string().describe("Tree root to analyze."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async ({ rootId, userId }) => {
      try {
        const User = (await import("../../seed/models/user.js")).default;
        const user = await User.findById(userId).select("username").lean();
        const result = await analyze(rootId, userId, user?.username || "system");
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              overallCoherence: result.overallCoherence,
              branchCount: result.branchCount,
              nodeCount: result.nodeCount,
              findingsCount: result.findings.length,
              usedEmbeddings: result.usedEmbeddings,
              degraded: result.degraded || [],
              findings: result.findings,
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Analysis failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "boundary-branch",
    description:
      "Run cohesion analysis on a subtree from the current node down. " +
      "Lighter than full tree analysis. Good for checking a reorganized branch.",
    schema: {
      nodeId: z.string().describe("Node to analyze from (subtree root)."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async ({ nodeId, userId }) => {
      try {
        const User = (await import("../../seed/models/user.js")).default;
        const user = await User.findById(userId).select("username").lean();
        const result = await analyzeBranch(nodeId, userId, user?.username || "system");
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              overallCoherence: result.overallCoherence,
              branchCount: result.branchCount,
              findingsCount: result.findings.length,
              usedEmbeddings: result.usedEmbeddings,
              degraded: result.degraded || [],
              findings: result.findings,
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Branch analysis failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "boundary-status",
    description: "Show the last boundary analysis results. No LLM calls. Read-only.",
    schema: {
      rootId: z.string().describe("Tree root to check."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ rootId }) => {
      try {
        const report = await getBoundaryReport(rootId);
        if (!report || !report.lastAnalysis) {
          return {
            content: [{
              type: "text",
              text: "No boundary analysis has been run on this tree yet. Use boundary-analyze to run one.",
            }],
          };
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              lastAnalysis: report.lastAnalysis,
              stale: !!report.stale,
              overallCoherence: report.overallCoherence,
              branchCount: report.branchCount,
              nodeCount: report.nodeCount,
              usedEmbeddings: report.usedEmbeddings,
              degraded: report.degraded || [],
              findings: report.findings,
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Status check failed: ${err.message}` }] };
      }
    },
  },
];
