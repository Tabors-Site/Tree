import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { resolveRootNode } from "../../seed/tree/treeFetch.js";
import { runScout, getScoutHistory, getScoutGaps } from "./core.js";

const router = express.Router();

// POST /node/:nodeId/scout - run a scout
router.post("/node/:nodeId/scout", authenticate, async (req, res) => {
  try {
    const { query } = req.body || {};
    if (!query || typeof query !== "string") {
      return sendError(res, 400, ERR.INVALID_INPUT, "query is required");
    }

    // Walk up to tree root so strategies search the whole tree
    const rootNode = await resolveRootNode(req.params.nodeId);
    const rootId = String(rootNode._id);

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
