import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { runTrace, getTraceMap } from "./core.js";

const router = express.Router();

// POST /node/:nodeId/trace - trace a concept through the tree
router.post("/node/:nodeId/trace", authenticate, async (req, res) => {
  try {
    const { query, since } = req.body || {};
    if (!query || typeof query !== "string") {
      return sendError(res, 400, ERR.INVALID_INPUT, "query is required");
    }

    // Resolve root for trace (traces the whole tree from root)
    let rootId = req.params.nodeId;
    try {
      const { resolveRootNode } = await import("../../seed/tree/treeFetch.js");
      const root = await resolveRootNode(rootId);
      if (root?._id) rootId = root._id;
    } catch {
      // Use nodeId as root
    }

    const result = await runTrace(rootId, query, req.userId, req.username || "system", { since });
    if (result.error) {
      return sendError(res, 409, ERR.RESOURCE_CONFLICT, result.error);
    }
    sendOk(res, result);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /node/:nodeId/trace/map - last trace map
router.get("/node/:nodeId/trace/map", authenticate, async (req, res) => {
  try {
    const map = await getTraceMap(req.params.nodeId);
    if (!map) return sendOk(res, { message: "No trace map at this position." });
    sendOk(res, map);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
