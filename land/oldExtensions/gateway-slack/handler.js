// Slack channel type handler.
// Output: posts messages to a Slack channel via chat.postMessage API.
// Input: receives messages via Slack Events API webhook.
// Config: botToken, slackChannelId. Signing secret from env for webhook verification.

import log from "../../seed/log.js";
import crypto from "crypto";

function validateConfig(config, direction) {
  const botToken = config.botToken || process.env.SLACK_BOT_TOKEN;
  if (!botToken || !botToken.startsWith("xoxb-")) {
    throw new Error("Slack requires a Bot User OAuth Token (xoxb-...) in config or SLACK_BOT_TOKEN env var");
  }

  if (!config.slackChannelId || typeof config.slackChannelId !== "string") {
    throw new Error("Slack requires a slackChannelId (e.g., C01ABCDEF)");
  }
}

function buildEncryptedConfig(config, direction) {
  const secrets = {};
  const metadata = {};

  if (config.botToken) secrets.botToken = config.botToken;
  metadata.slackChannelId = config.slackChannelId;

  return {
    secrets,
    metadata,
    displayIdentifier: `#${config.channelName || config.slackChannelId}`,
  };
}

function getToken(secrets) {
  return secrets.botToken || process.env.SLACK_BOT_TOKEN;
}

async function slackApi(method, token, body) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Slack API ${method}: ${data.error || "unknown error"}`);
  }
  return data;
}

async function send(secrets, metadata, notification) {
  const token = getToken(secrets);
  const text = notification.title
    ? `*${notification.title}*\n\n${notification.content}`
    : notification.content;

  await slackApi("chat.postMessage", token, {
    channel: metadata.slackChannelId,
    text,
    unfurl_links: false,
    unfurl_media: false,
  });
}

async function registerInput(channel, secrets) {
  // Slack Events API uses a single webhook URL for all events.
  // The URL is: POST /api/v1/gateway/slack/:channelId
  // Configure in Slack App > Event Subscriptions > Request URL.
  // Subscribe to: message.channels (public) or message.groups (private).
  log.info("GatewaySlack",
    `Slack input registered for channel ${channel._id}. ` +
    `Events URL: POST /api/v1/gateway/slack/${channel._id}`,
  );
}

async function unregisterInput(channel, secrets) {
  log.verbose("GatewaySlack", `Slack input unregistered for channel ${channel._id}`);
}

// Exported for routes.js
export { slackApi, getToken };

export default {
  allowedDirections: ["input", "output", "input-output"],
  validateConfig,
  buildEncryptedConfig,
  send,
  registerInput,
  unregisterInput,
};
