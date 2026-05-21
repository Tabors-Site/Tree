// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
/**
 * Matter metadata helpers.
 *
 * Mirrors extensionMetadata.js (Space) and beingMetadata.js (Being) for the
 * Matter schema. Extensions own their data in matter.metadata. The kernel
 * provides namespaced read/write only; semantic interpretation is the
 * extension's responsibility.
 *
 * Convention: each extension gets a namespace key matching its manifest name.
 * e.g. matter.metadata.get('my-extension').
 *
 * Concurrency: every write goes through atomic MongoDB operators ($set on the
 * specific namespace key, $inc / $push / $addToSet / $unset). Two concurrent
 * writes to different namespaces on the same matter do not clobber each
 * other. There is no read-modify-write path.
 *
 * Spatial scoping: matter inherits scope from the space it lives on. There
 * is no per-matter extension-blocked list. Extensions blocked at the
 * containing space already have their hooks and tool resolutions filtered out
 * by the time they reach matter code, so a separate per-matter check
 * would be redundant.
 *
 * Document size guard: every write checks total matter document size against
 * maxDocumentSizeBytes (default 14MB). Writes exceeding the limit are rejected.
 */

import { hooks } from "../system/hooks.js";
import { guardMetadataWrite } from "../space/documentGuard.js";
import Matter from "../models/matter.js";
import { getLandConfigValue } from "../landConfig.js";

const MAX_KEY_LENGTH = 50;
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function MAX_VALUE_BYTES() {
  return Math.max(1024, Math.min(Number(getLandConfigValue("metadataNamespaceMaxBytes")) || 524288, 2 * 1024 * 1024));
}

function MAX_NESTING_DEPTH() {
  return Math.max(2, Math.min(Number(getLandConfigValue("metadataMaxNestingDepth")) || 8, 20));
}

// ─────────────────────────────────────────────────────────────────────────
// VALIDATION HELPERS
// ─────────────────────────────────────────────────────────────────────────

function validateExtName(extName) {
  if (!extName || typeof extName !== "string") {
    throw new Error("Matter metadata namespace key must be a non-empty string");
  }
  if (extName.length > MAX_KEY_LENGTH) {
    throw new Error(`Matter metadata namespace "${extName.slice(0, 20)}..." exceeds ${MAX_KEY_LENGTH} character limit`);
  }
  if (DANGEROUS_KEYS.has(extName)) {
    throw new Error(`Matter metadata namespace "${extName}" is not allowed`);
  }
}

function hasDangerousKeys(value, seen) {
  if (value === null || typeof value !== "object") return false;
  if (!seen) seen = new WeakSet();
  if (seen.has(value)) return false;
  seen.add(value);
  const entries = Array.isArray(value) ? value.entries() : Object.entries(value);
  for (const [key, v] of entries) {
    if (typeof key === "string" && DANGEROUS_KEYS.has(key)) return true;
    if (v !== null && typeof v === "object" && hasDangerousKeys(v, seen)) return true;
  }
  return false;
}

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
      if (max > MAX_NESTING_DEPTH()) return max;
    }
  }
  return max;
}

function validateData(extName, data) {
  if (data == null) return 0;
  let size;
  try {
    size = Buffer.byteLength(JSON.stringify(data), "utf8");
  } catch {
    throw new Error(`Matter metadata for "${extName}" is not serializable (circular reference, BigInt, or non-JSON type)`);
  }
  if (size > MAX_VALUE_BYTES()) {
    throw new Error(`Matter metadata for "${extName}" exceeds ${MAX_VALUE_BYTES() / 1024}KB limit (${Math.round(size / 1024)}KB)`);
  }
  const depth = measureDepth(data);
  if (depth > MAX_NESTING_DEPTH()) {
    throw new Error(`Matter metadata for "${extName}" exceeds max nesting depth of ${MAX_NESTING_DEPTH()} (found ${depth})`);
  }
  if (hasDangerousKeys(data)) {
    throw new Error(`Matter metadata for "${extName}" contains forbidden keys (__proto__, constructor, or prototype)`);
  }
  return size;
}

// ─────────────────────────────────────────────────────────────────────────
// READ
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get an extension's metadata namespace from matter.
 * Returns the stored object, or an empty object if nothing exists.
 */
export function getMatterMeta(matter, extName) {
  if (!matter || !matter.metadata) return {};
  const data = matter.metadata instanceof Map
    ? matter.metadata.get(extName)
    : matter.metadata?.[extName];
  return data || {};
}

/**
 * Like getMatterMeta but returns `null` when the namespace is unset
 * instead of an empty object. Mirrors readNs on the Space module and
 * readBeingNs on the Being module.
 */
export function readMatterNs(matter, extName) {
  if (!matter || !matter.metadata) return null;
  if (matter.metadata instanceof Map) return matter.metadata.get(extName) || null;
  return matter.metadata?.[extName] || null;
}

// ─────────────────────────────────────────────────────────────────────────
// WRITE
// ─────────────────────────────────────────────────────────────────────────

/**
 * Set an extension's metadata namespace on matter (full replace).
 * Uses atomic MongoDB $set on the specific namespace key. Two concurrent
 * writes to different namespaces on the same matter never clobber each other.
 *
 *   await setMatterMeta(matterId, "review", { status: "approved" });
 *
 * @param {object|string} matter - matter document or _id string
 * @param {string}        extName - the namespace to write to
 * @param {*}             data - the data to store
 * @param {object}        [opts]
 * @param {string}        [opts.callerExtName] - if provided, enforces namespace ownership.
 *   The caller can only write to its own namespace. Set automatically by
 *   the scoped core in buildScopedCore(). Direct imports from seed omit it.
 */
export async function setMatterMeta(matter, extName, data, opts) {
  validateExtName(extName);
  if (opts?.callerExtName && extName !== opts.callerExtName) {
    throw new Error(`Namespace violation: "${opts.callerExtName}" cannot write to "${extName}". Extensions can only write to their own namespace.`);
  }

  validateData(extName, data);

  // Document size guard. Only runs when the caller passes a document; an
  // _id string carries no size context.
  if (typeof matter === "object" && matter !== null) {
    guardMetadataWrite(matter, data, { documentType: "matter", documentId: matter._id });
  }

  const matterId = String(matter._id || matter);

  await Matter.updateOne(
    { _id: matterId },
    { $set: { [`metadata.${extName}`]: data } },
  );

  // Update in-memory document if caller still holds it
  if (typeof matter === "object" && matter !== null) {
    if (matter.metadata instanceof Map) {
      matter.metadata.set(extName, data);
    } else if (matter.metadata) {
      matter.metadata[extName] = data;
    }
  }

  hooks.run("afterMetadataWrite", { documentType: "matter", matterId, extName, data }).catch(() => {});
  return true;
}

/**
 * Shallow merge into an extension's metadata namespace on matter.
 * Uses atomic MongoDB $set on individual keys to avoid read-modify-write races.
 * Mirrors mergeExtMeta and mergeBeingMeta.
 *
 *   await mergeMatterMeta(matterId, "review", { status: "approved", reviewer: "alice" });
 */
export async function mergeMatterMeta(matter, extName, partial, opts) {
  validateExtName(extName);
  if (opts?.callerExtName && extName !== opts.callerExtName) {
    throw new Error(`Namespace violation: "${opts.callerExtName}" cannot write to "${extName}". Extensions can only write to their own namespace.`);
  }
  if (!partial || typeof partial !== "object" || Array.isArray(partial)) return false;

  const safePartial = {};
  for (const [key, value] of Object.entries(partial)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    if (typeof key !== "string" || key.length === 0 || key.length > MAX_KEY_LENGTH) continue;
    if (key.includes(".") || key.includes("$")) continue;
    try { JSON.stringify(value); } catch { continue; }
    safePartial[key] = value;
  }
  if (Object.keys(safePartial).length === 0) return false;

  // Size-bound the merged result.
  const existing = getMatterMeta(matter, extName);
  const merged = { ...existing, ...safePartial };
  validateData(extName, merged);

  if (typeof matter === "object" && matter !== null) {
    guardMetadataWrite(matter, merged, { documentType: "matter", documentId: matter._id });
  }

  const matterId = String(matter._id || matter);
  const updates = {};
  for (const [key, value] of Object.entries(safePartial)) {
    updates[`metadata.${extName}.${key}`] = value;
  }
  await Matter.updateOne({ _id: matterId }, { $set: updates });

  if (typeof matter === "object" && matter !== null) {
    if (matter.metadata instanceof Map) {
      matter.metadata.set(extName, merged);
    } else if (matter.metadata) {
      matter.metadata[extName] = merged;
    }
  }

  hooks.run("afterMetadataWrite", { documentType: "matter", matterId, extName, data: safePartial }).catch(() => {});
  return true;
}

/**
 * Atomic increment on a single key within an extension's metadata namespace
 * on matter. Uses MongoDB $inc. No read-modify-write.
 *
 *   await incMatterMeta(matterId, "review", "revisions", 1);
 */
export async function incMatterMeta(matter, extName, key, amount = 1) {
  if (!matter || !extName || !key) return false;
  validateExtName(extName);
  if (typeof amount !== "number" || !isFinite(amount)) return false;
  if (DANGEROUS_KEYS.has(key)) return false;
  const matterId = String(matter._id || matter);
  await Matter.updateOne(
    { _id: matterId },
    { $inc: { [`metadata.${extName}.${key}`]: amount } },
  );
  return true;
}

/**
 * Atomic push to an array within an extension's metadata namespace on matter.
 * Uses MongoDB $push with $slice for a capped circular buffer.
 *
 *   await pushMatterMeta(matterId, "review", "history", { round, reviewer }, 50);
 */
export async function pushMatterMeta(matter, extName, key, item, maxLength = 100) {
  if (!matter || !extName || !key) return false;
  validateExtName(extName);
  if (DANGEROUS_KEYS.has(key)) return false;
  const safeCap = Math.min(Math.max(1, maxLength), 1000);
  let itemSize;
  try { itemSize = Buffer.byteLength(JSON.stringify(item), "utf8"); } catch { return false; }
  const perItemCap = Math.max(1024, Math.floor(MAX_VALUE_BYTES() / safeCap));
  if (itemSize > perItemCap) return false;
  const matterId = String(matter._id || matter);
  await Matter.updateOne(
    { _id: matterId },
    { $push: { [`metadata.${extName}.${key}`]: { $each: [item], $slice: -safeCap } } },
  );
  return true;
}

/**
 * Atomic add-to-set within an extension's metadata namespace on matter.
 * Uses MongoDB $addToSet. No duplicates. No read-modify-write.
 *
 *   await addToMatterMetaSet(matterId, "team", "tagged", "@alice");
 */
export async function addToMatterMetaSet(matter, extName, key, item) {
  if (!matter || !extName || !key) return false;
  validateExtName(extName);
  if (DANGEROUS_KEYS.has(key)) return false;
  let itemSize;
  try { itemSize = Buffer.byteLength(JSON.stringify(item), "utf8"); } catch { return false; }
  if (itemSize > MAX_VALUE_BYTES()) return false;
  const matterId = String(matter._id || matter);
  await Matter.updateOne(
    { _id: matterId },
    { $addToSet: { [`metadata.${extName}.${key}`]: item } },
  );
  return true;
}

/**
 * Atomic multi-field set within an extension's metadata namespace on
 * matter. Uses MongoDB $set on individual keys. No read-modify-write.
 *
 *   await batchSetMatterMeta(matterId, "embed", { vector, model, generatedAt });
 */
export async function batchSetMatterMeta(matter, extName, fields) {
  if (!matter || !extName || !fields || typeof fields !== "object") return false;
  validateExtName(extName);
  const entries = Object.entries(fields);
  if (entries.length === 0 || entries.length > 100) return false;
  const updates = {};
  let totalSize = 0;
  const maxBytes = MAX_VALUE_BYTES();
  for (const [key, value] of entries) {
    if (DANGEROUS_KEYS.has(key)) continue;
    let serialized;
    try { serialized = JSON.stringify(value); } catch { continue; }
    totalSize += Buffer.byteLength(serialized, "utf8");
    if (totalSize > maxBytes) return false;
    updates[`metadata.${extName}.${key}`] = value;
  }
  if (Object.keys(updates).length === 0) return false;
  const matterId = String(matter._id || matter);
  await Matter.updateOne({ _id: matterId }, { $set: updates });
  return true;
}

/**
 * Atomic namespace removal from matter's metadata.
 * Uses MongoDB $unset. The key is removed entirely, not set to null.
 *
 *   await unsetMatterMeta(matterId, "embed");
 */
export async function unsetMatterMeta(matter, extName) {
  if (!matter || !extName) return false;
  validateExtName(extName);
  const matterId = String(matter._id || matter);
  await Matter.updateOne(
    { _id: matterId },
    { $unset: { [`metadata.${extName}`]: "" } },
  );
  return true;
}
