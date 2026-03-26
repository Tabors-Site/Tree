import { z } from "zod";
import { getProfile, addCorrection, resetProfile, compress } from "./core.js";

export default [
  {
    name: "inverse-profile",
    description: "Show the user's profile as the AI sees it. The inverse tree: values, knowledge, habits, communication style, unresolved questions, recurring frustrations, goals vs actions.",
    schema: {
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ userId }) => {
      try {
        const data = await getProfile(userId);
        if (!data || Object.keys(data.profile).length === 0) {
          return { content: [{ type: "text", text: "No inverse profile yet. It builds after enough interactions." }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "inverse-correct",
    description: "Manually correct the AI's model of you. These corrections are ground truth and override inferences. Example: \"I actually prefer direct feedback\" or \"I work nights by choice not insomnia\"",
    schema: {
      text: z.string().describe("The correction to record."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: async ({ text, userId }) => {
      try {
        const corrections = await addCorrection(userId, text);
        return { content: [{ type: "text", text: `Correction recorded (${corrections.length} total). Will be applied on next compression pass.` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "inverse-compress",
    description: "Force a compression pass on your inverse profile. Normally happens automatically every 50 interactions.",
    schema: {
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: async ({ userId }) => {
      try {
        const result = await compress(userId);
        if (!result) return { content: [{ type: "text", text: "Compression skipped. Not enough signals yet." }] };
        return { content: [{ type: "text", text: JSON.stringify({ message: "Profile updated", categories: Object.keys(result) }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Compression failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "inverse-reset",
    description: "Wipe the AI's model of you. Start fresh. The profile, signals, stats, and corrections are all cleared.",
    schema: {
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    handler: async ({ userId }) => {
      try {
        await resetProfile(userId);
        return { content: [{ type: "text", text: "Inverse profile reset. Starting fresh." }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
];
