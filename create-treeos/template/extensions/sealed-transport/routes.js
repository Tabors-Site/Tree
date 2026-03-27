import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import Node from "../../seed/models/node.js";

const router = express.Router();

// GET /node/:nodeId/seal - seal status
router.get("/node/:nodeId/seal", authenticate, async (req, res) => {
  try {
    const node = await Node.findById(req.params.nodeId).select("name metadata").lean();
    if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");
    const meta = node.metadata instanceof Map ? Object.fromEntries(node.metadata) : (node.metadata || {});
    const mode = meta.cascade?.mode || "open";
    sendOk(res, {
      nodeId: req.params.nodeId,
      nodeName: node.name,
      cascadeMode: mode,
      sealed: mode === "sealed",
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /node/:nodeId/seal/on - set sealed
router.post("/node/:nodeId/seal/on", authenticate, async (req, res) => {
  try {
    await Node.findByIdAndUpdate(req.params.nodeId, {
      $set: { "metadata.cascade.mode": "sealed" },
    });
    sendOk(res, { message: "Cascade mode set to sealed", mode: "sealed" });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /node/:nodeId/seal/off - set open
router.post("/node/:nodeId/seal/off", authenticate, async (req, res) => {
  try {
    await Node.findByIdAndUpdate(req.params.nodeId, {
      $set: { "metadata.cascade.mode": "open" },
    });
    sendOk(res, { message: "Cascade mode set to open", mode: "open" });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
