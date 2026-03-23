/**
 * Helpers for extensions to store per-node data in node.metadata.
 *
 * Convention: each extension gets a namespace key matching its manifest name.
 * e.g. node.metadata.get('solana'), node.metadata.get('scripts')
 *
 * metadata is Map<Mixed> in Mongoose, so markModified() is required after writes.
 */

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
 * Set an extension's metadata namespace on a node (full replace).
 * Handles the Mongoose Mixed type markModified requirement.
 */
export function setExtMeta(node, extName, data) {
  if (!node.metadata) {
    node.metadata = new Map();
  }
  if (node.metadata instanceof Map) {
    node.metadata.set(extName, data);
  } else {
    node.metadata[extName] = data;
  }
  if (node.markModified) node.markModified("metadata");
}

/**
 * Shallow merge into an extension's metadata namespace.
 * Preserves existing keys not present in the partial update.
 */
export function mergeExtMeta(node, extName, partial) {
  const existing = getExtMeta(node, extName);
  setExtMeta(node, extName, { ...existing, ...partial });
}

