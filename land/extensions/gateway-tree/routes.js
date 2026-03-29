// Tree-to-tree gateway webhook receiver.
//
// No auth middleware. Remote trees call this directly with a shared secret.
// Same async pattern as every other channel type.
//
// Respond 200 immediately. Process in background. If input-output, the AI's
// reply fires as a separate outbound POST through the gateway dispatch pipeline
// (the channel's output side sends it back to the remote land's input endpoint).
//
// The remote land doesn't wait. The message arrives as rain. The reply
// arrives as rain on the other side. Two one-way messages. Fully async.
//
// Endpoint: POST /api/v1/gateway/tree/:channelId
//
// Request body (JSON):
//   {
//     secret: string,        // must match the channel's webhookSecret
//     senderLand: string,    // domain of the sending land (informational)
//     message: string,       // the content to process
//     title: string | null,  // optional title/subject
//     type: string,          // notification type (informational)
//   }

import log from "../../seed/log.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import express from "express";

const router = express.Router();

router.post("/gateway/tree/:channelId", async (req, res) => {
  const channelId = req.params.channelId;
  const body = req.body;

  // Validate payload structure before responding
  if (!body || !body.message || typeof body.message !== "string") {
    return sendError(res, 400, ERR.INVALID_INPUT, "Missing or invalid message field");
  }
  if (!body.secret || typeof body.secret !== "string") {
    return sendError(res, 401, ERR.UNAUTHORIZED, "Missing secret");
  }

  // Load and validate channel synchronously (fast DB lookup)
  let channel;
  try {
    const { getExtension } = await import("../loader.js");
    const GatewayChannel = getExtension("gateway")?.exports?.GatewayChannel;
    channel = await GatewayChannel.findById(channelId).lean();
  } catch {
    return sendError(res, 500, ERR.INTERNAL, "Failed to load channel");
  }

  if (!channel || !channel.enabled) {
    return sendError(res, 404, ERR.NODE_NOT_FOUND, "Channel not found or disabled");
  }
  if (channel.type !== "tree") {
    return sendError(res, 400, ERR.INVALID_INPUT, "Channel is not a tree type");
  }
  const hasInput = channel.direction === "input" || channel.direction === "input-output";
  if (!hasInput) {
    return sendError(res, 400, ERR.INVALID_INPUT, "Channel does not accept input");
  }

  // Verify webhook secret
  const expectedSecret = channel.config?.metadata?.webhookSecret;
  if (!expectedSecret || body.secret !== expectedSecret) {
    return sendError(res, 401, ERR.UNAUTHORIZED, "Invalid secret");
  }

  // Respond 200 immediately. Processing happens in background.
  sendOk(res, { received: true });

  // ── Background processing ──────────────────────────────────────────
  try {
    // Optional sender filter
    const senderFilter = channel.config?.metadata?.senderFilter;
    if (senderFilter && body.senderLand) {
      const filterLower = senderFilter.toLowerCase();
      const senderLower = body.senderLand.toLowerCase();
      if (senderLower !== filterLower && !senderLower.endsWith("." + filterLower)) {
        log.verbose("GatewayTree", `Filtered out message from ${body.senderLand} (filter: ${senderFilter})`);
        return;
      }
    }

    const senderName = body.senderLand || "remote-tree";
    const senderPlatformId = body.senderLand || "unknown";
    let messageText = body.message.trim();

    if (body.title) {
      messageText = `[${body.title}] ${messageText}`;
    }
    if (!messageText) return;

    log.verbose("GatewayTree",
      `Tree message on channel ${channelId} from ${senderName}: "${messageText.slice(0, 80)}"`,
    );

    // Process via gateway core. Same pipeline as Telegram, Discord, etc.
    const { getExtension } = await import("../loader.js");
    const gateway = getExtension("gateway");
    if (!gateway?.exports?.processGatewayMessage) {
      log.error("GatewayTree", "Gateway core not loaded");
      return;
    }

    const result = await gateway.exports.processGatewayMessage(channelId, {
      senderName,
      senderPlatformId,
      messageText,
    });

    // If input-output and there's a reply, dispatch it back through the
    // gateway output pipeline. The channel's output side (send()) POSTs
    // the reply to the remote land's input endpoint as a separate message.
    if (result.reply && channel.direction === "input-output" && channel.rootId) {
      try {
        await gateway.exports.dispatchNotifications(channel.rootId, [{
          type: "tree-reply",
          title: null,
          content: result.reply,
        }]);
      } catch (err) {
        log.warn("GatewayTree", `Failed to dispatch reply for channel ${channelId}: ${err.message}`);
      }
    }
  } catch (err) {
    log.error("GatewayTree",
      `Tree webhook processing error for channel ${channelId}:`,
      err.message,
    );
  }
});

export default router;
