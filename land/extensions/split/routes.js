import express from "express";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import authenticate from "../../seed/middleware/authenticate.js";
import { analyze, preview, execute, getHistory } from "./core.js";

const router = express.Router();

// POST /root/:rootId/split/analyze - Analyze all branches for split candidates
router.post("/root/:rootId/split/analyze", authenticate, async (req, res) => {
  try {
    const result = await analyze(req.params.rootId, req.userId);
    sendOk(res, result);
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// POST /node/:nodeId/split/preview - Preview what a split would do
router.post("/node/:nodeId/split/preview", authenticate, async (req, res) => {
  try {
    const result = await preview(req.params.nodeId, req.userId);
    sendOk(res, result);
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// POST /node/:nodeId/split/execute - Execute the split
router.post("/node/:nodeId/split/execute", authenticate, async (req, res) => {
  try {
    const result = await execute(req.params.nodeId, req.userId, req.username);
    sendOk(res, result, 201);
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// GET /root/:rootId/split/history - Past splits from this tree
router.get("/root/:rootId/split/history", authenticate, async (req, res) => {
  try {
    const result = await getHistory(req.params.rootId);
    sendOk(res, result);
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

export default router;
