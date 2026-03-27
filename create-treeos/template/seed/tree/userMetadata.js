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
