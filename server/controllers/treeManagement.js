const Node = require("../db/models/node");
const User = require("../db/models/user");
const { findNodeById, logContribution } = require("../db/utils");

async function createNewNode(
  name,
  schedule,
  reeffectTime,
  parentNodeID,
  isRoot = false,
  userId,
  values = {}, // Optional, defaults to an empty object
  goals = {}    // Optional, defaults to an empty array
) {
  const newNode = new Node({
    name,
    prestige: 0,
    versions: [
      {
        prestige: 0,
        values: values || {}, // Use provided values or default to an empty object
        status: "active",
        dateCreated: new Date(),
        schedule: schedule ? new Date(schedule) : null,
        reeffectTime: reeffectTime || 0,
        goals: goals || [],   // Use provided goals or default to an empty array
      },
    ],
    children: [],
    parent: parentNodeID && parentNodeID !== null ? parentNodeID : null,
    rootOwner: isRoot ? userId : null,
    contributors: [],
  });

  await newNode.save();
  return newNode;
}


async function addNode(req, res) {
  const { parentId, name, schedule, reeffectTime, isRoot } = req.body;
  const userId = req.userId;

  try {
    if (isRoot && parentId !== null) {
      const parentNode = await findNodeById(parentId);
      if (!parentNode) {
        return res
          .status(404)
          .json({ success: false, message: "Parent node not found" });
      }
    }

    const newNode = await createNewNode(
      name,
      schedule,
      reeffectTime,
      parentId,
      isRoot,
      userId
    );

    if (isRoot) {
      const user = await User.findById(userId);
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }
      user.roots.push(newNode._id);
      await user.save();
    } else if (parentId !== null) {
      const parentNode = await findNodeById(parentId);
      if (!parentNode) {
        return res
          .status(404)
          .json({ success: false, message: "Parent node not found" });
      }
      parentNode.children.push(newNode._id);
      await parentNode.save();
    }

    await logContribution({
      userId,
      nodeId: newNode._id,
      action: "create",
      nodeVersion: "0",
    });

    res.json({ success: true, newNode });
  } catch (err) {
    res
      .status(500)
      .json({
        success: false,
        message: "Error adding node",
        error: err.message,
      });
  }
}

async function addNodesTree(req, res) {
  const { parentId, nodeTree } = req.body;

  if (!parentId || !nodeTree) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid request data" });
  }

  try {
    const parentNode = await findNodeById(parentId);
    if (!parentNode) {
      return res
        .status(404)
        .json({ success: false, message: "Parent node not found" });
    }

      // Validate nodeTree structure
      const isValidNode = (node) => {
        return (
          (typeof node.name === "string" || node.name === null) &&
          (typeof node.schedule === "string" || node.schedule === null) &&
          (node.schedule === null || !isNaN(Date.parse(node.schedule))) && // Allow null but ensure valid date string
          (typeof node.reeffectTime === "number" || node.reeffectTime === null || 
           typeof node.effectTime === "number" || node.effectTime === null) && // Allow null time values
          (typeof node.values === "object" || node.values === null) &&
          (typeof node.goals === "object" || node.goals === null) &&
          (Array.isArray(node.children) || node.children === null)  
        );
      };
      

  if (!isValidNode(nodeTree)) {
    return res.status(400).json({
      success: false,
      message: "Invalid nodeTree structure. Ensure it contains name, schedule, at least one of reeffectTime/effectTime, values, goals, and children."
    });
  }

    async function createNodesRecursive(nodeData, parentId) {
      const { 
        name, 
        schedule, 
        values, 
        goals, 
        children = [], 
        reeffectTime, 
        effectTime 
      } = nodeData;
      
      // Use reeffectTime if it's available, otherwise fall back to effectTime
      const timeToUse = reeffectTime !== undefined ? reeffectTime : effectTime;
      
      
      // Create the new node and link it to the parent
      const newNode = await createNewNode(
        name,
        schedule,
        timeToUse,
        parentId,  // Pass the correct parentId
        false,     // isRoot should always be false for recursive children
        req.userId,
        values || {},
        goals || []
      );

      // Recursively create child nodes and link them
      for (const childData of children) {
        const childId = await createNodesRecursive(childData, newNode._id);
        newNode.children.push(childId);
      }

      await newNode.save();
      return newNode._id;
    }

    // Start recursion with the root of the new subtree
    const newChildId = await createNodesRecursive(nodeTree, parentId);
    
    // Add the newly created child node to the parent's children
    parentNode.children.push(newChildId);
    await parentNode.save();

    res.json({ success: true, message: "Nodes added successfully" });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Error adding nodes tree",
      error: err.message,
    });
  }
}

async function deleteNode(req, res) {
  const { nodeId } = req.body;

  try {
    // Find the node to be deleted
    const nodeToDelete = await Node.findById(nodeId);

    if (!nodeToDelete) {
      return res
        .status(404)
        .json({ success: false, message: "Node not found" });
    }

    // Set the parent of the node being deleted to "deleted"
    nodeToDelete.parent = "deleted";
    await nodeToDelete.save();

    // Now find all nodes that have the deleted node in their children array
    const allNodes = await Node.find();

    // Filter out the node from the children arrays of any nodes that have it as a child
    for (let node of allNodes) {
      if (node.children && node.children.includes(nodeId)) {
        node.children = node.children.filter(childId => childId.toString() !== nodeId.toString());
        await node.save(); // Save the updated parent node
      }
    }

    res.json({ success: true, message: "Node shadow deleted and removed from parent children" });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
}


async function editNodeName(req, res) {
  const { nodeId, newName } = req.body;

  if (!newName || newName.trim() === "") {
    return res.status(400).json({
      success: false,
      message: "Node name cannot be empty or just spaces",
    });
  }
  try {
    // Find the node by ID
    const node = await Node.findById(nodeId);

    if (!node) {
      return res.status(404).json({
        success: false,
        message: "Node not found",
      });
    }

    // Update the node's name
    node.name = newName;
    await node.save();

    res.json({
      success: true,
      message: "Node name updated successfully",
      updatedNode: node,
    });
  } catch (error) {
    console.error("Error updating node name:", error);
    res.status(500).json({
      success: false,
      message: "Error updating node name",
      error: error.message,
    });
  }
}

async function updateNodeParent(req, res) {
  const { nodeChildId, nodeNewParentId } = req.body;

  try {
    // Find the child node by its ID
    const nodeChild = await Node.findById(nodeChildId);
    if (!nodeChild) {
      return res.status(404).json({
        success: false,
        message: "Child node not found",
      });
    }

    if (nodeChild.parent == null) {
      return res.status(443).json({
        success: false,
        message: "Cannot change root's parent",
      });
    }


    // Find the new parent node by its ID
    const nodeNewParent = await Node.findById(nodeNewParentId);
    if (!nodeNewParent) {
      return res.status(404).json({
        success: false,
        message: "New parent node not found",
      });
    }

    // If the child node already has a parent, remove it from the old parent's children array
    if (nodeChild.parent) {
      const oldParent = await Node.findById(nodeChild.parent);
      if (oldParent) {
        oldParent.children = oldParent.children.filter(
          (childId) => childId.toString() !== nodeChildId
        );
        await oldParent.save();
      }
    }

    // Update the child's parent to the new parent
    nodeChild.parent = nodeNewParentId;
    await nodeChild.save();

    // Add the child node to the new parent's children array
    nodeNewParent.children.push(nodeChildId);
    await nodeNewParent.save();

    // Optionally, log the contribution if needed
    // await logContribution({
    //   userId: req.userId, // Ensure this userId is available in the request (could be added through authentication middleware)
    //   nodeId: nodeChildId,
    //   action: "parent-update",
    // });

    res.json({
      success: true,
      message: "Node parent updated successfully",
      updatedNodeChild: nodeChild,
      updatedNodeNewParent: nodeNewParent,
    });
  } catch (error) {
    console.error("Error updating node parent:", error);
    res.status(500).json({
      success: false,
      message: "Error updating node parent",
      error: error.message,
    });
  }
}



module.exports = {
  addNode,
  addNodesTree,
  deleteNode,
  editNodeName,
  updateNodeParent
};
