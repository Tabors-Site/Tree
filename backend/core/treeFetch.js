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
