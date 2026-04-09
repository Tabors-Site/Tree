/**
 * Food Tools
 *
 * Extension-specific tools that call core functions directly.
 * No MCP nodeId validation issues because these accept rootId.
 */

import { z } from "zod";
import { saveProfile, findFoodNodes, adoptNode, deliverMacros, detectMealSlot, writeMealNote, getDailyPicture, STRUCTURAL_ROLES } from "./core.js";

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
    {
      name: "food-log-entry",
      description:
        "Log a food entry. Updates all tracked metrics atomically, writes to the correct meal slot, " +
        "and creates a structured log note. Call this ONCE after estimating macros for what the user ate. " +
        "Pass the items with their macro breakdown and the totals. The tool handles everything else.",
      schema: {
        rootId: z.string().describe("Food root node ID."),
        items: z.array(z.object({
          name: z.string().describe("Food item name."),
          protein: z.number().optional().describe("Protein in grams."),
          carbs: z.number().optional().describe("Carbs in grams."),
          fats: z.number().optional().describe("Fats in grams."),
          calories: z.number().optional().describe("Calories."),
        }).passthrough()).describe("Parsed food items with macro estimates."),
        totals: z.record(z.number()).describe("Sum of all items. Keys match metric roles: protein, carbs, fats, etc."),
        meal: z.string().optional().describe("Meal slot: breakfast, lunch, dinner, snack. Auto-detected from time if omitted."),
        summary: z.string().describe("Readable food description for the log note. e.g. '2 eggs and a cup of rice'"),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      handler: async (args) => {
        try {
          const { rootId, items, totals, meal, summary, userId, chatId, sessionId } = args;
          const foodNodes = await findFoodNodes(rootId);
          if (!foodNodes) return { content: [{ type: "text", text: "Food tree not found." }] };

          const logNodeId = foodNodes.log?.id;
          if (!logNodeId) return { content: [{ type: "text", text: "Log node not found in food tree." }] };

          // Write structured note to Log node
          const { createNote } = await import("../../seed/tree/notes.js");
          const logContent = JSON.stringify({ items, totals, meal: meal || null, summary });
          const logNote = await createNote({
            nodeId: logNodeId,
            content: logContent,
            contentType: "text",
            userId: userId || "SYSTEM",
            wasAi: true,
            chatId: chatId ?? null,
            sessionId: sessionId ?? null,
          });
          const logNoteId = logNote?._id ? String(logNote._id) : null;

          // Deliver macros to all metric nodes atomically
          await deliverMacros(logNodeId, foodNodes, { totals, meal, when: meal });

          // Write to meal slot
          const slot = detectMealSlot(summary, meal);
          const mealNoteContent = JSON.stringify({ text: summary, totals, logNoteId });
          await writeMealNote(foodNodes, slot, mealNoteContent, userId || "SYSTEM", { chatId, sessionId });

          // Build running totals for confirmation
          const picture = await getDailyPicture(rootId);
          const runningTotals = [];
          for (const role of (picture?._valueRoles || [])) {
            const m = picture[role];
            if (!m) continue;
            const goalStr = m.goal > 0 ? `/${m.goal}g` : "g";
            runningTotals.push(`${m.name || role}: ${m.today}${goalStr}`);
          }
          const calStr = picture?.calories
            ? `${picture.calories.today}${picture.calories.goal > 0 ? `/${picture.calories.goal}` : ""} cal`
            : null;
          if (calStr) runningTotals.push(calStr);

          const result = `Logged to ${slot}. ${runningTotals.join(", ")}.`;
          return { content: [{ type: "text", text: result }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
  ];
}
