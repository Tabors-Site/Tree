import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import User from "../../seed/models/user.js";
import { compressTree, compressBranch, compressToBudget, decompressNode, getCompressStatus } from "./core.js";

const router = express.Router();

// GET /root/:rootId/compress - compression status
router.get("/root/:rootId/compress", authenticate, async (req, res) => {
  try {
    const status = await getCompressStatus(req.params.rootId);
    sendOk(res, status);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /root/:rootId/compress - full tree compression
router.post("/root/:rootId/compress", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("username").lean();
    const { targetSizeBytes } = req.body || {};

    let result;
    if (targetSizeBytes) {
      result = await compressToBudget(req.params.rootId, req.userId, user?.username, targetSizeBytes);
    } else {
      result = await compressTree(req.params.rootId, req.userId, user?.username);
    }

    sendOk(res, result);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /node/:nodeId/compress - branch compression
router.post("/node/:nodeId/compress", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("username").lean();
    const result = await compressBranch(req.params.nodeId, req.userId, user?.username);
    sendOk(res, result);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /node/:nodeId/decompress - restore a trimmed node
router.post("/node/:nodeId/decompress", authenticate, async (req, res) => {
  try {
    const result = await decompressNode(req.params.nodeId, req.userId);
    sendOk(res, result);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /root/:rootId/compress/budget - budget-targeted compression
router.post("/root/:rootId/compress/budget", authenticate, async (req, res) => {
  try {
    const size = parseInt(req.body.size, 10);
    if (!size || size <= 0) return sendError(res, 400, ERR.INVALID_INPUT, "size must be a positive number in bytes");
    const user = await User.findById(req.userId).select("username").lean();
    const result = await compressToBudget(req.params.rootId, req.userId, user?.username, size);
    sendOk(res, result);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
