import { z } from "zod";
import { updateSchedule } from "./core.js";

export default [
  {
    name: "edit-node-schedule",
    description:
      "Set or update a node's schedule. Use for reminders, recurring events, deadlines.",
    schema: {
      nodeId: z
        .string()
        .describe("The node to schedule."),
      newSchedule: z
        .string()
        .describe("The schedule date/time (ISO 8601 format)."),
      reeffectTime: z
        .number()
        .optional()
        .describe("Recurring interval in hours. e.g. 168 for weekly, 24 for daily. Omit for one-time."),
      beingId: z.string().describe("Injected by server. Ignore."),
      summonId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
      sessionId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    handler: async ({
      nodeId,
      newSchedule,
      reeffectTime,
      beingId,
      summonId,
      sessionId,
    }) => {
      try {
        const result = await updateSchedule({
          nodeId,
          newSchedule,
          reeffectTime: reeffectTime || 0,
          beingId,
          summonId,
          sessionId,
        });

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to update schedule: ${err.message}`,
            },
          ],
        };
      }
    },
  },
];
