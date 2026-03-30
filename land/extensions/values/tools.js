import { z } from "zod";
import { setValueForNode, setGoalForNode } from "./core.js";

export default function getTools() {
  return [
    {
      name: "edit-node-value",
      description: "Update a numeric value on a node. Values track quantitative state (strength, progress, count, etc.).",
      schema: {
        nodeId: z.string().describe("The unique ID of the node to edit."),
        key: z.string().describe("The key of the value to modify."),
        value: z.number().describe("The numeric value to assign."),
        userId: z.string().describe("The ID of the user performing the edit."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: async ({ nodeId, key, value, userId, chatId, sessionId }) => {
        const result = await setValueForNode({ nodeId, key, value, userId, wasAi: true, chatId, sessionId });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      },
    },
    {
      name: "edit-node-goal",
      description: "Set a goal for a value on a node. A goal is the target number a value needs to reach.",
      schema: {
        nodeId: z.string().describe("The unique ID of the node to edit."),
        key: z.string().describe("The key of the goal (must match an existing value key)."),
        goal: z.number().describe("The numeric goal value."),
        userId: z.string().describe("The ID of the user performing the edit."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: async ({ nodeId, key, goal, userId, chatId, sessionId }) => {
        try {
          const result = await setGoalForNode({ nodeId, key, goal, userId, wasAi: true, chatId, sessionId });
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed to update goal: ${err.message}` }] };
        }
      },
    },
  ];
}
