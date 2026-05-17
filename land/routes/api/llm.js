import log from "../../seed/log.js";
import express from "express";
import Being from "../../seed/models/being.js";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import {
  addLlmConnection,
  updateLlmConnection,
  deleteLlmConnection,
  getConnectionsForUser,
  assignConnection,
} from "../../seed/llm/connections.js";

const router = express.Router();

// ── List connections ─────────────────────────────────────────────────────

router.get("/user/:beingId/custom-llm", authenticate, async (req, res) => {
  try {
    const connections = await getConnectionsForUser(req.params.beingId);
    return sendOk(res, { connections });
  } catch (err) {
    return sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// ── Add connection ───────────────────────────────────────────────────────

router.post("/user/:beingId/custom-llm", authenticate, async (req, res) => {
  try {
    const { name, baseUrl, model } = req.body;
    const apiKey = req.body.apiKey || "none";
    if (!name || !baseUrl || !model) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Missing required fields: name, baseUrl, model");
    }
    const result = await addLlmConnection(req.params.beingId, {
      name,
      baseUrl,
      apiKey,
      model,
    });

    try {
      const user = await Being.findById(req.params.beingId)
        .select("llmDefault metadata")
        .lean();
      if (!user?.llmDefault) {
        await assignConnection(req.params.beingId, "main", result._id);
      }
    } catch (assignErr) {
      log.error("LLM", "Auto-assign main failed:", assignErr.message);
    }

    return sendOk(res, { connection: result }, 201);
  } catch (err) {
    log.error("LLM", "Failed to save custom LLM:", err.message);
    const status = err.message.includes("Maximum") ? 400 : 500;
    const code = status === 400 ? ERR.INVALID_INPUT : ERR.INTERNAL;
    return sendError(res, status, code, err.message);
  }
});

// ── Update connection ────────────────────────────────────────────────────

router.put(
  "/user/:beingId/custom-llm/:connectionId",
  authenticate,
  async (req, res) => {
    try {
      const { name, baseUrl, apiKey, model } = req.body;
      if (!baseUrl || !model) {
        return sendError(res, 400, ERR.INVALID_INPUT, "Missing required fields: baseUrl, model");
      }
      const result = await updateLlmConnection(
        req.params.beingId,
        req.params.connectionId,
        { name, baseUrl, apiKey, model },
      );
      return sendOk(res, { connection: result });
    } catch (err) {
      log.error("LLM", "Failed to update custom LLM:", err.message);
      return sendError(res, 500, ERR.INTERNAL, err.message);
    }
  },
);

// ── Delete connection ────────────────────────────────────────────────────

router.delete(
  "/user/:beingId/custom-llm/:connectionId",
  authenticate,
  async (req, res) => {
    try {
      await deleteLlmConnection(
        req.params.beingId,
        req.params.connectionId,
      );
      return sendOk(res, { removed: true });
    } catch (err) {
      log.error("LLM", "Failed to delete custom LLM:", err.message);
      return sendError(res, 500, ERR.INTERNAL, err.message);
    }
  },
);

// ── User slot assignment ─────────────────────────────────────────────────

router.post("/user/:beingId/llm-assign", authenticate, async (req, res) => {
  try {
    const { slot, connectionId } = req.body;
    if (!slot) return sendError(res, 400, ERR.INVALID_INPUT, "slot is required");
    const result = await assignConnection(
      req.params.beingId,
      slot,
      connectionId || null,
    );
    return sendOk(res, result);
  } catch (err) {
    log.error("LLM", "Failed to assign custom LLM:", err.message);
    return sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
