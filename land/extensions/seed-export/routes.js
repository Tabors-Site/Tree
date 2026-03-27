import express from "express";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import authenticate from "../../seed/middleware/authenticate.js";
import { exportTreeSeed, plantTreeSeed, analyzeSeed } from "./core.js";

const router = express.Router();

// GET /node/:nodeId/seed-export - Export subtree as a seed file
router.get("/node/:nodeId/seed-export", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const cascade = req.query.cascade === "true";
    const seed = await exportTreeSeed(nodeId, req.userId, { cascade });
    sendOk(res, seed);
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// POST /seed/plant - Plant a seed file
router.post("/seed/plant", authenticate, async (req, res) => {
  try {
    const seedData = req.body;
    if (!seedData?.tree) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Request body must contain a seed file with a tree field");
    }
    const result = await plantTreeSeed(seedData, req.userId, req.username);
    sendOk(res, result, 201);
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// POST /seed/analyze - Analyze a seed file without planting
router.post("/seed/analyze", authenticate, async (req, res) => {
  try {
    const seedData = req.body;
    if (!seedData?.tree) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Request body must contain a seed file with a tree field");
    }
    const analysis = await analyzeSeed(seedData);
    sendOk(res, analysis);
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

export default router;
