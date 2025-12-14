import Node from "../db/models/node.js";
import User from "../db/models/user.js";
import { resolveRootNode } from "./treeFetch.js";

export async function resolveTreeAccess(nodeId, userId) {
  if (!nodeId) {
    throw new Error("nodeId is required");
  }

  const startNodeId = nodeId;

  let node = await Node.findById(nodeId)
    .select("parent rootOwner contributors")
    .lean()
    .exec();

  if (!node) {
    throw new Error("Node not found");
  }

  while (!Boolean(node.rootOwner)) {
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

  const isRoot = node._id.toString() === startNodeId;

  const isOwner = node.rootOwner?.toString() === userId;

  const isContributor =
    node.contributors?.some((id) => id.toString() === userId) ?? false;

  return {
    rootId: node._id.toString(),
    isRoot,
    isOwner,
    isContributor,
    canWrite: isOwner || isContributor,
  };
}

export async function resolveHtmlShareAccess({ userId, nodeId, shareToken }) {
  if (!shareToken) {
    return { allowed: false, reason: "Missing share token" };
  }

  // ─────────────────────────────────────
  // CASE 1: userId-based access
  // ─────────────────────────────────────
  if (userId && !nodeId) {
    const user = await User.findOne({
      _id: userId,
      htmlShareToken: shareToken,
    })
      .select("_id username")
      .lean()
      .exec();

    if (!user) {
      return { allowed: false, reason: "Invalid share token" };
    }

    return {
      allowed: true,
      matchedUserId: user._id,
      matchedUsername: user.username,
      scope: "user",
    };
  }

  // ─────────────────────────────────────
  // CASE 2: nodeId-based access
  // ─────────────────────────────────────
  if (nodeId) {
    const rootNode = await resolveRootNode(nodeId);

    const userIds = [
      rootNode.rootOwner,
      ...(rootNode.contributors || []),
    ].filter(Boolean);

    if (userIds.length === 0) {
      return { allowed: false, reason: "No users associated with root" };
    }

    const matchedUser = await User.findOne({
      _id: { $in: userIds },
      htmlShareToken: shareToken,
    })
      .select("_id username")
      .lean()
      .exec();

    if (!matchedUser) {
      return { allowed: false, reason: "Invalid share token for node" };
    }

    return {
      allowed: true,
      rootId: rootNode._id.toString(),
      matchedUserId: matchedUser._id,
      matchedUsername: matchedUser.username,
      scope: "node",
    };
  }

  // ─────────────────────────────────────
  // INVALID
  // ─────────────────────────────────────
  return {
    allowed: false,
    reason: "userId or nodeId is required",
  };
}
