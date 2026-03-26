import log from "../../seed/log.js";
import GatewayChannel from "./model.js";
import { getChannelType } from "./registry.js";
import crypto from "crypto";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../..", ".env") });

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
// DISPATCH (delegates to registered channel type senders)
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
      log.error("Gateway", `Failed to decrypt secrets for channel ${channel._id}`);
      await GatewayChannel.findByIdAndUpdate(channel._id, {
        $set: { lastError: "Failed to decrypt channel secrets" },
      });
      continue;
    }

    var handler = getChannelType(channel.type);
    if (!handler || !handler.send) {
      log.error("Gateway", `No registered sender for channel type "${channel.type}"`);
      continue;
    }

    for (var notification of matching) {
      try {
        await handler.send(secrets, channel.config.metadata || {}, {
          ...notification,
          _channelId: channel._id,
        });

        await GatewayChannel.findByIdAndUpdate(channel._id, {
          $set: { lastDispatchAt: new Date(), lastError: null },
        });

        results.push({ channelId: channel._id, type: channel.type, status: "ok" });
      } catch (err) {
        log.error("Gateway", `Dispatch error for channel ${channel._id} (${channel.type}):`, err.message);

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
    log.verbose("Gateway", `Dispatched ${ok} ok, ${fail} failed for root ${rootId}`);
  }

  return results;
}

export async function dispatchTestNotification(channelId) {
  var channel = await GatewayChannel.findById(channelId).lean();
  if (!channel) throw new Error("Channel not found");
  if (!channel.enabled) throw new Error("Channel is disabled");

  var secrets = decryptChannelSecrets(channel);
  if (!secrets) throw new Error("Failed to decrypt channel secrets");

  var handler = getChannelType(channel.type);
  if (!handler || !handler.send) throw new Error("No sender for channel type: " + channel.type);

  var testNotification = {
    type: "test",
    title: "Test Notification",
    content: "This is a test notification from your tree. If you see this, your channel is working correctly!",
    _channelId: channel._id,
  };

  await handler.send(secrets, channel.config.metadata || {}, testNotification);

  await GatewayChannel.findByIdAndUpdate(channel._id, {
    $set: { lastDispatchAt: new Date(), lastError: null },
  });

  return { success: true };
}
