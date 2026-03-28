import log from "../../seed/log.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import crypto from "crypto";
import bcrypt from "bcrypt";
import User from "../../seed/models/user.js";
import { getUserMeta, setUserMeta } from "../../seed/tree/userMetadata.js";

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
      return sendError(res, 400, ERR.INVALID_INPUT, "Invalid key name");
    }

    const safeName = name?.trim().slice(0, 64) || "API Key";

    if (containsHtml(safeName)) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Key name cannot contain HTML tags");
    }

    const user = await User.findById(userId);
    if (!user) {
      return sendError(res, 404, ERR.USER_NOT_FOUND, "User not found");
    }

    let keys = getUserMeta(user, "apiKeys");
    if (!Array.isArray(keys)) keys = [];

    if (revokeOld) {
      keys = keys.map((k) => ({ ...k, revoked: true }));
    }

    if (keys.filter((k) => !k.revoked).length > MAX_API_KEYS_PER_USER) {
      return sendError(res, 400, ERR.INVALID_INPUT, "API key limit reached");
    }

    const { rawKey, keyHash, keyPrefix } = await generateApiKey();
    keys = [...keys, { _id: crypto.randomUUID(), keyHash, keyPrefix, name: safeName, createdAt: new Date() }];
    setUserMeta(user, "apiKeys", keys);
    await user.save();

    return sendOk(res, {
      apiKey: rawKey,
      message: "Store this key securely. You will not see it again.",
    }, 201);
  } catch (err) {
 log.error("Api Keys", "[createApiKey]", err);
    return sendError(res, 500, ERR.INTERNAL, "Failed to create API key");
  }
};

export const listApiKeys = async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("metadata");
    if (!user) {
      return sendError(res, 404, ERR.USER_NOT_FOUND, "User not found");
    }

    return sendOk(res,
      (getUserMeta(user, "apiKeys") || []).map((k) => ({
        id: k._id,
        name: k.name,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
        usageCount: k.usageCount,
        revoked: k.revoked,
      })),
    );
  } catch (err) {
 log.error("Api Keys", "[listApiKeys]", err);
    return sendError(res, 500, ERR.INTERNAL, "Failed to list API keys");
  }
};

export const deleteApiKey = async (req, res) => {
  try {
    const { keyId } = req.params;
    if (!keyId) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Key ID required");
    }

    const user = await User.findById(req.userId);
    if (!user) return sendError(res, 404, ERR.USER_NOT_FOUND, "User not found");
    const keys = getUserMeta(user, "apiKeys") || [];
    const key = keys.find((k) => k._id === keyId);
    if (!key) return sendError(res, 404, ERR.NODE_NOT_FOUND, "API key not found");
    key.revoked = true;
    setUserMeta(user, "apiKeys", keys);
    await user.save();

    return sendOk(res, { message: "API key revoked" });
  } catch (err) {
 log.error("Api Keys", "[deleteApiKey]", err);
    return sendError(res, 500, ERR.INTERNAL, "Failed to revoke API key");
  }
};

const failedAttempts = new Map();
const FAIL_WINDOW_MS = 5 * 60 * 1000;
const MAX_FAILURES = 10;

function getClientIp(req) {
  return req.ip || req.connection?.remoteAddress || "unknown";
}

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

  const clientIp = getClientIp(req);
  const entry = failedAttempts.get(clientIp);
  if (entry && Date.now() - entry.start <= FAIL_WINDOW_MS && entry.count >= MAX_FAILURES) {
    const err = new Error("Too many failed attempts. Try again later.");
    err.status = 429;
    throw err;
  }

  const prefix = apiKey.slice(0, 8);
  const candidates = await User.find({
    "metadata.apiKeys": {
      $elemMatch: { keyPrefix: prefix, revoked: { $ne: true } },
    },
  });

  for (const user of candidates) {
    const keys = getUserMeta(user, "apiKeys") || [];
    for (const key of keys) {
      if (key.revoked) continue;
      if (key.keyPrefix && key.keyPrefix !== prefix) continue;

      const match = await bcrypt.compare(apiKey, key.keyHash);
      if (!match) continue;

      failedAttempts.delete(clientIp);

      key.usageCount = (key.usageCount || 0) + 1;
      key.lastUsedAt = new Date();
      setUserMeta(user, "apiKeys", keys);
      await user.save();

      return { userId: user._id, username: user.username, extra: { apiKeyId: key._id } };
    }
  }

  if (!entry || Date.now() - entry.start > FAIL_WINDOW_MS) {
    failedAttempts.set(clientIp, { start: Date.now(), count: 1 });
  } else {
    entry.count += 1;
  }

  return null;
}
