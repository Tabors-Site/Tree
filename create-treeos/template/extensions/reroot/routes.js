import express from "express";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import authenticate from "../../seed/middleware/authenticate.js";
import { analyze, getProposal, applyProposal, rejectProposal } from "./core.js";

function validateRootId(req, res) {
  const rootId = req.params.rootId;
  if (!rootId || rootId === "undefined" || rootId === "null") {
    sendError(res, 400, ERR.INVALID_INPUT, "rootId is required");
    return null;
  }
  return rootId;
}

const router = express.Router();

// POST /root/:rootId/reroot/analyze - Run analysis and generate proposal
router.post("/root/:rootId/reroot/analyze", authenticate, async (req, res) => {
  try {
    const rootId = validateRootId(req, res);
    if (!rootId) return;
    const result = await analyze(rootId, req.userId, req.username);
    sendOk(res, result);
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// GET /root/:rootId/reroot - Show current proposal
router.get("/root/:rootId/reroot", authenticate, async (req, res) => {
  try {
    const rootId = validateRootId(req, res);
    if (!rootId) return;
    const proposal = await getProposal(rootId);
    if (!proposal) {
      return sendOk(res, { proposal: null, message: "No proposal. Run reroot to analyze." });
    }
    sendOk(res, { proposal });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /root/:rootId/reroot/apply - Execute the proposal
router.post("/root/:rootId/reroot/apply", authenticate, async (req, res) => {
  try {
    const rootId = validateRootId(req, res);
    if (!rootId) return;
    const result = await applyProposal(rootId, req.userId);
    sendOk(res, result);
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// POST /root/:rootId/reroot/reject - Discard the proposal
router.post("/root/:rootId/reroot/reject", authenticate, async (req, res) => {
  try {
    const rootId = validateRootId(req, res);
    if (!rootId) return;
    const result = await rejectProposal(rootId, req.userId);
    sendOk(res, result);
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

export default router;
