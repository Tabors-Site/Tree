import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { calculateFitness, getPatterns, getDormant } from "./core.js";

const router = express.Router();

// GET /node/:nodeId/evolution - fitness metrics
router.get("/node/:nodeId/evolution", authenticate, async (req, res) => {
  try {
    const fitness = await calculateFitness(req.params.nodeId);
    if (!fitness) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");
    sendOk(res, fitness);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /root/:rootId/evolution/patterns - discovered patterns
router.get("/root/:rootId/evolution/patterns", authenticate, async (req, res) => {
  try {
    const patterns = await getPatterns(req.params.rootId);
    sendOk(res, { count: patterns.length, patterns });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /root/:rootId/evolution/dormant - dormant branches
router.get("/root/:rootId/evolution/dormant", authenticate, async (req, res) => {
  try {
    const dormant = await getDormant(req.params.rootId);
    sendOk(res, { dormantCount: dormant.length, branches: dormant });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
