import log from "../../seed/log.js";
import express from "express";
import User from "../../seed/models/user.js";
import authenticate from "../../seed/middleware/authenticate.js";
import authenticateLite from "../html-rendering/authenticateLite.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import {
  addLlmConnection,
  updateLlmConnection,
  deleteLlmConnection,
  getConnectionsForUser,
  assignConnection,
} from "../../seed/llm/connections.js";

const router = express.Router();

router.get("/user/:userId/custom-llm", authenticate, async (req, res) => {
  try {
    const connections = await getConnectionsForUser(req.params.userId);
    return sendOk(res, { connections });
  } catch (err) {
    return sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.post("/user/:userId/llm-assign", authenticate, async (req, res) => {
  try {
    const { slot, connectionId } = req.body;
    if (!slot) return sendError(res, 400, ERR.INVALID_INPUT, "slot is required");
    const result = await assignConnection(
      req.params.userId,
      slot,
      connectionId || null,
    );
    return sendOk(res, result);
  } catch (err) {
 log.error("User Llm", "Failed to assign custom LLM:", err.message);
    return sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.post("/user/:userId/custom-llm", authenticate, async (req, res) => {
  try {
    const { name, baseUrl, apiKey, model } = req.body;
    if (!name || !baseUrl || !apiKey || !model) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Missing required fields: name, baseUrl, apiKey, model");
    }
    const result = await addLlmConnection(req.params.userId, {
      name,
      baseUrl,
      apiKey,
      model,
    });

    try {
      const user = await User.findById(req.params.userId)
        .select("llmDefault metadata")
        .lean();
      if (!user?.llmDefault) {
        await assignConnection(req.params.userId, "main", result._id);
      }
    } catch (assignErr) {
 log.error("User Llm", "Auto-assign main failed:", assignErr.message);
    }

    return sendOk(res, { connection: result }, 201);
  } catch (err) {
 log.error("User Llm", "Failed to save custom LLM:", err.message);
    const status = err.message.includes("Maximum") ? 400 : 500;
    const code = status === 400 ? ERR.INVALID_INPUT : ERR.INTERNAL;
    return sendError(res, status, code, err.message);
  }
});

router.put(
  "/user/:userId/custom-llm/:connectionId",
  authenticate,
  async (req, res) => {
    try {
      const { name, baseUrl, apiKey, model } = req.body;
      if (!baseUrl || !model) {
        return sendError(res, 400, ERR.INVALID_INPUT, "Missing required fields: baseUrl, model");
      }
      const result = await updateLlmConnection(
        req.params.userId,
        req.params.connectionId,
        { name, baseUrl, apiKey, model },
      );
      return sendOk(res, { connection: result });
    } catch (err) {
 log.error("User Llm", "Failed to update custom LLM:", err.message);
      return sendError(res, 500, ERR.INTERNAL, err.message);
    }
  },
);

router.delete(
  "/user/:userId/custom-llm/:connectionId",
  authenticate,
  async (req, res) => {
    try {
      await deleteLlmConnection(
        req.params.userId,
        req.params.connectionId,
      );
      return sendOk(res, { removed: true });
    } catch (err) {
 log.error("User Llm", "Failed to delete custom LLM:", err.message);
      return sendError(res, 500, ERR.INTERNAL, err.message);
    }
  },
);

// ── Failover Stack ──

router.get("/user/:userId/llm-failover", authenticateLite, async (req, res) => {
  try {
    if (!req.userId) return sendError(res, 401, ERR.UNAUTHORIZED, "Authentication required");
    const user = await User.findById(req.userId).select("metadata").lean();
    const meta = user?.metadata instanceof Map ? Object.fromEntries(user.metadata) : (user?.metadata || {});
    const stack = meta.llm?.failoverStack || [];
    sendOk(res, { stack });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.post("/user/:userId/llm-failover", authenticate, async (req, res) => {
  try {
    const { connectionId } = req.body;
    if (!connectionId) return sendError(res, 400, ERR.INVALID_INPUT, "connectionId required");

    const user = await User.findById(req.userId);
    if (!user) return sendError(res, 404, ERR.USER_NOT_FOUND, "User not found");

    // Validate connection exists and belongs to user
    const LlmConnection = (await import("./model.js")).default;
    const conn = await LlmConnection.findOne({ _id: connectionId, userId: req.userId }).lean();
    if (!conn) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Connection not found or not yours");

    // Can't add your current default (it's already the primary)
    if (user.llmDefault === connectionId) {
      return sendError(res, 400, ERR.INVALID_INPUT, "That is already your default connection. Failover is for backups.");
    }

    const { getUserMeta, setUserMeta } = await import("../../seed/tree/userMetadata.js");
    const llmMeta = getUserMeta(user, "llm") || {};
    const stack = llmMeta.failoverStack || [];

    if (stack.includes(connectionId)) return sendError(res, 400, ERR.INVALID_INPUT, "Already in failover stack");
    if (stack.length >= 10) return sendError(res, 400, ERR.INVALID_INPUT, "Failover stack full (max 10)");
    stack.push(connectionId);

    llmMeta.failoverStack = stack;
    setUserMeta(user, "llm", llmMeta);
    await user.save();

    sendOk(res, { stack, added: conn.name || connectionId });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.delete("/user/:userId/llm-failover/:connectionId", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return sendError(res, 404, ERR.USER_NOT_FOUND, "User not found");

    const { getUserMeta, setUserMeta } = await import("../../seed/tree/userMetadata.js");
    const llmMeta = getUserMeta(user, "llm") || {};
    const stack = llmMeta.failoverStack || [];
    const idx = stack.indexOf(req.params.connectionId);
    if (idx === -1) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Not in stack");
    stack.splice(idx, 1);

    llmMeta.failoverStack = stack;
    setUserMeta(user, "llm", llmMeta);
    await user.save();

    sendOk(res, { removed: req.params.connectionId, stack });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.delete("/user/:userId/llm-failover", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return sendError(res, 404, ERR.USER_NOT_FOUND, "User not found");

    const { getUserMeta, setUserMeta } = await import("../../seed/tree/userMetadata.js");
    const llmMeta = getUserMeta(user, "llm") || {};
    const stack = llmMeta.failoverStack || [];
    const removed = stack.pop();

    llmMeta.failoverStack = stack;
    setUserMeta(user, "llm", llmMeta);
    await user.save();

    sendOk(res, { removed, stack });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
