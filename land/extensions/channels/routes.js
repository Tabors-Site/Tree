import express from "express";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import authenticate from "../../seed/middleware/authenticate.js";
import {
  getChannels, createChannel, removeChannel, acceptInvite,
  createRoom, addAgentParticipant, addUserParticipant, addObserverParticipant,
  removeParticipant, postToRoom, readRoomTranscript, listRooms,
} from "./core.js";

const router = express.Router();

// GET /node/:nodeId/channels - List all channels
router.get("/node/:nodeId/channels", authenticate, async (req, res) => {
  try {
    const result = await getChannels(req.params.nodeId);
    sendOk(res, result);
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// GET /node/:nodeId/channels/:channelName - Channel detail/status
router.get("/node/:nodeId/channels/:channelName", authenticate, async (req, res) => {
  try {
    const { subscriptions, pending } = await getChannels(req.params.nodeId);
    const sub = subscriptions.find(s => s.channelName === req.params.channelName);
    const invite = pending.find(p => p.channelName === req.params.channelName);
    if (!sub && !invite) {
      return sendError(res, 404, ERR.NODE_NOT_FOUND, `Channel "${req.params.channelName}" not found`);
    }
    sendOk(res, { subscription: sub || null, pending: invite || null });
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// POST /node/:nodeId/channels - Create a channel
router.post("/node/:nodeId/channels", authenticate, async (req, res) => {
  try {
    const { target, name, direction, filter } = req.body;
    if (!target) return sendError(res, 400, ERR.INVALID_INPUT, "target (node ID) is required");
    if (!name) return sendError(res, 400, ERR.INVALID_INPUT, "name (channel name) is required");

    const result = await createChannel({
      sourceNodeId: req.params.nodeId,
      targetNodeId: target,
      channelName: name,
      direction: direction || "bidirectional",
      filter: filter || null,
      userId: req.userId,
    });
    sendOk(res, result, 201);
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// DELETE /node/:nodeId/channels/:channelName - Remove a channel
router.delete("/node/:nodeId/channels/:channelName", authenticate, async (req, res) => {
  try {
    const result = await removeChannel(req.params.nodeId, req.params.channelName, req.userId);
    sendOk(res, result);
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// POST /node/:nodeId/channels/:channelName/accept - Accept invitation
router.post("/node/:nodeId/channels/:channelName/accept", authenticate, async (req, res) => {
  try {
    const result = await acceptInvite(req.params.nodeId, req.params.channelName, req.userId);
    sendOk(res, result);
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// ROOMS — HTTP admin surface. Wraps the core helpers so the UI and
// third-party scripts can create/manage rooms without going through MCP.
// ─────────────────────────────────────────────────────────────────────────

// GET /rooms — list all rooms
router.get("/rooms", authenticate, async (req, res) => {
  try {
    const rooms = await listRooms({ userId: req.userId });
    sendOk(res, { rooms });
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// GET /rooms/:roomId — one room's participants + meta
router.get("/rooms/:roomId", authenticate, async (req, res) => {
  try {
    const all = await listRooms({ userId: req.userId });
    const room = all.find((r) => r.id === req.params.roomId);
    if (!room) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Room not found");
    sendOk(res, room);
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// GET /rooms/:roomId/transcript — note history
router.get("/rooms/:roomId/transcript", authenticate, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit, 10) || 100));
    const transcript = await readRoomTranscript({ roomNodeId: req.params.roomId, limit });
    sendOk(res, { transcript });
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// POST /rooms — create a room under a given parent node
router.post("/rooms", authenticate, async (req, res) => {
  try {
    const { name, parentNodeId, maxMessages } = req.body || {};
    if (!name) return sendError(res, 400, ERR.INVALID_INPUT, "name is required");
    if (!parentNodeId) return sendError(res, 400, ERR.INVALID_INPUT, "parentNodeId is required");
    const result = await createRoom({ name, parentNodeId, userId: req.userId, maxMessages });
    sendOk(res, result, 201);
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// POST /rooms/:roomId/agents — add agent participant
router.post("/rooms/:roomId/agents", authenticate, async (req, res) => {
  try {
    const { rootId, nodeId, modeHint, label } = req.body || {};
    if (!rootId) return sendError(res, 400, ERR.INVALID_INPUT, "rootId is required");
    if (!nodeId) return sendError(res, 400, ERR.INVALID_INPUT, "nodeId is required");
    const result = await addAgentParticipant({
      roomNodeId: req.params.roomId,
      rootId, nodeId, modeHint, label, userId: req.userId,
    });
    sendOk(res, result, 201);
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// POST /rooms/:roomId/users — add user participant
router.post("/rooms/:roomId/users", authenticate, async (req, res) => {
  try {
    const { userHomeNodeId, label } = req.body || {};
    if (!userHomeNodeId) return sendError(res, 400, ERR.INVALID_INPUT, "userHomeNodeId is required");
    const result = await addUserParticipant({
      roomNodeId: req.params.roomId,
      userHomeNodeId, label, userId: req.userId,
    });
    sendOk(res, result, 201);
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// POST /rooms/:roomId/observers — add observer
router.post("/rooms/:roomId/observers", authenticate, async (req, res) => {
  try {
    const { label, partnerId } = req.body || {};
    if (!label) return sendError(res, 400, ERR.INVALID_INPUT, "label is required");
    const result = await addObserverParticipant({
      roomNodeId: req.params.roomId, label, partnerId, userId: req.userId,
    });
    sendOk(res, result, 201);
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// DELETE /rooms/:roomId/participants/:subId — remove any participant
router.delete("/rooms/:roomId/participants/:subId", authenticate, async (req, res) => {
  try {
    const result = await removeParticipant({
      roomNodeId: req.params.roomId,
      subId: req.params.subId,
    });
    if (!result) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Participant not found");
    sendOk(res, result);
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// POST /rooms/:roomId/post — post a message into the room
router.post("/rooms/:roomId/post", authenticate, async (req, res) => {
  try {
    const { content, authorLabel } = req.body || {};
    if (!content) return sendError(res, 400, ERR.INVALID_INPUT, "content is required");
    const result = await postToRoom({
      roomNodeId: req.params.roomId,
      content, userId: req.userId, authorLabel,
    });
    sendOk(res, result, 201);
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// POST /rooms/:roomId/close — terminal state
router.post("/rooms/:roomId/close", authenticate, async (req, res) => {
  try {
    const { closeRoom } = await import("./core.js");
    await closeRoom(req.params.roomId);
    sendOk(res, { closed: true });
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

export default router;
