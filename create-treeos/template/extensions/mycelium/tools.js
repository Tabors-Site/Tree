import { z } from "zod";
import { getMyceliumStatus, getRoutingLog } from "./core.js";

export default [
  {
    name: "mycelium-status",
    description: "Mycelium routing status. Connected peers, signals routed, routing mode, buffer size.",
    schema: {
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async () => {
      try {
        const status = await getMyceliumStatus();
        return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "mycelium-routes",
    description: "Recent routing decisions. Which signals went where and why.",
    schema: {
      limit: z.number().optional().default(20).describe("Max decisions to show."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ limit }) => {
      try {
        const decisions = await getRoutingLog(limit || 20);
        if (decisions.length === 0) {
          return { content: [{ type: "text", text: "No routing decisions yet." }] };
        }
        return { content: [{ type: "text", text: JSON.stringify({ count: decisions.length, decisions }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
];
