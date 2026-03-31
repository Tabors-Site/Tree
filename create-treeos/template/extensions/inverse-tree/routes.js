import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { getProfile, addCorrection, resetProfile } from "./core.js";

const router = express.Router();

// GET /user/:userId/inverse - profile as the AI sees it
router.get("/user/:userId/inverse", (req, res, next) => {
  if ("html" in req.query) return next("route");
  next();
}, authenticate, async (req, res) => {
  try {
    // Users can only read their own inverse profile
    if (req.params.userId !== req.userId) {
      return sendError(res, 403, ERR.FORBIDDEN, "Can only view your own inverse profile");
    }
    const data = await getProfile(req.userId);
    sendOk(res, data || { profile: {}, stats: {}, corrections: [] });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /user/:userId/inverse/correct - manual correction
router.post("/user/:userId/inverse/correct", authenticate, async (req, res) => {
  try {
    if (req.params.userId !== req.userId) {
      return sendError(res, 403, ERR.FORBIDDEN, "Can only correct your own inverse profile");
    }
    const { text } = req.body;
    if (!text || typeof text !== "string") {
      return sendError(res, 400, ERR.INVALID_INPUT, "text is required");
    }
    const corrections = await addCorrection(req.userId, text);
    sendOk(res, { corrections: corrections.length, message: "Correction recorded" });
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// POST /user/:userId/inverse/reset - wipe profile
router.post("/user/:userId/inverse/reset", authenticate, async (req, res) => {
  try {
    if (req.params.userId !== req.userId) {
      return sendError(res, 403, ERR.FORBIDDEN, "Can only reset your own inverse profile");
    }
    await resetProfile(req.userId);
    sendOk(res, { message: "Inverse profile reset" });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
