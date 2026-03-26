import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { getMemory, clearMemory } from "./core.js";

const router = express.Router();

// GET /node/:nodeId/memory - trace summary
router.get("/node/:nodeId/memory", authenticate, async (req, res) => {
  try {
    const memory = await getMemory(req.params.nodeId);
    if (!memory) return sendOk(res, { message: "No cascade memory on this node." });
    sendOk(res, {
      lastSeen: memory.lastSeen,
      lastStatus: memory.lastStatus,
      lastSourceId: memory.lastSourceId,
      totalInteractions: memory.totalInteractions || 0,
      recentConnections: (memory.connections || []).length,
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /node/:nodeId/memory/connections - full connection list
router.get("/node/:nodeId/memory/connections", authenticate, async (req, res) => {
  try {
    const memory = await getMemory(req.params.nodeId);
    if (!memory) return sendOk(res, { connections: [] });
    sendOk(res, { connections: memory.connections || [] });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// DELETE /node/:nodeId/memory - clear trace
router.delete("/node/:nodeId/memory", authenticate, async (req, res) => {
  try {
    await clearMemory(req.params.nodeId);
    sendOk(res, { message: "Memory cleared" });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
