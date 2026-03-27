import { z } from "zod";
import { getSuggestions, dismissSuggestion, acceptSuggestion } from "./core.js";

export default [
  {
    name: "delegate-list",
    description:
      "Show pending delegate suggestions for this tree. Who should look at what.",
    schema: {
      nodeId: z.string().describe("The tree root ID."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ nodeId, userId }) => {
      try {
        const suggestions = await getSuggestions(nodeId, null);
        if (suggestions.length === 0) {
          return { content: [{ type: "text", text: "No pending delegate suggestions." }] };
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify(suggestions.map(s => ({
              id: s.id,
              nodeName: s.nodeName,
              daysSilent: s.daysSilent,
              suggestedUser: s.suggestedUsername,
              score: s.score,
              reasons: s.reasons,
            })), null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "delegate-dismiss",
    description: "Dismiss a delegate suggestion. Not my problem.",
    schema: {
      nodeId: z.string().describe("The tree root ID."),
      suggestionId: z.string().describe("The suggestion ID to dismiss."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ nodeId, suggestionId, userId }) => {
      try {
        const result = await dismissSuggestion(nodeId, suggestionId, userId);
        if (!result) return { content: [{ type: "text", text: "Suggestion not found." }] };
        return { content: [{ type: "text", text: `Dismissed: ${result.nodeName}` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "delegate-accept",
    description: "Accept a delegate suggestion. I'll look at it.",
    schema: {
      nodeId: z.string().describe("The tree root ID."),
      suggestionId: z.string().describe("The suggestion ID to accept."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ nodeId, suggestionId, userId }) => {
      try {
        const result = await acceptSuggestion(nodeId, suggestionId, userId);
        if (!result) return { content: [{ type: "text", text: "Suggestion not found." }] };
        return { content: [{ type: "text", text: `Accepted: ${result.nodeName}. Navigate there to start.` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
];
