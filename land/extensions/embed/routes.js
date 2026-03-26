import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { findRelatedAtNode, getEmbedStatus } from "./core.js";

const router = express.Router();

// GET /node/:nodeId/related - semantically similar notes
router.get("/node/:nodeId/related", authenticate, async (req, res) => {
  try {
    const searchAll = req.query.all === "true" || req.query.all === "1";
    const results = await findRelatedAtNode(req.params.nodeId, req.userId, req.query.rootId || null, searchAll);
    sendOk(res, { count: results.length, results });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /embed/status - coverage stats
router.get("/embed/status", authenticate, async (req, res) => {
  try {
    const status = await getEmbedStatus();
    sendOk(res, status);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
