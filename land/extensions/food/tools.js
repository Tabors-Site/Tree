/**
 * Food Tools
 *
 * Extension-specific tools that call core functions directly.
 * No MCP nodeId validation issues because these accept rootId.
 */

import { z } from "zod";
import { saveProfile, findFoodNodes, adoptNode } from "./core.js";

export default function getTools() {
  return [
    {
      name: "food-save-profile",
      description:
        "Save the user's nutrition profile. Sets calorie target and metric goals on the tree. " +
        "Call this after gathering calorie target, goals, and dietary restrictions. " +
        "Goal keys are dynamic: proteinGoal, carbsGoal, fatsGoal, sugarGoal, fiberGoal, etc. " +
        "Any key ending in 'Goal' sets the daily goal for the matching metric node.",
      schema: {
        rootId: z.string().describe("Food root node ID."),
        calorieGoal: z.number().optional().describe("Daily calorie target."),
        proteinGoal: z.number().optional().describe("Daily protein goal in grams."),
        carbsGoal: z.number().optional().describe("Daily carbs goal in grams."),
        fatsGoal: z.number().optional().describe("Daily fats goal in grams."),
        sugarGoal: z.number().optional().describe("Daily sugar goal in grams."),
        fiberGoal: z.number().optional().describe("Daily fiber goal in grams."),
        sodiumGoal: z.number().optional().describe("Daily sodium goal in mg."),
        goal: z.string().optional().describe("Goal type: bulk, cut, maintain, general."),
        restrictions: z.string().nullable().optional().describe("Dietary restrictions or preferences."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      handler: async (args) => {
        try {
          const { rootId, userId, chatId, sessionId, ...profile } = args;
          const foodNodes = await findFoodNodes(rootId);
          if (!foodNodes) return { content: [{ type: "text", text: "Food tree not found." }] };
          await saveProfile(rootId, profile, foodNodes, userId);
          const goalSummary = Object.entries(profile)
            .filter(([k, v]) => k.endsWith("Goal") && v)
            .map(([k, v]) => `${k.replace("Goal", "")}: ${v}`)
            .join(", ");
          return { content: [{ type: "text", text: `Profile saved.${goalSummary ? " Goals: " + goalSummary + "." : ""}` }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
    {
      name: "food-adopt-node",
      description:
        "Adopt an existing node into the food tree as a tracked metric. " +
        "Sets metadata.food.role on the node so the food system discovers it. " +
        "Use when you see unadopted child nodes that should be tracked (e.g. Sugar, Fiber, Sodium).",
      schema: {
        nodeId: z.string().describe("The node ID to adopt."),
        role: z.string().describe("The role name (lowercase, no spaces). e.g. 'sugar', 'fiber', 'sodium'."),
        goal: z.number().optional().describe("Optional daily goal in grams."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      handler: async ({ nodeId, role, goal }) => {
        try {
          await adoptNode(nodeId, role, goal);
          return { content: [{ type: "text", text: `Adopted as "${role}".${goal ? ` Goal: ${goal}g/day.` : ""} It will now appear in tracking, dashboard, and daily resets.` }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
  ];
}
