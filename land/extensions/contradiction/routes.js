import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import Being from "../../seed/models/being.js";
import { getContradictions, resolveContradiction, scanTree } from "./core.js";

const router = express.Router();

// GET /node/:nodeId/contradictions
router.get("/node/:nodeId/contradictions", authenticate, async (req, res) => {
  try {
    const all = await getContradictions(req.params.nodeId);
    const active = all.filter((c) => c.status === "active");
    const resolved = all.filter((c) => c.status === "resolved");
    sendOk(res, { active: active.length, resolved: resolved.length, contradictions: active });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /node/:nodeId/contradictions/resolve
router.post("/node/:nodeId/contradictions/resolve", authenticate, async (req, res) => {
  try {
    const { contradictionId } = req.body;
    if (!contradictionId) return sendError(res, 400, ERR.INVALID_INPUT, "contradictionId required");
    const entry = await resolveContradiction(req.params.nodeId, contradictionId);
    sendOk(res, entry);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /root/:rootId/contradictions/scan
router.post("/root/:rootId/contradictions/scan", authenticate, async (req, res) => {
  try {
    const user = await Being.findById(req.beingId).select("username").lean();
    const result = await scanTree(req.params.rootId, req.beingId, user?.username);
    sendOk(res, result);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
