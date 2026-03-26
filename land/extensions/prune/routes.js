import log from "../../seed/log.js";
import express from "express";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import authenticate from "../../seed/middleware/authenticate.js";
import { getExtMeta } from "../../seed/tree/extensionMetadata.js";
import { scanForCandidates, confirmPrune, undoPrune, purge } from "./core.js";

let Node = null;
export function setModels(models) { Node = models.Node; }

function validateRootId(req, res) {
  const rootId = req.params.rootId;
  if (!rootId || rootId === "undefined" || rootId === "null") {
    sendError(res, 400, ERR.INVALID_INPUT, "rootId is required");
    return null;
  }
  return rootId;
}

const router = express.Router();

// GET /root/:rootId/prune - Show candidates
router.get("/root/:rootId/prune", authenticate, async (req, res) => {
  try {
    const rootId = validateRootId(req, res);
    if (!rootId) return;
    const root = await Node.findById(rootId).select("metadata name").lean();
    if (!root) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Tree not found");

    const pruneMeta = getExtMeta(root, "prune");

    sendOk(res, {
      rootId,
      candidates: pruneMeta.candidates || [],
      lastScanAt: pruneMeta.lastScanAt || null,
      lastPruneAt: pruneMeta.lastPruneAt || null,
      dormancyDays: pruneMeta.dormancyDays || 90,
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /root/:rootId/prune/scan - Run a fresh scan
router.post("/root/:rootId/prune/scan", authenticate, async (req, res) => {
  try {
    const rootId = validateRootId(req, res);
    if (!rootId) return;
    const candidates = await scanForCandidates(rootId, req.userId);
    sendOk(res, { candidates, count: candidates.length });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /root/:rootId/prune/confirm - Execute pruning
router.post("/root/:rootId/prune/confirm", authenticate, async (req, res) => {
  try {
    const rootId = validateRootId(req, res);
    if (!rootId) return;
    const result = await confirmPrune(rootId, req.userId, req.username);
    sendOk(res, result);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /root/:rootId/prune/undo - Restore a pruned node
router.post("/root/:rootId/prune/undo", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.body;
    if (!nodeId) return sendError(res, 400, ERR.INVALID_INPUT, "nodeId is required");
    const result = await undoPrune(nodeId, req.userId);
    sendOk(res, result);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /root/:rootId/prune/history - What was shed and absorbed
router.get("/root/:rootId/prune/history", authenticate, async (req, res) => {
  try {
    const rootId = validateRootId(req, res);
    if (!rootId) return;
    const root = await Node.findById(rootId).select("metadata").lean();
    if (!root) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Tree not found");

    const pruneMeta = getExtMeta(root, "prune");

    sendOk(res, {
      history: pruneMeta.history || [],
      totalPruned: (pruneMeta.history || []).reduce((sum, h) => sum + (h.pruned || 0), 0),
      totalAbsorbed: (pruneMeta.history || []).reduce((sum, h) => sum + (h.absorbed || 0), 0),
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /root/:rootId/prune/purge - Permanent removal (irreversible)
router.post("/root/:rootId/prune/purge", authenticate, async (req, res) => {
  try {
    const rootId = validateRootId(req, res);
    if (!rootId) return;
    const result = await purge(rootId, req.userId);
    sendOk(res, result);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
