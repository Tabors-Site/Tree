import { z } from "zod";
import { checkCascade, getCascadeResults, getAllCascadeResults } from "../../seed/tree/cascade.js";

export default [
  {
    name: "trigger-cascade",
    description:
      "Manually fire a cascade signal at a node. The node must have metadata.cascade.enabled = true and cascadeEnabled must be true in land config.",
    schema: {
      nodeId: z.string().describe("The node ID to trigger cascade at."),
      payload: z
        .record(z.any())
        .optional()
        .describe("Optional payload data to include in the signal."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async ({ nodeId, payload, userId }) => {
      try {
        const writeContext = {
          action: "manual-cascade",
          triggeredBy: userId,
          ...(payload || {}),
        };

        const result = await checkCascade(nodeId, writeContext);

        if (!result) {
          return {
            content: [
              {
                type: "text",
                text: "Cascade did not fire. Either cascadeEnabled is false in land config or the node does not have metadata.cascade.enabled = true.",
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  message: "Cascade triggered",
                  signalId: result.signalId,
                  originStatus: result.result?.status,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Cascade failed: ${err.message}` }],
        };
      }
    },
  },
  {
    name: "cascade-status",
    description:
      "Get cascade results. Pass a signalId to see results for that signal, or omit to see recent signals.",
    schema: {
      signalId: z
        .string()
        .optional()
        .describe("Signal ID to check. Omit for recent results."),
      limit: z
        .number()
        .optional()
        .default(20)
        .describe("Max number of recent signals to return (default 20)."),
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
    handler: async ({ signalId, limit }) => {
      try {
        if (signalId) {
          const results = await getCascadeResults(signalId);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    signalId,
                    hops: results.length,
                    results: results.map((r) => ({
                      status: r.status,
                      source: r.source,
                      extName: r.extName,
                      timestamp: r.timestamp,
                    })),
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        const all = await getAllCascadeResults(limit || 20);
        const summary = Object.entries(all).map(([sid, entries]) => ({
          signalId: sid,
          hops: entries.length,
          lastStatus: entries[entries.length - 1]?.status,
          lastTimestamp: entries[entries.length - 1]?.timestamp,
        }));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ signals: summary.length, results: summary }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to read cascade status: ${err.message}` }],
        };
      }
    },
  },
];
