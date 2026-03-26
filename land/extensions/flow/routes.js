import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import log from "../../seed/log.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { getFlowForPosition } from "./core.js";

const router = express.Router();

// GET /node/:nodeId/flow - Cascade flow scoped to position
// Land root: all flow. Tree root: tree-wide flow. Node: that node's flow.
router.get("/node/:nodeId/flow", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const limit = Math.min(Math.max(parseInt(req.query.limit || "50", 10), 1), 500);
    const data = await getFlowForPosition(nodeId, limit);
    sendOk(res, data);
  } catch (err) {
    log.error("Flow", "Error reading flow:", err.message);
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
