import { z } from "zod";
import {
  scanTree,
  getCachedTimeline,
  getWeekTimeline,
  calculateReliability,
} from "./core.js";
import { getExtMeta } from "../../seed/tree/extensionMetadata.js";
import Node from "../../seed/models/node.js";

export default [
  {
    name: "schedule-timeline",
    description:
      "Get the schedule timeline for the current tree. Shows due, upcoming, and overdue items. " +
      "Use this to check what's happening today or this week.",
    schema: {
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      rootId: z.string().describe("The tree root to check."),
      window: z
        .enum(["day", "week"])
        .optional()
        .describe("Time window. 'day' (default) shows 24h lookahead. 'week' shows 7 days."),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async ({ rootId, window: timeWindow }) => {
      try {
        if (timeWindow === "week") {
          const items = await getWeekTimeline(rootId);
          if (!items || items.length === 0) {
            return { content: [{ type: "text", text: "No scheduled items this week." }] };
          }
          return {
            content: [{ type: "text", text: JSON.stringify({ week: items }, null, 2) }],
          };
        }

        // Default: day view (use cached or fresh scan)
        let timeline = getCachedTimeline(rootId);
        if (!timeline) {
          timeline = await scanTree(rootId);
        }
        if (!timeline) {
          return { content: [{ type: "text", text: "No scheduled items found." }] };
        }

        const { due, upcoming, overdue } = timeline;
        if (!due.length && !upcoming.length && !overdue.length) {
          return { content: [{ type: "text", text: "Nothing due, upcoming, or overdue right now." }] };
        }

        return {
          content: [{ type: "text", text: JSON.stringify({ due, upcoming, overdue }, null, 2) }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },

  {
    name: "schedule-reliability",
    description:
      "Get completion patterns for a scheduled node. Shows average timing, on-time rate, " +
      "streak, and recent completions. Use this to understand how consistent someone is " +
      "with a recurring item.",
    schema: {
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      nodeId: z.string().describe("The node to check reliability for."),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async ({ nodeId }) => {
      try {
        const node = await Node.findById(nodeId).select("name metadata").lean();
        if (!node) {
          return { content: [{ type: "text", text: "Node not found." }] };
        }

        const schedulerMeta = getExtMeta(node, "scheduler");
        if (!schedulerMeta?.completions?.length) {
          return {
            content: [{ type: "text", text: `"${node.name}" has no completion history yet.` }],
          };
        }

        const reliability = calculateReliability(schedulerMeta.completions);
        if (!reliability) {
          return { content: [{ type: "text", text: "Not enough data to calculate reliability." }] };
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ nodeName: node.name, ...reliability }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
];
