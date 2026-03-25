import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import log from "../../seed/log.js";
import { v4 as uuidv4 } from "uuid";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";

const router = express.Router();

// POST /node/:nodeId/cascade - Deliver a cascade signal to a node (the arrival path)
router.post("/node/:nodeId/cascade", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { payload, source, signalId: existingSignalId, depth } = req.body;

    const { deliverCascade } = await import("../../seed/tree/cascade.js");
    const signalId = existingSignalId || uuidv4();

    const result = await deliverCascade({
      nodeId,
      signalId,
      payload: payload || {},
      source: source || nodeId,
      depth: depth || 0,
    });

    sendOk(res, { signalId, result });
  } catch (err) {
    log.error("Cascade", "Deliver error:", err.message);
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /flow - Recent cascade results from .flow
router.get("/flow", authenticate, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || "50", 10);
    const { getAllCascadeResults } = await import("../../seed/tree/cascade.js");
    const results = await getAllCascadeResults(limit);
    sendOk(res, { results });
  } catch (err) {
    log.error("Cascade", "Flow read error:", err.message);
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /flow/:signalId - Results for a specific signal
router.get("/flow/:signalId", authenticate, async (req, res) => {
  try {
    const { getCascadeResults } = await import("../../seed/tree/cascade.js");
    const results = await getCascadeResults(req.params.signalId);
    sendOk(res, { signalId: req.params.signalId, results });
  } catch (err) {
    log.error("Cascade", "Flow signal read error:", err.message);
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
