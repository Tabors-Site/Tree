// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import { hooks } from "../hooks.js";
import { guardMetadataWrite } from "./documentGuard.js";
import { invalidateNode } from "./ancestorCache.js";
import Node from "../models/node.js";

/**
 * Helpers for extensions to store per-node data in node.metadata.
 *
 * Convention: each extension gets a namespace key matching its manifest name.
 * e.g. node.metadata.get('solana'), node.metadata.get('scripts')
 *
 * Spatial extension scoping: if an extension is blocked at a node
 * (via metadata.extensions.blocked), writes are silently skipped.
 * Core namespaces (tools, modes, extensions, cascade) are never blocked.
 *
 * Concurrency: setExtMeta uses atomic MongoDB $set on the specific namespace key.
 * Two concurrent writes to different namespaces on the same node do not clobber each other.
 * Two concurrent writes to the SAME namespace: last write wins (intentional, same as any $set).
 *
 * Document size guard: every write checks total document size against
 * maxDocumentSizeBytes (default 14MB). Writes exceeding the limit rejected.
 */

const CORE_NAMESPACES = new Set(["tools", "modes", "extensions", "cascade"]);
const MAX_METADATA_VALUE_BYTES = 512 * 1024; // 512KB per extension namespace per node
const MAX_NAMESPACE_KEY_LENGTH = 50; // same cap as node type names
const MAX_NESTING_DEPTH = 5;

/**
 * Measure the nesting depth of a plain object/array.
 * Arrays and objects each count as one level. Primitives are 0.
 */
function measureDepth(value, current = 0) {
  if (value === null || typeof value !== "object") return current;
  let max = current + 1;
  const entries = Array.isArray(value) ? value : Object.values(value);
  for (const v of entries) {
    if (v !== null && typeof v === "object") {
      const d = measureDepth(v, current + 1);
      if (d > max) max = d;
      if (max > MAX_NESTING_DEPTH) return max; // early exit
    }
  }
  return max;
}

/**
 * Get an extension's metadata namespace from a node.
 * Returns the stored object, or an empty object if nothing exists.
 */
export function getExtMeta(node, extName) {
  if (!node.metadata) return {};
  const data = node.metadata instanceof Map
    ? node.metadata.get(extName)
    : node.metadata?.[extName];
  return data || {};
}

/**
 * Check if an extension is blocked at this specific node.
 * Only checks the node's own metadata, not the parent chain
 * (parent chain is handled by hooks and tool resolution).
 */
function isBlockedLocally(node, extName) {
  if (CORE_NAMESPACES.has(extName)) return false;
  const meta = node.metadata instanceof Map
    ? node.metadata.get("extensions")
    : node.metadata?.extensions;
  return meta?.blocked?.includes(extName) || false;
}

/**
 * Set an extension's metadata namespace on a node (full replace).
 * Uses atomic MongoDB $set so concurrent writes to different namespaces
 * on the same node do not clobber each other.
 *
 * Silently skips if the extension is blocked at this node.
 */
export async function setExtMeta(node, extName, data) {
  if (isBlockedLocally(node, extName)) return false;

  // Namespace key length guard
  if (extName.length > MAX_NAMESPACE_KEY_LENGTH) {
    throw new Error(`Metadata namespace "${extName.slice(0, 20)}..." exceeds ${MAX_NAMESPACE_KEY_LENGTH} character limit`);
  }

  // Per-namespace size guard + nesting depth check
  if (data != null) {
    try {
      const serialized = JSON.stringify(data);
      const size = Buffer.byteLength(serialized, "utf8");
      if (size > MAX_METADATA_VALUE_BYTES) {
        throw new Error(`Metadata for "${extName}" exceeds ${MAX_METADATA_VALUE_BYTES / 1024}KB limit (${Math.round(size / 1024)}KB)`);
      }
    } catch (e) {
      if (e.message.includes("limit")) throw e;
    }

    // Nesting depth guard: prevents expensive deep queries and painful inspection
    const depth = measureDepth(data);
    if (depth > MAX_NESTING_DEPTH) {
      throw new Error(`Metadata for "${extName}" exceeds max nesting depth of ${MAX_NESTING_DEPTH} (found ${depth}). Flatten your data structure.`);
    }
  }

  // Document size guard: check total document size before writing
  guardMetadataWrite(node, data, { documentType: "node", documentId: node._id });

  const nodeId = node._id;

  // Atomic write: MongoDB handles concurrency. No read-modify-write race.
  await Node.updateOne(
    { _id: nodeId },
    { $set: { [`metadata.${extName}`]: data } },
  );

  // Update in-memory document if caller still holds it
  if (node.metadata instanceof Map) {
    node.metadata.set(extName, data);
  } else if (node.metadata) {
    node.metadata[extName] = data;
  }

  invalidateNode(nodeId);
  hooks.run("afterMetadataWrite", { nodeId, extName, data }).catch(() => {});
  return true;
}

/**
 * Shallow merge into an extension's metadata namespace.
 * Uses atomic $set on individual keys to avoid read-modify-write races.
 * Silently skips if the extension is blocked at this node.
 */
export async function mergeExtMeta(node, extName, partial) {
  if (isBlockedLocally(node, extName)) return false;
  if (!partial || typeof partial !== "object") return false;

  const updates = {};
  for (const [key, value] of Object.entries(partial)) {
    updates[`metadata.${extName}.${key}`] = value;
  }
  if (Object.keys(updates).length === 0) return false;

  await Node.updateOne({ _id: node._id }, { $set: updates });

  // Update in-memory document
  if (node.metadata instanceof Map) {
    const existing = node.metadata.get(extName) || {};
    node.metadata.set(extName, { ...existing, ...partial });
  } else if (node.metadata) {
    node.metadata[extName] = { ...(node.metadata[extName] || {}), ...partial };
  }

  invalidateNode(node._id);
  hooks.run("afterMetadataWrite", { nodeId: node._id, extName, data: partial }).catch(() => {});
  return true;
}
