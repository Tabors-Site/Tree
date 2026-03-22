import { z } from "zod";
import { updateSchedule } from "./core.js";
import { getNodeForAi } from "../../core/tree/treeDataFetching.js";

async function resolvePrestige({ nodeId, prestige }) {
  // If a valid prestige is explicitly provided, use it as-is
  if (typeof prestige === "number" && prestige >= 0) {
    return prestige;
  }

  // Otherwise, fetch the node and use its latest prestige
  const node = await getNodeForAi(nodeId);

  if (!node) {
    throw new Error(`Node not found: ${nodeId}`);
  }

  if (typeof node.prestige !== "number") {
    throw new Error(`Node prestige missing for node ${nodeId}`);
  }

  return node.prestige;
}

export default [
  {
    name: "edit-node-version-schedule",
    description:
      "Calls updateSchedule() to modify a node version's schedule and reeffect time for a specific version.",
    schema: {
      nodeId: z
        .string()
        .describe(
          "The unique ID of the node whose schedule should be updated.",
        ),
      prestige: z
        .number()
        .describe(
          "The prestige of the version to update within the node's version history.",
        ),
      newSchedule: z
        .string()
        .describe("The new schedule date/time (in ISO 8601 format)."),
      reeffectTime: z
        .number()
        .describe(
          "The reeffect time in hours (must be below 1,000,000). Added to schedule when prestiging for new version.",
        ),
      userId: z.string().describe("Injected by server. Ignore."),
      aiChatId: z
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
      openWorldHint: false,
    },
    handler: async ({
      nodeId,
      prestige,
      newSchedule,
      reeffectTime,
      userId,
      aiChatId,
      sessionId,
    }) => {
      const version = await resolvePrestige({
        nodeId,
        prestige,
      });
      try {
        const result = await updateSchedule({
          nodeId,
          versionIndex: version,
          newSchedule,
          reeffectTime,
          userId,
          wasAi: true,
          aiChatId,
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
