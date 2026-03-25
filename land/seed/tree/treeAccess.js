import Node from "../models/node.js";

/**
 * Resolve tree access by walking the parent chain.
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

  const startNodeId = nodeId;
  let isContributor = false;

  let node = await Node.findById(nodeId)
    .select("parent rootOwner contributors")
    .lean()
    .exec();

  if (!node) {
    return {
      ok: false,
      error: "NODE_NOT_FOUND",
      message:
        "Node not found. Use get-root-nodes-by-user to find a valid node.",
    };
  }

  // Check contributors at start node
  if (userId && node.contributors?.some((id) => id.toString() === userId)) {
    isContributor = true;
  }

  let depth = 0;
  const MAX_DEPTH = 100;
  while (!node.rootOwner || node.rootOwner === "SYSTEM") {
    if (++depth > MAX_DEPTH) {
      return { ok: false, error: "BROKEN_TREE", message: "Tree depth limit exceeded (circular reference?)" };
    }
    if (!node.parent) {
      return {
        ok: false,
        error: "INVALID_TREE",
        message: "Invalid tree: no rootOwner found",
      };
    }

    node = await Node.findById(node.parent)
      .select("parent rootOwner contributors systemRole")
      .lean()
      .exec();

    if (!node) {
      return {
        ok: false,
        error: "BROKEN_TREE",
        message: "Broken tree: parent node missing",
      };
    }

    if (node.systemRole) {
      return {
        ok: false,
        error: "INVALID_TREE",
        message: "Invalid tree: reached system node boundary",
      };
    }

    // Accumulate contributors at each node along the walk
    if (!isContributor && userId && node.contributors?.some((id) => id.toString() === userId)) {
      isContributor = true;
    }
  }

  const isOwner = userId && node.rootOwner?.toString() === userId;

  return {
    ok: true,
    rootId: node._id.toString(),
    isRoot: node._id.toString() === startNodeId,
    isOwner: !!isOwner,
    isContributor,
    canWrite: !!isOwner || isContributor,
  };
}
