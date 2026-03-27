import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { getCodebook, clearCodebook, runCompression } from "./core.js";
import User from "../../seed/models/user.js";

const router = express.Router();

// GET /node/:nodeId/codebook - dictionary for current user
router.get("/node/:nodeId/codebook", authenticate, async (req, res) => {
  try {
    const entry = await getCodebook(req.params.nodeId, req.userId);
    if (!entry || !entry.dictionary) {
      return sendOk(res, { message: "No codebook yet. It builds after enough conversations." });
    }
    sendOk(res, {
      entries: Object.keys(entry.dictionary).length,
      lastCompressed: entry.lastCompressed,
      dictionary: entry.dictionary,
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /node/:nodeId/codebook/stats
router.get("/node/:nodeId/codebook/stats", authenticate, async (req, res) => {
  try {
    const entry = await getCodebook(req.params.nodeId, req.userId);
    sendOk(res, {
      notesSinceCompression: entry?.notesSinceCompression || 0,
      dictionarySize: entry?.dictionary ? Object.keys(entry.dictionary).length : 0,
      lastCompressed: entry?.lastCompressed || null,
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /node/:nodeId/codebook/compress - force compression
router.post("/node/:nodeId/codebook/compress", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("username").lean();
    const result = await runCompression(req.params.nodeId, req.userId, user?.username);
    if (!result) return sendOk(res, { message: "Compression skipped. Not enough history." });
    sendOk(res, { entries: Object.keys(result).length, dictionary: result });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// DELETE /node/:nodeId/codebook - clear dictionary
router.delete("/node/:nodeId/codebook", authenticate, async (req, res) => {
  try {
    await clearCodebook(req.params.nodeId, req.userId);
    sendOk(res, { message: "Codebook cleared" });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
