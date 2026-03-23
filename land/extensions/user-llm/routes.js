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

// List all custom LLM connections
router.get("/user/:userId/custom-llm", authenticate, async (req, res) => {
  try {
    const connections = await getConnectionsForUser(req.params.userId);
    return res.json({ success: true, connections });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Assign a connection to a user-level slot
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
    console.error("Failed to assign custom LLM:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// Add a new connection
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

    // Auto-assign as profile chat if none is set
    try {
      const user = await User.findById(req.params.userId)
        .select("llmDefault metadata")
        .lean();
      if (!user?.llmAssignments?.main) {
        await assignConnection(req.params.userId, "main", result._id);
      }
    } catch (assignErr) {
      console.error("Auto-assign main failed:", assignErr.message);
    }

    return res.status(201).json({ success: true, connection: result });
  } catch (err) {
    console.error("Failed to save custom LLM:", err.message);
    const status = err.message.includes("Maximum") ? 400 : 500;
    return res.status(status).json({ error: err.message });
  }
});

// Update a connection
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
      console.error("Failed to update custom LLM:", err.message);
      return res.status(500).json({ error: err.message });
    }
  },
);

// Delete a connection
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
      console.error("Failed to delete custom LLM:", err.message);
      return res.status(500).json({ error: err.message });
    }
  },
);

export default router;
