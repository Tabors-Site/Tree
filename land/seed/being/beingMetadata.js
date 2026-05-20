// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
/**
 * Being metadata helpers.
 * Same pattern as extensionMetadata.js but for Being documents.
 * Extensions own their data in metadata. Core provides read/write only.
 * Document size guard protects against 16MB BSON limit.
 *
 * setBeingMeta is synchronous (modifies in-memory document). Caller must
 * await being.save() to persist. This matches the Mongoose document pattern
 * used by all 35+ callers.
 */

import { guardMetadataWrite } from "../space/documentGuard.js";
import { getLandConfigValue } from "../landConfig.js";
import Being from "../models/being.js";

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
 * Read from being metadata. Works with both Mongoose docs and .lean() plain objects.
 * Returns the stored value or an empty object.
 */
export function getBeingMeta(user, key) {
  if (!user || !user.metadata) return {};
  const data = user.metadata instanceof Map
    ? user.metadata.get(key)
    : user.metadata?.[key];
  return data || {};
}

/**
 * Like getBeingMeta but returns `null` when the namespace is unset
 * instead of an empty object. Use when callers distinguish "never written"
 * from "empty state" (e.g. `if (readBeingNs(being, "billing")) { ... }`).
 * Mirrors readNs on the Space module.
 */
export function readBeingNs(user, key) {
  if (!user || !user.metadata) return null;
  if (user.metadata instanceof Map) return user.metadata.get(key) || null;
  return user.metadata?.[key] || null;
}

/**
 * Set a namespace on a being's metadata (full replace).
 * Atomic at the MongoDB layer: `$set` on `metadata.<key>` only. Two concurrent
 * writes to different namespaces on the same being do not clobber each other.
 * Mirrors setExtMeta semantics on the Space module.
 *
 * Accepts a being document OR a beingId string. When passed a document, the
 * in-memory `metadata` Map is also updated so subsequent reads on the same
 * document see the new value without re-fetching from MongoDB.
 *
 * NOTE: the legacy `setBeingMeta(user, key, data) + await user.save()` pattern
 * was a read-modify-write race that clobbered concurrent writes to other
 * namespaces. This function is now atomic; the trailing `save()` is no longer
 * required and should be removed unless the caller mutated other top-level
 * fields on the document.
 *
 * Validates: key name, data size, data serializability, nesting depth,
 * total document size. Throws on failure.
 */
export async function setBeingMeta(user, key, data) {
  if (!user) throw new Error("setBeingMeta: user is required");

  // Key validation
  if (!key || typeof key !== "string") throw new Error("setBeingMeta: key must be a non-empty string");
  if (key.length > MAX_KEY_LENGTH) throw new Error(`setBeingMeta: key "${key.slice(0, 20)}..." exceeds ${MAX_KEY_LENGTH} chars`);
  if (DANGEROUS_KEYS.has(key)) throw new Error(`setBeingMeta: key "${key}" is not allowed`);

  // Data validation
  if (data != null) {
    let size;
    try {
      size = Buffer.byteLength(JSON.stringify(data), "utf8");
    } catch {
      throw new Error(`setBeingMeta: data for "${key}" is not serializable`);
    }
    if (size > MAX_VALUE_BYTES()) {
      throw new Error(`setBeingMeta: data for "${key}" exceeds ${MAX_VALUE_BYTES() / 1024}KB limit (${Math.round(size / 1024)}KB)`);
    }
    const depth = measureDepth(data);
    if (depth > maxNestingDepth()) {
      throw new Error(`setBeingMeta: data for "${key}" exceeds max nesting depth of ${maxNestingDepth()}`);
    }
  }

  // Document size guard. Only meaningful when caller passed a real document
  // (an _id string has no size context).
  if (typeof user === "object" && user !== null && user.metadata !== undefined) {
    guardMetadataWrite(user, data, { documentType: "being", documentId: user._id });
  }

  // Update in-memory document BEFORE awaiting the DB write. Fire-and-forget
  // callers (routes that read user.metadata immediately after this call without
  // awaiting) need the synchronous in-memory update to see the new value;
  // the DB persist still happens, just asynchronously.
  if (typeof user === "object" && user !== null && user.metadata !== undefined) {
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

  const beingId = String(user._id || user);
  await Being.updateOne(
    { _id: beingId },
    { $set: { [`metadata.${key}`]: data } },
  );

  return true;
}

/**
 * Shallow merge into a being's metadata namespace.
 * Uses atomic MongoDB $set on individual keys to avoid read-modify-write races.
 * Returns true on success, false on no-op. Mirrors mergeExtMeta on the Space module.
 *
 *   await mergeBeingMeta(beingId, "energy", { available: 95, lastUsed: Date.now() });
 *   // Atomically sets metadata.energy.available and metadata.energy.lastUsed without
 *   // overwriting other keys in the energy namespace.
 */
export async function mergeBeingMeta(user, key, partial) {
  if (!user || !key) return false;
  if (typeof key !== "string" || key.length > MAX_KEY_LENGTH || DANGEROUS_KEYS.has(key)) return false;
  if (!partial || typeof partial !== "object" || Array.isArray(partial)) return false;

  // Filter dangerous keys and invalid field names from the partial. Dots and
  // dollar signs create unintended nested MongoDB paths and must be rejected.
  const safePartial = {};
  for (const [field, value] of Object.entries(partial)) {
    if (DANGEROUS_KEYS.has(field)) continue;
    if (typeof field !== "string" || field.length === 0 || field.length > MAX_KEY_LENGTH) continue;
    if (field.includes(".") || field.includes("$")) continue;
    try { JSON.stringify(value); } catch { continue; }
    safePartial[field] = value;
  }
  if (Object.keys(safePartial).length === 0) return false;

  // Size-bound the merge result against the namespace cap.
  const existing = getBeingMeta(user, key);
  const merged = { ...existing, ...safePartial };
  let mergedSize;
  try {
    mergedSize = Buffer.byteLength(JSON.stringify(merged), "utf8");
  } catch {
    return false;
  }
  if (mergedSize > MAX_VALUE_BYTES()) return false;

  const beingId = String(user._id || user);
  const updates = {};
  for (const [field, value] of Object.entries(safePartial)) {
    updates[`metadata.${key}.${field}`] = value;
  }
  await Being.updateOne({ _id: beingId }, { $set: updates });
  return true;
}

/**
 * Atomic increment on a single key within a being's metadata namespace.
 * Uses MongoDB $inc. No read-modify-write. No race conditions.
 * Accepts user document or beingId string.
 *
 *   await incBeingMeta(beingId, "storage", "usageKB", 42);
 */
export async function incBeingMeta(user, key, field, amount = 1) {
  if (!user || !key || !field) return false;
  if (typeof key !== "string" || key.length > MAX_KEY_LENGTH || DANGEROUS_KEYS.has(key)) return false;
  if (DANGEROUS_KEYS.has(field)) return false;
  if (typeof amount !== "number" || !isFinite(amount)) return false;
  const beingId = String(user._id || user);
  await Being.updateOne(
    { _id: beingId },
    { $inc: { [`metadata.${key}.${field}`]: amount } }
  );
  return true;
}

/**
 * Atomic push to an array within a user's metadata namespace.
 * Uses MongoDB $push with $slice for a capped circular buffer.
 *
 *   await pushBeingMeta(beingId, "phase", "history", { phase, ts }, 50);
 */
export async function pushBeingMeta(user, key, field, item, maxLength = 100) {
  if (!user || !key || !field) return false;
  if (typeof key !== "string" || key.length > MAX_KEY_LENGTH || DANGEROUS_KEYS.has(key)) return false;
  if (DANGEROUS_KEYS.has(field)) return false;
  const safeCap = Math.min(Math.max(1, maxLength), 1000);
  try { JSON.stringify(item); } catch { return false; }
  const beingId = String(user._id || user);
  await Being.updateOne(
    { _id: beingId },
    { $push: { [`metadata.${key}.${field}`]: { $each: [item], $slice: -safeCap } } }
  );
  return true;
}

/**
 * Atomic add-to-set within a user's metadata namespace.
 * Uses MongoDB $addToSet. No duplicates. No read-modify-write.
 *
 *   await addToBeingMetaSet(beingId, "nav", "roots", rootId);
 */
export async function addToBeingMetaSet(user, key, field, item) {
  if (!user || !key || !field) return false;
  if (typeof key !== "string" || key.length > MAX_KEY_LENGTH || DANGEROUS_KEYS.has(key)) return false;
  if (DANGEROUS_KEYS.has(field)) return false;
  const beingId = String(user._id || user);
  await Being.updateOne(
    { _id: beingId },
    { $addToSet: { [`metadata.${key}.${field}`]: item } },
  );
  return true;
}

/**
 * Atomic multi-field set within a user's metadata namespace.
 * Uses MongoDB $set on individual keys. No read-modify-write.
 *
 *   await batchSetBeingMeta(beingId, "energy", { available: 100, lastReset: now });
 */
export async function batchSetBeingMeta(user, key, fields) {
  if (!user || !key || !fields || typeof fields !== "object") return false;
  if (typeof key !== "string" || key.length > MAX_KEY_LENGTH || DANGEROUS_KEYS.has(key)) return false;
  const entries = Object.entries(fields);
  if (entries.length === 0 || entries.length > 100) return false;
  const beingId = String(user._id || user);
  const updates = {};
  for (const [field, value] of entries) {
    if (DANGEROUS_KEYS.has(field)) continue;
    try { JSON.stringify(value); } catch { continue; }
    updates[`metadata.${key}.${field}`] = value;
  }
  if (Object.keys(updates).length === 0) return false;
  await Being.updateOne({ _id: beingId }, { $set: updates });
  return true;
}

/**
 * Atomic namespace removal from a user's metadata.
 * Uses MongoDB $unset. The key is removed entirely, not set to null.
 *
 *   await unsetBeingMeta(beingId, "old-extension");
 */
export async function unsetBeingMeta(user, key) {
  if (!user || !key) return false;
  if (typeof key !== "string" || key.length > MAX_KEY_LENGTH || DANGEROUS_KEYS.has(key)) return false;
  const beingId = String(user._id || user);
  await Being.updateOne(
    { _id: beingId },
    { $unset: { [`metadata.${key}`]: "" } }
  );
  return true;
}
