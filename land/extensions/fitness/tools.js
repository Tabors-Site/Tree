/**
 * Fitness Tools
 *
 * MCP tools for building and modifying the fitness tree.
 * Used by the plan and coach modes during setup and program changes.
 */

import { z } from "zod";
import {
  addGroupNode, addExerciseNode, removeExerciseNode,
  completeSetup, scaffoldGym, scaffoldRunning, scaffoldHome,
  saveProfile,
} from "./setup.js";
import { adoptExercise } from "./core.js";

export default function getTools() {
  return [
    {
      name: "fitness-add-modality",
      description: "Add a training modality branch (Gym, Running, or Home/bodyweight) to the fitness tree.",
      schema: {
        rootId: z.string().describe("Fitness root node ID."),
        modality: z.enum(["gym", "running", "home"]).describe("Which modality to add."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      handler: async ({ rootId, modality, userId }) => {
        try {
          let result;
          if (modality === "gym") result = await scaffoldGym(rootId, userId);
          else if (modality === "running") result = await scaffoldRunning(rootId, userId);
          else if (modality === "home") result = await scaffoldHome(rootId, userId);
          else return { content: [{ type: "text", text: `Unknown modality: ${modality}` }] };
          return { content: [{ type: "text", text: `Created ${result.name} branch (${result.id})` }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
    {
      name: "fitness-add-group",
      description: "Add a group (muscle group, category, or activity type) under a modality branch.",
      schema: {
        parentId: z.string().describe("Parent node ID (modality branch like Gym or Home)."),
        name: z.string().describe("Group name (e.g. Chest, Push, Morning Routine)."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      handler: async ({ parentId, name, userId }) => {
        try {
          const result = await addGroupNode({ parentId, name, userId });
          return { content: [{ type: "text", text: `Created group "${result.name}" (${result.id})` }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
    {
      name: "fitness-add-exercise",
      description:
        "Add an exercise node under a group. Sets the tracking type, initial values, goals, and progression rules. " +
        "exerciseType: 'weight-reps' for gym lifts, 'reps' for bodyweight, 'duration' for holds/planks, 'distance-time' for running.",
      schema: {
        groupId: z.string().describe("Parent group node ID."),
        name: z.string().describe("Exercise name (e.g. Bench Press, Push-ups, Plank)."),
        exerciseType: z.enum(["weight-reps", "reps", "duration", "distance-time"]).default("weight-reps")
          .describe("How this exercise is tracked."),
        unit: z.string().optional().describe("Unit: lb, kg, bodyweight, seconds, minutes, miles, km."),
        sets: z.number().optional().describe("Number of tracked sets (for weight-reps and reps types)."),
        startingValues: z.record(z.number()).optional()
          .describe("Initial values object (e.g. {weight: 135, set1: 0, set2: 0, set3: 0})."),
        goals: z.record(z.number()).optional()
          .describe("Goal values object (e.g. {set1: 12, set2: 12, set3: 12})."),
        progressionIncrement: z.record(z.number()).optional()
          .describe("How much to increase on goal met (e.g. {weight: 5} or {duration: 10})."),
        progressionPath: z.array(z.string()).optional()
          .describe("Variation progression for bodyweight (e.g. ['standard', 'diamond', 'archer'])."),
        rootId: z.string().describe("Fitness root node ID (for channel creation)."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      handler: async ({ groupId, name, exerciseType, unit, sets, startingValues, goals, progressionIncrement, progressionPath, rootId, userId }) => {
        try {
          const result = await addExerciseNode({
            groupId, name, exerciseType, unit, sets,
            startingValues, goals, progressionIncrement, progressionPath,
            rootId, userId,
          });
          return { content: [{ type: "text", text: `Created exercise "${result.name}" (${result.id})` }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
    {
      name: "fitness-remove-exercise",
      description: "Remove an exercise node from the tree.",
      schema: {
        exerciseId: z.string().describe("Exercise node ID to remove."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      handler: async ({ exerciseId, userId }) => {
        try {
          const ok = await removeExerciseNode(exerciseId, userId);
          return { content: [{ type: "text", text: ok ? "Exercise removed." : "Failed to remove exercise." }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
    {
      name: "fitness-complete-setup",
      description: "Mark fitness setup as complete after all modalities, groups, and exercises have been created.",
      schema: {
        rootId: z.string().describe("Fitness root node ID."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      handler: async ({ rootId }) => {
        try {
          await completeSetup(rootId);
          return { content: [{ type: "text", text: "Fitness setup complete. Ready to track workouts." }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
    {
      name: "fitness-save-profile",
      description: "Save the user's fitness profile (units, weekly goal, modalities, etc.).",
      schema: {
        rootId: z.string().describe("Fitness root node ID."),
        profile: z.object({
          weightUnit: z.enum(["lb", "kg"]).optional(),
          distanceUnit: z.enum(["miles", "km"]).optional(),
          sessionsPerWeek: z.number().optional(),
          modalities: z.array(z.string()).optional(),
          weightIncrement: z.number().optional(),
          weeklyMilesGoal: z.number().optional(),
        }).describe("Profile settings."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      handler: async ({ rootId, profile }) => {
        try {
          await saveProfile(rootId, profile);
          return { content: [{ type: "text", text: "Profile saved." }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
    {
      name: "fitness-adopt-exercise",
      description:
        "Adopt an existing node into the fitness tree as a tracked exercise. " +
        "Use when you see unadopted child nodes that should be tracked. " +
        "Sets the exercise type, unit, and optionally goals on the node.",
      schema: {
        nodeId: z.string().describe("The node ID to adopt as an exercise."),
        exerciseType: z.enum(["weight-reps", "reps", "duration", "distance-time"]).default("weight-reps")
          .describe("How this exercise is tracked."),
        unit: z.string().optional().describe("Unit: lb, kg, bodyweight, seconds, minutes, miles, km."),
        goals: z.record(z.number()).optional().describe("Optional goal values."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      handler: async ({ nodeId, exerciseType, unit, goals }) => {
        try {
          await adoptExercise(nodeId, { exerciseType, unit, goals });
          return { content: [{ type: "text", text: `Adopted as ${exerciseType} exercise.${unit ? ` Unit: ${unit}.` : ""} It will now appear in workout tracking and the dashboard.` }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
  ];
}
