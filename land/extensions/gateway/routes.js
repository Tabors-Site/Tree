import log from "../../seed/log.js";
import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import {
  addGatewayChannel,
  updateGatewayChannel,
  deleteGatewayChannel,
  getChannelsForRoot,
  getChannelWithSecrets,
} from "./core.js";
import { dispatchTestNotification } from "./dispatch.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────
// AUTHENTICATED: Channel CRUD
// ─────────────────────────────────────────────────────────────────────────

// List channels for a tree
router.get("/root/:rootId/gateway", authenticate, async (req, res) => {
  try {
    const channels = await getChannelsForRoot(req.params.rootId);
    if ("html" in req.query) {
      try {
        const { getExtension } = await import("../loader.js");
        const renderGateway = getExtension("html-rendering")?.exports?.renderGateway;
        if (renderGateway) {
          const Node = (await import("../../seed/models/node.js")).default;
          const root = await Node.findById(req.params.rootId).select("name").lean();
          return res.send(renderGateway({ rootId: req.params.rootId, rootName: root?.name || "", queryString: `?token=${req.query.token || ""}&html`, channels }));
        }
      } catch {}
    }
    sendOk(res, { channels });
  } catch (err) {
    log.error("Gateway", "List channels error:", err.message);
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// Add a channel
router.post("/root/:rootId/gateway", authenticate, async (req, res) => {
  try {
    const channel = await addGatewayChannel(req.userId, req.params.rootId, req.body);
    sendOk(res, { channel }, 201);
  } catch (err) {
    log.error("Gateway", "Add channel error:", err.message);
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// Update a channel
router.put("/gateway/channel/:channelId", authenticate, async (req, res) => {
  try {
    const channel = await updateGatewayChannel(req.userId, req.params.channelId, req.body);
    sendOk(res, { channel });
  } catch (err) {
    log.error("Gateway", "Update channel error:", err.message);
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// Delete a channel
router.delete("/gateway/channel/:channelId", authenticate, async (req, res) => {
  try {
    const result = await deleteGatewayChannel(req.userId, req.params.channelId);
    sendOk(res, result);
  } catch (err) {
    log.error("Gateway", "Delete channel error:", err.message);
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// Test a channel (send test notification)
router.post("/gateway/channel/:channelId/test", authenticate, async (req, res) => {
  try {
    const result = await dispatchTestNotification(req.params.channelId);
    sendOk(res, result);
  } catch (err) {
    log.error("Gateway", "Test channel error:", err.message);
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

export default router;
