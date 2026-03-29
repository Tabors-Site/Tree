import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import Node from "../../seed/models/node.js";
import { runScout, getScoutHistory, getScoutGaps } from "./core.js";

const router = express.Router();

// POST /node/:nodeId/scout - run a scout
router.post("/node/:nodeId/scout", authenticate, async (req, res) => {
  try {
    const { query } = req.body || {};
    if (!query || typeof query !== "string") {
      return sendError(res, 400, ERR.INVALID_INPUT, "query is required");
    }

    // Resolve tree root so strategies search the whole tree
    const node = await Node.findById(req.params.nodeId).select("rootOwner").lean();
    const rootId = node?.rootOwner ? String(node.rootOwner) : req.params.nodeId;

    const result = await runScout(req.params.nodeId, query, req.userId, req.username || "system", { rootId });
    if (result.error) {
      return sendError(res, 409, ERR.RESOURCE_CONFLICT, result.error);
    }
    sendOk(res, result);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /node/:nodeId/scout/history - previous scout runs
router.get("/node/:nodeId/scout/history", authenticate, async (req, res) => {
  try {
    const history = await getScoutHistory(req.params.nodeId);
    sendOk(res, { history });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /node/:nodeId/scout/gaps - accumulated knowledge gaps
router.get("/node/:nodeId/scout/gaps", authenticate, async (req, res) => {
  try {
    const gaps = await getScoutGaps(req.params.nodeId);
    sendOk(res, { gaps });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
