import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { getWatchlist, watchTool, unwatchTool, getPendingRequests, resolveRequest } from "./core.js";

const router = express.Router();

// GET /node/:nodeId/approve - show watchlist and pending
router.get("/node/:nodeId/approve", authenticate, async (req, res) => {
  try {
    const watchlist = await getWatchlist(req.params.nodeId);
    const pending = getPendingRequests();
    sendOk(res, { watchlist, pending });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /node/:nodeId/approve/watch - add tool to watchlist
router.post("/node/:nodeId/approve/watch", authenticate, async (req, res) => {
  try {
    const { toolName } = req.body;
    if (!toolName) return sendError(res, 400, ERR.INVALID_INPUT, "toolName is required");
    const list = await watchTool(req.params.nodeId, toolName);
    sendOk(res, { watchlist: list });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /node/:nodeId/approve/unwatch - remove tool from watchlist
router.post("/node/:nodeId/approve/unwatch", authenticate, async (req, res) => {
  try {
    const { toolName } = req.body;
    if (!toolName) return sendError(res, 400, ERR.INVALID_INPUT, "toolName is required");
    const list = await unwatchTool(req.params.nodeId, toolName);
    sendOk(res, { watchlist: list });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /node/:nodeId/approve/pending - pending requests
router.get("/node/:nodeId/approve/pending", authenticate, async (req, res) => {
  try {
    sendOk(res, { pending: getPendingRequests() });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /node/:nodeId/approve/resolve - approve or reject
router.post("/node/:nodeId/approve/resolve", authenticate, async (req, res) => {
  try {
    const { id, decision } = req.body;
    if (!id) return sendError(res, 400, ERR.INVALID_INPUT, "id is required");
    if (!["approved", "rejected"].includes(decision)) {
      return sendError(res, 400, ERR.INVALID_INPUT, "decision must be 'approved' or 'rejected'");
    }
    const result = resolveRequest(id, decision, req.userId);
    if (!result) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Request not found or already resolved");
    sendOk(res, result);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
