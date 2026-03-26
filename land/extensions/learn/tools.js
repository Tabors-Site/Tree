import { z } from "zod";
import {
  initLearnState,
  getLearnState,
  processQueue,
  pauseLearn,
  resumeLearn,
} from "./core.js";

export default [
  {
    name: "learn",
    description:
      "Start learning from text. Paste a massive block of text and the extension decomposes it " +
      "into a tree structure. First pass identifies top-level sections. Each section becomes a child " +
      "node. Repeat for each child until all leaves are a reasonable size. Queue-based, can be " +
      "paused and resumed. If no text is provided, learns from the existing notes on the node.",
    schema: {
      nodeId: z.string().describe("The node to start learning at. Children will be created here."),
      text: z.string().optional().describe("The text to learn. If omitted, reads from existing notes on the node."),
      targetSize: z.number().optional().default(3000).describe("Target note size in characters for leaf nodes (default 3000)."),
      maxSteps: z.number().optional().default(10).describe("Max nodes to process in this call (default 10). Use for incremental processing."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async ({ nodeId, text, targetSize, maxSteps, userId }) => {
      try {
        // Check if there's already a learn operation on this node
        const existing = await getLearnState(nodeId);
        if (existing && existing.status === "processing") {
          return { content: [{ type: "text", text: "Learn operation already in progress on this node. Use learn-resume to continue or learn-status to check progress." }] };
        }

        // If text provided, write it as a note first
        if (text && text.trim().length > 0) {
          const { createNote } = await import("../../seed/tree/notes.js");
          await createNote({
            contentType: "text",
            content: text,
            userId,
            nodeId,
            wasAi: false,
          });
        }

        // Initialize learn state and start processing
        await initLearnState(nodeId, targetSize);

        // Look up username
        let username = null;
        try {
          const User = (await import("../../seed/models/user.js")).default;
          const user = await User.findById(userId).select("username").lean();
          username = user?.username;
        } catch {}

        const state = await processQueue(nodeId, userId, username, maxSteps || 10);

        const statusText = state.status === "complete"
          ? `Learning complete. Created ${state.nodesCreated} nodes from ${state.nodesProcessed} decomposition passes.`
          : `Learning in progress. Created ${state.nodesCreated} nodes so far. ${state.queue.length} nodes still in queue. Use learn-resume to continue.`;

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              message: statusText,
              status: state.status,
              nodesCreated: state.nodesCreated,
              nodesProcessed: state.nodesProcessed,
              queueRemaining: state.queue.length,
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Learn failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "learn-resume",
    description:
      "Resume a paused or in-progress learn operation. Processes the next batch of nodes in the queue.",
    schema: {
      nodeId: z.string().describe("The root node of the learn operation."),
      maxSteps: z.number().optional().default(10).describe("Max nodes to process in this call (default 10)."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async ({ nodeId, maxSteps, userId }) => {
      try {
        const state = await getLearnState(nodeId);
        if (!state) {
          return { content: [{ type: "text", text: "No learn operation found on this node. Use learn to start one." }] };
        }
        if (state.status === "complete") {
          return { content: [{ type: "text", text: `Learning already complete. ${state.nodesCreated} nodes created across ${state.nodesProcessed} passes.` }] };
        }

        // Resume if paused
        if (state.status === "paused") {
          await resumeLearn(nodeId);
        }

        let username = null;
        try {
          const User = (await import("../../seed/models/user.js")).default;
          const user = await User.findById(userId).select("username").lean();
          username = user?.username;
        } catch {}

        const updated = await processQueue(nodeId, userId, username, maxSteps || 10);

        const statusText = updated.status === "complete"
          ? `Learning complete. Created ${updated.nodesCreated} nodes from ${updated.nodesProcessed} passes.`
          : `Processed batch. Created ${updated.nodesCreated} total nodes. ${updated.queue.length} still in queue. Call learn-resume again to continue.`;

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              message: statusText,
              status: updated.status,
              nodesCreated: updated.nodesCreated,
              nodesProcessed: updated.nodesProcessed,
              queueRemaining: updated.queue.length,
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Resume failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "learn-status",
    description: "Check the progress of a learn operation on a node.",
    schema: {
      nodeId: z.string().describe("The root node of the learn operation."),
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
    handler: async ({ nodeId }) => {
      try {
        const state = await getLearnState(nodeId);
        if (!state) {
          return { content: [{ type: "text", text: "No learn operation found on this node." }] };
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              status: state.status,
              nodesCreated: state.nodesCreated,
              nodesProcessed: state.nodesProcessed,
              queueRemaining: (state.queue || []).length,
              targetNoteSize: state.targetNoteSize,
              startedAt: state.startedAt,
              lastActivityAt: state.lastActivityAt,
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Status check failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "learn-pause",
    description: "Pause a learn operation. The queue is preserved and can be resumed later.",
    schema: {
      nodeId: z.string().describe("The root node of the learn operation."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async ({ nodeId }) => {
      try {
        const state = await pauseLearn(nodeId);
        if (!state) {
          return { content: [{ type: "text", text: "No learn operation found on this node." }] };
        }
        return {
          content: [{
            type: "text",
            text: `Learn paused. ${state.nodesCreated} nodes created so far. ${(state.queue || []).length} nodes still in queue. Use learn-resume to continue.`,
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Pause failed: ${err.message}` }] };
      }
    },
  },
];
