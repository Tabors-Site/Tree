import GatewayChannel from "../db/models/gatewayChannel.js";
import crypto from "crypto";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../..", ".env") });

const ENCRYPTION_KEY = process.env.CUSTOM_LLM_API_SECRET_KEY;
const ALGORITHM = "aes-256-cbc";

function decrypt(encryptedText) {
  var parts = encryptedText.split(":");
  var iv = Buffer.from(parts[0], "hex");
  var key = Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32));
  var decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  var decrypted = decipher.update(parts[1], "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

function decryptChannelSecrets(channel) {
  if (!channel.config || !channel.config.encryptedPayload) return null;
  try {
    return JSON.parse(decrypt(channel.config.encryptedPayload));
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// SENDERS
// ─────────────────────────────────────────────────────────────────────────

async function sendTelegram(secrets, metadata, notification) {
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

async function sendDiscord(secrets, metadata, notification) {
  var content = `**${notification.title}**\n\n${notification.content}`;
  if (content.length > 2000) {
    content = content.slice(0, 1997) + "...";
  }

  if (secrets.webhookUrl) {
    // Output via webhook
    var res = await fetch(secrets.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });

    if (!res.ok) {
      var body = await res.text();
      throw new Error(`Discord webhook error ${res.status}: ${body}`);
    }
  } else if (secrets.botToken && metadata.discordChannelId) {
    // Input channel - send via bot API
    var res = await fetch(`https://discord.com/api/v10/channels/${metadata.discordChannelId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bot ${secrets.botToken}`,
      },
      body: JSON.stringify({ content }),
    });

    if (!res.ok) {
      var body = await res.text();
      throw new Error(`Discord bot API error ${res.status}: ${body}`);
    }
  } else {
    throw new Error("Discord channel has no webhookUrl or botToken configured");
  }
}

async function sendWebPush(secrets, metadata, notification) {
  var { subscription } = secrets;

  var webpush;
  try {
    webpush = await import("web-push");
    webpush = webpush.default || webpush;
  } catch {
    throw new Error("web-push package not installed");
  }

  var vapidPublic = process.env.VAPID_PUBLIC_KEY;
  var vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  var vapidEmail = process.env.VAPID_EMAIL;

  if (!vapidPublic || !vapidPrivate || !vapidEmail) {
    throw new Error("VAPID keys not configured");
  }

  var email = vapidEmail.startsWith("mailto:") ? vapidEmail : "mailto:" + vapidEmail;
  webpush.setVapidDetails(email, vapidPublic, vapidPrivate);

  var payload = JSON.stringify({
    title: notification.title,
    body: notification.content,
    type: notification.type,
  });

  try {
    await webpush.sendNotification(subscription, payload);
  } catch (err) {
    if (err.statusCode === 410) {
      // Subscription expired, disable the channel
      await GatewayChannel.findByIdAndUpdate(notification._channelId, {
        $set: { enabled: false, lastError: "Push subscription expired (410 Gone)" },
      });
      throw new Error("Push subscription expired");
    }
    throw err;
  }
}

const SENDERS = {
  telegram: sendTelegram,
  discord: sendDiscord,
  webapp: sendWebPush,
};

// ─────────────────────────────────────────────────────────────────────────
// DISPATCH
// ─────────────────────────────────────────────────────────────────────────

export async function dispatchNotifications(rootId, notifications) {
  if (!notifications || notifications.length === 0) return;

  var channels = await GatewayChannel.find({
    rootId,
    enabled: true,
    direction: { $in: ["output", "input-output"] },
  }).lean();

  if (channels.length === 0) return;

  var results = [];

  for (var channel of channels) {
    var matching = notifications.filter(
      (n) => channel.notificationTypes.includes(n.type),
    );

    if (matching.length === 0) continue;

    var secrets = decryptChannelSecrets(channel);
    if (!secrets) {
      console.error(`Gateway: failed to decrypt secrets for channel ${channel._id}`);
      await GatewayChannel.findByIdAndUpdate(channel._id, {
        $set: { lastError: "Failed to decrypt channel secrets" },
      });
      continue;
    }

    var sender = SENDERS[channel.type];
    if (!sender) {
      console.error(`Gateway: no sender for channel type "${channel.type}"`);
      continue;
    }

    for (var notification of matching) {
      try {
        await sender(secrets, channel.config.metadata || {}, {
          ...notification,
          _channelId: channel._id,
        });

        await GatewayChannel.findByIdAndUpdate(channel._id, {
          $set: { lastDispatchAt: new Date(), lastError: null },
        });

        results.push({ channelId: channel._id, type: channel.type, status: "ok" });
      } catch (err) {
        console.error(`Gateway: dispatch error for channel ${channel._id} (${channel.type}):`, err.message);

        await GatewayChannel.findByIdAndUpdate(channel._id, {
          $set: { lastError: err.message },
        });

        results.push({ channelId: channel._id, type: channel.type, status: "error", error: err.message });
      }
    }
  }

  if (results.length > 0) {
    var ok = results.filter((r) => r.status === "ok").length;
    var fail = results.filter((r) => r.status === "error").length;
    console.log(`Gateway: dispatched ${ok} ok, ${fail} failed for root ${rootId}`);
  }

  return results;
}

export async function dispatchTestNotification(channelId) {
  var channel = await GatewayChannel.findById(channelId).lean();
  if (!channel) throw new Error("Channel not found");
  if (!channel.enabled) throw new Error("Channel is disabled");

  var secrets = decryptChannelSecrets(channel);
  if (!secrets) throw new Error("Failed to decrypt channel secrets");

  var sender = SENDERS[channel.type];
  if (!sender) throw new Error("No sender for channel type: " + channel.type);

  var testNotification = {
    type: "test",
    title: "Test Notification",
    content: "This is a test notification from your tree. If you see this, your channel is working correctly!",
    _channelId: channel._id,
  };

  await sender(secrets, channel.config.metadata || {}, testNotification);

  await GatewayChannel.findByIdAndUpdate(channel._id, {
    $set: { lastDispatchAt: new Date(), lastError: null },
  });

  return { success: true };
}
