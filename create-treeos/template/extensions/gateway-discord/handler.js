// Discord channel type handler.
// Registered with gateway core during init.

import log from "../../seed/log.js";

// ─────────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────────

function validateDiscordWebhookUrl(webhookUrl) {
  try {
    const parsed = new URL(webhookUrl);
    if (
      !parsed.hostname.endsWith("discord.com") &&
      !parsed.hostname.endsWith("discordapp.com")
    ) {
      throw new Error("Discord webhook URL must be a discord.com URL");
    }
  } catch (err) {
    if (err.message.includes("discord")) throw err;
    throw new Error("Invalid Discord webhook URL");
  }
}

function validateConfig(config, direction) {
  const hasInput = direction === "input" || direction === "input-output";
  const hasOutput = direction === "output" || direction === "input-output";

  if (hasInput) {
    // Discord input requires bot token + channel ID (bot connects via gateway)
    if (!config.botToken || typeof config.botToken !== "string") {
      throw new Error("Discord input channel requires a botToken");
    }
    if (
      !config.discordChannelId ||
      typeof config.discordChannelId !== "string"
    ) {
      throw new Error("Discord input channel requires a discordChannelId");
    }
    // Webhook URL optional for input-output (used for output side)
    if (hasOutput && config.webhookUrl) {
      validateDiscordWebhookUrl(config.webhookUrl);
    }
  } else {
    // Output-only: webhook URL required
    if (!config.webhookUrl || typeof config.webhookUrl !== "string") {
      throw new Error("Discord channel requires a webhookUrl");
    }
    validateDiscordWebhookUrl(config.webhookUrl);
  }
}

function buildEncryptedConfig(config, direction) {
  const hasInput = direction === "input" || direction === "input-output";
  let secrets;
  let metadata = {};

  if (hasInput) {
    // Bot token for input, optionally webhook for output side
    secrets = { botToken: config.botToken };
    if (config.webhookUrl) secrets.webhookUrl = config.webhookUrl;
    metadata = {
      discordChannelId: config.discordChannelId,
      guildId: config.guildId || null,
    };
  } else {
    secrets = { webhookUrl: config.webhookUrl };
  }

  return {
    secrets,
    metadata,
    displayIdentifier: config.displayIdentifier || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// SENDER
// ─────────────────────────────────────────────────────────────────────────

async function send(secrets, metadata, notification) {
  let content = `**${notification.title}**\n\n${notification.content}`;
  if (content.length > 2000) {
    content = content.slice(0, 1997) + "...";
  }

  if (secrets.webhookUrl) {
    // Output via webhook
    const res = await fetch(secrets.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Discord webhook error ${res.status}: ${body}`);
    }
  } else if (secrets.botToken && metadata.discordChannelId) {
    // Input channel, send via bot API
    const res = await fetch(`https://discord.com/api/v10/channels/${metadata.discordChannelId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bot ${secrets.botToken}`,
      },
      body: JSON.stringify({ content }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Discord bot API error ${res.status}: ${body}`);
    }
  } else {
    throw new Error("Discord channel has no webhookUrl or botToken configured");
  }
}

// ─────────────────────────────────────────────────────────────────────────
// INPUT LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────

async function registerInput(channel, secrets) {
  const { connectBot } = await import("./botManager.js");
  await connectBot(
    secrets.botToken,
    channel._id,
    channel.config.metadata.discordChannelId,
    channel.rootId,
  );
  log.verbose("GatewayDiscord", `Discord bot connected for channel ${channel._id}`);
}

async function unregisterInput(channel, secrets) {
  try {
    const { disconnectBot } = await import("./botManager.js");
    await disconnectBot(channel._id);
    log.verbose("GatewayDiscord", `Discord bot disconnected for channel ${channel._id}`);
  } catch (err) {
    log.error("GatewayDiscord", `Failed to disconnect Discord bot for ${channel._id}:`, err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// EXPORT HANDLER
// ─────────────────────────────────────────────────────────────────────────

export default {
  allowedDirections: ["input", "output", "input-output"],
  requiredTiers: ["standard", "premium"],
  validateConfig,
  buildEncryptedConfig,
  send,
  registerInput,
  unregisterInput,
};
