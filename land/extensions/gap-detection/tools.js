import { z } from "zod";
import { getGaps, clearGaps } from "./core.js";

export default [
  {
    name: "node-gaps",
    description:
      "Show extension gaps detected at a node. Lists extension namespaces that appeared in cascade signals but are not installed on this land.",
    schema: {
      nodeId: z.string().describe("The node to check."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async ({ nodeId }) => {
      try {
        const gaps = await getGaps(nodeId);
        if (gaps.length === 0) {
          return { content: [{ type: "text", text: "No extension gaps detected at this node." }] };
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              nodeId,
              gapCount: gaps.length,
              gaps: gaps.sort((a, b) => b.count - a.count),
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "clear-node-gaps",
    description: "Clear gap records for a node. Use after installing the missing extension.",
    schema: {
      nodeId: z.string().describe("The node to clear."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async ({ nodeId }) => {
      try {
        await clearGaps(nodeId);
        return { content: [{ type: "text", text: `Gap records cleared on ${nodeId}.` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
];
