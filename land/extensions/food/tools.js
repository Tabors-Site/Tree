/**
 * Food Tools
 *
 * Extension-specific tools that call core functions directly.
 * No MCP nodeId validation issues because these accept rootId.
 */

import { z } from "zod";
import { saveProfile, findFoodNodes } from "./core.js";

export default function getTools() {
  return [
    {
      name: "food-save-profile",
      description:
        "Save the user's nutrition profile. Sets calorie target and macro goals on the tree. " +
        "Call this after gathering calorie target, macro split, and dietary restrictions.",
      schema: {
        rootId: z.string().describe("Food root node ID."),
        calorieGoal: z.number().describe("Daily calorie target."),
        proteinGoal: z.number().describe("Daily protein goal in grams."),
        carbsGoal: z.number().describe("Daily carbs goal in grams."),
        fatsGoal: z.number().describe("Daily fats goal in grams."),
        goal: z.string().optional().describe("Goal type: bulk, cut, maintain, general."),
        restrictions: z.string().nullable().optional().describe("Dietary restrictions or preferences."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      handler: async ({ rootId, calorieGoal, proteinGoal, carbsGoal, fatsGoal, goal, restrictions }) => {
        try {
          const foodNodes = await findFoodNodes(rootId);
          if (!foodNodes) return { content: [{ type: "text", text: "Food tree not found." }] };
          await saveProfile(rootId, { calorieGoal, proteinGoal, carbsGoal, fatsGoal, goal, restrictions }, foodNodes);
          return { content: [{ type: "text", text: `Profile saved. Protein: ${proteinGoal}g, Carbs: ${carbsGoal}g, Fats: ${fatsGoal}g (${calorieGoal} cal).` }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
  ];
}
