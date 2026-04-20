import { z } from "zod";
import {
  getChannels,
  createChannel,
  removeChannel,
  // Rooms
  createRoom,
  addAgentParticipant,
  addUserParticipant,
  addObserverParticipant,
  removeParticipant,
  postToRoom,
  readRoomTranscript,
  listRooms,
} from "./core.js";

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

  // ─────────────────────────────────────────────────────────────────────
  // ROOMS — trees talking over a channel
  //
  // A room is a channel with a friendly node + participants. Participants
  // can be users (notification), agents (orchestrate on arrival), or
  // observers (read-only). See extensions/channels/core.js.
  // ─────────────────────────────────────────────────────────────────────

  {
    name: "room-create",
    description:
      "Create a room — a cascade-enabled node that hosts a conversation between " +
      "participants. Pass parentNodeId to place the room under an existing node " +
      "(usually your home or a dedicated /rooms container).",
    schema: {
      name: z.string().describe("Room name, used for display and channel naming."),
      parentNodeId: z.string().describe("Node under which the room node is created."),
      maxMessages: z.number().int().min(1).max(500).optional().describe("Hard cap on total posts. Default 60."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: async ({ name, parentNodeId, maxMessages, userId }) => {
      try {
        const result = await createRoom({ name, parentNodeId, userId, maxMessages });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `room-create failed: ${err.message}` }] };
      }
    },
  },

  {
    name: "room-join-agent",
    description:
      "Add a tree-agent participant to a room. When the room cascades a post, " +
      "this agent runs orchestrateTreeRequest at (rootId, nodeId) — full TreeOS " +
      "routing, mode resolution, navigation. The agent's response is posted " +
      "back to the room as a note and cascades to other participants.",
    schema: {
      roomNodeId: z.string().describe("The room's node id."),
      rootId: z.string().describe("Root id of the tree the agent speaks from."),
      nodeId: z.string().describe("Node inside that tree where orchestration runs."),
      modeHint: z.string().optional().describe("Starting mode key (e.g. 'tree:code-ask'). Optional — intent routing can override."),
      label: z.string().optional().describe("Human-friendly name for this agent in transcripts."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: async ({ roomNodeId, rootId, nodeId, modeHint, label, userId }) => {
      try {
        const result = await addAgentParticipant({ roomNodeId, rootId, nodeId, modeHint, label, userId });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `room-join-agent failed: ${err.message}` }] };
      }
    },
  },

  {
    name: "room-join-user",
    description:
      "Add a user participant to a room. Cascade delivery to this subscription " +
      "surfaces as a notification at the user's home node. The user posts via " +
      "room-post.",
    schema: {
      roomNodeId: z.string().describe("The room's node id."),
      userHomeNodeId: z.string().describe("The user's home node id (where notifications land)."),
      label: z.string().optional().describe("Display name for the user in transcripts."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: async ({ roomNodeId, userHomeNodeId, label, userId }) => {
      try {
        const result = await addUserParticipant({ roomNodeId, userHomeNodeId, label, userId });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `room-join-user failed: ${err.message}` }] };
      }
    },
  },

  {
    name: "room-join-observer",
    description:
      "Add a read-only observer. Shows in the participant list but receives no " +
      "delivery — no notifications, no orchestration. Useful for audit views.",
    schema: {
      roomNodeId: z.string().describe("The room's node id."),
      label: z.string().describe("Display name for the observer."),
      partnerId: z.string().optional().describe("Optional node id this observer maps to."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ roomNodeId, label, partnerId, userId }) => {
      try {
        const result = await addObserverParticipant({ roomNodeId, label, partnerId, userId });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `room-join-observer failed: ${err.message}` }] };
      }
    },
  },

  {
    name: "room-leave",
    description: "Remove a participant from a room by subscription id.",
    schema: {
      roomNodeId: z.string().describe("The room's node id."),
      subId: z.string().describe("The subscription id returned when joining."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    handler: async ({ roomNodeId, subId }) => {
      try {
        const result = await removeParticipant({ roomNodeId, subId });
        return { content: [{ type: "text", text: JSON.stringify(result || { removed: false }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `room-leave failed: ${err.message}` }] };
      }
    },
  },

  {
    name: "room-post",
    description:
      "Post a message into a room. The message becomes a note on the room node " +
      "and cascades to every active participant. Agent participants respond " +
      "automatically via their mode. Emit [[ROOM-DONE]] in content to close the " +
      "room after this post.",
    schema: {
      roomNodeId: z.string().describe("The room's node id."),
      content: z.string().describe("Message content."),
      authorLabel: z.string().optional().describe("Display name for this post (defaults to user:<id>)."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: async ({ roomNodeId, content, authorLabel, userId }) => {
      try {
        const result = await postToRoom({ roomNodeId, content, userId, authorLabel });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `room-post failed: ${err.message}` }] };
      }
    },
  },

  {
    name: "room-list",
    description: "List all rooms with status, participant breakdown, and recent activity.",
    schema: {
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ userId }) => {
      try {
        const rooms = await listRooms({ userId });
        return { content: [{ type: "text", text: JSON.stringify(rooms, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `room-list failed: ${err.message}` }] };
      }
    },
  },

  {
    name: "room-peek",
    description: "Read the transcript of a room (its note history), chronological.",
    schema: {
      roomNodeId: z.string().describe("The room's node id."),
      limit: z.number().int().min(1).max(500).optional().describe("Max entries to return. Default 100."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async ({ roomNodeId, limit }) => {
      try {
        const transcript = await readRoomTranscript({ roomNodeId, limit });
        return { content: [{ type: "text", text: JSON.stringify(transcript, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `room-peek failed: ${err.message}` }] };
      }
    },
  },
];
