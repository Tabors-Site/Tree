import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import Node from "../../seed/models/node.js";
import { getReviewConfig, getReviewHistory } from "./core.js";

let _metadata = null;
export function setMetadata(metadata) { _metadata = metadata; }

const router = express.Router();

// GET /node/:nodeId/review/status
router.get("/node/:nodeId/review/status", authenticate, async (req, res) => {
  try {
    const node = await Node.findById(req.params.nodeId).select("metadata").lean();
    if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");

    const config = getReviewConfig(node);
    if (!config.partner) return sendOk(res, { configured: false });

    let partnerName = null;
    try {
      const p = await Node.findById(config.partner).select("name").lean();
      partnerName = p?.name || null;
    } catch {}

    sendOk(res, {
      configured: true,
      partner: { nodeId: config.partner, name: partnerName },
      status: config.status,
      maxRounds: config.maxRounds,
      autoApply: config.autoApply,
      reviewPrompt: config.reviewPrompt || null,
      currentReviewId: config.currentReviewId || null,
      reviewsCompleted: (config.history || []).filter((h) => h.completedAt).length,
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /node/:nodeId/review/partner
router.post("/node/:nodeId/review/partner", authenticate, async (req, res) => {
  try {
    const { partnerId, maxRounds, autoApply, reviewPrompt } = req.body;
    if (!partnerId) return sendError(res, 400, ERR.INVALID_INPUT, "partnerId required");

    const node = await Node.findById(req.params.nodeId);
    if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");
    if (node.systemRole) return sendError(res, 403, ERR.FORBIDDEN, "Cannot set review on system nodes");

    if (partnerId === req.params.nodeId) {
      return sendError(res, 400, ERR.INVALID_INPUT, "A node cannot review itself");
    }

    const partner = await Node.findById(partnerId).select("name systemRole").lean();
    if (!partner) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Partner node not found");
    if (partner.systemRole) return sendError(res, 403, ERR.FORBIDDEN, "Cannot use system node as reviewer");

    const existing = getReviewConfig(node);
    const config = {
      ...existing,
      partner: partnerId,
      trigger: "afterNote",
      status: existing.status === "paused" ? "paused" : "idle",
    };
    if (maxRounds !== undefined) config.maxRounds = Math.max(1, Math.min(Number(maxRounds) || 5, 20));
    if (autoApply !== undefined) config.autoApply = !!autoApply;
    if (reviewPrompt !== undefined) config.reviewPrompt = reviewPrompt || null;

    await _metadata.setExtMeta(node, "peer-review", config);
    sendOk(res, { partner: { nodeId: partnerId, name: partner.name }, config });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// DELETE /node/:nodeId/review
router.delete("/node/:nodeId/review", authenticate, async (req, res) => {
  try {
    const node = await Node.findById(req.params.nodeId);
    if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");

    const config = getReviewConfig(node);
    if (!config.partner) return sendOk(res, { message: "No review configuration to remove" });

    await _metadata.setExtMeta(node, "peer-review", null);
    sendOk(res, { message: "Review configuration removed" });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /node/:nodeId/review/history
router.get("/node/:nodeId/review/history", authenticate, async (req, res) => {
  try {
    const node = await Node.findById(req.params.nodeId).select("metadata").lean();
    if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");

    const limit = Math.max(1, Math.min(Number(req.query.limit) || 10, 50));
    const history = getReviewHistory(node, limit);
    sendOk(res, { count: history.length, history });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /node/:nodeId/review/pause
router.post("/node/:nodeId/review/pause", authenticate, async (req, res) => {
  try {
    const node = await Node.findById(req.params.nodeId);
    if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");

    const config = getReviewConfig(node);
    if (!config.partner) return sendError(res, 400, ERR.INVALID_INPUT, "No review partner configured");

    await _metadata.setExtMeta(node, "peer-review", { ...config, status: "paused" });
    sendOk(res, { status: "paused" });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /node/:nodeId/review/resume
router.post("/node/:nodeId/review/resume", authenticate, async (req, res) => {
  try {
    const node = await Node.findById(req.params.nodeId);
    if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");

    const config = getReviewConfig(node);
    if (!config.partner) return sendError(res, 400, ERR.INVALID_INPUT, "No review partner configured");

    await _metadata.setExtMeta(node, "peer-review", { ...config, status: "idle" });
    sendOk(res, { status: "idle" });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
