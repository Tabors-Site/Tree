import crypto from "crypto";
import bcrypt from "bcrypt";
import User from "../../db/models/user.js";
import { getApiKeys, setApiKeys } from "../../core/tree/userMetadata.js";

const MAX_API_KEYS_PER_USER = 10;

function containsHtml(str) {
  return /<[a-zA-Z\/][^>]*>/.test(str);
}

export async function generateApiKey() {
  const rawKey = crypto.randomBytes(32).toString("hex");
  const keyHash = await bcrypt.hash(rawKey, 10);
  const keyPrefix = rawKey.slice(0, 8);
  return { rawKey, keyHash, keyPrefix };
}

export async function compareApiKey(rawKey, keyHash) {
  return bcrypt.compare(rawKey, keyHash);
}

export const createApiKey = async (req, res) => {
  try {
    const userId = req.userId;
    const { name, revokeOld = false } = req.body;

    if (name && typeof name !== "string") {
      return res.status(400).json({ message: "Invalid key name" });
    }

    const safeName = name?.trim().slice(0, 64) || "API Key";

    if (containsHtml(safeName)) {
      return res.status(400).json({ message: "Key name cannot contain HTML tags" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    let keys = getApiKeys(user);

    if (revokeOld) {
      keys = keys.map((k) => ({ ...k, revoked: true }));
    }

    if (keys.filter((k) => !k.revoked).length > MAX_API_KEYS_PER_USER) {
      return res.status(400).json({ message: "API key limit reached" });
    }

    const { rawKey, keyHash, keyPrefix } = await generateApiKey();
    keys = [...keys, { _id: crypto.randomUUID(), keyHash, keyPrefix, name: safeName, createdAt: new Date() }];
    setApiKeys(user, keys);
    await user.save();

    return res.status(201).json({
      apiKey: rawKey,
      message: "Store this key securely. You will not see it again.",
    });
  } catch (err) {
    console.error("[createApiKey]", err);
    return res.status(500).json({ message: "Failed to create API key" });
  }
};

export const listApiKeys = async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("metadata");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json(
      getApiKeys(user).map((k) => ({
        id: k._id,
        name: k.name,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
        usageCount: k.usageCount,
        revoked: k.revoked,
      })),
    );
  } catch (err) {
    console.error("[listApiKeys]", err);
    return res.status(500).json({ message: "Failed to list API keys" });
  }
};

export const deleteApiKey = async (req, res) => {
  try {
    const { keyId } = req.params;
    if (!keyId) {
      return res.status(400).json({ message: "Key ID required" });
    }

    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const keys = getApiKeys(user);
    const key = keys.find((k) => k._id === keyId);
    if (!key) return res.status(404).json({ message: "API key not found" });
    key.revoked = true;
    setApiKeys(user, keys);
    await user.save();

    return res.json({ message: "API key revoked" });
  } catch (err) {
    console.error("[deleteApiKey]", err);
    return res.status(500).json({ message: "Failed to revoke API key" });
  }
};

/* ===========================
    AUTH STRATEGY HANDLER
    Called by authenticate/urlAuth middleware via the strategy pattern.
    Returns { userId, username, extra: { apiKeyId } } or null.
============================ */

const failedAttempts = new Map();
const FAIL_WINDOW_MS = 5 * 60 * 1000;
const MAX_FAILURES = 10;

function getClientIp(req) {
  return req.ip || req.connection?.remoteAddress || "unknown";
}

// Clean up stale entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of failedAttempts) {
    if (now - entry.start > FAIL_WINDOW_MS * 2) failedAttempts.delete(ip);
  }
}, 10 * 60 * 1000);

export async function apiKeyAuthStrategy(req) {
  const authHeader = req.headers.authorization;
  const apiKey =
    req.headers["x-api-key"] ||
    (authHeader?.startsWith("ApiKey ") ? authHeader.slice(7).trim() : null);

  if (!apiKey) return null;

  // Brute-force protection
  const clientIp = getClientIp(req);
  const entry = failedAttempts.get(clientIp);
  if (entry && Date.now() - entry.start <= FAIL_WINDOW_MS && entry.count >= MAX_FAILURES) {
    const err = new Error("Too many failed attempts. Try again later.");
    err.status = 429;
    throw err;
  }

  const prefix = apiKey.slice(0, 8);
  const candidates = await User.find({
    "metadata.apiKeys.keyPrefix": prefix,
    "metadata.apiKeys.revoked": { $ne: true },
  });

  for (const user of candidates) {
    const keys = getApiKeys(user);
    for (const key of keys) {
      if (key.revoked) continue;
      if (key.keyPrefix && key.keyPrefix !== prefix) continue;

      const match = await bcrypt.compare(apiKey, key.keyHash);
      if (!match) continue;

      // Clear failures on success
      failedAttempts.delete(clientIp);

      // Usage tracking
      key.usageCount = (key.usageCount || 0) + 1;
      key.lastUsedAt = new Date();
      setApiKeys(user, keys);
      await user.save();

      return { userId: user._id, username: user.username, extra: { apiKeyId: key._id } };
    }
  }

  // Record failure
  if (!entry || Date.now() - entry.start > FAIL_WINDOW_MS) {
    failedAttempts.set(clientIp, { start: Date.now(), count: 1 });
  } else {
    entry.count += 1;
  }

  return null;
}
