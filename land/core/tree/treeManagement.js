import Node from "../../db/models/node.js";
import { logContribution } from "../../db/utils.js";
import User from "../../db/models/user.js";
import { createNote } from "./notes.js";
import { resolveTreeAccess } from "../authenticate.js";
import { isDescendant } from "./treeFetch.js";
import { hooks } from "../hooks.js";
// Energy: dynamic import, no-op if extension not installed
import { getLandRootId } from "../landRoot.js";

function containsHtml(str) {
  return /<[a-zA-Z\/][^>]*>/.test(str);
}
//validate once during recursive branches
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

export async function createNewNode(
  name,
  schedule,
  reeffectTime,
  parentNodeID,
  isRoot = false,
  userId,
  values = {},
  goals = {},
  note = null,
  validatedUser = null,
  wasAi = false,
  aiChatId = null,
  sessionId = null,
  type = null,
) {
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
  const user = validatedUser ?? (await getUserOrThrow(userId));



  values = values && typeof values === "object" ? values : {};
  goals = goals && typeof goals === "object" ? goals : {};

  // Build metadata from extension-specific params
  // Extensions own their metadata keys. Core just passes them through.
  const metadata = new Map();
  if (Object.keys(values).length > 0) metadata.set("values", values);
  if (Object.keys(goals).length > 0) metadata.set("goals", goals);
  if (schedule) metadata.set("schedule", new Date(schedule));
  if (reeffectTime) metadata.set("reeffectTime", reeffectTime);

  const newNode = new Node({
    name,
    type,
    status: "active",
    children: [],
    parent: isRoot ? getLandRootId() : (parentNodeID || null),
    rootOwner: isRoot ? user._id : null,
    contributors: [],
    metadata,
  });

  await newNode.save();

  if (isRoot) {
    user.roots.addToSet(newNode._id);
    await user.save();
    // Add to Land root's children
    const landRootId = getLandRootId();
    if (landRootId) {
      await Node.findByIdAndUpdate(landRootId, {
        $addToSet: { children: newNode._id },
      });
    }
  } else if (parentNodeID) {
    const parentNode = await Node.findById(parentNodeID);
    if (!parentNode) throw new Error("Parent node not found");
    if (parentNode.systemRole) throw new Error("Cannot create nodes under system nodes");

    parentNode.children.addToSet(newNode._id);
    await parentNode.save();

    await logContribution({
      userId: user._id,
      nodeId: parentNodeID,
      wasAi,
      aiChatId,
      sessionId,
      action: "updateChildNode",

      updateChildNode: {
        action: "added",
        childId: newNode._id.toString(),
      },
    });
  }

  await logContribution({
    userId: user._id,
    nodeId: newNode._id,
    wasAi,
    aiChatId,
    sessionId,
    action: "create",

  });

  if (note?.trim()) {
    await createNote({
      contentType: "text",
      content: note,
      userId: user._id,
      nodeId: newNode._id,
      version: 0,
      isReflection: false,
      wasAi,
      aiChatId,
      sessionId,
    });
  }

  // afterNodeCreate (fire-and-forget)
  hooks.run("afterNodeCreate", { node: newNode, userId: user._id }).catch(() => {});

  return newNode;
}

export async function createNodesRecursive(
  nodeData,
  parentId,
  userId,
  wasAi = false,
  aiChatId = null,
  sessionId = null,
) {
  const user = await getUserOrThrow(userId);

  return createNodesRecursiveInternal(
    nodeData,
    parentId,
    user,
    wasAi,
    aiChatId,
    sessionId,
  );
}

async function createNodesRecursiveInternal(
  nodeData,
  parentId,
  user,
  wasAi,
  aiChatId = null,
  sessionId = null,
) {
  const { name, schedule, values, goals, reeffectTime, effectTime, note, type } =
    nodeData;

  const children = Array.isArray(nodeData.children) ? nodeData.children : [];

  const timeToUse = reeffectTime ?? effectTime;

  const newNode = await createNewNode(
    name,
    schedule,
    timeToUse,
    parentId,
    false,
    user._id,
    values || {},
    goals || {},
    note || null,
    user, // 👈 avoids re-query
    wasAi,
    aiChatId,
    sessionId,
    type || null,
  );

  let totalCreated = 1;

  for (const childData of children) {
    const childResult = await createNodesRecursiveInternal(
      childData,
      newNode._id,
      user,
      wasAi,
      aiChatId,
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
  aiChatId = null,
  sessionId = null,
) {
  const nodeToDelete = await Node.findById(nodeId);
  if (!nodeToDelete) throw new Error("Node not found");
  const access = await resolveTreeAccess(nodeId, userId);
  if (!access.isOwner || (!access.isRoot && !!nodeToDelete.rootOwner)) {
    throw new Error("Invalid delete attempt. Must be owner and not root.");
  }
  if (nodeToDelete.rootOwner && nodeToDelete.rootOwner !== "SYSTEM") {
    throw new Error("Root nodes can only be retired on root view");
  }
  if (nodeToDelete.parent === "deleted") {
    throw new Error("Node has already been deleted");
  }
  // beforeNodeDelete hook
  await hooks.run("beforeNodeDelete", { node: nodeToDelete, userId });


  nodeToDelete.rootOwner = userId;
  const oldParent = nodeToDelete.parent;
  nodeToDelete.parent = "deleted";

  await nodeToDelete.save();

  const allNodes = await Node.find();

  for (const node of allNodes) {
    if (node.children && node.children.includes(nodeId)) {
      node.children = node.children.filter(
        (childId) => childId.toString() !== nodeId.toString(),
      );
      await node.save();

      await logContribution({
        userId,
        nodeId: node._id.toString(),
        wasAi,
        aiChatId,
        sessionId,
        action: "updateChildNode",
  
        updateChildNode: {
          action: "removed",
          childId: nodeId.toString(),
        },
      });
    }
  }
  await logContribution({
    userId,
    nodeId: nodeId,
    wasAi,
    aiChatId,
    sessionId,
    action: "branchLifecycle",

    branchLifecycle: {
      action: "retired",
      fromParentId: oldParent?.toString() ?? null,
    },
  });
  return nodeToDelete;
}

export async function updateParentRelationship(
  nodeChildId,
  nodeNewParentId,
  userId,
  wasAi = false,
  aiChatId = null,
  sessionId = null,
) {
  const nodeChild = await Node.findById(nodeChildId);
  if (!nodeChild) throw new Error("Child node not found");
  if (nodeChild.rootOwner && nodeChild.rootOwner !== "SYSTEM") throw new Error("Cannot change root's parent");
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


  // Remove from old parent
  if (oldParent) {
    oldParent.children = oldParent.children.filter(
      (childId) => childId.toString() !== nodeChildId,
    );
    await oldParent.save();

    await logContribution({
      userId,
      nodeId: oldParent._id.toString(),
      wasAi,
      aiChatId,
      sessionId,
      action: "updateChildNode",

      updateChildNode: {
        action: "removed",
        childId: nodeChildId.toString(),
      },
    });
  }

  // Update parent field
  nodeChild.parent = nodeNewParentId;
  await nodeChild.save();

  // Log updateParent
  await logContribution({
    userId,
    nodeId: nodeChildId,
    wasAi,
    aiChatId,
    sessionId,
    action: "updateParent",

    updateParent: {
      oldParentId: oldParentId ? oldParentId.toString() : null,
      newParentId: nodeNewParentId.toString(),
    },
  });

  // Add to new parent
  nodeNewParent.children.addToSet(nodeChildId);
  await nodeNewParent.save();

  await logContribution({
    userId,
    nodeId: nodeNewParentId.toString(),
    wasAi,
    aiChatId,
    sessionId,
    action: "updateChildNode",

    updateChildNode: {
      action: "added",
      childId: nodeChildId.toString(),
    },
  });

  return { nodeChild, nodeNewParent };
}
export async function editNodeName({
  nodeId,
  newName,
  userId,
  wasAi = false,
  aiChatId = null,
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
  if (newType.startsWith("/")) {
        throw new Error("Node Names cannot start with a /");
      }
  if (newName.startsWith("@")) {
    throw new Error("Node names cannot start with @");
  }
  const node = await Node.findById(nodeId);
  if (!node) {
    throw new Error("Node not found");
  }
  if (node.systemRole) throw new Error("Cannot modify system nodes");


  const oldName = node.name;
  node.name = newName;
  await node.save();

  await logContribution({
    userId,
    nodeId,
    action: "editNameNode",
    wasAi,
    aiChatId,
    sessionId,

    editNameNode: {
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

  if (deletedNode.parent !== "deleted") {
    throw new Error("Node is not deleted and cannot be revived");
  }

  if (targetParent.parent === "deleted") {
    throw new Error("Cannot revive into a deleted branch");
  }

  if (targetParent.systemRole) {
    throw new Error("Cannot revive into a system node");
  }

  const deletedAccess = await resolveTreeAccess(deletedNodeId, userId);
  const targetAccess = await resolveTreeAccess(targetParentId, userId);

  if (!deletedAccess.isOwner || !targetAccess.isOwner) {
    throw new Error("You must own both branches to revive a node");
  }
  //extra safe but unneeded
  if (await isDescendant(deletedNodeId, targetParentId)) {
    throw new Error("Cannot revive a node into its own descendant");
  }


  deletedNode.parent = targetParentId;
  deletedNode.rootOwner = null;
  await deletedNode.save();

  targetParent.children.addToSet(deletedNodeId);
  await targetParent.save();

  // 6️⃣ Log contributions
  await logContribution({
    userId,
    nodeId: targetParentId,
    wasAi,
    action: "updateChildNode",

    updateChildNode: {
      action: "added",
      childId: deletedNodeId.toString(),
    },
  });
  await logContribution({
    userId,
    nodeId: deletedNodeId,
    wasAi,
    action: "branchLifecycle",

    branchLifecycle: {
      action: "revived",
      fromParentId: "deleted",

      toParentId: targetParentId.toString(),
    },
  });

  return {
    revivedNode: deletedNodeId,
    newParent: targetParentId,
  };
}
export async function reviveNodeBranchAsRoot({
  deletedNodeId,
  userId,
  wasAi = false,
}) {
  const deletedNode = await Node.findById(deletedNodeId);
  if (!deletedNode) throw new Error("Deleted node not found");

  if (deletedNode.parent !== "deleted") {
    throw new Error("Node is not deleted and cannot be revived");
  }

  const access = await resolveTreeAccess(deletedNodeId, userId);
  if (!access.isOwner) {
    throw new Error("Only the owner can revive this branch as a root");
  }

  if (!deletedNode.rootOwner) {
    throw new Error("Deleted node has no root owner and cannot be revived");
  }


  deletedNode.parent = getLandRootId();
  deletedNode.rootOwner = userId;
  await deletedNode.save();

  await User.findByIdAndUpdate(userId, {
    $addToSet: { roots: deletedNodeId },
  });

  // Add to Land root's children
  const landRootId = getLandRootId();
  if (landRootId) {
    await Node.findByIdAndUpdate(landRootId, {
      $addToSet: { children: deletedNodeId },
    });
  }

  await logContribution({
    userId,
    nodeId: deletedNodeId,
    wasAi,
    action: "branchLifecycle",

    branchLifecycle: {
      action: "revivedAsRoot",
    },
  });

  return {
    revivedRoot: deletedNodeId,
  };
}
