import Node from "../db/models/node.js";
import { logContribution } from "../db/utils.js";
import User from "../db/models/user.js";
import { createNote } from "./notes.js";

export async function createNewNode(
  name,
  schedule,
  reeffectTime,
  parentNodeID,
  isRoot = false,
  userId,
  values = {},
  goals = {},
  note = null
) {
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
    rootOwner: isRoot ? userId : null,
    contributors: [],
  });

  await newNode.save();

  if (isRoot) {
    const user = await User.findById(userId);
    if (!user) throw new Error("User not found");

    user.roots.push(newNode._id);
    await user.save();
  } else if (parentNodeID) {
    const parentNode = await Node.findById(parentNodeID);
    if (!parentNode) throw new Error("Parent node not found");

    parentNode.children.push(newNode._id);
    await parentNode.save();

    await logContribution({
      userId,
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
    userId,
    nodeId: newNode._id,
    action: "create",
    nodeVersion: "0",
  });

  if (note && note.trim().length > 0) {
    await createNote({
      contentType: "text",
      content: note,
      userId,
      nodeId: newNode._id,
      version: 0,
      isReflection: false,
    });
  }

  return newNode;
}

export async function createNodesRecursive(nodeData, parentId, userId) {
  const {
    name,
    schedule,
    values,
    goals,
    children = [],
    reeffectTime,
    effectTime,
    note,
  } = nodeData;

  const timeToUse = reeffectTime ?? effectTime;

  const newNode = await createNewNode(
    name,
    schedule,
    timeToUse,
    parentId,
    false,
    userId,
    values || {},
    goals || {},
    note || null
  );

  for (const childData of children) {
    await createNodesRecursive(childData, newNode._id, userId);
  }

  return newNode._id;
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

  return node;
}
