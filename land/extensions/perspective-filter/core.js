/**
 * Perspective Filter Core
 *
 * Each node or tree declares what cascade signals it wants to receive
 * via metadata.perspective. Signals carry tags in payload.tags[].
 * The perspective filter checks those tags against accept/reject lists.
 *
 * Inheritance: walk up the parent chain. The closest node with a
 * perspective config wins. If root sets accept: ["music", "creativity"],
 * every node below inherits it unless overridden.
 *
 * metadata.perspective shape:
 * {
 *   accept: ["music", "creativity"],   // only accept signals tagged with these
 *   reject: ["fitness", "finance"],     // reject signals tagged with these
 * }
 *
 * Rules:
 * - No perspective anywhere in the chain: accept everything
 * - Signal has no tags: accept (untagged signals pass through)
 * - reject list checked first: any matching tag rejects the signal
 * - accept list checked second: if set, at least one tag must match
 */

import Node from "../../seed/models/node.js";

/**
 * Resolve the effective perspective for a node.
 * Walks up the parent chain. Closest override wins.
 *
 * @param {object} node - node document (lean, with metadata and parent)
 * @returns {object|null} - perspective config or null if none set
 */
export async function resolvePerspective(node) {
  const meta = node.metadata instanceof Map
    ? Object.fromEntries(node.metadata)
    : (node.metadata || {});

  if (meta.perspective && hasPerspectiveRules(meta.perspective)) {
    return meta.perspective;
  }

  // Walk up parent chain
  let cursor = node.parent;
  let depth = 0;
  const maxDepth = 50;

  while (cursor && depth < maxDepth) {
    const parent = await Node.findById(cursor)
      .select("metadata parent systemRole")
      .lean();
    if (!parent || parent.systemRole) break;

    const parentMeta = parent.metadata instanceof Map
      ? Object.fromEntries(parent.metadata)
      : (parent.metadata || {});

    if (parentMeta.perspective && hasPerspectiveRules(parentMeta.perspective)) {
      return parentMeta.perspective;
    }

    cursor = parent.parent;
    depth++;
  }

  return null;
}

/**
 * Check whether a perspective config has actual rules.
 */
function hasPerspectiveRules(perspective) {
  if (!perspective || typeof perspective !== "object") return false;
  const hasAccept = Array.isArray(perspective.accept) && perspective.accept.length > 0;
  const hasReject = Array.isArray(perspective.reject) && perspective.reject.length > 0;
  return hasAccept || hasReject;
}

/**
 * Determine whether a cascade signal should be delivered to a node.
 * Called by propagation before each hop.
 *
 * @param {object} node - target node document (lean, with metadata and parent)
 * @param {object} payload - the cascade signal payload
 * @returns {boolean} true if the signal should be delivered
 */
export async function shouldDeliver(node, payload) {
  const perspective = await resolvePerspective(node);

  // No perspective set anywhere in the chain: accept everything
  if (!perspective) return true;

  // No tags on the signal: accept (untagged signals always pass)
  const tags = payload?.tags;
  if (!Array.isArray(tags) || tags.length === 0) return true;

  // Reject list: if any tag matches, reject
  if (Array.isArray(perspective.reject) && perspective.reject.length > 0) {
    for (const tag of tags) {
      if (perspective.reject.includes(tag)) return false;
    }
  }

  // Accept list: if set, at least one tag must match
  if (Array.isArray(perspective.accept) && perspective.accept.length > 0) {
    const hasMatch = tags.some((tag) => perspective.accept.includes(tag));
    if (!hasMatch) return false;
  }

  return true;
}

/**
 * Set the perspective filter on a node.
 *
 * @param {string} nodeId
 * @param {object} perspective - { accept?: string[], reject?: string[] }
 */
let _metadata = null;
export function setMetadata(metadata) { _metadata = metadata; }

export async function setPerspective(nodeId, perspective) {
  const node = await Node.findById(nodeId);
  if (!node) throw new Error("Node not found");

  const clean = {};
  if (Array.isArray(perspective.accept) && perspective.accept.length > 0) {
    clean.accept = perspective.accept.map(String);
  }
  if (Array.isArray(perspective.reject) && perspective.reject.length > 0) {
    clean.reject = perspective.reject.map(String);
  }

  await _metadata.setExtMeta(node, "perspective", clean);
  return clean;
}

/**
 * Clear the perspective filter on a node (inherit from parent again).
 */
export async function clearPerspective(nodeId) {
  const node = await Node.findById(nodeId);
  if (!node) throw new Error("Node not found");

  await _metadata.setExtMeta(node, "perspective", {});
}
