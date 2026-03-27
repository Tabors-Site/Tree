import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import log from "../../seed/log.js";
import { v4 as uuidv4 } from "uuid";
import { sendOk, sendError, ERR, CASCADE } from "../../seed/protocol.js";

const router = express.Router();

// Map cascade rejection reasons to HTTP error codes
const REJECTION_MAP = {
  "rate_limited":                 { http: 429, code: ERR.CASCADE_REJECTED },
  "payload_too_large":            { http: 429, code: ERR.CASCADE_REJECTED },
  "depth limit exceeded":         { http: 413, code: ERR.CASCADE_DEPTH_EXCEEDED },
  "tree circuit breaker tripped": { http: 503, code: ERR.TREE_DORMANT },
  "system nodes do not cascade":  { http: 403, code: ERR.FORBIDDEN },
};

// POST /node/:nodeId/cascade - Deliver a cascade signal to a node (the arrival path)
router.post("/node/:nodeId/cascade", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { payload, source, signalId: existingSignalId, depth } = req.body;

    const { getLandConfigValue } = await import("../../seed/landConfig.js");
    const enabled = getLandConfigValue("cascadeEnabled");
    if (enabled === false || enabled === "false") {
      return sendError(res, 403, ERR.CASCADE_DISABLED, "Cascade is disabled on this land");
    }

    const { deliverCascade } = await import("../../seed/tree/cascade.js");
    const signalId = existingSignalId || uuidv4();

    const result = await deliverCascade({
      nodeId,
      signalId,
      payload: payload || {},
      source: source || nodeId,
      depth: depth || 0,
    });

    // Map cascade failures to HTTP error codes
    if (result.status === CASCADE.REJECTED) {
      const reason = result.payload?.reason;
      const mapping = REJECTION_MAP[reason] || { http: 500, code: ERR.INTERNAL };
      return sendError(res, mapping.http, mapping.code, reason || "Cascade rejected", { signalId, result });
    }

    if (result.status === CASCADE.FAILED) {
      const reason = result.payload?.reason;
      if (reason === "node not found") {
        return sendError(res, 404, ERR.NODE_NOT_FOUND, reason, { signalId, result });
      }
      return sendError(res, 500, ERR.INTERNAL, reason || "Cascade failed", { signalId, result });
    }

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
