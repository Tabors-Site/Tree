import Node from "../db/models/node.js";
import { logContribution } from "../db/utils.js";
import User from "../db/models/user.js";
import { createNote } from "./notes.js";

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
  validatedUser = null
) {
  const user = validatedUser ?? (await getUserOrThrow(userId));

  values = values && typeof values === "object" ? values : {};
  goals = goals && typeof goals === "object" ? goals : {};

  const newNode = new Node({
    name,
    prestige: 0,
    versions: [
      {
        prestige: 0,
        values,
        status: "active",
        dateCreated: new Date(),
        schedule: schedule ? new Date(schedule) : null,
        reeffectTime: reeffectTime || 0,
        goals,
      },
    ],
    children: [],
    parent: parentNodeID || null,
    rootOwner: isRoot ? user._id : null,
    contributors: [],
  });

  await newNode.save();

  if (isRoot) {
    user.roots.push(newNode._id);
    await user.save();
  } else if (parentNodeID) {
    const parentNode = await Node.findById(parentNodeID);
    if (!parentNode) throw new Error("Parent node not found");

    parentNode.children.push(newNode._id);
    await parentNode.save();

    await logContribution({
      userId: user._id,
      nodeId: parentNodeID,
      action: "updateChildNode",
      nodeVersion: parentNode.prestige.toString(),
      updateChildNode: {
        action: "added",
        childId: newNode._id.toString(),
      },
    });
  }

  await logContribution({
    userId: user._id,
    nodeId: newNode._id,
    action: "create",
    nodeVersion: "0",
  });

  if (note?.trim()) {
    await createNote({
      contentType: "text",
      content: note,
      userId: user._id,
      nodeId: newNode._id,
      version: 0,
      isReflection: false,
    });
  }

  return newNode;
}

export async function createNodesRecursive(nodeData, parentId, userId) {
  const user = await getUserOrThrow(userId);

  return createNodesRecursiveInternal(nodeData, parentId, user);
}

async function createNodesRecursiveInternal(nodeData, parentId, user) {
  const { name, schedule, values, goals, reeffectTime, effectTime, note } =
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
    user // 👈 avoids re-query
  );

  let totalCreated = 1;

  for (const childData of children) {
    const childResult = await createNodesRecursiveInternal(
      childData,
      newNode._id,
      user
    );
    totalCreated += childResult.totalCreated;
  }

  return {
    rootId: newNode._id,
    rootName: newNode.name,
    totalCreated,
  };
}

export async function deleteNodeBranch(nodeId, userId) {
  const nodeToDelete = await Node.findById(nodeId);
  if (!nodeToDelete) throw new Error("Node not found");

  nodeToDelete.parent = "deleted";
  await nodeToDelete.save();

  const allNodes = await Node.find();

  for (const node of allNodes) {
    if (node.children && node.children.includes(nodeId)) {
      node.children = node.children.filter(
        (childId) => childId.toString() !== nodeId.toString()
      );
      await node.save();

      await logContribution({
        userId,
        nodeId: node._id.toString(),
        action: "updateChildNode",
        nodeVersion: node.prestige.toString(),
        updateChildNode: {
          action: "removed",
          childId: nodeId.toString(),
        },
      });
    }
  }

  return nodeToDelete;
}

export async function updateParentRelationship(
  nodeChildId,
  nodeNewParentId,
  userId
) {
  const nodeChild = await Node.findById(nodeChildId);
  if (!nodeChild) throw new Error("Child node not found");
  if (nodeChild.parent == null) throw new Error("Cannot change root's parent");
  if (nodeChild.parent.toString() === nodeNewParentId.toString()) {
    throw new Error("Node already has this parent");
  }

  const oldParentId = nodeChild.parent; // ✅ safe
  const oldParent = oldParentId ? await Node.findById(oldParentId) : null;
  const nodeNewParent = await Node.findById(nodeNewParentId);

  if (!nodeNewParent) throw new Error("New parent node not found");

  // Remove from old parent
  if (oldParent) {
    oldParent.children = oldParent.children.filter(
      (childId) => childId.toString() !== nodeChildId
    );
    await oldParent.save();

    await logContribution({
      userId,
      nodeId: oldParent._id.toString(),
      action: "updateChildNode",
      nodeVersion: oldParent.prestige.toString(),
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
    action: "updateParent",
    nodeVersion: nodeChild.prestige.toString(),
    updateParent: {
      oldParentId: oldParentId ? oldParentId.toString() : null,
      newParentId: nodeNewParentId.toString(),
    },
  });

  // Add to new parent
  nodeNewParent.children.push(nodeChildId);
  await nodeNewParent.save();

  await logContribution({
    userId,
    nodeId: nodeNewParentId.toString(),
    action: "updateChildNode",
    nodeVersion: nodeNewParent.prestige.toString(),
    updateChildNode: {
      action: "added",
      childId: nodeChildId.toString(),
    },
  });

  return { nodeChild, nodeNewParent };
}
export async function editNodeName({ nodeId, newName, userId }) {
  if (!newName || !newName.trim()) {
    throw new Error("Node name cannot be empty");
  }

  const node = await Node.findById(nodeId);
  if (!node) {
    throw new Error("Node not found");
  }

  const oldName = node.name;
  node.name = newName;
  await node.save();

  await logContribution({
    userId,
    nodeId,
    action: "editNameNode",
    nodeVersion: node.prestige.toString(),
    editNameNode: {
      oldName,
      newName,
    },
  });

  return { node, oldName, newName };
}
