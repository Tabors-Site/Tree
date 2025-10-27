import Node from "../db/models/node.js";
import User from "../db/models/user.js";
import Contribution from "../db/models/contribution.js";
import Note from "../db/models/notes.js";

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

async function getNodeForAi(nodeId) {
  if (!nodeId) throw new Error("Node ID is required");

  try {
    const node = await Node.findById(nodeId).lean().exec();
    if (!node) throw new Error(`Node ${nodeId} not found`);

    if (node.versions && node.versions.length > 0) {
      const versionsWithNotes = [];
      for (let i = 0; i < node.versions.length; i++) {
        const version = node.versions[i];

        const notes = await Note.find({
          nodeId: node._id,
          version: i,
          contentType: "text",
        })
          .populate("userId", "username -_id")
          .lean()
          .exec();

        const noteContents = notes.map((n) => ({
          username: n.userId?.username || "Unknown",
          content: n.content,
        }));

        versionsWithNotes.push({
          ...version,
          notes: noteContents,
        });
      }
      node.versions = versionsWithNotes;
    }

    return {
      id: node._id.toString(),
      name: node.name,
      versions: node.versions || [],
      scripts: node.scripts || [],
    };
  } catch (error) {
    console.error("Error fetching AI node:", error);
    throw new Error("Server error while fetching node");
  }
}

async function getTreeForAi(rootId) {
  if (!rootId) {
    throw new Error("Root node ID is required");
  }

  try {
    const rootNode = await Node.findById(rootId).populate("children").exec();
    if (!rootNode) {
      throw new Error("Node not found");
    }

    const simplifyNode = async (node) => {
      const simplified = {
        id: node._id.toString(),
        name: node.name?.replace(/\s+/g, " ").trim(),
      };

      if (node.children?.length > 0) {
        const populatedChildren = await Node.populate(node.children, {
          path: "children",
        });
        simplified.children = [];

        for (const child of populatedChildren) {
          simplified.children.push(await simplifyNode(child));
        }
      }

      return simplified;
    };

    const tree = await simplifyNode(rootNode);

    return JSON.stringify(tree);
  } catch (error) {
    console.error("Error fetching AI tree:", error);
    throw new Error("Server error while fetching tree");
  }
}

async function getParents(req, res) {
  const { childId } = req.body;

  if (!childId) {
    return res.status(400).json({ message: "Child node ID is required" });
  }

  try {
    const getParentsRecursive = async (nodeId, parents = []) => {
      const currentNode = await Node.findById(nodeId).lean().exec(); // lean + exec

      if (!currentNode) {
        return parents;
      }

      // only attach notes for the *last* version
      if (currentNode.versions && currentNode.versions.length > 0) {
        const lastVersion = currentNode.prestige;

        const notes = await Note.find({
          nodeId: currentNode._id,
          version: lastVersion,
          contentType: "text",
        })
          .sort({ createdAt: -1 }) // newest first
          .limit(7) // only last 7
          .select("content -_id")
          .lean()
          .exec();

        // flatten into array of strings
        const noteContents = notes.map((n) => n.content);

        currentNode.versions = [
          {
            ...lastVersion,
            notes: noteContents,
          },
        ];
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

async function getRootNodesForUser(userId) {
  try {
    const user = await User.findById(userId).populate("roots", "name _id");
    if (!user || !user.roots || user.roots.length === 0) {
      return [];
    }

    return user.roots.map((node) => ({
      _id: node._id,
      name: node.name,
    }));
  } catch (error) {
    throw error;
  }
}

async function getRootNodes(req, res) {
  try {
    const roots = await getRootNodesForUser(req.userId);
    res.json({ roots });
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
    const populateNodeRecursive = async (nodeId) => {
      const node = await Node.findById(nodeId)
        .populate("children")
        .lean()
        .exec();
      if (!node) return null;

      const contributions = await Contribution.find({
        nodeId: node._id,
      }).exec();
      node.contributions = contributions;

      // Loop through all versions and fetch notes for each
      if (node.versions && node.versions.length > 0) {
        const versionsWithNotes = [];
        for (let i = 0; i < node.versions.length; i++) {
          const version = node.versions[i];

          const notes = await Note.find({
            nodeId: node._id,
            version: i,
            contentType: "text",
          })
            .populate("userId", "username -_id")
            .lean()
            .exec();

          const noteContents = notes.map((n) => ({
            username: n.userId?.username || "Unknown",
            content: n.content,
          }));

          versionsWithNotes.push({
            ...version,
            notes: noteContents,
          });
        }
        node.versions = versionsWithNotes;
      }

      // Recursively populate children
      if (node.children && node.children.length > 0) {
        const populatedChildren = [];
        for (const child of node.children) {
          const childData = await populateNodeRecursive(child._id);
          if (childData) populatedChildren.push(childData);
        }
        node.children = populatedChildren;
      }

      return node;
    };

    const rootNode = await populateNodeRecursive(rootId);
    if (!rootNode) {
      return res.status(404).json({ message: "Node not found" });
    }

    res.json(rootNode);
  } catch (error) {
    console.error("Error fetching node details:", error);
    res.status(500).json({ message: "Server error" });
  }
}

function removeNullFields(obj) {
  if (obj === null || obj === undefined) {
    return undefined;
  }

  if (Array.isArray(obj)) {
    return obj.map(removeNullFields).filter((item) => item !== undefined);
  }

  if (typeof obj === "object") {
    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
      const cleanedValue = removeNullFields(value);
      if (cleanedValue !== undefined) {
        cleaned[key] = cleanedValue;
      }
    }
    return cleaned;
  }

  return obj;
}

export {
  getRootNodes,
  getRootDetails,
  getTree,
  getTreeForAi,
  getNodeForAi,
  getParents,
  getAllData,
};
