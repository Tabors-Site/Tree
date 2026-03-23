import log from "../../core/log.js";
import express from "express";
import User from "../../db/models/user.js";
import authenticate from "../../middleware/authenticate.js";
import {
  addCustomLlmConnection,
  updateCustomLlmConnection,
  deleteCustomLlmConnection,
  getConnectionsForUser,
  assignConnection,
} from "../../core/llms/customLLM.js";

const router = express.Router();

router.get("/user/:userId/custom-llm", authenticate, async (req, res) => {
  try {
    const connections = await getConnectionsForUser(req.params.userId);
    return res.json({ success: true, connections });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/user/:userId/llm-assign", authenticate, async (req, res) => {
  try {
    const { slot, connectionId } = req.body;
    if (!slot) return res.status(400).json({ error: "slot is required" });
    const result = await assignConnection(
      req.params.userId,
      slot,
      connectionId || null,
    );
    return res.json({ success: true, ...result });
  } catch (err) {
 log.error("User Llm", "Failed to assign custom LLM:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

router.post("/user/:userId/custom-llm", authenticate, async (req, res) => {
  try {
    const { name, baseUrl, apiKey, model } = req.body;
    if (!name || !baseUrl || !apiKey || !model) {
      return res.status(400).json({
        error: "Missing required fields: name, baseUrl, apiKey, model",
      });
    }
    const result = await addCustomLlmConnection(req.params.userId, {
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

    return res.status(201).json({ success: true, connection: result });
  } catch (err) {
 log.error("User Llm", "Failed to save custom LLM:", err.message);
    const status = err.message.includes("Maximum") ? 400 : 500;
    return res.status(status).json({ error: err.message });
  }
});

router.put(
  "/user/:userId/custom-llm/:connectionId",
  authenticate,
  async (req, res) => {
    try {
      const { name, baseUrl, apiKey, model } = req.body;
      if (!baseUrl || !model) {
        return res
          .status(400)
          .json({ error: "Missing required fields: baseUrl, model" });
      }
      const result = await updateCustomLlmConnection(
        req.params.userId,
        req.params.connectionId,
        { name, baseUrl, apiKey, model },
      );
      return res.json({ success: true, connection: result });
    } catch (err) {
 log.error("User Llm", "Failed to update custom LLM:", err.message);
      return res.status(500).json({ error: err.message });
    }
  },
);

router.delete(
  "/user/:userId/custom-llm/:connectionId",
  authenticate,
  async (req, res) => {
    try {
      await deleteCustomLlmConnection(
        req.params.userId,
        req.params.connectionId,
      );
      return res.json({ success: true, removed: true });
    } catch (err) {
 log.error("User Llm", "Failed to delete custom LLM:", err.message);
      return res.status(500).json({ error: err.message });
    }
  },
);

// ── Failover Stack ──

router.get("/user/:userId/llm-failover", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("metadata").lean();
    const meta = user?.metadata instanceof Map ? Object.fromEntries(user.metadata) : (user?.metadata || {});
    const stack = meta.llm?.failoverStack || [];
    res.json({ stack });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/user/:userId/llm-failover", authenticate, async (req, res) => {
  try {
    const { connectionId } = req.body;
    if (!connectionId) return res.status(400).json({ error: "connectionId required" });

    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Validate connection exists and belongs to user
    const CustomLlmConnection = (await import("./model.js")).default;
    const conn = await CustomLlmConnection.findOne({ _id: connectionId, userId: req.userId }).lean();
    if (!conn) return res.status(404).json({ error: "Connection not found or not yours" });

    // Can't add your current default (it's already the primary)
    if (user.llmDefault === connectionId) {
      return res.status(400).json({ error: "That is already your default connection. Failover is for backups." });
    }

    const { getUserMeta, setUserMeta } = await import("../../core/tree/userMetadata.js");
    const llmMeta = getUserMeta(user, "llm") || {};
    const stack = llmMeta.failoverStack || [];

    if (stack.includes(connectionId)) return res.status(400).json({ error: "Already in failover stack" });
    if (stack.length >= 10) return res.status(400).json({ error: "Failover stack full (max 10)" });
    stack.push(connectionId);

    llmMeta.failoverStack = stack;
    setUserMeta(user, "llm", llmMeta);
    await user.save();

    res.json({ stack, added: conn.name || connectionId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/user/:userId/llm-failover/:connectionId", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    const { getUserMeta, setUserMeta } = await import("../../core/tree/userMetadata.js");
    const llmMeta = getUserMeta(user, "llm") || {};
    const stack = llmMeta.failoverStack || [];
    const idx = stack.indexOf(req.params.connectionId);
    if (idx === -1) return res.status(404).json({ error: "Not in stack" });
    stack.splice(idx, 1);

    llmMeta.failoverStack = stack;
    setUserMeta(user, "llm", llmMeta);
    await user.save();

    res.json({ removed: req.params.connectionId, stack });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/user/:userId/llm-failover", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    const { getUserMeta, setUserMeta } = await import("../../core/tree/userMetadata.js");
    const llmMeta = getUserMeta(user, "llm") || {};
    const stack = llmMeta.failoverStack || [];
    const removed = stack.pop();

    llmMeta.failoverStack = stack;
    setUserMeta(user, "llm", llmMeta);
    await user.save();

    res.json({ removed, stack });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
