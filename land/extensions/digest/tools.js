import { z } from "zod";
import { getLatestDigest, getDigestHistory, generateDigest } from "./core.js";

export default [
  {
    name: "digest-show",
    description:
      "Show today's daily briefing. What happened overnight, what needs attention, " +
      "what the tree did on its own, what's healthy, what's drifting.",
    schema: {
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async () => {
      try {
        let digest = await getLatestDigest();
        if (!digest) {
          // Generate on demand if none exists
          digest = await generateDigest();
        }
        if (!digest) {
          return { content: [{ type: "text", text: "No digest available." }] };
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              date: digest.date,
              summary: digest.summary,
              overnight: digest.overnight,
              needsAttention: digest.needsAttention,
              healthy: digest.healthy,
              drifting: digest.drifting,
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Digest failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "digest-history",
    description: "Past daily briefings.",
    schema: {
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async () => {
      try {
        const history = await getDigestHistory();
        if (history.length === 0) {
          return { content: [{ type: "text", text: "No digest history." }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(history, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
];
