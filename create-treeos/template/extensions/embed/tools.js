import { z } from "zod";
import { findRelatedAtNode, getEmbedStatus, rebuildEmbeddings } from "./core.js";

export default [
  {
    name: "related-notes",
    description:
      "Find notes semantically similar to the content at this node. Scoped to the local neighborhood (parent subtree plus sibling branches) by default. Pass searchAll for land-wide.",
    schema: {
      nodeId: z.string().describe("The node to find related content for."),
      rootId: z.string().optional().describe("Tree root to search within. Auto-resolved if omitted."),
      searchAll: z.boolean().optional().default(false).describe("Search entire tree instead of scoped neighborhood."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ nodeId, rootId, searchAll, userId }) => {
      try {
        const results = await findRelatedAtNode(nodeId, userId, rootId, searchAll);
        if (results.length === 0) {
          return { content: [{ type: "text", text: "No semantically related notes found. Either no notes are embedded yet, or nothing passes the similarity threshold." }] };
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              query: nodeId,
              relatedCount: results.length,
              results: results.map((r) => ({
                nodeName: r.nodeName,
                nodeId: r.nodeId,
                similarity: r.similarity,
                snippet: r.snippet,
              })),
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Search failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "embed-status",
    description: "Show embedding coverage. How many notes have vectors, what percentage of the total.",
    schema: {
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async () => {
      try {
        const status = await getEmbedStatus();
        return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Status failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "embed-rebuild",
    description: "Re-embed all text notes. Use after changing the embedding model. Token-intensive.",
    schema: {
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: async ({ userId }) => {
      try {
        const result = await rebuildEmbeddings(userId);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Rebuild failed: ${err.message}` }] };
      }
    },
  },
];
