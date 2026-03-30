// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import mongoose from "mongoose";
import Node from "../models/node.js";
import { logContribution } from "./contributions.js";
import { containsHtml } from "../utils.js";
import User from "../models/user.js";
import { createNote } from "./notes.js";
import { resolveTreeAccess } from "./treeAccess.js";
import { isDescendant } from "./treeFetch.js";
import { hooks } from "../hooks.js";
import { getLandRootId } from "../landRoot.js";
import { invalidateAll, invalidateNode } from "./ancestorCache.js";
import log from "../log.js";
import { NODE_STATUS, DELETED, CONTENT_TYPE, ERR, ProtocolError, SYSTEM_OWNER } from "../protocol.js";
import { acquireNodeLock, releaseNodeLock, acquireMultiple, releaseMultiple } from "./nodeLocks.js";
import { getLandConfigValue } from "../landConfig.js";

async function getUserOrThrow(userId) {
  if (!userId) {
    throw new Error("User ID is required");
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new Error("User not found");
  }

  return user;
}

export async function createNode({
  name,
  parentId = null,
  isRoot = false,
  userId,
  type = null,
  note = null,
  metadata = null,
  validatedUser = null,
  wasAi = false,
  chatId = null,
  sessionId = null,
} = {}) {
  if (!name || typeof name !== "string" || !name.trim()) {
    throw new Error("Node name is required");
  }
  name = name.trim();
  if (name.length > 150) {
    throw new Error("Node name must be 150 characters or fewer");
  }
  if (containsHtml(name)) {
    throw new Error("Node name cannot contain HTML tags");
  }
  if (name.startsWith(".")) {
    throw new Error("Node names cannot start with a dot");
  }
  if (name.startsWith("@")) {
    throw new Error("Node names cannot start with @");
  }
  if (name === "~" || name.startsWith("~/")) {
    throw new Error("Node names cannot be ~ (reserved for home)");
  }
  if (name.startsWith("/")) {
    throw new Error("Node names cannot start with / (reserved for path separator)");
  }
  if (!isRoot && !parentId) {
    throw new Error("Non-root nodes require a parentId");
  }
  const user = validatedUser ?? (await getUserOrThrow(userId));

  // beforeNodeCreate: extensions can modify or cancel.
  // parentType included so extensions can validate parent-child type compatibility.
  let parentType = null;
  if (parentId) {
    const parentDoc = await Node.findById(parentId).select("type").lean();
    parentType = parentDoc?.type || null;
  }
  const hookData = { name, type, parentId, parentType, isRoot, userId, metadata: metadata || new Map() };
  const hookResult = await hooks.run("beforeNodeCreate", hookData);
  if (hookResult.cancelled) {
    const code = hookResult.timedOut ? ERR.HOOK_TIMEOUT : ERR.HOOK_CANCELLED;
    throw new ProtocolError(500, code, hookResult.reason || "Node creation blocked");
  }
  // Apply any modifications from hooks
  name = hookData.name;
  type = hookData.type;

  const newNode = new Node({
    name,
    type,
    status: NODE_STATUS.ACTIVE,
    children: [],
    parent: isRoot ? getLandRootId() : (parentId || null),
    rootOwner: isRoot ? user._id : null,
    contributors: [],
    metadata: hookData.metadata instanceof Map ? hookData.metadata : new Map(),
  });

  await newNode.save();

  // Structural mutation: lock the parent while adding to its children[]
  const lockTarget = isRoot ? getLandRootId() : parentId;
  if (lockTarget) {
    const locked = await acquireNodeLock(lockTarget, sessionId);
    if (!locked) throw new ProtocolError(409, ERR.RESOURCE_CONFLICT, "Parent node is being modified");
  }
  try {
    // Children cap: prevent any single node from accumulating unbounded children.
    // Wide nodes cause memory spikes on every parent query (the entire children
    // array loads into memory). Default 1000, configurable via maxChildrenPerNode.
    const maxChildren = parseInt(getLandConfigValue("maxChildrenPerNode") || "1000", 10);

    if (isRoot) {
      const landRootId = getLandRootId();
      if (landRootId) {
        const landRoot = await Node.findById(landRootId).select("children").lean();
        if (landRoot?.children?.length >= maxChildren) {
          throw new ProtocolError(400, ERR.INVALID_INPUT, `Land root has reached the maximum of ${maxChildren} children`);
        }
        await Node.findByIdAndUpdate(landRootId, { $addToSet: { children: newNode._id } });
      }
    } else if (parentId) {
      const parentNode = await Node.findById(parentId).select("systemRole children").lean();
      if (!parentNode) throw new Error("Parent node not found");
      if (parentNode.systemRole) throw new Error("Cannot create nodes under system nodes");
      if (parentNode.children?.length >= maxChildren) {
        throw new ProtocolError(400, ERR.INVALID_INPUT, `Parent node has reached the maximum of ${maxChildren} children`);
      }

      await Node.findByIdAndUpdate(parentId, { $addToSet: { children: newNode._id } });

      await logContribution({
        userId: user._id,
        nodeId: parentId,
        wasAi,
        chatId,
        sessionId,
        action: "updateChild",
        updateChild: {
          action: "added",
          childId: newNode._id.toString(),
        },
      });
    }
  } finally {
    if (lockTarget) releaseNodeLock(lockTarget, sessionId);
  }

  await logContribution({
    userId: user._id,
    nodeId: newNode._id,
    wasAi,
    chatId,
    sessionId,
    action: "create",

  });

  if (note?.trim()) {
    await createNote({
      contentType: CONTENT_TYPE.TEXT,
      content: note,
      userId: user._id,
      nodeId: newNode._id,
      wasAi,
      chatId,
      sessionId,
    });
  }

  // afterNodeCreate: await for root creation so navigation extension
  // updates metadata.nav.roots before the response goes back to the CLI.
  // Non-root nodes fire-and-forget (hooks are independent reactions).
  if (isRoot) {
    await hooks.run("afterNodeCreate", { node: newNode, userId: user._id }).catch(() => {});
  } else {
    hooks.run("afterNodeCreate", { node: newNode, userId: user._id }).catch(() => {});
  }

  return newNode;
}

/**
 * Create a system node (dot-prefixed, no hooks, no contributions).
 * Used by extensions for infrastructure nodes like .intent, .pulse, .rings.
 * These are not user-created content. They are extension infrastructure.
 *
 * Returns the created node. Handles parent linking atomically.
 */
export async function createSystemNode({ name, parentId, metadata = null }) {
  if (!name || typeof name !== "string") {
    throw new Error("System node name is required");
  }
  if (!parentId) {
    throw new Error("System node requires a parent");
  }

  const { v4: uuidv4 } = await import("uuid");
  const id = uuidv4();

  const newNode = new Node({
    _id: id,
    name,
    parent: parentId,
    children: [],
    contributors: [],
    status: NODE_STATUS.ACTIVE,
    metadata: metadata instanceof Map ? metadata : new Map(),
  });
  await newNode.save();

  await Node.findByIdAndUpdate(parentId, { $addToSet: { children: id } });

  return newNode;
}

export async function createNodeBranch(
  nodeData,
  parentId,
  userId,
  wasAi = false,
  chatId = null,
  sessionId = null,
) {
  const user = await getUserOrThrow(userId);

  return createNodeBranchInternal(
    nodeData,
    parentId,
    user,
    wasAi,
    chatId,
    sessionId,
  );
}

async function createNodeBranchInternal(
  nodeData,
  parentId,
  user,
  wasAi,
  chatId = null,
  sessionId = null,
) {
  const { name, note, type, metadata } = nodeData;
  const children = Array.isArray(nodeData.children) ? nodeData.children : [];

  // Callers build metadata. The kernel just passes it through.
  let metadataMap = null;
  if (metadata instanceof Map) {
    metadataMap = metadata;
  } else if (metadata && typeof metadata === "object" && Object.keys(metadata).length > 0) {
    metadataMap = new Map(Object.entries(metadata));
  }

  const newNode = await createNode({
    name,
    parentId,
    userId: user._id,
    type: type || null,
    note: note || null,
    metadata: metadataMap,
    validatedUser: user,
    wasAi,
    chatId,
    sessionId,
  });

  let totalCreated = 1;

  for (const childData of children) {
    const childResult = await createNodeBranchInternal(
      childData,
      newNode._id,
      user,
      wasAi,
      chatId,
      sessionId,
    );
    totalCreated += childResult.totalCreated;
  }

  return {
    rootId: newNode._id,
    rootName: newNode.name,
    totalCreated,
  };
}

export async function deleteNodeBranch(
  nodeId,
  userId,
  wasAi = false,
  chatId = null,
  sessionId = null,
) {
  const nodeToDelete = await Node.findById(nodeId);
  if (!nodeToDelete) throw new Error("Node not found");
  const access = await resolveTreeAccess(nodeId, userId);
  if (!access.isOwner || (!access.isRoot && !!nodeToDelete.rootOwner)) {
    throw new Error("Invalid delete attempt. Must be owner and not root.");
  }
  if (nodeToDelete.rootOwner && nodeToDelete.rootOwner !== SYSTEM_OWNER) {
    throw new Error("Root nodes can only be retired on root view");
  }
  if (nodeToDelete.parent === DELETED) {
    throw new Error("Node has already been deleted");
  }
  // beforeNodeDelete hook
  await hooks.run("beforeNodeDelete", { node: nodeToDelete, userId });


  const oldParent = nodeToDelete.parent;
  const lockIds = [nodeId.toString(), oldParent && oldParent !== DELETED ? oldParent.toString() : null].filter(Boolean);
  const locked = await acquireMultiple(lockIds, sessionId);
  if (!locked) throw new ProtocolError(409, ERR.RESOURCE_CONFLICT, "Nodes are being modified");
  try {
    nodeToDelete.rootOwner = userId;
    nodeToDelete.parent = DELETED;
    await nodeToDelete.save();

    if (oldParent && oldParent !== DELETED) {
      await Node.findByIdAndUpdate(oldParent, {
        $pull: { children: nodeId },
      });

      await logContribution({
        userId,
        nodeId: oldParent.toString(),
        wasAi,
        chatId,
        sessionId,
        action: "updateChild",
        updateChild: {
          action: "removed",
          childId: nodeId.toString(),
        },
      });
    }
  } finally {
    releaseMultiple(lockIds, sessionId);
  }
  await logContribution({
    userId,
    nodeId: nodeId,
    wasAi,
    chatId,
    sessionId,
    action: "branchLifecycle",

    branchLifecycle: {
      action: "retired",
      fromParentId: oldParent?.toString() ?? null,
    },
  });
  invalidateNode(nodeId); // Deleted node and entries containing it
  return nodeToDelete;
}

export async function updateParentRelationship(
  nodeChildId,
  nodeNewParentId,
  userId,
  wasAi = false,
  chatId = null,
  sessionId = null,
  opts = {},
) {
  const nodeChild = await Node.findById(nodeChildId);
  if (!nodeChild) throw new Error("Child node not found");
  if (nodeChild.rootOwner && nodeChild.rootOwner !== SYSTEM_OWNER) throw new Error("Cannot change root's parent");
  if (nodeChild.parent.toString() === nodeNewParentId.toString()) {
    throw new Error("Node already has this parent");
  }

  const oldParentId = nodeChild.parent; // ✅ safe
  const oldParent = oldParentId ? await Node.findById(oldParentId) : null;
  const nodeNewParent = await Node.findById(nodeNewParentId);

  if (!nodeNewParent) throw new Error("New parent node not found");
  if (nodeNewParent.systemRole) throw new Error("Cannot move into a system node");
  if (await isDescendant(nodeChildId, nodeNewParentId)) {
    throw new Error("Cannot move a node into its own descendant");
  }

  // Resolve tree access for both nodes
  const childAccess = await resolveTreeAccess(nodeChildId, userId);
  const newParentAccess = await resolveTreeAccess(nodeNewParentId, userId);

  // CASE 1: Same tree → user must have write access (owner OR contributor)
  if (childAccess.rootId === newParentAccess.rootId) {
    if (!childAccess.canWrite) {
      throw new Error("Must be owner or contributor");
    }
  }

  // CASE 2: Different trees → user must own BOTH roots
  else {
    if (!childAccess.isOwner || !newParentAccess.isOwner) {
      throw new Error(
        "Cannot move nodes across trees unless you own both roots",
      );
    }
  }


  // Structural lock: lock all three involved nodes to prevent concurrent moves/deletes
  const lockIds = [nodeChildId, oldParentId, nodeNewParentId].filter(Boolean).map(String);
  const locked = await acquireMultiple(lockIds, sessionId);
  if (!locked) throw new ProtocolError(409, ERR.RESOURCE_CONFLICT, "Nodes are being modified by another operation");

  // The three core operations ($pull, $set parent, $addToSet) must be atomic.
  // Use a MongoDB transaction if available (replica set). Falls back to
  // sequential ops on standalone MongoDB with a warning.
  let session = null;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
  } catch {
    // Standalone MongoDB or transactions not available
    session = null;
    log.verbose("Tree", "MongoDB transactions not available. Node move runs without atomicity guarantees.");
  }

  const txOpts = session ? { session } : {};

  try {
    // Remove from old parent
    if (oldParent) {
      await Node.findByIdAndUpdate(oldParent._id, { $pull: { children: nodeChildId } }, txOpts);
    }

    // Update parent field
    await Node.findByIdAndUpdate(nodeChildId, { $set: { parent: nodeNewParentId } }, txOpts);

    // Add to new parent
    await Node.findByIdAndUpdate(nodeNewParentId, { $addToSet: { children: nodeChildId } }, txOpts);

    if (session) await session.commitTransaction();
  } catch (err) {
    if (session) {
      try { await session.abortTransaction(); } catch {}
    }
    releaseMultiple(lockIds, sessionId);
    throw err;
  } finally {
    if (session) session.endSession();
  }

  // Contributions logged outside the transaction (audit trail, not structural)
  if (oldParent) {
    await logContribution({
      userId,
      nodeId: oldParent._id.toString(),
      wasAi,
      chatId,
      sessionId,
      action: "updateChild",
      updateChild: { action: "removed", childId: nodeChildId.toString() },
    });
  }

  await logContribution({
    userId,
    nodeId: nodeChildId,
    wasAi,
    chatId,
    sessionId,
    action: "updateParent",
    updateParent: {
      oldParentId: oldParentId ? oldParentId.toString() : null,
      newParentId: nodeNewParentId.toString(),
    },
  });

  await logContribution({
    userId,
    nodeId: nodeNewParentId.toString(),
    wasAi,
    chatId,
    sessionId,
    action: "updateChild",
    updateChild: { action: "added", childId: nodeChildId.toString() },
  });

  // Caller can skip cache invalidation for batched moves (e.g., reroot apply).
  // The caller is responsible for calling invalidateAll() once after the batch.
  if (!opts.skipCacheInvalidation) {
    invalidateAll();
  }
  releaseMultiple(lockIds, sessionId);

  hooks.run("afterNodeMove", { nodeId: nodeChildId.toString(), oldParentId: oldParentId.toString(), newParentId: nodeNewParentId.toString(), userId }).catch(() => {});

  return { nodeChild, nodeNewParent };
}
export async function editNodeName({
  nodeId,
  newName,
  userId,
  wasAi = false,
  chatId = null,
  sessionId = null,
}) {
  if (!newName || typeof newName !== "string" || !newName.trim()) {
    throw new Error("Node name cannot be empty");
  }
  newName = newName.trim();
  if (newName.length > 150) {
    throw new Error("Node name must be 150 characters or fewer");
  }
  if (containsHtml(newName)) {
    throw new Error("Node name cannot contain HTML tags");
  }
  if (newName.startsWith(".")) {
    throw new Error("Node names cannot start with a dot");
  }
  if (newName.startsWith("/")) {
    throw new Error("Node names cannot start with a /");
  }
  if (newName.startsWith("@")) {
    throw new Error("Node names cannot start with @");
  }
  if (newName === "~" || newName.startsWith("~/")) {
    throw new Error("Node names cannot be ~ (reserved for home)");
  }
  if (newName.includes("/")) {
    throw new Error("Node names cannot contain / (reserved for path separator)");
  }
  const node = await Node.findById(nodeId);
  if (!node) {
    throw new Error("Node not found");
  }
  if (node.systemRole) throw new Error("Cannot modify system nodes");

  const oldName = node.name;
  await Node.findByIdAndUpdate(nodeId, { $set: { name: newName } });

  await logContribution({
    userId,
    nodeId,
    action: "editName",
    wasAi,
    chatId,
    sessionId,

    editName: {
      oldName,
      newName,
    },
  });

  return { node, oldName, newName };
}

export async function reviveNodeBranch({
  deletedNodeId,
  targetParentId,
  userId,
  wasAi = false,
}) {
  const deletedNode = await Node.findById(deletedNodeId);
  if (!deletedNode) throw new Error("Deleted node not found");

  const targetParent = await Node.findById(targetParentId);
  if (!targetParent) throw new Error("Target parent node not found");

  if (deletedNode.parent !== DELETED) {
    throw new Error("Node is not deleted and cannot be revived");
  }

  if (targetParent.parent === DELETED) {
    throw new Error("Cannot revive into a deleted branch");
  }

  if (targetParent.systemRole) {
    throw new Error("Cannot revive into a system node");
  }

  if (await isDescendant(deletedNodeId, targetParentId)) {
    throw new Error("Cannot revive a node into its own descendant");
  }

  // Lock BEFORE access check to prevent TOCTOU race
  const lockIds = [deletedNodeId.toString(), targetParentId.toString()];
  const locked = await acquireMultiple(lockIds, userId);
  if (!locked) throw new ProtocolError(409, ERR.RESOURCE_CONFLICT, "Nodes are being modified");
  try {
    // Access check inside lock window
    const deletedAccess = await resolveTreeAccess(deletedNodeId, userId);
    const targetAccess = await resolveTreeAccess(targetParentId, userId);
    if (!deletedAccess.isOwner || !targetAccess.isOwner) {
      throw new Error("You must own both branches to revive a node");
    }
    deletedNode.parent = targetParentId;
    deletedNode.rootOwner = null;
    await deletedNode.save();

    await Node.findByIdAndUpdate(targetParentId, { $addToSet: { children: deletedNodeId } });

    await logContribution({
      userId,
      nodeId: targetParentId,
      wasAi,
      action: "updateChild",
      updateChild: { action: "added", childId: deletedNodeId.toString() },
    });
    await logContribution({
      userId,
      nodeId: deletedNodeId,
      wasAi,
      action: "branchLifecycle",
      branchLifecycle: { action: "revived", fromParentId: DELETED, toParentId: targetParentId.toString() },
    });

    invalidateAll();
    return { revivedNode: deletedNodeId, newParent: targetParentId };
  } finally {
    releaseMultiple(lockIds);
  }
}
export async function reviveNodeBranchAsRoot({
  deletedNodeId,
  userId,
  wasAi = false,
}) {
  const deletedNode = await Node.findById(deletedNodeId);
  if (!deletedNode) throw new Error("Deleted node not found");

  if (deletedNode.parent !== DELETED) {
    throw new Error("Node is not deleted and cannot be revived");
  }

  if (!deletedNode.rootOwner) {
    throw new Error("Deleted node has no root owner and cannot be revived");
  }

  // Lock BEFORE access check to prevent TOCTOU race
  const landRootId = getLandRootId();
  const lockIds = [deletedNodeId.toString(), landRootId].filter(Boolean);
  const locked = await acquireMultiple(lockIds, userId);
  if (!locked) throw new ProtocolError(409, ERR.RESOURCE_CONFLICT, "Nodes are being modified");
  try {
    // Access check inside lock window
    const access = await resolveTreeAccess(deletedNodeId, userId);
    if (!access.isOwner) {
      throw new Error("Only the owner can revive this branch as a root");
    }
    deletedNode.parent = landRootId;
    deletedNode.rootOwner = userId;
    await deletedNode.save();

    hooks.run("afterOwnershipChange", { nodeId: deletedNodeId, action: "setOwner", targetUserId: userId }).catch(() => {});

    if (landRootId) {
      await Node.findByIdAndUpdate(landRootId, { $addToSet: { children: deletedNodeId } });
    }

    await logContribution({
      userId,
      nodeId: deletedNodeId,
      wasAi,
      action: "branchLifecycle",
      branchLifecycle: { action: "revivedAsRoot" },
    });

    invalidateAll();
    return { revivedRoot: deletedNodeId };
  } finally {
    releaseMultiple(lockIds);
  }
}

export async function editNodeType({
  nodeId,
  newType,
  userId,
  wasAi = false,
  chatId = null,
  sessionId = null,
}) {
  if (newType !== null) {
    if (typeof newType !== "string") {
      throw new Error("Type must be a string or null");
    }
    newType = newType.trim();
    if (!newType) {
      newType = null;
    } else {
      if (newType.length > 50) {
        throw new Error("Type must be 50 characters or fewer");
      }
      if (containsHtml(newType)) {
        throw new Error("Type cannot contain HTML tags");
      }
      if (newType.startsWith(".")) {
        throw new Error("Type cannot start with a dot");
      }
      if (newType.startsWith("/")) {
        throw new Error("Type cannot start with a /");
      }
      if (newType.startsWith("@")) {
        throw new Error("Type cannot start with @");
      }
    }
  }

  const node = await Node.findById(nodeId);
  if (!node) throw new Error("Node not found");
  if (node.systemRole) throw new Error("Cannot modify system nodes");

  const oldType = node.type;
  await Node.findByIdAndUpdate(nodeId, { $set: { type: newType } });

  await logContribution({
    userId,
    nodeId,
    action: "editType",
    wasAi,
    chatId,
    sessionId,
    editType: { oldType, newType },
  });

  return { node, oldType, newType };
}

/**
 * Reorder a node's children array.
 * Must contain the exact same IDs as the current children, just in a different order.
 * Atomic $set. Contribution logged.
 */
export async function reorderChildren({
  nodeId,
  children: newOrder,
  userId,
  wasAi = false,
  chatId = null,
  sessionId = null,
}) {
  if (!Array.isArray(newOrder)) throw new Error("children must be an array");

  const node = await Node.findById(nodeId);
  if (!node) throw new Error("Node not found");
  if (node.systemRole) throw new Error("Cannot modify system nodes");

  const currentSet = new Set(node.children.map(String));
  const newSet = new Set(newOrder.map(String));
  if (currentSet.size !== newSet.size || ![...currentSet].every(id => newSet.has(id))) {
    throw new Error("Reorder must contain the same children IDs");
  }

  await Node.updateOne({ _id: nodeId }, { $set: { children: newOrder } });

  await logContribution({
    userId,
    nodeId,
    action: "reorder",
    wasAi,
    chatId,
    sessionId,
  });

  return { node };
}
