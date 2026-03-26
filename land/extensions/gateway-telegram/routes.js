// Telegram webhook receiver endpoint.
// No auth middleware. Telegram calls this directly.

import log from "../../seed/log.js";
import { sendOk } from "../../seed/protocol.js";
import express from "express";
import { sendTelegramReply } from "./handler.js";

const router = express.Router();

// POST /api/v1/gateway/telegram/:channelId
router.post("/gateway/telegram/:channelId", async (req, res) => {
  // Always respond 200 to Telegram immediately (prevents retries)
  sendOk(res, { ok: true });

  try {
    var channelId = req.params.channelId;
    var update = req.body;

    // Basic structure check
    if (!update || !update.message || !update.message.text) return;

    // Load channel
    var GatewayChannel = (await import("../gateway/model.js")).default;
    var channel = await GatewayChannel.findById(channelId).lean();
    if (!channel || !channel.enabled) return;
    if (channel.type !== "telegram") return;

    var hasInput =
      channel.direction === "input" || channel.direction === "input-output";
    if (!hasInput) return;

    // Verify secret token header (if configured)
    var expectedSecret = channel.config?.metadata?.webhookSecret;
    if (expectedSecret) {
      var headerSecret = req.headers["x-telegram-bot-api-secret-token"];
      if (headerSecret !== expectedSecret) {
        log.error("GatewayTelegram",
          `Telegram webhook secret mismatch for channel ${channelId}`,
        );
        return;
      }
    }

    // Verify chatId matches
    var expectedChatId = channel.config?.metadata?.chatId;
    var actualChatId = String(update.message.chat.id);
    if (expectedChatId && actualChatId !== expectedChatId) {
      log.error("GatewayTelegram",
        `Telegram chatId mismatch for channel ${channelId}: expected ${expectedChatId}, got ${actualChatId}`,
      );
      return;
    }

    // Extract sender info
    var from = update.message.from || {};
    var senderName = from.username || from.first_name || "Unknown";
    var senderPlatformId = String(from.id || "");
    var messageText = update.message.text;

    log.verbose("GatewayTelegram",
      `Telegram message on channel ${channelId} from ${senderName}: "${messageText.slice(0, 80)}"`,
    );

    // Process the message via gateway core
    var { getExtension } = await import("../loader.js");
    var gateway = getExtension("gateway");
    if (!gateway?.exports?.processGatewayMessage) {
      log.error("GatewayTelegram", "Gateway core not loaded");
      return;
    }

    var result = await gateway.exports.processGatewayMessage(channelId, {
      senderName,
      senderPlatformId,
      messageText,
    });

    // Send reply back if input-output and there's a reply
    if (result.reply && channel.direction === "input-output") {
      await sendTelegramReply(channel, actualChatId, result.reply);
    }
  } catch (err) {
    log.error("GatewayTelegram",
      `Telegram webhook error for channel ${req.params.channelId}:`,
      err.message,
    );
  }
});

export default router;
