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
      beingId: z.string().describe("Injected by server. Ignore."),
      summonId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async ({ rootId, beingId }) => {
      try {
        const Being = (await import("../../seed/models/being.js")).default;
        const user = await Being.findById(beingId).select("username").lean();
        const result = await analyze(rootId, beingId, user?.username || "system");
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
      beingId: z.string().describe("Injected by server. Ignore."),
      summonId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async ({ nodeId, beingId }) => {
      try {
        const Being = (await import("../../seed/models/being.js")).default;
        const user = await Being.findById(beingId).select("username").lean();
        const result = await analyzeBranch(nodeId, beingId, user?.username || "system");
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
      beingId: z.string().describe("Injected by server. Ignore."),
      summonId: z.string().nullable().optional().describe("Injected by server. Ignore."),
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
