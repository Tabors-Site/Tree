import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { runExplore, getExploreMap, getExploreGaps } from "./core.js";

const router = express.Router();

// POST /node/:nodeId/explore - run exploration
router.post("/node/:nodeId/explore", authenticate, async (req, res) => {
  try {
    const { query, deep } = req.body || {};
    if (!query || typeof query !== "string") {
      return sendError(res, 400, ERR.INVALID_INPUT, "query is required");
    }
    const map = await runExplore(req.params.nodeId, query, req.userId, req.username || "system", { deep: !!deep });
    sendOk(res, map);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /node/:nodeId/explore/map - last exploration map
router.get("/node/:nodeId/explore/map", authenticate, async (req, res) => {
  try {
    const map = await getExploreMap(req.params.nodeId);
    if (!map) return sendOk(res, { message: "No exploration map at this position." });
    sendOk(res, map);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /node/:nodeId/explore/gaps - unexplored areas
router.get("/node/:nodeId/explore/gaps", authenticate, async (req, res) => {
  try {
    const result = await getExploreGaps(req.params.nodeId);
    sendOk(res, result);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
