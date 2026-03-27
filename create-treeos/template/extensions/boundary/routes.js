import express from "express";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import authenticate from "../../seed/middleware/authenticate.js";
import { analyze, analyzeBranch, getBoundaryReport } from "./core.js";

function validateRootId(req, res) {
  const rootId = req.params.rootId;
  if (!rootId || rootId === "undefined" || rootId === "null") {
    sendError(res, 400, ERR.INVALID_INPUT, "rootId is required");
    return null;
  }
  return rootId;
}

const router = express.Router();

// GET /root/:rootId/boundary - Last analysis results
router.get("/root/:rootId/boundary", authenticate, async (req, res) => {
  try {
    const rootId = validateRootId(req, res);
    if (!rootId) return;
    const report = await getBoundaryReport(rootId);
    sendOk(res, {
      rootId,
      report: report || null,
      stale: !!report?.stale,
      lastAnalysis: report?.lastAnalysis || null,
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /root/:rootId/boundary/analyze - Full tree analysis
router.post("/root/:rootId/boundary/analyze", authenticate, async (req, res) => {
  try {
    const rootId = validateRootId(req, res);
    if (!rootId) return;
    const result = await analyze(rootId, req.userId, req.username);
    sendOk(res, result);
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// POST /node/:nodeId/boundary/analyze - Subtree analysis
router.post("/node/:nodeId/boundary/analyze", authenticate, async (req, res) => {
  try {
    const nodeId = req.params.nodeId;
    if (!nodeId || nodeId === "undefined" || nodeId === "null") {
      return sendError(res, 400, ERR.INVALID_INPUT, "nodeId is required");
    }
    const result = await analyzeBranch(nodeId, req.userId, req.username);
    sendOk(res, result);
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

export default router;
