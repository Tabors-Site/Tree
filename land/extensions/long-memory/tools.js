import { z } from "zod";
import { getMemory, clearMemory } from "./core.js";

export default [
  {
    name: "node-memory",
    description:
      "Get the long-term memory trace for a node. Shows when it last heard from another node, how many interactions total, and the rolling connection history.",
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
        const memory = await getMemory(nodeId);
        if (!memory) {
          return { content: [{ type: "text", text: "No memory traces on this node. It has not received any cascade signals." }] };
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              lastSeen: memory.lastSeen,
              lastStatus: memory.lastStatus,
              lastSourceId: memory.lastSourceId,
              totalInteractions: memory.totalInteractions || 0,
              recentConnections: (memory.connections || []).length,
              connections: memory.connections || [],
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "clear-node-memory",
    description: "Clear the long-term memory trace for a node. The node forgets all cascade history.",
    schema: {
      nodeId: z.string().describe("The node to clear."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async ({ nodeId }) => {
      try {
        await clearMemory(nodeId);
        return { content: [{ type: "text", text: `Memory cleared on ${nodeId}.` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
];
