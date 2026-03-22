import { z } from "zod";
import { addPrestige } from "./core.js";

export default [
  {
    name: "add-node-prestige",
    description:
      "Calls addPrestige() to increment a node's prestige level and create a new version.",
    schema: {
      nodeId: z
        .string()
        .describe("The unique ID of the node to add prestige to."),
      userId: z.string().describe("Injected by server. Ignore."),
      aiChatId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
      sessionId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async ({ nodeId, userId, aiChatId, sessionId }) => {
      try {
        const result = await addPrestige({
          nodeId,
          userId,
          wasAi: true,
          aiChatId,
          sessionId,
        });

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `Failed to add prestige: ${err.message}` },
          ],
        };
      }
    },
  },
];
