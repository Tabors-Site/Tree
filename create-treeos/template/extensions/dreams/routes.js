import express from "express";
import mongoose from "mongoose";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import authenticate from "../../seed/middleware/authenticate.js";
import ShortMemory from "./model.js";

const router = express.Router();

/**
 * Load root and verify the requesting user is owner or contributor.
 * Returns the root doc or sends an error response.
 */
async function loadRootAndAuthorize(req, res, { ownerOnly = false } = {}) {
  const Node = mongoose.model("Node");
  const root = await Node.findById(req.params.rootId).lean();
  if (!root || !root.rootOwner) {
    sendError(res, 404, ERR.TREE_NOT_FOUND, "Tree not found");
    return null;
  }
  const userId = req.userId.toString();
  const isOwner = root.rootOwner.toString() === userId;
  const isContributor =
    !ownerOnly &&
    Array.isArray(root.contributors) &&
    root.contributors.some((c) => (c.user || c).toString() === userId);
  if (!isOwner && !isContributor) {
    sendError(res, 403, ERR.FORBIDDEN, "Not authorized");
    return null;
  }
  return root;
}

// GET /root/:rootId/holdings -- list pending + escalated items
router.get("/root/:rootId/holdings", authenticate, async (req, res) => {
  try {
    const root = await loadRootAndAuthorize(req, res);
    if (!root) return;

    const items = await ShortMemory.find({
      rootId: req.params.rootId,
      status: { $in: ["pending", "escalated"] },
    })
      .sort({ createdAt: -1 })
      .lean();

    if (items.length === 0) {
      return sendOk(res, { answer: "No short term memories right now." });
    }

    const list = items.map((item) => ({
      _id: item._id,
      title:
        item.content.length > 80
          ? item.content.slice(0, 80) + "..."
          : item.content,
      status: item.status,
      deferReason: item.deferReason,
      drainAttempts: item.drainAttempts,
      sourceType: item.sourceType,
      createdAt: item.createdAt,
    }));

    return sendOk(res, { items: list });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /root/:rootId/holdings/:itemId -- view full details
router.get("/root/:rootId/holdings/:itemId", authenticate, async (req, res) => {
  try {
    const root = await loadRootAndAuthorize(req, res);
    if (!root) return;

    const item = await ShortMemory.findById(req.params.itemId).lean();
    if (!item || item.rootId !== req.params.rootId) {
      return sendError(res, 404, ERR.NOTE_NOT_FOUND, "Item not found");
    }

    return sendOk(res, {
      _id: item._id,
      content: item.content,
      status: item.status,
      deferReason: item.deferReason,
      candidates: item.candidates,
      classificationAxes: item.classificationAxes,
      sourceType: item.sourceType,
      drainAttempts: item.drainAttempts,
      systemResponse: item.systemResponse,
      placedNodeId: item.placedNodeId,
      placedAt: item.placedAt,
      createdAt: item.createdAt,
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /root/:rootId/holdings/:itemId/dismiss -- dismiss an item
router.post(
  "/root/:rootId/holdings/:itemId/dismiss",
  authenticate,
  async (req, res) => {
    try {
      const root = await loadRootAndAuthorize(req, res, { ownerOnly: true });
      if (!root) return;

      const item = await ShortMemory.findById(req.params.itemId);
      if (!item || item.rootId !== req.params.rootId) {
        return sendError(res, 404, ERR.NOTE_NOT_FOUND, "Item not found");
      }

      if (item.status === "dismissed") {
        return sendOk(res, { _id: item._id, status: "dismissed" });
      }

      item.status = "dismissed";
      await item.save();

      return sendOk(res, { _id: item._id, status: "dismissed" });
    } catch (err) {
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  },
);

export default router;
