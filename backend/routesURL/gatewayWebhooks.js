// routesURL/gatewayWebhooks.js
// Webhook receiver endpoints for gateway input channels.
// No auth middleware — external platforms (Telegram) call these directly.

import express from "express";
import GatewayChannel from "../db/models/gatewayChannel.js";
import { processGatewayMessage } from "../core/gatewayInput.js";
import { getChannelWithSecrets } from "../core/gateway.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────
// TELEGRAM WEBHOOK
// POST /api/v1/gateway/telegram/:channelId
// ─────────────────────────────────────────────────────────────────────────

router.post("/gateway/telegram/:channelId", async (req, res) => {
  // Always respond 200 to Telegram immediately (prevents retries)
  res.status(200).json({ ok: true });

  try {
    var channelId = req.params.channelId;
    var update = req.body;

    // Basic structure check
    if (!update || !update.message || !update.message.text) return;

    // Verify secret token header (if configured)
    var channel = await GatewayChannel.findById(channelId).lean();
    if (!channel || !channel.enabled) return;
    if (channel.type !== "telegram") return;

    var hasInput = channel.direction === "input" || channel.direction === "input-output";
    if (!hasInput) return;

    var expectedSecret = channel.config?.metadata?.webhookSecret;
    if (expectedSecret) {
      var headerSecret = req.headers["x-telegram-bot-api-secret-token"];
      if (headerSecret !== expectedSecret) {
        console.error(`Gateway: Telegram webhook secret mismatch for channel ${channelId}`);
        return;
      }
    }

    // Verify chatId matches
    var expectedChatId = channel.config?.metadata?.chatId;
    var actualChatId = String(update.message.chat.id);
    if (expectedChatId && actualChatId !== expectedChatId) {
      console.error(`Gateway: Telegram chatId mismatch for channel ${channelId}: expected ${expectedChatId}, got ${actualChatId}`);
      return;
    }

    // Extract sender info
    var from = update.message.from || {};
    var senderName = from.username || from.first_name || "Unknown";
    var senderPlatformId = String(from.id || "");
    var messageText = update.message.text;

    console.log(`Gateway: Telegram message on channel ${channelId} from ${senderName}: "${messageText.slice(0, 80)}"`);

    // Process the message
    var result = await processGatewayMessage(channelId, {
      senderName,
      senderPlatformId,
      messageText,
    });

    // Send reply back if input-output and there's a reply
    if (result.reply && (channel.direction === "input-output")) {
      await sendTelegramReply(channel, actualChatId, result.reply);
    }
  } catch (err) {
    console.error(`Gateway: Telegram webhook error for channel ${req.params.channelId}:`, err.message);
  }
});

async function sendTelegramReply(channel, chatId, text) {
  try {
    var fullChannel = await getChannelWithSecrets(channel._id);
    if (!fullChannel?.config?.decryptedSecrets?.botToken) return;

    var botToken = fullChannel.config.decryptedSecrets.botToken;

    // Truncate if too long for Telegram (4096 char limit)
    if (text.length > 4096) {
      text = text.slice(0, 4093) + "...";
    }

    var res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
      }),
    });

    if (!res.ok) {
      var body = await res.text();
      console.error(`Gateway: Telegram reply failed for channel ${channel._id}: ${body}`);
    }
  } catch (err) {
    console.error(`Gateway: Telegram reply error for channel ${channel._id}:`, err.message);
  }
}

export default router;
