import { z } from "zod";
import { resolveRootNode } from "../../seed/tree/treeFetch.js";
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
        // Walk up to tree root so strategies search the whole tree
        const rootNode = await resolveRootNode(nodeId);
        const rootId = String(rootNode._id);

        const result = await runScout(nodeId, query, userId, username || "system", { rootId });
        if (result.error) {
          return { content: [{ type: "text", text: result.error }] };
        }

        // Return human-readable answer as primary content, structured data as context
        const parts = [result.answer];
        if (result.citations?.length > 0) {
          parts.push(`\nCitations: ${result.citations.map(c => typeof c === "string" ? c : c.nodeName || c.nodeId).join(", ")}`);
        }
        if (result.gaps?.length > 0) {
          parts.push(`\nGaps: ${result.gaps.join("; ")}`);
        }
        parts.push(`\n(${result.findings.length} findings from ${result.strategiesUsed.length} strategies, confidence: ${result.confidence})`);

        return {
          content: [{ type: "text", text: parts.join("") }],
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
