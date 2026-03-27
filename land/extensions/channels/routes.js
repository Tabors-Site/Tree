import express from "express";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import authenticate from "../../seed/middleware/authenticate.js";
import { getChannels, createChannel, removeChannel, acceptInvite } from "./core.js";

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

export default router;
