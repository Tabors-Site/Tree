import { z } from "zod";
import { getCompetence } from "./core.js";

export default [
  {
    name: "competence-status",
    description:
      "Knowledge boundaries at this position. Shows what topics the tree can help " +
      "with and what it has no data on. Based on accumulated query history.",
    schema: {
      nodeId: z.string().describe("The node to check competence for."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ nodeId }) => {
      try {
        const comp = await getCompetence(nodeId);
        if (!comp || comp.totalQueries === 0) {
          return { content: [{ type: "text", text: "No competence data yet. The tree needs more queries to map its knowledge boundaries." }] };
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              totalQueries: comp.totalQueries,
              answered: comp.answered,
              unanswered: comp.unanswered,
              answerRate: `${(comp.answerRate * 100).toFixed(0)}%`,
              canHelpWith: comp.strongTopics,
              noDataOn: comp.weakTopics,
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
];
