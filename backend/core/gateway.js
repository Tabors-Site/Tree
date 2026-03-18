import GatewayChannel from "../db/models/gatewayChannel.js";
import Node from "../db/models/node.js";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

const ENCRYPTION_KEY = process.env.CUSTOM_LLM_API_SECRET_KEY;
const ALGORITHM = "aes-256-cbc";

// ─────────────────────────────────────────────────────────────────────────
// ENCRYPTION (same pattern as customLLM.js, reusing CUSTOM_LLM_API_SECRET_KEY)
// ─────────────────────────────────────────────────────────────────────────

function getEncryptionKey() {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) {
    throw new Error("CUSTOM_LLM_API_SECRET_KEY must be at least 32 characters");
  }
  return Buffer.from(ENCRYPTION_KEY.slice(0, 32));
}

function encrypt(text) {
  var key = getEncryptionKey();
  var iv = crypto.randomBytes(16);
  var cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  var encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function decrypt(encryptedText) {
  var parts = encryptedText.split(":");
  var iv = Buffer.from(parts[0], "hex");
  var key = Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32));
  var decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  var decrypted = decipher.update(parts[1], "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// ─────────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────────

const VALID_TYPES = ["telegram", "discord", "webapp"];
const VALID_DIRECTIONS = ["input", "input-output", "output"];
const VALID_MODES = ["read", "read-write", "write"];
const KNOWN_NOTIFICATION_TYPES = ["dream-summary", "dream-thought"];
const MAX_CHANNELS_PER_ROOT = 10;

function validateType(type) {
  if (!type || !VALID_TYPES.includes(type)) {
    throw new Error("Invalid channel type -- must be one of: " + VALID_TYPES.join(", "));
  }
}

function validateNotificationTypes(types) {
  if (!Array.isArray(types)) {
    throw new Error("notificationTypes must be an array");
  }
  for (var t of types) {
    if (typeof t !== "string" || !KNOWN_NOTIFICATION_TYPES.includes(t)) {
      throw new Error("Unknown notification type: " + t + " -- must be one of: " + KNOWN_NOTIFICATION_TYPES.join(", "));
    }
  }
}

function validateConfigForType(type, config) {
  if (!config || typeof config !== "object") {
    throw new Error("config is required");
  }

  switch (type) {
    case "telegram": {
      if (!config.botToken || typeof config.botToken !== "string") {
        throw new Error("Telegram channel requires a botToken");
      }
      if (!config.chatId || typeof config.chatId !== "string") {
        throw new Error("Telegram channel requires a chatId");
      }
      break;
    }
    case "discord": {
      if (!config.webhookUrl || typeof config.webhookUrl !== "string") {
        throw new Error("Discord channel requires a webhookUrl");
      }
      try {
        var parsed = new URL(config.webhookUrl);
        if (!parsed.hostname.endsWith("discord.com") && !parsed.hostname.endsWith("discordapp.com")) {
          throw new Error("Discord webhook URL must be a discord.com URL");
        }
      } catch (err) {
        if (err.message.includes("discord")) throw err;
        throw new Error("Invalid Discord webhook URL");
      }
      break;
    }
    case "webapp": {
      if (!config.subscription || typeof config.subscription !== "object") {
        throw new Error("Web app channel requires a subscription object");
      }
      if (!config.subscription.endpoint || typeof config.subscription.endpoint !== "string") {
        throw new Error("Web push subscription must have an endpoint");
      }
      break;
    }
  }
}

function buildEncryptedConfig(type, config) {
  var secrets;
  var metadata = {};
  var displayIdentifier = config.displayIdentifier || null;

  switch (type) {
    case "telegram":
      secrets = { botToken: config.botToken };
      metadata = { chatId: config.chatId };
      break;
    case "discord":
      secrets = { webhookUrl: config.webhookUrl };
      break;
    case "webapp":
      secrets = { subscription: config.subscription };
      break;
    default:
      secrets = {};
  }

  return {
    encryptedPayload: encrypt(JSON.stringify(secrets)),
    displayIdentifier,
    metadata,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────

async function verifyRootAccess(userId, rootId) {
  var root = await Node.findById(rootId).select("rootOwner contributors").lean();
  if (!root) throw new Error("Root not found");
  if (!root.rootOwner) throw new Error("Node is not a root");

  var isOwner = root.rootOwner.toString() === userId.toString();
  var isContributor = (root.contributors || []).some(
    (c) => c.toString() === userId.toString(),
  );

  if (!isOwner && !isContributor) {
    throw new Error("Only the root owner or contributors can manage gateway channels");
  }

  return { root, isOwner };
}

function sanitizeChannel(channel) {
  var obj = typeof channel.toObject === "function" ? channel.toObject() : { ...channel };
  if (obj.config) {
    delete obj.config.encryptedPayload;
  }
  return obj;
}

// ─────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────

export async function addGatewayChannel(userId, rootId, { name, type, direction, mode, config, notificationTypes }) {
  await verifyRootAccess(userId, rootId);

  var count = await GatewayChannel.countDocuments({ rootId });
  if (count >= MAX_CHANNELS_PER_ROOT) {
    throw new Error("Maximum of " + MAX_CHANNELS_PER_ROOT + " channels per root reached");
  }

  if (!name || typeof name !== "string" || name.length > 100) {
    throw new Error("Invalid channel name");
  }

  validateType(type);

  // Validate direction and mode
  var safeDirection = direction || "output";
  var safeMode = mode || "write";
  if (!VALID_DIRECTIONS.includes(safeDirection)) {
    throw new Error("Invalid direction -- must be one of: " + VALID_DIRECTIONS.join(", "));
  }
  if (!VALID_MODES.includes(safeMode)) {
    throw new Error("Invalid mode -- must be one of: " + VALID_MODES.join(", "));
  }

  // Webapp can only be output
  if (type === "webapp" && safeDirection !== "output") {
    throw new Error("Web push channels can only be output");
  }

  var hasOutput = safeDirection === "output" || safeDirection === "input-output";

  // Only validate config + notification types for channels with output capability
  var encConfig = { encryptedPayload: null, displayIdentifier: null, metadata: {} };
  if (hasOutput) {
    validateConfigForType(type, config);
    encConfig = buildEncryptedConfig(type, config);
  }

  var types = [];
  if (hasOutput) {
    types = notificationTypes || KNOWN_NOTIFICATION_TYPES;
    validateNotificationTypes(types);
  }

  var channel = await GatewayChannel.create({
    userId,
    rootId,
    name: name.trim(),
    type,
    direction: safeDirection,
    mode: safeMode,
    enabled: true,
    config: encConfig,
    notificationTypes: types,
  });

  return sanitizeChannel(channel);
}

export async function updateGatewayChannel(userId, channelId, updates) {
  var channel = await GatewayChannel.findOne({ _id: channelId, userId });
  if (!channel) throw new Error("Channel not found");

  if (updates.name !== undefined) {
    if (typeof updates.name !== "string" || updates.name.length > 100) {
      throw new Error("Invalid channel name");
    }
    channel.name = updates.name.trim();
  }

  if (updates.enabled !== undefined) {
    channel.enabled = Boolean(updates.enabled);
  }

  if (updates.notificationTypes !== undefined) {
    validateNotificationTypes(updates.notificationTypes);
    channel.notificationTypes = updates.notificationTypes;
  }

  if (updates.config !== undefined) {
    validateConfigForType(channel.type, updates.config);
    channel.config = buildEncryptedConfig(channel.type, updates.config);
  }

  await channel.save();
  return sanitizeChannel(channel);
}

export async function deleteGatewayChannel(userId, channelId) {
  var channel = await GatewayChannel.findOneAndDelete({ _id: channelId, userId });
  if (!channel) throw new Error("Channel not found");
  return { removed: true };
}

export async function getChannelsForRoot(rootId) {
  var channels = await GatewayChannel.find({ rootId })
    .select("-config.encryptedPayload")
    .sort({ createdAt: -1 })
    .lean();
  return channels;
}

export async function getChannelWithSecrets(channelId) {
  var channel = await GatewayChannel.findById(channelId).lean();
  if (!channel) return null;

  if (channel.config && channel.config.encryptedPayload) {
    try {
      channel.config.decryptedSecrets = JSON.parse(decrypt(channel.config.encryptedPayload));
    } catch (err) {
      channel.config.decryptedSecrets = null;
    }
  }

  return channel;
}

export { decrypt as decryptPayload };
