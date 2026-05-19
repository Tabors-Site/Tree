import { z } from "zod";
import { extractLessons, getLessons, dismissLesson } from "./core.js";

export default [
  {
    name: "teach-export",
    description:
      "Extract wisdom from this tree's intelligence extensions into a transferable " +
      "lesson set. Reads evolution, prune, purpose, codebook, boundary, and other " +
      "installed intelligence data, then distills actionable insights.",
    schema: {
      rootId: z.string().describe("Tree root to extract lessons from."),
      beingId: z.string().describe("Injected by server. Ignore."),
      summonId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: async ({ rootId, beingId }) => {
      try {
        const Being = (await import("../../seed/models/being.js")).default;
        const user = await Being.findById(beingId).select("username").lean();
        const lessonSet = await extractLessons(rootId, beingId, user?.username || "system");
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              source: lessonSet.source,
              lessonCount: lessonSet.lessons.length,
              extensionsQueried: lessonSet.extensionsQueried,
              lessons: lessonSet.lessons.map(l => ({
                from: l.from,
                insight: l.insight,
                confidence: l.confidence,
              })),
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Extraction failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "teach-lessons",
    description: "Show active lessons at this tree. Read-only, no LLM calls.",
    schema: {
      rootId: z.string().describe("Tree root to check."),
      beingId: z.string().describe("Injected by server. Ignore."),
      summonId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ rootId }) => {
      try {
        const result = await getLessons(rootId);
        if (result.totalActive === 0) {
          return { content: [{ type: "text", text: "No active lessons at this tree. Use teach-export to extract lessons, or import them from another tree." }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "teach-dismiss",
    description: "Dismiss a lesson that does not apply to this tree.",
    schema: {
      rootId: z.string().describe("Tree root."),
      lessonId: z.string().describe("ID of the lesson to dismiss."),
      beingId: z.string().describe("Injected by server. Ignore."),
      summonId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ rootId, lessonId, beingId }) => {
      try {
        const result = await dismissLesson(rootId, lessonId, beingId);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
];
