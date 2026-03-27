import { z } from "zod";
import { runScout, getScoutHistory, getScoutGaps } from "./core.js";

export default [
  {
    name: "scout-query",
    description:
      "Triangulate across the tree to answer a question. Runs five parallel search strategies " +
      "(semantic, structural, memory, codebook, profile), scores by convergence, and synthesizes " +
      "an answer with citations. Returns what the tree knows and what it doesn't.",
    schema: {
      nodeId: z.string().describe("The node to scout from."),
      query: z.string().describe("What to find. Natural language."),
      userId: z.string().describe("Injected by server. Ignore."),
      username: z.string().optional().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: async ({ nodeId, query, userId, username }) => {
      try {
        const result = await runScout(nodeId, query, userId, username || "system", {});
        if (result.error) {
          return { content: [{ type: "text", text: result.error }] };
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              synthesis: result.synthesis,
              confidence: result.confidence,
              strategiesUsed: result.strategiesUsed,
              strategiesSkipped: result.strategiesSkipped,
              findingsCount: result.findings.length,
              citations: result.citations,
              gaps: result.gaps,
              angles: result.angles,
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Scout failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "scout-history",
    description: "Previous scout runs at this position. Shows what was searched and what was found.",
    schema: {
      nodeId: z.string().describe("The node to check."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ nodeId }) => {
      try {
        const history = await getScoutHistory(nodeId);
        if (history.length === 0) {
          return { content: [{ type: "text", text: "No scout history at this position." }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(history, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "scout-gaps",
    description: "Accumulated knowledge gaps from all scout runs at this position. What the tree doesn't know.",
    schema: {
      nodeId: z.string().describe("The node to check."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ nodeId }) => {
      try {
        const gaps = await getScoutGaps(nodeId);
        if (gaps.length === 0) {
          return { content: [{ type: "text", text: "No knowledge gaps recorded at this position." }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(gaps, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
];
