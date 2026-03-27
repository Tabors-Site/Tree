import { z } from "zod";
import { getChannels, createChannel, removeChannel } from "./core.js";

export default [
  {
    name: "channel-list",
    description: "Show active channels and pending invitations at this node.",
    schema: {
      nodeId: z.string().describe("Node to list channels for."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ nodeId }) => {
      try {
        const result = await getChannels(nodeId);
        if (result.subscriptions.length === 0 && result.pending.length === 0) {
          return { content: [{ type: "text", text: "No channels or pending invitations at this node." }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "channel-create",
    description:
      "Create a named direct signal channel to another node. Signals bypass the " +
      "propagation tree walk and arrive in one hop.",
    schema: {
      nodeId: z.string().describe("Source node (this end of the channel)."),
      targetNodeId: z.string().describe("Target node (the other end)."),
      channelName: z.string().describe("Name for the channel (alphanumeric, hyphens, underscores, max 50)."),
      direction: z.enum(["inbound", "outbound", "bidirectional"]).optional().default("bidirectional")
        .describe("Signal direction. Bidirectional means both ends send and receive."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: async ({ nodeId, targetNodeId, channelName, direction, userId }) => {
      try {
        const result = await createChannel({
          sourceNodeId: nodeId,
          targetNodeId,
          channelName,
          direction,
          userId,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "channel-remove",
    description: "Remove a named channel from this node. Cleans up both endpoints.",
    schema: {
      nodeId: z.string().describe("Node to remove the channel from."),
      channelName: z.string().describe("Name of the channel to remove."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    handler: async ({ nodeId, channelName, userId }) => {
      try {
        const result = await removeChannel(nodeId, channelName, userId);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "channel-status",
    description: "Show detail and signal stats for a specific channel.",
    schema: {
      nodeId: z.string().describe("Node to check."),
      channelName: z.string().describe("Channel name to inspect."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ nodeId, channelName }) => {
      try {
        const { subscriptions, pending } = await getChannels(nodeId);
        const sub = subscriptions.find(s => s.channelName === channelName);
        const invite = pending.find(p => p.channelName === channelName);
        if (!sub && !invite) {
          return { content: [{ type: "text", text: `Channel "${channelName}" not found at this node.` }] };
        }
        return { content: [{ type: "text", text: JSON.stringify({ subscription: sub || null, pending: invite || null }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
];
