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
  const { botToken } = secrets;
  const chatId = metadata.chatId;

  const text = `*${notification.title}*\n\n${notification.content}`;

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API error ${res.status}: ${body}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// INPUT LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────

async function registerInput(channel, secrets) {
  const secretToken = crypto.randomBytes(32).toString("hex");
  const webhookUrl = `${process.env.BASE_URL || getLandUrl()}/api/v1/gateway/telegram/${channel._id}`;

  const res = await fetch(
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
    const body = await res.text();
    throw new Error("Telegram setWebhook failed: " + body);
  }

  // Store secret token in metadata for webhook verification
  const { getExtension } = await import("../loader.js");
  const GatewayChannel = getExtension("gateway")?.exports?.GatewayChannel;
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
    const { getExtension } = await import("../loader.js");
    const getChannelWithSecrets = getExtension("gateway")?.exports?.getChannelWithSecrets;
    const fullChannel = await getChannelWithSecrets(channel._id);
    if (!fullChannel?.config?.decryptedSecrets?.botToken) return;

    const botToken = fullChannel.config.decryptedSecrets.botToken;

    // Truncate if too long for Telegram (4096 char limit)
    if (text.length > 4096) {
      text = text.slice(0, 4093) + "...";
    }

    const res = await fetch(
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
      const body = await res.text();
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
