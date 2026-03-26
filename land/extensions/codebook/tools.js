import { z } from "zod";
import { getCodebook, clearCodebook, runCompression } from "./core.js";

export default [
  {
    name: "get-codebook",
    description:
      "Get the codebook dictionary for a user at a node. Shows the compressed language, shorthand, and recurring concepts that have emerged from their interaction history.",
    schema: {
      nodeId: z.string().describe("The node to check."),
      targetUserId: z.string().optional().describe("User ID to check. Defaults to the current user."),
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
    handler: async ({ nodeId, targetUserId, userId }) => {
      try {
        const uid = targetUserId || userId;
        const codebook = await getCodebook(nodeId, uid);
        if (!codebook || !codebook.dictionary) {
          return { content: [{ type: "text", text: "No codebook exists for this user at this node yet. It builds after enough conversations." }] };
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              nodeId,
              userId: uid,
              lastCompressed: codebook.lastCompressed,
              notesSinceCompression: codebook.notesSinceCompression || 0,
              entries: Object.keys(codebook.dictionary).length,
              dictionary: codebook.dictionary,
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "compress-codebook",
    description:
      "Force a compression pass for a user at a node. Analyzes recent conversation history and updates the codebook dictionary. Normally this happens automatically after enough notes accumulate.",
    schema: {
      nodeId: z.string().describe("The node to compress."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async ({ nodeId, userId }) => {
      try {
        const result = await runCompression(nodeId, userId, null);
        if (!result) {
          return { content: [{ type: "text", text: "Compression skipped. Not enough conversation history at this node." }] };
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              message: "Codebook updated",
              entries: Object.keys(result).length,
              dictionary: result,
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Compression failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "clear-codebook",
    description: "Clear the codebook dictionary for a user at a node. The relationship starts fresh.",
    schema: {
      nodeId: z.string().describe("The node to clear."),
      targetUserId: z.string().optional().describe("User ID to clear. Defaults to the current user."),
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
    handler: async ({ nodeId, targetUserId, userId }) => {
      try {
        const uid = targetUserId || userId;
        await clearCodebook(nodeId, uid);
        return { content: [{ type: "text", text: `Codebook cleared for user ${uid} at node ${nodeId}.` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
];
