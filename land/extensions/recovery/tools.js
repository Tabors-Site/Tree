/**
 * Recovery tools
 *
 * MCP tools for the AI to modify the recovery tree.
 * addSubstance creates a substance node with schedule and dose tracking.
 * completeSetup marks the tree as configured.
 */

import { z } from "zod";
import { addSubstance, completeSetup } from "./core.js";

export default function getTools() {
  return [
    {
      name: "recovery-add-substance",
      description:
        "Add a substance to track. Creates a substance node with schedule and dose tracking. " +
        "Call this during setup when the user tells you what they want to track.",
      schema: {
        rootId: z.string().describe("Root node ID of the recovery tree."),
        substanceName: z.string().describe("Name of the substance (e.g. 'vape', 'caffeine', 'alcohol')."),
        startingTarget: z.number().optional().describe("Current daily usage amount."),
        finalTarget: z.number().optional().describe("Target daily usage (0 for quit)."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      handler: async ({ rootId, substanceName, startingTarget, finalTarget, userId }) => {
        try {
          const result = await addSubstance(rootId, substanceName, userId, {
            startingTarget: startingTarget || 0,
            finalTarget: finalTarget || 0,
          });
          return { content: [{ type: "text", text: `Now tracking "${substanceName}". Setup auto-completes on first substance.` }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
    {
      name: "recovery-complete-setup",
      description: "Mark recovery tree setup as complete. Call after adding all substances.",
      schema: {
        rootId: z.string().describe("Root node ID of the recovery tree."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      handler: async ({ rootId }) => {
        try {
          await completeSetup(rootId);
          return { content: [{ type: "text", text: "Setup complete." }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
        }
      },
    },
  ];
}
