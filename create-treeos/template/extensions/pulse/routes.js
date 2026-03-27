import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { getLatestSnapshot, ensurePulseNode } from "./core.js";
import Node from "../../seed/models/node.js";
import Note from "../../seed/models/note.js";

const router = express.Router();

// GET /pulse - latest health snapshot (CLI endpoint)
router.get("/pulse", authenticate, async (req, res) => {
  try {
    const snapshot = await getLatestSnapshot();
    if (!snapshot) {
      return sendOk(res, { message: "No pulse data yet. Health check has not run." });
    }
    sendOk(res, snapshot);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /pulse/history - last 10 snapshots
router.get("/pulse/history", authenticate, async (req, res) => {
  try {
    const nodeId = await ensurePulseNode();
    const notes = await Note.find({ nodeId, contentType: "text" })
      .sort({ createdAt: -1 })
      .limit(10)
      .select("content createdAt metadata")
      .lean();

    const snapshots = notes.map((n) => ({
      timestamp: n.createdAt,
      elevated: n.metadata instanceof Map ? n.metadata.get("elevated") : n.metadata?.elevated,
      failureRate: n.metadata instanceof Map ? n.metadata.get("failureRate") : n.metadata?.failureRate,
      summary: n.content,
    }));

    sendOk(res, { count: snapshots.length, history: snapshots });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /pulse/peers - peer-specific health
router.get("/pulse/peers", authenticate, async (req, res) => {
  try {
    const snapshot = await getLatestSnapshot();
    if (!snapshot) return sendOk(res, { peers: [] });
    sendOk(res, { peers: snapshot.peers || [] });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
