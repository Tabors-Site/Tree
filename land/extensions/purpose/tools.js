import { z } from "zod";
import { getThesis, deriveThesis, checkCoherence } from "./core.js";

export default [
  {
    name: "tree-thesis",
    description: "Show this tree's root thesis and coherence stats. The one sentence everything in this tree should serve.",
    schema: {
      rootId: z.string().describe("The tree root."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ rootId }) => {
      try {
        const data = await getThesis(rootId);
        if (!data || !data.thesis) {
          return { content: [{ type: "text", text: "No thesis derived yet. Write some notes at the root and the thesis will emerge." }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "rederive-thesis",
    description: "Force re-derivation of the thesis from the current tree state. The thesis evolves but always connects to the root.",
    schema: {
      rootId: z.string().describe("The tree root."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: async ({ rootId, userId }) => {
      try {
        const thesis = await deriveThesis(rootId, userId);
        if (!thesis) return { content: [{ type: "text", text: "Could not derive thesis. Check that notes exist at the root." }] };
        return { content: [{ type: "text", text: `Thesis: ${thesis}` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "check-coherence",
    description: "Check how well specific text serves this tree's thesis. Returns a score 0 to 1.",
    schema: {
      rootId: z.string().describe("The tree root."),
      text: z.string().describe("The text to check against the thesis."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async ({ rootId, text, userId }) => {
      try {
        const result = await checkCoherence(text, rootId, userId);
        if (!result) return { content: [{ type: "text", text: "No thesis available. Derive one first." }] };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
];
