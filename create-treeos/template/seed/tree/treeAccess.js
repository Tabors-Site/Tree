// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import { getAncestorChain, resolveTreeAccessFromChain } from "./ancestorCache.js";
import { ERR } from "../protocol.js";

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
 *
 * userId is normalized to string. Callers can pass ObjectId or string.
 */
export async function resolveTreeAccess(nodeId, userId) {
  if (!nodeId) {
    return {
      ok: false,
      error: ERR.INVALID_INPUT,
      message: "nodeId is required",
    };
  }

  // Normalize userId to string for consistent comparison with cached ancestor data.
  // Ancestor cache stores all IDs as strings. ObjectId === String is always false.
  const safeUserId = userId ? String(userId) : null;

  const ancestors = await getAncestorChain(String(nodeId));
  if (!ancestors) {
    return {
      ok: false,
      error: ERR.NODE_NOT_FOUND,
      message: "Node not found. Use get-root-nodes-by-user to find a valid node.",
    };
  }

  return resolveTreeAccessFromChain(String(nodeId), safeUserId, ancestors);
}
