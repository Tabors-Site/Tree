import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { getSuggestions, dismissSuggestion, acceptSuggestion, generateSuggestions } from "./core.js";

const router = express.Router();

// GET /root/:rootId/delegate - list pending suggestions
router.get("/root/:rootId/delegate", authenticate, async (req, res) => {
  try {
    const suggestions = await getSuggestions(req.params.rootId, req.query.mine === "true" ? req.userId : null);
    sendOk(res, { suggestions });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /root/:rootId/delegate/dismiss - dismiss a suggestion
router.post("/root/:rootId/delegate/dismiss", authenticate, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return sendError(res, 400, ERR.INVALID_INPUT, "id is required");
    const result = await dismissSuggestion(req.params.rootId, id, req.userId);
    if (!result) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Suggestion not found");
    sendOk(res, result);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /root/:rootId/delegate/accept - accept a suggestion
router.post("/root/:rootId/delegate/accept", authenticate, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return sendError(res, 400, ERR.INVALID_INPUT, "id is required");
    const result = await acceptSuggestion(req.params.rootId, id, req.userId);
    if (!result) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Suggestion not found");
    sendOk(res, result);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
