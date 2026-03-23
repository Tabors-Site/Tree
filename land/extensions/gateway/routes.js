import log from "../../core/log.js";
import express from "express";
import authenticate from "../../middleware/authenticate.js";
import {
  addGatewayChannel,
  updateGatewayChannel,
  deleteGatewayChannel,
  getChannelsForRoot,
  getChannelWithSecrets,
} from "./core.js";
import { dispatchTestNotification } from "./dispatch.js";
import webhookRouter from "./webhooks.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────
// UNAUTHENTICATED: Webhook endpoints (Telegram/Discord call these directly)
// ─────────────────────────────────────────────────────────────────────────

router.use(webhookRouter);

// ─────────────────────────────────────────────────────────────────────────
// AUTHENTICATED: Channel CRUD
// ─────────────────────────────────────────────────────────────────────────

// List channels for a tree
router.get("/root/:rootId/gateway", authenticate, async (req, res) => {
  try {
    const channels = await getChannelsForRoot(req.params.rootId);
    res.json({ channels });
  } catch (err) {
    log.error("Gateway", "List channels error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// Add a channel
router.post("/root/:rootId/gateway", authenticate, async (req, res) => {
  try {
    const channel = await addGatewayChannel(req.userId, req.params.rootId, req.body);
    res.json({ success: true, channel });
  } catch (err) {
    log.error("Gateway", "Add channel error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// Update a channel
router.put("/gateway/channel/:channelId", authenticate, async (req, res) => {
  try {
    const channel = await updateGatewayChannel(req.userId, req.params.channelId, req.body);
    res.json({ success: true, channel });
  } catch (err) {
    log.error("Gateway", "Update channel error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// Delete a channel
router.delete("/gateway/channel/:channelId", authenticate, async (req, res) => {
  try {
    const result = await deleteGatewayChannel(req.userId, req.params.channelId);
    res.json({ success: true, ...result });
  } catch (err) {
    log.error("Gateway", "Delete channel error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// Test a channel (send test notification)
router.post("/gateway/channel/:channelId/test", authenticate, async (req, res) => {
  try {
    const result = await dispatchTestNotification(req.params.channelId);
    res.json({ success: true, ...result });
  } catch (err) {
    log.error("Gateway", "Test channel error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

export default router;
