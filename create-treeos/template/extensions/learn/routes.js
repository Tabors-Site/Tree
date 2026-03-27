import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { getLearnState, pauseLearn, resumeLearn, stopLearn, processQueue } from "./core.js";
import User from "../../seed/models/user.js";

const router = express.Router();

// GET /node/:nodeId/learn - learn status
router.get("/node/:nodeId/learn", authenticate, async (req, res) => {
  try {
    const state = await getLearnState(req.params.nodeId);
    if (!state) return sendOk(res, { message: "No learn operation on this node." });
    sendOk(res, {
      status: state.status,
      nodesCreated: state.nodesCreated,
      nodesProcessed: state.nodesProcessed,
      queueRemaining: (state.queue || []).length,
      targetNoteSize: state.targetNoteSize,
      startedAt: state.startedAt,
      lastActivityAt: state.lastActivityAt,
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /node/:nodeId/learn/resume - resume and process next batch
router.post("/node/:nodeId/learn/resume", authenticate, async (req, res) => {
  try {
    const nodeId = req.params.nodeId;
    const state = await getLearnState(nodeId);
    if (!state) return sendError(res, 404, ERR.NODE_NOT_FOUND, "No learn operation on this node");
    if (state.status === "complete") return sendOk(res, { message: "Already complete", ...state });

    if (state.status === "paused") await resumeLearn(nodeId);

    const user = await User.findById(req.userId).select("username").lean();
    const updated = await processQueue(nodeId, req.userId, user?.username, 10);
    sendOk(res, updated);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /node/:nodeId/learn/pause - pause
router.post("/node/:nodeId/learn/pause", authenticate, async (req, res) => {
  try {
    const state = await pauseLearn(req.params.nodeId);
    if (!state) return sendError(res, 404, ERR.NODE_NOT_FOUND, "No learn operation on this node");
    sendOk(res, state);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /node/:nodeId/learn/stop - stop and clear queue
router.post("/node/:nodeId/learn/stop", authenticate, async (req, res) => {
  try {
    const state = await stopLearn(req.params.nodeId);
    if (!state) return sendError(res, 404, ERR.NODE_NOT_FOUND, "No learn operation on this node");
    sendOk(res, state);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
