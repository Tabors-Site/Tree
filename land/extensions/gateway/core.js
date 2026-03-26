import log from "../../seed/log.js";
import GatewayChannel from "./model.js";
import crypto from "crypto";
import { getLandUrl } from "../../canopy/identity.js";
import { getChannelType, getRegisteredTypes, hasChannelType } from "./registry.js";

// Models wired from init() via setModels(). Fallback to direct import for standalone use.
let Node = null;
let User = null;
export function setModels(models) { Node = models.Node; User = models.User; }

// Lazy model access for gateway core (may be called before init in some paths)
async function ensureModels() {
  if (!Node) {
    const mod = await import("../../seed/models/node.js");
    Node = mod.default;
  }
  if (!User) {
    const mod = await import("../../seed/models/user.js");
    User = mod.default;
  }
}

const ENCRYPTION_KEY = process.env.CUSTOM_LLM_API_SECRET_KEY;
const ALGORITHM = "aes-256-cbc";

// ─────────────────────────────────────────────────────────────────────────
// ENCRYPTION (same pattern as seed/llm/connections.js, reusing CUSTOM_LLM_API_SECRET_KEY)
// ─────────────────────────────────────────────────────────────────────────

function getEncryptionKey() {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) {
    throw new Error("CUSTOM_LLM_API_SECRET_KEY must be at least 32 characters");
  }
  return Buffer.from(ENCRYPTION_KEY.slice(0, 32));
}

function encrypt(text) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function decrypt(encryptedText) {
  const parts = encryptedText.split(":");
  const iv = Buffer.from(parts[0], "hex");
  const key = Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32));
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(parts[1], "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// ─────────────────────────────────────────────────────────────────────────
// VALIDATION (delegates to registered channel type handlers)
// ─────────────────────────────────────────────────────────────────────────

const VALID_DIRECTIONS = ["input", "input-output", "output"];
const VALID_MODES = ["read", "read-write", "write"];
const KNOWN_NOTIFICATION_TYPES = ["dream-summary", "dream-thought"];
const MAX_CHANNELS_PER_ROOT = 10;

function validateType(type) {
  if (!type || !hasChannelType(type)) {
    throw new Error(
      "Unknown channel type: " + type + ". Registered types: " + getRegisteredTypes().join(", "),
    );
  }
}

function validateNotificationTypes(types) {
  if (!Array.isArray(types)) {
    throw new Error("notificationTypes must be an array");
  }
  for (const t of types) {
    if (typeof t !== "string" || !KNOWN_NOTIFICATION_TYPES.includes(t)) {
      throw new Error(
        "Unknown notification type: " +
          t +
          ". Must be one of: " +
          KNOWN_NOTIFICATION_TYPES.join(", "),
      );
    }
  }
}

function validateConfigForType(type, config, direction) {
  if (!config || typeof config !== "object") {
    throw new Error("config is required");
  }
  const handler = getChannelType(type);
  if (!handler) throw new Error("Unknown channel type: " + type);
  handler.validateConfig(config, direction);
}

function buildEncryptedConfig(type, config, direction) {
  const handler = getChannelType(type);
  if (!handler) throw new Error("Unknown channel type: " + type);
  const result = handler.buildEncryptedConfig(config, direction);
  return {
    encryptedPayload: encrypt(JSON.stringify(result.secrets)),
    displayIdentifier: result.displayIdentifier || config.displayIdentifier || null,
    metadata: result.metadata || {},
  };
}

// ─────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────

async function verifyRootAccess(userId, rootId) {
  const root = await Node.findById(rootId)
    .select("rootOwner contributors")
    .lean();
  if (!root) throw new Error("Root not found");
  if (!root.rootOwner) throw new Error("Node is not a root");

  const isOwner = root.rootOwner.toString() === userId.toString();
  const isContributor = (root.contributors || []).some(
    (c) => c.toString() === userId.toString(),
  );

  if (!isOwner && !isContributor) {
    throw new Error(
      "Only the root owner or contributors can manage gateway channels",
    );
  }

  return { root, isOwner };
}

function sanitizeChannel(channel) {
  const obj =
    typeof channel.toObject === "function"
      ? channel.toObject()
      : { ...channel };
  if (obj.config) {
    delete obj.config.encryptedPayload;
  }
  return obj;
}

// ─────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────

export async function addGatewayChannel(
  userId,
  rootId,
  { name, type, direction, mode, config, notificationTypes, queueBehavior },
) {
  await verifyRootAccess(userId, rootId);

  const count = await GatewayChannel.countDocuments({ rootId });
  if (count >= MAX_CHANNELS_PER_ROOT) {
    throw new Error(
      "Maximum of " + MAX_CHANNELS_PER_ROOT + " channels per root reached",
    );
  }

  if (!name || typeof name !== "string" || name.length > 100) {
    throw new Error("Invalid channel name");
  }

  validateType(type);
  const handler = getChannelType(type);

  // Validate direction and mode
  const safeDirection = direction || "output";
  const safeMode = mode || "write";
  if (!VALID_DIRECTIONS.includes(safeDirection)) {
    throw new Error(
      "Invalid direction. Must be one of: " + VALID_DIRECTIONS.join(", "),
    );
  }
  if (!VALID_MODES.includes(safeMode)) {
    throw new Error(
      "Invalid mode. Must be one of: " + VALID_MODES.join(", "),
    );
  }

  // Check if this channel type supports the requested direction
  if (!handler.allowedDirections.includes(safeDirection)) {
    throw new Error(
      type + " channels only support: " + handler.allowedDirections.join(", "),
    );
  }

  // Tier check for input channels (if handler requires it)
  const hasInput = safeDirection === "input" || safeDirection === "input-output";
  if (hasInput && handler.requiredTiers && handler.requiredTiers.length > 0) {
    const user = await User.findById(userId).select("isAdmin metadata").lean();
    const userPlan = (user?.metadata?.tiers?.plan) || "basic";
    if (!user || (!user.isAdmin && !handler.requiredTiers.includes(userPlan))) {
      throw new Error(
        type + " input channels require a " + handler.requiredTiers.join(" or ") + " tier subscription",
      );
    }
  }

  const hasOutput =
    safeDirection === "output" || safeDirection === "input-output";

  // Validate config
  let encConfig = {
    encryptedPayload: null,
    displayIdentifier: null,
    metadata: {},
  };
  if (hasOutput || hasInput) {
    validateConfigForType(type, config, safeDirection);
    encConfig = buildEncryptedConfig(type, config, safeDirection);
  }

  let types = [];
  if (hasOutput) {
    types = notificationTypes || KNOWN_NOTIFICATION_TYPES;
    validateNotificationTypes(types);
  }

  const safeQueueBehavior = queueBehavior === "silent" ? "silent" : "respond";

  const channel = await GatewayChannel.create({
    userId,
    rootId,
    name: name.trim(),
    type,
    direction: safeDirection,
    mode: safeMode,
    enabled: true,
    config: encConfig,
    notificationTypes: types,
    queueBehavior: safeQueueBehavior,
  });

  // Register input webhooks/bots after creation
  if (hasInput && channel.enabled) {
    registerInputChannel(channel).catch((err) =>
      log.error("Gateway",
        `Failed to register input for channel ${channel._id}:`,
        err.message,
      ),
    );
  }

  return sanitizeChannel(channel);
}

export async function updateGatewayChannel(userId, channelId, updates) {
  const channel = await GatewayChannel.findOne({ _id: channelId, userId });
  if (!channel) throw new Error("Channel not found");

  const wasEnabled = channel.enabled;
  const hasInput =
    channel.direction === "input" || channel.direction === "input-output";

  if (updates.name !== undefined) {
    if (typeof updates.name !== "string" || updates.name.length > 100) {
      throw new Error("Invalid channel name");
    }
    channel.name = updates.name.trim();
  }

  if (updates.enabled !== undefined) {
    channel.enabled = Boolean(updates.enabled);
  }

  if (updates.queueBehavior !== undefined) {
    channel.queueBehavior =
      updates.queueBehavior === "silent" ? "silent" : "respond";
  }

  if (updates.notificationTypes !== undefined) {
    validateNotificationTypes(updates.notificationTypes);
    channel.notificationTypes = updates.notificationTypes;
  }

  if (updates.config !== undefined) {
    validateConfigForType(channel.type, updates.config, channel.direction);
    channel.config = buildEncryptedConfig(
      channel.type,
      updates.config,
      channel.direction,
    );
  }

  await channel.save();

  // Handle input channel lifecycle on enable/disable changes
  if (hasInput) {
    if (!wasEnabled && channel.enabled) {
      registerInputChannel(channel).catch((err) =>
        log.error("Gateway",
          `Failed to register input for channel ${channel._id}:`,
          err.message,
        ),
      );
    } else if (wasEnabled && !channel.enabled) {
      unregisterInputChannel(channel).catch((err) =>
        log.error("Gateway",
          `Failed to unregister input for channel ${channel._id}:`,
          err.message,
        ),
      );
    }
  }

  return sanitizeChannel(channel);
}

export async function deleteGatewayChannel(userId, channelId) {
  const channel = await GatewayChannel.findOneAndDelete({
    _id: channelId,
    userId,
  });
  if (!channel) throw new Error("Channel not found");

  const hasInput =
    channel.direction === "input" || channel.direction === "input-output";
  if (hasInput) {
    unregisterInputChannel(channel).catch((err) =>
      log.error("Gateway",
        `Failed to unregister input for channel ${channel._id}:`,
        err.message,
      ),
    );
  }

  return { removed: true };
}

export async function getChannelsForRoot(rootId) {
  const channels = await GatewayChannel.find({ rootId })
    .select("-config.encryptedPayload")
    .sort({ createdAt: -1 })
    .lean();
  return channels;
}

export async function getChannelWithSecrets(channelId) {
  const channel = await GatewayChannel.findById(channelId).lean();
  if (!channel) return null;

  if (channel.config && channel.config.encryptedPayload) {
    try {
      channel.config.decryptedSecrets = JSON.parse(
        decrypt(channel.config.encryptedPayload),
      );
    } catch (err) {
      channel.config.decryptedSecrets = null;
    }
  }

  return channel;
}

export { decrypt as decryptPayload };

// ─────────────────────────────────────────────────────────────────────────
// INPUT CHANNEL LIFECYCLE (delegates to registered handler)
// ─────────────────────────────────────────────────────────────────────────

async function registerInputChannel(channel) {
  const handler = getChannelType(channel.type);
  if (!handler || !handler.registerInput) return;
  const secrets = JSON.parse(decrypt(channel.config.encryptedPayload));
  await handler.registerInput(channel, secrets);
}

async function unregisterInputChannel(channel) {
  const handler = getChannelType(channel.type);
  if (!handler || !handler.unregisterInput) return;
  try {
    const secrets = JSON.parse(decrypt(channel.config.encryptedPayload));
    await handler.unregisterInput(channel, secrets);
  } catch (err) {
    log.error("Gateway", `Failed to unregister input for channel ${channel._id}:`, err.message);
  }
}

export { registerInputChannel, unregisterInputChannel };
