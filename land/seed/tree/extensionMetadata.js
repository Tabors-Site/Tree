import { hooks } from "../hooks.js";

/**
 * Helpers for extensions to store per-node data in node.metadata.
 *
 * Convention: each extension gets a namespace key matching its manifest name.
 * e.g. node.metadata.get('solana'), node.metadata.get('scripts')
 *
 * metadata is Map<Mixed> in Mongoose, so markModified() is required after writes.
 *
 * Spatial extension scoping: if an extension is blocked at a node
 * (via metadata.extensions.blocked), writes are silently skipped.
 * Core namespaces (tools, modes, extensions, storage) are never blocked.
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
 * Silently skips if the extension is blocked at this node.
 * Handles the Mongoose Mixed type markModified requirement.
 */
export function setExtMeta(node, extName, data) {
  if (isBlockedLocally(node, extName)) return false;
  // Size guard: prevent extensions from writing unbounded data
  if (data != null) {
    try {
      const size = Buffer.byteLength(JSON.stringify(data), "utf8");
      if (size > MAX_METADATA_VALUE_BYTES) {
        throw new Error(`Metadata for "${extName}" exceeds ${MAX_METADATA_VALUE_BYTES / 1024}KB limit (${Math.round(size / 1024)}KB)`);
      }
    } catch (e) {
      if (e.message.includes("limit")) throw e;
      // JSON.stringify failed (circular ref, etc.) - allow but warn
    }
  }
  if (!node.metadata) {
    node.metadata = new Map();
  }
  if (node.metadata instanceof Map) {
    node.metadata.set(extName, data);
  } else {
    node.metadata[extName] = data;
  }
  if (node.markModified) node.markModified("metadata");
  hooks.run("afterMetadataWrite", { nodeId: node._id, extName, data }).catch(() => {});
  return true;
}

/**
 * Shallow merge into an extension's metadata namespace.
 * Preserves existing keys not present in the partial update.
 * Silently skips if the extension is blocked at this node.
 */
export function mergeExtMeta(node, extName, partial) {
  if (isBlockedLocally(node, extName)) return false;
  const existing = getExtMeta(node, extName);
  setExtMeta(node, extName, { ...existing, ...partial });
  return true;
}
