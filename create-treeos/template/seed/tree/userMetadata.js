// TreeOS Seed . AGPL-3.0 . https://treeos.ai
/**
 * User metadata helpers.
 * Same pattern as extensionMetadata.js but for User documents.
 * Extensions own their data in metadata. Core provides read/write only.
 * Document size guard protects against 16MB BSON limit.
 *
 * setUserMeta is synchronous (modifies in-memory document). Caller must
 * await user.save() to persist. This matches the Mongoose document pattern
 * used by all 35+ callers.
 */

import { guardMetadataWrite } from "./documentGuard.js";
import { getLandConfigValue } from "../landConfig.js";
import User from "../models/user.js";

const MAX_KEY_LENGTH = 50;
function MAX_VALUE_BYTES() { return Math.max(1024, Math.min(Number(getLandConfigValue("metadataNamespaceMaxBytes")) || 524288, 2 * 1024 * 1024)); }
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function maxNestingDepth() {
  return Math.max(2, Math.min(Number(getLandConfigValue("metadataMaxNestingDepth")) || 5, 20));
}

/**
 * Measure nesting depth. Same as extensionMetadata.
 */
function measureDepth(value, current = 0, seen) {
  if (value === null || typeof value !== "object") return current;
  if (!seen) seen = new WeakSet();
  if (seen.has(value)) return current;
  seen.add(value);
  let max = current + 1;
  const entries = Array.isArray(value) ? value : Object.values(value);
  for (const v of entries) {
    if (v !== null && typeof v === "object") {
      const d = measureDepth(v, current + 1, seen);
      if (d > max) max = d;
      if (max > maxNestingDepth()) return max;
    }
  }
  return max;
}

/**
 * Read from user metadata. Works with both Mongoose docs and .lean() plain objects.
 * Returns the stored value or an empty object.
 */
export function getUserMeta(user, key) {
  if (!user || !user.metadata) return {};
  const data = user.metadata instanceof Map
    ? user.metadata.get(key)
    : user.metadata?.[key];
  return data || {};
}

/**
 * Write to user metadata. Synchronous (modifies in-memory document).
 * Caller must await user.save() to persist.
 *
 * Validates: key name, data size, data serializability, nesting depth,
 * total document size. Throws on failure.
 */
export function setUserMeta(user, key, data) {
  if (!user) throw new Error("setUserMeta: user is required");

  // Key validation
  if (!key || typeof key !== "string") throw new Error("setUserMeta: key must be a non-empty string");
  if (key.length > MAX_KEY_LENGTH) throw new Error(`setUserMeta: key "${key.slice(0, 20)}..." exceeds ${MAX_KEY_LENGTH} chars`);
  if (DANGEROUS_KEYS.has(key)) throw new Error(`setUserMeta: key "${key}" is not allowed`);

  // Data validation
  if (data != null) {
    let size;
    try {
      size = Buffer.byteLength(JSON.stringify(data), "utf8");
    } catch {
      throw new Error(`setUserMeta: data for "${key}" is not serializable`);
    }
    if (size > MAX_VALUE_BYTES()) {
      throw new Error(`setUserMeta: data for "${key}" exceeds ${MAX_VALUE_BYTES() / 1024}KB limit (${Math.round(size / 1024)}KB)`);
    }
    const depth = measureDepth(data);
    if (depth > maxNestingDepth()) {
      throw new Error(`setUserMeta: data for "${key}" exceeds max nesting depth of ${maxNestingDepth()}`);
    }
  }

  // Document size guard
  guardMetadataWrite(user, data, { documentType: "user", documentId: user._id });

  // Apply to in-memory document
  if (!user.metadata) {
    user.metadata = new Map();
  }
  if (user.metadata instanceof Map) {
    user.metadata.set(key, data);
  } else {
    user.metadata[key] = data;
  }
  if (user.markModified) user.markModified("metadata");
}

/**
 * Atomic increment on a single key within a user's metadata namespace.
 * Uses MongoDB $inc. No read-modify-write. No race conditions.
 * Accepts user document or userId string.
 *
 *   await incUserMeta(userId, "storage", "usageKB", 42);
 */
export async function incUserMeta(user, key, field, amount = 1) {
  if (!user || !key || !field) return false;
  if (typeof key !== "string" || key.length > MAX_KEY_LENGTH || DANGEROUS_KEYS.has(key)) return false;
  if (DANGEROUS_KEYS.has(field)) return false;
  if (typeof amount !== "number" || !isFinite(amount)) return false;
  const userId = String(user._id || user);
  await User.updateOne(
    { _id: userId },
    { $inc: { [`metadata.${key}.${field}`]: amount } }
  );
  return true;
}

/**
 * Atomic push to an array within a user's metadata namespace.
 * Uses MongoDB $push with $slice for a capped circular buffer.
 *
 *   await pushUserMeta(userId, "phase", "history", { phase, ts }, 50);
 */
export async function pushUserMeta(user, key, field, item, maxLength = 100) {
  if (!user || !key || !field) return false;
  if (typeof key !== "string" || key.length > MAX_KEY_LENGTH || DANGEROUS_KEYS.has(key)) return false;
  if (DANGEROUS_KEYS.has(field)) return false;
  const safeCap = Math.min(Math.max(1, maxLength), 1000);
  try { JSON.stringify(item); } catch { return false; }
  const userId = String(user._id || user);
  await User.updateOne(
    { _id: userId },
    { $push: { [`metadata.${key}.${field}`]: { $each: [item], $slice: -safeCap } } }
  );
  return true;
}

/**
 * Atomic add-to-set within a user's metadata namespace.
 * Uses MongoDB $addToSet. No duplicates. No read-modify-write.
 *
 *   await addToUserMetaSet(userId, "nav", "roots", rootId);
 */
export async function addToUserMetaSet(user, key, field, item) {
  if (!user || !key || !field) return false;
  if (typeof key !== "string" || key.length > MAX_KEY_LENGTH || DANGEROUS_KEYS.has(key)) return false;
  if (DANGEROUS_KEYS.has(field)) return false;
  const userId = String(user._id || user);
  await User.updateOne(
    { _id: userId },
    { $addToSet: { [`metadata.${key}.${field}`]: item } },
  );
  return true;
}

/**
 * Atomic multi-field set within a user's metadata namespace.
 * Uses MongoDB $set on individual keys. No read-modify-write.
 *
 *   await batchSetUserMeta(userId, "energy", { available: 100, lastReset: now });
 */
export async function batchSetUserMeta(user, key, fields) {
  if (!user || !key || !fields || typeof fields !== "object") return false;
  if (typeof key !== "string" || key.length > MAX_KEY_LENGTH || DANGEROUS_KEYS.has(key)) return false;
  const entries = Object.entries(fields);
  if (entries.length === 0 || entries.length > 100) return false;
  const userId = String(user._id || user);
  const updates = {};
  for (const [field, value] of entries) {
    if (DANGEROUS_KEYS.has(field)) continue;
    try { JSON.stringify(value); } catch { continue; }
    updates[`metadata.${key}.${field}`] = value;
  }
  if (Object.keys(updates).length === 0) return false;
  await User.updateOne({ _id: userId }, { $set: updates });
  return true;
}

/**
 * Atomic namespace removal from a user's metadata.
 * Uses MongoDB $unset. The key is removed entirely, not set to null.
 *
 *   await unsetUserMeta(userId, "old-extension");
 */
export async function unsetUserMeta(user, key) {
  if (!user || !key) return false;
  if (typeof key !== "string" || key.length > MAX_KEY_LENGTH || DANGEROUS_KEYS.has(key)) return false;
  const userId = String(user._id || user);
  await User.updateOne(
    { _id: userId },
    { $unset: { [`metadata.${key}`]: "" } }
  );
  return true;
}
