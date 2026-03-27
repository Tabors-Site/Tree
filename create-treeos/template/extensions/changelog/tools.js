import { z } from "zod";
import { getChangelog, summarizeChangelog } from "./core.js";

export default [
  {
    name: "changelog-get",
    description:
      "Show what changed in this branch. Reads the contribution audit trail and " +
      "constructs a narrative: new work, completed work, stalled areas, autonomous " +
      "activity from intent and dreams.",
    schema: {
      nodeId: z.string().describe("The node to get changelog for (scoped to subtree)."),
      since: z.string().optional().default("24h").describe("Time window: 24h, 7d, 2w, 30d, or ISO date."),
      land: z.boolean().optional().default(false).describe("Scope to entire land instead of subtree."),
      userId: z.string().describe("Injected by server. Ignore."),
      username: z.string().optional().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ nodeId, since, land, userId, username }) => {
      try {
        const { contributions } = await getChangelog(nodeId, { since, land });

        if (contributions.length === 0) {
          return { content: [{ type: "text", text: `No changes since ${since}.` }] };
        }

        const narrative = await summarizeChangelog(nodeId, contributions, userId, username || "system", { since });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              summary: narrative.summary,
              new: narrative.new,
              active: narrative.active,
              completed: narrative.completed,
              stalled: narrative.stalled,
              autonomous: narrative.autonomous,
              contributors: narrative.contributors,
              totalContributions: contributions.length,
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Changelog failed: ${err.message}` }] };
      }
    },
  },
];
