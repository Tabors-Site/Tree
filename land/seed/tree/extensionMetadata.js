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

  // Per-namespace size guard
  if (data != null) {
    try {
      const size = Buffer.byteLength(JSON.stringify(data), "utf8");
      if (size > MAX_METADATA_VALUE_BYTES) {
        throw new Error(`Metadata for "${extName}" exceeds ${MAX_METADATA_VALUE_BYTES / 1024}KB limit (${Math.round(size / 1024)}KB)`);
      }
    } catch (e) {
      if (e.message.includes("limit")) throw e;
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
 * Reads current value, merges, then writes atomically.
 * Silently skips if the extension is blocked at this node.
 */
export async function mergeExtMeta(node, extName, partial) {
  if (isBlockedLocally(node, extName)) return false;
  const existing = getExtMeta(node, extName);
  return setExtMeta(node, extName, { ...existing, ...partial });
}
