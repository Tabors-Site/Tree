// Telegram channel type handler.
// Registered with gateway core during init.

import log from "../../seed/log.js";
import crypto from "crypto";
import { getLandUrl } from "../../canopy/identity.js";

// ─────────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────────

function validateConfig(config, direction) {
  // Telegram always needs botToken + chatId (same bot sends and receives)
  if (!config.botToken || typeof config.botToken !== "string") {
    throw new Error("Telegram channel requires a botToken");
  }
  if (!config.chatId || typeof config.chatId !== "string") {
    throw new Error("Telegram channel requires a chatId");
  }
}

function buildEncryptedConfig(config, direction) {
  return {
    secrets: { botToken: config.botToken },
    metadata: { chatId: config.chatId },
    displayIdentifier: config.displayIdentifier || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// SENDER
// ─────────────────────────────────────────────────────────────────────────

async function send(secrets, metadata, notification) {
  var { botToken } = secrets;
  var chatId = metadata.chatId;

  var text = `*${notification.title}*\n\n${notification.content}`;

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
    throw new Error(`Telegram API error ${res.status}: ${body}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// INPUT LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────

async function registerInput(channel, secrets) {
  var secretToken = crypto.randomBytes(32).toString("hex");
  var webhookUrl = `${process.env.BASE_URL || getLandUrl()}/api/v1/gateway/telegram/${channel._id}`;

  var res = await fetch(
    `https://api.telegram.org/bot${secrets.botToken}/setWebhook`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: secretToken,
        allowed_updates: ["message"],
      }),
    },
  );

  if (!res.ok) {
    var body = await res.text();
    throw new Error("Telegram setWebhook failed: " + body);
  }

  // Store secret token in metadata for webhook verification
  var GatewayChannel = (await import("../gateway/model.js")).default;
  await GatewayChannel.findByIdAndUpdate(channel._id, {
    $set: { "config.metadata.webhookSecret": secretToken },
  });

  log.verbose("GatewayTelegram", `Telegram webhook registered for channel ${channel._id}`);
}

async function unregisterInput(channel, secrets) {
  try {
    await fetch(
      `https://api.telegram.org/bot${secrets.botToken}/deleteWebhook`,
      { method: "POST" },
    );
    log.verbose("GatewayTelegram", `Telegram webhook removed for channel ${channel._id}`);
  } catch (err) {
    log.error("GatewayTelegram", `Failed to remove Telegram webhook for ${channel._id}:`, err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// REPLY HELPER (used by webhook receiver)
// ─────────────────────────────────────────────────────────────────────────

export async function sendTelegramReply(channel, chatId, text) {
  try {
    var { getChannelWithSecrets } = (await import("../gateway/core.js"));
    var fullChannel = await getChannelWithSecrets(channel._id);
    if (!fullChannel?.config?.decryptedSecrets?.botToken) return;

    var botToken = fullChannel.config.decryptedSecrets.botToken;

    // Truncate if too long for Telegram (4096 char limit)
    if (text.length > 4096) {
      text = text.slice(0, 4093) + "...";
    }

    var res = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "Markdown",
        }),
      },
    );

    if (!res.ok) {
      var body = await res.text();
      log.error("GatewayTelegram", `Telegram reply failed for channel ${channel._id}: ${body}`);
    }
  } catch (err) {
    log.error("GatewayTelegram", `Telegram reply error for channel ${channel._id}:`, err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// EXPORT HANDLER
// ─────────────────────────────────────────────────────────────────────────

export default {
  allowedDirections: ["input", "output", "input-output"],
  validateConfig,
  buildEncryptedConfig,
  send,
  registerInput,
  unregisterInput,
};
