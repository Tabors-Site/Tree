import Node from "../db/models/node.js";

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
