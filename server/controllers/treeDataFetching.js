const Node = require("../db/models/node");
const User = require("../db/models/user");
const Contribution = require("../db/models/contribution");
const Note = require("../db/models/notes");

async function getRootDetails(req, res) {
  const { id } = req.body;

  try {
    const node = await Node.findById(id, "rootOwner contributors")
      .populate("rootOwner", "_id username")
      .populate("contributors", "_id username");

    if (!node) {
      return res.status(404).json({ error: "Node not found" });
    }

    res.json({
      rootOwner: node.rootOwner,
      contributors: node.contributors,
    });
  } catch (error) {
    console.error("Error fetching node details:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

// Fetches a complete tree starting from a root node
async function getTree(req, res) {
  const { rootId } = req.body;

  if (!rootId) {
    return res.status(400).json({ message: "Root node ID is required" });
  }

  try {
    const rootNode = await Node.findById(rootId).populate("children").exec();

    if (!rootNode) {
      return res.status(404).json({ message: "Node not found" });
    }

    const populateChildrenRecursive = async (node) => {
      if (node.children && node.children.length > 0) {
        node.children = await Node.populate(node.children, {
          path: "children",
        });
        for (const child of node.children) {
          await populateChildrenRecursive(child);
        }
      }
    };

    await populateChildrenRecursive(rootNode);

    res.json(rootNode);
  } catch (error) {
    console.error("Error fetching tree:", error);
    res.status(500).json({ message: "Server error" });
  }
}

// Fetches all parent nodes for a given child node
async function getParents(req, res) {
  const { childId } = req.body;

  if (!childId) {
    return res.status(400).json({ message: "Child node ID is required" });
  }

  try {
    const getParentsRecursive = async (nodeId, parents = []) => {
      const currentNode = await Node.findById(nodeId).exec();

      if (!currentNode) {
        return parents;
      }

      parents.push(currentNode);

      if (currentNode.parent) {
        return await getParentsRecursive(currentNode.parent, parents);
      }

      return parents;
    };

    const parentNodes = await getParentsRecursive(childId);
    res.json(parentNodes);
  } catch (error) {
    console.error("Error fetching parents:", error);
    res.status(500).json({ message: "Server error" });
  }
}

async function getRootNodeIds(userId) {
  try {
    const user = await User.findById(userId);
    if (!user) {
      return null;
    }
    return user.roots;
  } catch (error) {
    throw error;
  }
}

// Fetches root node IDs for a user
async function getRootNodes(req, res) {
  try {
    const rootNodes = await getRootNodeIds(req.userId);
    if (!rootNodes || rootNodes.length === 0) {
      return res.json({ roots: [] });
    }
    res.json({ roots: rootNodes });
  } catch (error) {
    console.error("Error fetching root nodes:", error);
    res.status(500).json({ message: "Server error" });
  }
}

async function getAllData(req, res) {
  const { rootId } = req.body;

  if (!rootId) {
    return res.status(400).json({ message: "Root node ID is required" });
  }

  try {
    const rootNode = await Node.findById(rootId).populate("children").exec();

    if (!rootNode) {
      return res.status(404).json({ message: "Node not found" });
    }

    const populateNodeDetailsRecursive = async (node) => {
      const [notes, contributions] = await Promise.all([
        Note.find({ nodeId: node._id }),
        Contribution.find({ nodeId: node._id }),
      ]);

      node.notes = notes;
      node.contributions = contributions;

      if (node.children && node.children.length > 0) {
        node.children = await Node.populate(node.children, {
          path: "children",
        });
        for (const child of node.children) {
          await populateNodeDetailsRecursive(child);
        }
      }
    };

    await populateNodeDetailsRecursive(rootNode);

    res.json(rootNode);
  } catch (error) {
    console.error("Error fetching node details with contributions:", error);
    res.status(500).json({ message: "Server error" });
  }
}

module.exports = {
  getRootNodes,
  getRootDetails,
  getTree,
  getParents,
  getAllData,
};
