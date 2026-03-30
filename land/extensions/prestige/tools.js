import { z } from "zod";
import { addPrestige, resolveVersion } from "./core.js";
import { createNote } from "../../seed/tree/notes.js";

export default [
  {
    name: "create-node-version-note",
    description:
      "Create a text note tagged with the node's current prestige version. Use this instead of create-node-note when version tracking matters.",
    schema: {
      content: z.string().describe("The text content of the note."),
      nodeId: z.string().describe("The ID of the node the note belongs to."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    handler: async ({ content, nodeId, userId, chatId, sessionId }) => {
      try {
        const version = await resolveVersion(nodeId, "latest");
        const result = await createNote({
          contentType: "text",
          content,
          userId,
          nodeId,
          wasAi: true,
          chatId,
          sessionId,
          metadata: {
            treeos: { isReflection: true },
            prestige: { version: version || 0 },
          },
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed to create versioned note: ${err.message}` }] };
      }
    },
  },
  {
    name: "add-node-prestige",
    description:
      "Calls addPrestige() to increment a node's prestige level and create a new version.",
    schema: {
      nodeId: z
        .string()
        .describe("The unique ID of the node to add prestige to."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z
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
    handler: async ({ nodeId, userId, chatId, sessionId }) => {
      try {
        const result = await addPrestige({
          nodeId,
          userId,
          wasAi: true,
          chatId,
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
