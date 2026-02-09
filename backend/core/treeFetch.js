import Node from "../db/models/node.js";

import User from "../db/models/user.js";

export async function getRootNodesForUser(userId) {
  if (!userId) {
    throw new Error("userId is required");
  }

  const user = await User.findById(userId)
    .populate("roots", "name _id")
    .lean()
    .exec();

  if (!user || !Array.isArray(user.roots) || user.roots.length === 0) {
    return [];
  }

  return user.roots.map((node) => ({
    _id: node._id.toString(),
    name: node.name,
  }));
}

export async function resolveRootNode(nodeId) {
  if (!nodeId) {
    throw new Error("nodeId is required");
  }

  let node = await Node.findById(nodeId)
    .select("parent rootOwner contributors")
    .lean()
    .exec();

  if (!node) {
    throw new Error("Node not found");
  }

  while (!node.rootOwner) {
    if (!node.parent) {
      throw new Error("Invalid tree: no rootOwner found");
    }

    node = await Node.findById(node.parent)
      .select("parent rootOwner contributors")
      .lean()
      .exec();

    if (!node) {
      throw new Error("Broken tree");
    }
  }

  return node;
}

export async function isDescendant(ancestorId, nodeId) {
  let current = await Node.findById(nodeId).select("parent");

  while (current && current.parent) {
    if (current.parent.toString() === ancestorId.toString()) {
      return true;
    }
    current = await Node.findById(current.parent).select("parent");
  }

  return false;
}

export async function getDeletedBranchesForUser(userId) {
  if (!userId) {
    throw new Error("userId is required");
  }

  const deletedNodes = await Node.find({
    parent: "deleted",
    rootOwner: userId,
  })
    .select("_id name")
    .lean()
    .exec();

  return deletedNodes.map((n) => ({
    _id: n._id.toString(),
    name: n.name,
  }));
}

export async function getActiveLeafExecutionFrontier(rootId) {
  if (!rootId) {
    throw new Error("rootId is required");
  }

  const rootNode = await Node.findById(rootId)
    .select("_id name children versions")
    .lean()
    .exec();

  if (!rootNode) {
    return { rootId, leaves: [] };
  }

  const leaves = [];

  // ---- helpers ----

  function getCurrentVersion(node) {
    if (!Array.isArray(node.versions) || node.versions.length === 0) {
      return null;
    }
    return node.versions.reduce((latest, v) =>
      v.prestige > latest.prestige ? v : latest
    );
  }

  function isActive(node) {
    return getCurrentVersion(node)?.status === "active";
  }

  // ---- TRUE DFS (post-order) ----
  async function traverse(node, depth, path) {
    const currentVersion = getCurrentVersion(node);
    if (!currentVersion || currentVersion.status !== "active") {
      return false;
    }

    let foundDeeperActive = false;

    const childrenIds = Array.isArray(node.children)
      ? node.children
      : [];

    if (childrenIds.length > 0) {
      const children = await Node.find({ _id: { $in: childrenIds } })
        .select("_id name children versions")
        .lean()
        .exec();

      const childrenById = new Map(
        children.map((c) => [c._id.toString(), c])
      );

      const orderedChildren = childrenIds
        .map((id) => childrenById.get(id.toString()))
        .filter(Boolean);

      for (const child of orderedChildren) {
        const childHasActive = await traverse(
          child,
          depth + 1,
          [...path, child.name]
        );
        if (childHasActive) {
          foundDeeperActive = true;
        }
      }
    }

    // ✅ Leaf = no active descendants
    if (!foundDeeperActive) {
      leaves.push({
        nodeId: node._id.toString(),
        name: node.name,
        path,
        depth,

        // 🔑 version context
        versionPrestige: currentVersion.prestige,
        versionStatus: currentVersion.status,

        next: false,
      });
    }

    return true;
  }

  await traverse(rootNode, 0, []);

  // First leaf in post-order DFS = deepest-leftmost
  if (leaves.length > 0) {
    leaves[0].next = true;
  }

  return {
    rootId,
    leaves,
  };
}






