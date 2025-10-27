import { findNodeById } from "../db/utils.js";
import {
  createNewNode as coreCreateNewNode,
  createNodesRecursive as coreCreateNodesRecursive,
  deleteNodeBranch as coreDeleteNodeBranch,
  updateParentRelationship as coreUpdateParentRelationships,
} from "../core/treeManagement.js";


export async function addNode(req, res) {
  const { parentId, name, schedule, reeffectTime, isRoot } = req.body;
  const userId = req.userId;

  try {
    const newNode = await coreCreateNewNode(
      name,
      schedule,
      reeffectTime,
      parentId,
      isRoot,
      userId
    );

    res.json({ success: true, newNode });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Error adding node",
      error: err.message,
    });
  }
}


export async function addNodesTree(req, res) {
  const { parentId, nodeTree } = req.body;

  if (!parentId || !nodeTree) {
    return res.status(400).json({
      success: false,
      message: "Invalid request data",
    });
  }

  try {
    const result = await coreCreateNodesRecursive(nodeTree, parentId, req.userId);
    res.json({
      success: true,
      message: "Nodes added successfully",
      rootId: result,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Error adding nodes tree",
      error: err.message,
    });
  }
}



export async function deleteNode(req, res) {
  const { nodeId } = req.body;
  try {
    await coreDeleteNodeBranch(nodeId, req.userId);
    res.json({ success: true, message: "Node branch deleted and removed from parent children" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error deleting node", error: err.message });
  }
}

export async function editNodeName(req, res) {
  const { nodeId, newName } = req.body;

  if (!newName?.trim())
    return res.status(400).json({ success: false, message: "Node name cannot be empty" });

  try {
    const node = await findNodeById(nodeId);
    if (!node)
      return res.status(404).json({ success: false, message: "Node not found" });

    node.name = newName;
    await node.save();

    res.json({ success: true, message: "Node name updated successfully", updatedNode: node });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error updating node name", error: err.message });
  }
}

export async function updateNodeParent(req, res) {
  const { nodeChildId, nodeNewParentId } = req.body;
  try {
    const { nodeChild, nodeNewParent } = await coreUpdateParentRelationships(
      nodeChildId,
      nodeNewParentId,
      req.userId
    );
    res.json({
      success: true,
      message: "Node parent updated successfully",
      updatedNodeChild: nodeChild,
      updatedNodeNewParent: nodeNewParent,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error updating node parent", error: err.message });
  }
}
