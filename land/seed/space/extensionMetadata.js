// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
import { hooks } from "../system/hooks.js";
import { guardMetadataWrite } from "./documentGuard.js";
import { invalidateSpace } from "./ancestorCache.js";
import Space from "../models/space.js";
import { getLandConfigValue } from "../landConfig.js";

/**
 * Helpers for extensions to store per-space data in space.metadata.
 *
 * Convention: each extension gets a namespace key matching its manifest name.
 * e.g. space.metadata.get('my-extension')
 *
 * Spatial extension scoping: if an extension is blocked at a space
 * (via metadata.extensions.blocked), writes are silently skipped.
 * Core namespaces (tools, modes, extensions, cascade) are never blocked.
 *
 * Concurrency: setExtMeta uses atomic MongoDB $set on the specific namespace key.
 * Two concurrent writes to different namespaces on the same space do not clobber each other.
 * mergeExtMeta uses $set on individual keys within a namespace for atomic partial updates.
 *
 * Document size guard: every write checks total document size against
 * maxDocumentSizeBytes (default 14MB). Writes exceeding the limit rejected.
 */

// Kernel-aware namespaces. Any extension can write to these because they
// hold protocol-level data referenced by the kernel itself:
//   - tools, modes, extensions: per-space capability scope
//   - cascade, llm: per-space behavior configuration
//   - beings: space-hosted being registry. Which beings of which roles
//     live at this space (beingIds bound to role names), plus any
//     role-related config specific to this position (e.g. arrival/
//     owner/member permission sets, scopeRulerId, etc.). Keyed by
//     role name on the inside. Multiple extensions legitimately write
//     here (governing registers Ruler/Planner/Contractor/Foreman/
//     Worker; authorize reads arrival/owner/member permissions).
//     Renamed from "embodiments" in migration 0.5.0.
//   - permissions: per-position verb-action permission rules
//     consumed by the authorize function (Layer 3 of stance auth).
const CORE_NAMESPACES = new Set(["tools", "modes", "extensions", "cascade", "llm", "beings", "permissions"]);
function MAX_METADATA_VALUE_BYTES() { return Math.max(1024, Math.min(Number(getLandConfigValue("metadataNamespaceMaxBytes")) || 524288, 2 * 1024 * 1024)); }
const MAX_NAMESPACE_KEY_LENGTH = 50;
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function MAX_NESTING_DEPTH() {
  return Math.max(2, Math.min(Number(getLandConfigValue("metadataMaxNestingDepth")) || 8, 20));
}

// ─────────────────────────────────────────────────────────────────────────
// VALIDATION HELPERS
// ─────────────────────────────────────────────────────────────────────────

/**
 * Validate a namespace key (extension name).
 */
function validateExtName(extName) {
  if (!extName || typeof extName !== "string") {
    throw new Error("Metadata namespace key must be a non-empty string");
  }
  if (extName.length > MAX_NAMESPACE_KEY_LENGTH) {
    throw new Error(`Metadata namespace "${extName.slice(0, 20)}..." exceeds ${MAX_NAMESPACE_KEY_LENGTH} character limit`);
  }
  if (DANGEROUS_KEYS.has(extName)) {
    throw new Error(`Metadata namespace "${extName}" is not allowed`);
  }
}

/**
 * Recursively check for dangerous keys (__proto__, constructor, prototype)
 * at any depth in an object tree. Prevents prototype pollution if metadata
 * is ever spread or Object.assign'd in memory.
 */
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

/**
 * Validate data for size, serializability, nesting depth, and dangerous keys.
 * Throws on failure. Returns the serialized size in bytes.
 */
function validateData(extName, data) {
  if (data == null) return 0;

  let size;
  try {
    size = Buffer.byteLength(JSON.stringify(data), "utf8");
  } catch {
    throw new Error(`Metadata for "${extName}" is not serializable (circular reference, BigInt, or non-JSON type)`);
  }

  if (size > MAX_METADATA_VALUE_BYTES()) {
    throw new Error(`Metadata for "${extName}" exceeds ${MAX_METADATA_VALUE_BYTES() / 1024}KB limit (${Math.round(size / 1024)}KB)`);
  }

  const depth = measureDepth(data);
  if (depth > MAX_NESTING_DEPTH()) {
    throw new Error(`Metadata for "${extName}" exceeds max nesting depth of ${MAX_NESTING_DEPTH()} (found ${depth}). Flatten your data structure.`);
  }

  if (hasDangerousKeys(data)) {
    throw new Error(`Metadata for "${extName}" contains forbidden keys (__proto__, constructor, or prototype)`);
  }

  return size;
}

/**
 * Measure the nesting depth of a plain object/array.
 * Arrays and objects each count as one level. Primitives are 0.
 * Tracks visited objects to prevent infinite recursion on circular references.
 */
function measureDepth(value, current = 0, seen) {
  if (value === null || typeof value !== "object") return current;
  if (!seen) seen = new WeakSet();
  if (seen.has(value)) return current; // circular reference, stop
  seen.add(value);
  let max = current + 1;
  const entries = Array.isArray(value) ? value : Object.values(value);
  for (const v of entries) {
    if (v !== null && typeof v === "object") {
      const d = measureDepth(v, current + 1, seen);
      if (d > max) max = d;
      if (max > MAX_NESTING_DEPTH()) return max; // early exit
    }
  }
  return max;
}

/**
 * Check if an extension is blocked at this specific space.
 * Only checks the space's own metadata, not the parent chain
 * (parent chain is handled by hooks and tool resolution).
 */
function isBlockedLocally(space, extName) {
  if (CORE_NAMESPACES.has(extName)) return false;
  const meta = space.metadata instanceof Map
    ? space.metadata.get("extensions")
    : space.metadata?.extensions;
  if (!meta?.blocked) return false;
  // Array.includes is fine here. blocked[] is typically < 10 entries per space.
  return Array.isArray(meta.blocked) && meta.blocked.includes(extName);
}

// ─────────────────────────────────────────────────────────────────────────
// READ
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get an extension's metadata namespace from a space.
 * Returns the stored object, or an empty object if nothing exists.
 */
export function getExtMeta(space, extName) {
  if (!space || !space.metadata) return {};
  const data = space.metadata instanceof Map
    ? space.metadata.get(extName)
    : space.metadata?.[extName];
  return data || {};
}

/**
 * Like getExtMeta but returns `null` when the namespace is unset
 * instead of an empty object. Use when callers distinguish "never
 * written" from "empty state" (e.g. `if (readNs(space, "swarm"))`
 * style guards). Extensions used to reinvent this function locally
 * in every state module; prefer this shared one.
 */
export function readNs(space, extName) {
  if (!space || !space.metadata) return null;
  if (space.metadata instanceof Map) return space.metadata.get(extName) || null;
  return space.metadata?.[extName] || null;
}

// ─────────────────────────────────────────────────────────────────────────
// WRITE
// ─────────────────────────────────────────────────────────────────────────

/**
 * Set an extension's metadata namespace on a space (full replace).
 * Uses atomic MongoDB $set so concurrent writes to different namespaces
 * on the same space do not clobber each other.
 *
 * Silently skips if the extension is blocked at this space.
 *
 * @param {object}  space
 * @param {string}  extName - the namespace to write to
 * @param {*}       data - the data to store
 * @param {object}  [opts]
 * @param {string}  [opts.callerExtName] - if provided, enforces namespace ownership.
 *   The caller can only write to its own namespace or core namespaces.
 *   Set automatically by the scoped core in buildScopedCore().
 *   Direct imports from seed omit this (kernel code, migrations, utilities).
 */
export async function setExtMeta(space, extName, data, opts) {
  validateExtName(extName);
  if (opts?.callerExtName && extName !== opts.callerExtName && !CORE_NAMESPACES.has(extName)) {
    throw new Error(`Namespace violation: "${opts.callerExtName}" cannot write to "${extName}". Extensions can only write to their own namespace.`);
  }
  if (isBlockedLocally(space, extName)) return false;

  validateData(extName, data);

  // Document size guard: check total document size before writing
  guardMetadataWrite(space, data, { documentType: "space", documentId: space._id });

  const spaceId = String(space._id);

  // Atomic write: MongoDB handles concurrency. No read-modify-write race.
  await Space.updateOne(
    { _id: spaceId },
    { $set: { [`metadata.${extName}`]: data } },
  );

  // Update in-memory document if caller still holds it
  if (space.metadata instanceof Map) {
    space.metadata.set(extName, data);
  } else if (space.metadata) {
    space.metadata[extName] = data;
  }

  invalidateSpace(spaceId);
  hooks.run("afterMetadataWrite", { spaceId, extName, data }).catch(() => {});
  return true;
}

/**
 * Shallow merge into an extension's metadata namespace.
 * Uses atomic $set on individual keys to avoid read-modify-write races.
 * Silently skips if the extension is blocked at this space.
 *
 * Same validation as setExtMeta: size, nesting, namespace key, dangerous keys.
 */
export async function mergeExtMeta(space, extName, partial, opts) {
  validateExtName(extName);
  if (opts?.callerExtName && extName !== opts.callerExtName && !CORE_NAMESPACES.has(extName)) {
    throw new Error(`Namespace violation: "${opts.callerExtName}" cannot write to "${extName}". Extensions can only write to their own namespace.`);
  }
  if (isBlockedLocally(space, extName)) return false;
  if (!partial || typeof partial !== "object" || Array.isArray(partial)) return false;

  // Filter dangerous keys from partial
  const safePartial = {};
  for (const [key, value] of Object.entries(partial)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    if (typeof key !== "string" || key.length === 0 || key.length > MAX_NAMESPACE_KEY_LENGTH) continue;
    // Dots in keys create nested MongoDB paths. Reject them.
    if (key.includes(".") || key.includes("$")) continue;
    safePartial[key] = value;
  }

  if (Object.keys(safePartial).length === 0) return false;

  // Validate the merged result for size and nesting
  const existing = getExtMeta(space, extName);
  const merged = { ...existing, ...safePartial };
  validateData(extName, merged);

  // Document size guard
  guardMetadataWrite(space, merged, { documentType: "space", documentId: space._id });

  const spaceId = String(space._id);

  const updates = {};
  for (const [key, value] of Object.entries(safePartial)) {
    updates[`metadata.${extName}.${key}`] = value;
  }

  await Space.updateOne({ _id: spaceId }, { $set: updates });

  // Update in-memory document
  if (space.metadata instanceof Map) {
    space.metadata.set(extName, merged);
  } else if (space.metadata) {
    space.metadata[extName] = merged;
  }

  invalidateSpace(spaceId);
  hooks.run("afterMetadataWrite", { spaceId, extName, data: safePartial }).catch(() => {});
  return true;
}

/**
 * Validate extName for atomic operations.
 * Same checks as setExtMeta: key length, dangerous keys, type.
 * Throws on failure so bad inputs never reach MongoDB.
 */
function validateAtomicExtName(extName) {
  validateExtName(extName);
}

/**
 * Atomic increment on a single key within an extension's metadata namespace.
 * Uses MongoDB $inc. No read-modify-write. No race conditions.
 *
 *   await incExtMeta(space, "my-extension", "counter.daily", 42);
 *   // Atomically adds 42 to metadata.my-extension.counter.daily
 */
export async function incExtMeta(space, extName, key, amount = 1) {
  if (!space || !extName || !key) return false;
  validateAtomicExtName(extName);
  if (typeof amount !== "number" || !isFinite(amount)) return false;
  if (DANGEROUS_KEYS.has(key)) return false;
  const spaceId = String(space._id || space);
  await Space.updateOne(
    { _id: spaceId },
    { $inc: { [`metadata.${extName}.${key}`]: amount } }
  );
  invalidateSpace(spaceId);
  return true;
}

/**
 * Atomic push to an array within an extension's metadata namespace.
 * Uses MongoDB $push with $slice for a capped circular buffer.
 *
 *   await pushExtMeta(space, "scheduler", "completions", { date, delta }, 50);
 *   // Atomically appends to metadata.scheduler.completions, keeps last 50
 */
export async function pushExtMeta(space, extName, key, item, maxLength = 100) {
  if (!space || !extName || !key) return false;
  validateAtomicExtName(extName);
  if (DANGEROUS_KEYS.has(key)) return false;
  // Cap maxLength to prevent unbounded arrays
  const safeCap = Math.min(Math.max(1, maxLength), 1000);
  // Validate item is serializable and within size budget
  let itemSize;
  try { itemSize = Buffer.byteLength(JSON.stringify(item), "utf8"); } catch { return false; }
  // Per-item cap: namespace max / safeCap ensures the array can't exceed the namespace limit
  const perItemCap = Math.max(1024, Math.floor(MAX_METADATA_VALUE_BYTES() / safeCap));
  if (itemSize > perItemCap) return false;
  const spaceId = String(space._id || space);
  await Space.updateOne(
    { _id: spaceId },
    { $push: { [`metadata.${extName}.${key}`]: { $each: [item], $slice: -safeCap } } }
  );
  invalidateSpace(spaceId);
  return true;
}

/**
 * Atomic add-to-set within an extension's metadata namespace.
 * Uses MongoDB $addToSet. No duplicates. No read-modify-write.
 *
 *   await addToExtMetaSet(space, "nav", "trackedRoots", rootId);
 *   // Atomically adds rootId to metadata.nav.trackedRoots if not already present.
 */
export async function addToExtMetaSet(space, extName, key, item) {
  if (!space || !extName || !key) return false;
  validateAtomicExtName(extName);
  if (DANGEROUS_KEYS.has(key)) return false;
  // Item must be serializable. Size-bound the item against the per-namespace cap
  // to prevent unbounded set growth from a single oversized push.
  let itemSize;
  try { itemSize = Buffer.byteLength(JSON.stringify(item), "utf8"); } catch { return false; }
  if (itemSize > MAX_METADATA_VALUE_BYTES()) return false;
  const spaceId = String(space._id || space);
  await Space.updateOne(
    { _id: spaceId },
    { $addToSet: { [`metadata.${extName}.${key}`]: item } },
  );
  invalidateSpace(spaceId);
  return true;
}

/**
 * Atomic multi-field set within an extension's metadata namespace.
 * Uses MongoDB $set on individual keys. No read-modify-write.
 * Accepts space document or spaceId string.
 *
 *   await batchSetExtMeta(spaceId, "values", { weight: 135, set1: 10, set2: 10, set3: 8 });
 *   // Atomically sets metadata.values.weight, metadata.values.set1, etc.
 */
export async function batchSetExtMeta(space, extName, fields) {
  if (!space || !extName || !fields || typeof fields !== "object") return false;
  validateAtomicExtName(extName);
  // Validate fields: check for dangerous keys, serializable values, total size
  const entries = Object.entries(fields);
  if (entries.length === 0) return false;
  if (entries.length > 100) return false; // cap field count
  const updates = {};
  let totalSize = 0;
  const maxBytes = MAX_METADATA_VALUE_BYTES();
  for (const [key, value] of entries) {
    if (DANGEROUS_KEYS.has(key)) continue; // skip dangerous keys silently
    let serialized;
    try { serialized = JSON.stringify(value); } catch { continue; } // skip non-serializable
    totalSize += Buffer.byteLength(serialized, "utf8");
    if (totalSize > maxBytes) return false; // batch exceeds namespace cap
    updates[`metadata.${extName}.${key}`] = value;
  }
  if (Object.keys(updates).length === 0) return false;
  const spaceId = String(space._id || space);
  await Space.updateOne({ _id: spaceId }, { $set: updates });
  invalidateSpace(spaceId);
  return true;
}

/**
 * Atomic namespace removal from a space's metadata.
 * Uses MongoDB $unset. The key is removed entirely, not set to null.
 * Document shrinks. Namespace is clean.
 *
 *   await unsetExtMeta(spaceId, "gaps");
 *   // metadata.gaps is gone. getExtMeta returns {}.
 */
export async function unsetExtMeta(space, extName) {
  if (!space || !extName) return false;
  validateAtomicExtName(extName);
  const spaceId = String(space._id || space);
  await Space.updateOne(
    { _id: spaceId },
    { $unset: { [`metadata.${extName}`]: "" } }
  );
  invalidateSpace(spaceId);
  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// EXTENSION ROOT RESOLUTION
// ─────────────────────────────────────────────────────────────────────────

/**
 * Find the extension's root space by walking up from any position.
 * Returns the space ID (string) of the nearest ancestor with
 * metadata[extName].initialized === true, or null.
 *
 * Walks up the parent chain. Stops at the tree root (rootOwner set)
 * or after 20 levels. Checks the starting space first.
 *
 * @param {string} spaceId - Starting space
 * @param {string} extName - Extension name (e.g. "food", "fitness")
 * @returns {Promise<string|null>}
 */
export async function findExtensionRoot(spaceId, extName) {
  if (!spaceId || !extName) return null;

  let current = await Space.findById(spaceId).select("_id metadata parent rootOwner").lean();
  let depth = 0;

  while (current && depth < 20) {
    const meta = current.metadata instanceof Map
      ? current.metadata.get(extName)
      : current.metadata?.[extName];
    if (meta?.initialized) return String(current._id);

    // Stop at tree root
    if (current.rootOwner) return null;
    if (!current.parent) return null;

    current = await Space.findById(current.parent).select("_id metadata parent rootOwner").lean();
    depth++;
  }

  return null;
}
