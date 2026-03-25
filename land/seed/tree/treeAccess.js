import { getAncestorChain, resolveTreeAccessFromChain } from "./ancestorCache.js";

/**
 * Resolve tree access by walking the parent chain via the ancestor cache.
 *
 * Ownership resolves at the first node where rootOwner is set.
 * rootOwner means "the owner from this point down." The word root
 * refers to the subtree root, not necessarily the tree root.
 *
 * Contributors accumulate along the walk. If the user is in
 * contributors[] at ANY node between the current position and
 * the ownership boundary, they have write access.
 */
export async function resolveTreeAccess(nodeId, userId) {
  if (!nodeId) {
    return {
      ok: false,
      error: "NODE_ID_MISSING",
      message: "nodeId is required",
    };
  }

  const ancestors = await getAncestorChain(nodeId);
  if (!ancestors) {
    return {
      ok: false,
      error: "NODE_NOT_FOUND",
      message: "Node not found. Use get-root-nodes-by-user to find a valid node.",
    };
  }

  return resolveTreeAccessFromChain(String(nodeId), userId, ancestors);
}
