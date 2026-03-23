import Node from "../db/models/node.js";

export async function resolveTreeAccess(nodeId, userId) {
  if (!nodeId) {
    return {
      ok: false,
      error: "NODE_ID_MISSING",
      message: "nodeId is required",
    };
  }

  const startNodeId = nodeId;

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
  }

  const isRoot = node._id.toString() === startNodeId;
  const isOwner = node.rootOwner?.toString() === userId;
  const isContributor =
    node.contributors?.some((id) => id.toString() === userId) ?? false;

  return {
    ok: true,
    rootId: node._id.toString(),
    isRoot,
    isOwner,
    isContributor,
    canWrite: isOwner || isContributor,
  };
}

// resolveHtmlShareAccess moved to extensions/html-rendering/shareAuth.js
