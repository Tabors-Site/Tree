import { z } from "zod";
import { runTrace, getTraceMap } from "./core.js";

export default [
  {
    name: "trace-query",
    description:
      "Follow one concept through the entire tree chronologically. Finds every note " +
      "that references the concept across all branches, ordered by time. Shows where " +
      "it started, how it evolved, and what's unresolved.",
    schema: {
      nodeId: z.string().describe("The tree root or starting node."),
      query: z.string().describe("The concept to trace."),
      since: z.string().optional().describe("Time filter: ISO date or relative (7d, 30d)."),
      userId: z.string().describe("Injected by server. Ignore."),
      username: z.string().optional().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: async ({ nodeId, query, since, userId, username }) => {
      try {
        const result = await runTrace(nodeId, query, userId, username || "system", { since });
        if (result.error) {
          return { content: [{ type: "text", text: result.error }] };
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              query: result.query,
              matches: result.matches,
              nodesVisited: result.nodesVisited,
              origin: result.origin,
              touchpoints: result.touchpoints,
              currentState: result.currentState,
              unresolved: result.unresolved,
              threadLength: result.threadLength,
              crossBranch: result.crossBranch,
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Trace failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "trace-map",
    description: "Show the last trace run at this position. The thread map without re-tracing.",
    schema: {
      nodeId: z.string().describe("The node to check."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ nodeId }) => {
      try {
        const map = await getTraceMap(nodeId);
        if (!map) return { content: [{ type: "text", text: "No trace map at this position. Run trace-query first." }] };
        return { content: [{ type: "text", text: JSON.stringify(map, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
];
