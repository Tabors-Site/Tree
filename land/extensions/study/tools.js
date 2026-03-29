/**
 * Study Tools
 *
 * MCP tools for building curricula, tracking mastery, managing queue.
 * Used by plan and session modes.
 */

import { z } from "zod";
import {
  addToQueue, moveToActive, updateMastery, addGap,
} from "./core.js";
import {
  addTopic, addSubtopic, completeSetup, saveProfile,
} from "./setup.js";

export default function getTools() {
  return [
    {
      name: "study-add-to-queue",
      description: "Add a topic or URL to the study queue.",
      schema: {
        rootId: z.string().describe("Study root node ID."),
        topic: z.string().describe("Topic name or URL to queue."),
        priority: z.number().optional().describe("Priority (higher = study sooner). Default 0."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      handler: async ({ rootId, topic, priority, userId }) => {
        try {
          const isUrl = /^https?:\/\//.test(topic);
          const result = await addToQueue(rootId, topic, userId, { url: isUrl ? topic : null, priority });
          return { content: [{ type: "text", text: `Queued: "${result.name}"` }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
    {
      name: "study-create-topic",
      description: "Create a topic under the Active branch with a Resources child. Use after picking a topic from the queue.",
      schema: {
        activeNodeId: z.string().describe("The Active node ID (parent of topics)."),
        topicName: z.string().describe("Topic name."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      handler: async ({ activeNodeId, topicName, userId }) => {
        try {
          const result = await addTopic(activeNodeId, topicName, userId);
          return { content: [{ type: "text", text: `Created topic "${result.name}" (${result.id})` }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
    {
      name: "study-add-subtopic",
      description: "Add a subtopic (concept to learn) under a topic. Sets initial mastery to 0.",
      schema: {
        topicId: z.string().describe("Parent topic node ID."),
        subtopicName: z.string().describe("Subtopic/concept name (e.g. 'useState', 'Closures')."),
        order: z.number().optional().describe("Learning order (lower = learn first)."),
        prerequisites: z.array(z.string()).optional().describe("Names of subtopics that should be learned first."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      handler: async ({ topicId, subtopicName, order, prerequisites, userId }) => {
        try {
          const result = await addSubtopic(topicId, subtopicName, userId, { order, prerequisites });
          return { content: [{ type: "text", text: `Added subtopic "${result.name}" (mastery: 0%)` }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
    {
      name: "study-update-mastery",
      description:
        "Update mastery score on a subtopic after evaluating the student's understanding. " +
        "0-30: introduced. 30-60: basics understood. 60-80: solid. 80+: can teach it.",
      schema: {
        subtopicId: z.string().describe("Subtopic node ID."),
        score: z.number().min(0).max(100).describe("New mastery score (0-100)."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      handler: async ({ subtopicId, score, userId }) => {
        try {
          const result = await updateMastery(subtopicId, score, userId);
          const status = result.complete ? "Complete!" : `${result.mastery}%`;
          return { content: [{ type: "text", text: `Mastery updated: ${status}` }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
    {
      name: "study-move-to-active",
      description: "Move a queue item to Active study. Creates topic node with Resources child.",
      schema: {
        rootId: z.string().describe("Study root node ID."),
        queueItemId: z.string().describe("Queue item node ID to activate."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      handler: async ({ rootId, queueItemId, userId }) => {
        try {
          const result = await moveToActive(rootId, queueItemId, userId);
          return { content: [{ type: "text", text: `Activated: "${result.name}" (${result.topicId}). Ready to build curriculum.` }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
    {
      name: "study-detect-gap",
      description: "Record a knowledge gap detected during a study session.",
      schema: {
        rootId: z.string().describe("Study root node ID."),
        gapName: z.string().describe("The missing concept (e.g. 'Closures')."),
        detectedDuring: z.string().describe("What was being studied when the gap was found."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      handler: async ({ rootId, gapName, detectedDuring, userId }) => {
        try {
          const result = await addGap(rootId, gapName, detectedDuring, userId);
          if (result?.existed) return { content: [{ type: "text", text: `Gap already tracked: "${gapName}"` }] };
          return { content: [{ type: "text", text: `Gap detected: "${gapName}" (found while studying ${detectedDuring})` }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
    {
      name: "study-complete-setup",
      description: "Mark study setup as complete after initial configuration.",
      schema: {
        rootId: z.string().describe("Study root node ID."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      handler: async ({ rootId }) => {
        try {
          await completeSetup(rootId);
          return { content: [{ type: "text", text: "Study setup complete. Queue topics with needlearn, then study." }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
    {
      name: "study-save-profile",
      description: "Save the user's learning profile (style, daily goal, preferences).",
      schema: {
        rootId: z.string().describe("Study root node ID."),
        profile: z.object({
          learningStyle: z.enum(["theory-first", "examples-first", "challenge-first"]).optional(),
          dailyStudyMinutes: z.number().optional(),
          preferredTime: z.string().optional(),
        }).describe("Learning profile settings."),
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
  ];
}
