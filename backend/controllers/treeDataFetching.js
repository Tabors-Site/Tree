import Node from "../db/models/node.js";
import User from "../db/models/user.js";
import Contribution from "../db/models/contribution.js";
import Note from "../db/models/notes.js";

function filterTreeByStatus(node, filters) {
  if (!node) return null;

  const allowedStatuses = [];
  if (filters.active === true) allowedStatuses.push("active");
  if (filters.trimmed === true) allowedStatuses.push("trimmed");
  if (filters.completed === true) allowedStatuses.push("completed");

  const filteringEnabled =
    filters.active !== undefined ||
    filters.trimmed !== undefined ||
    filters.completed !== undefined;

  const currentVersion = node.versions?.find(
    (v) => v.prestige === node.prestige
  );
  const status = currentVersion?.status;

  const filteredChildren =
    node.children
      ?.map((child) => filterTreeByStatus(child, filters))
      .filter(Boolean) || [];

  if (!filteringEnabled) {
    return { ...node, children: filteredChildren };
  }

  const nodeMatches = allowedStatuses.includes(status);

  if (!nodeMatches && filteredChildren.length === 0) {
    return null;
  }

  return {
    ...node,
    children: filteredChildren,
  };
}

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

    const filters = {
      active:
        req.query.active === undefined ? true : req.query.active === "true",
      trimmed:
        req.query.trimmed === undefined ? false : req.query.trimmed === "true",
      completed:
        req.query.completed === undefined
          ? true
          : req.query.completed === "true",
    };

    const filtered = filterTreeByStatus(
      rootNode.toObject ? rootNode.toObject() : rootNode,
      filters
    );

    return res.json(filtered ?? {});
  } catch (error) {
    console.error("Error fetching tree:", error);
    res.status(500).json({ message: "Server error" });
  }
}
export async function getNodeName(nodeId) {
  const doc = await Node.findById(nodeId, "name").lean();
  return doc?.name || null;
}

async function getNodeForAi(nodeId) {
  if (!nodeId) throw new Error("Node ID is required");

  try {
    const node = await Node.findById(nodeId).lean().exec();
    if (!node) throw new Error(`Node ${nodeId} not found`);

    // ----- versions + notes -----
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

        versionsWithNotes.push({
          ...version,
          notes: notes.map((n) => ({
            username: n.userId?.username || "Unknown",
            content: n.content,
          })),
        });
      }

      node.versions = versionsWithNotes;
    }

    // ----- parent info -----
    const parentNodeId = node.parent ? node.parent.toString() : null;
    const parentName = parentNodeId
      ? await getNodeName(parentNodeId)
      : "None. Root";

    // ----- children info -----
    const children = Array.isArray(node.children)
      ? await Promise.all(
          node.children.map(async (childId) => ({
            id: childId.toString(),
            name: (await getNodeName(childId)) || "Unknown",
          }))
        )
      : [];

    return {
      id: node._id.toString(),
      name: node.name,

      parentNodeId,
      parentName,

      children,

      versions: node.versions || [],
      scripts: node.scripts || [],
    };
  } catch (error) {
    console.error("Error fetching AI node:", error);
    throw new Error("Server error while fetching node");
  }
}

export default getNodeForAi;

async function getTreeForAi(rootId, filter = null) {
  if (!rootId) {
    throw new Error("Root node ID is required");
  }

  try {
    const rootNode = await Node.findById(rootId).populate("children").exec();
    if (!rootNode) {
      throw new Error("Node not found");
    }

    const filters = !filter
      ? {
          active: true,
          trimmed: false,
          completed: true,
        }
      : {
          active: !!filter.active,
          trimmed: !!filter.trimmed,
          completed: !!filter.completed,
        };

    // populate all children fully
    const populateChildrenRecursive = async (node) => {
      if (node.children?.length > 0) {
        node.children = await Node.populate(node.children, {
          path: "children",
        });

        for (const child of node.children) {
          await populateChildrenRecursive(child);
        }
      }
    };

    await populateChildrenRecursive(rootNode);

    const filtered = filterTreeByStatus(
      rootNode.toObject ? rootNode.toObject() : rootNode,
      filters
    );

    if (!filtered) return JSON.stringify({});

    const simplifyNode = async (node) => {
      const simplified = {
        id: node._id.toString(),
        name: node.name?.replace(/\s+/g, " ").trim(),
      };

      if (node.children?.length > 0) {
        simplified.children = [];
        for (const child of node.children) {
          simplified.children.push(await simplifyNode(child));
        }
      }

      return simplified;
    };

    const tree = await simplifyNode(filtered);
    return JSON.stringify({
  
      tree,
    });
  } catch (error) {
    console.error("Error fetching AI tree:", error);
    throw new Error("Server error while fetching tree for AI");
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
function stripWalletSecrets(node) {
  if (!node || !Array.isArray(node.versions)) return node;

  return {
    ...node,
    versions: node.versions.map((v) => ({
      ...v,
      wallet: v.wallet
        ? {
            publicKey: v.wallet.publicKey ?? null,
          }
        : null,
    })),
  };
}

async function getAllData(req, res) {
  const { rootId } = req.body;

  if (!rootId) {
    return res.status(400).json({ message: "Root node ID is required" });
  }

  try {
    const populateNodeRecursive = async (nodeId) => {
      let node = await Node.findById(nodeId).populate("children").lean().exec();

      if (!node) return null;

      // 🔐 STRIP WALLET SECRETS HERE
      node = stripWalletSecrets(node);

      const contributions = await Contribution.find({
        nodeId: node._id,
      }).exec();
      node.contributions = contributions;

      // versions + notes
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

          versionsWithNotes.push({
            ...version,
            notes: notes.map((n) => ({
              username: n.userId?.username || "Unknown",
              content: n.content,
            })),
          });
        }
        node.versions = versionsWithNotes;
      }

      // recurse children
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

    // 🔗 BUILD FULL PARENT CHAIN (leaf → root)
    const ancestors = [];
    let currentId = rootNode.parent?._id || rootNode.parent;

    while (currentId) {
      const parentNode = await Node.findById(currentId)
        .select("_id name parent")
        .lean()
        .exec();

      if (!parentNode) break;

      ancestors.push(parentNode);
      currentId = parentNode.parent;
    }

    rootNode.ancestors = ancestors;

    const filters = {
      active:
        req.query.active === undefined ? true : req.query.active === "true",
      trimmed:
        req.query.trimmed === undefined ? false : req.query.trimmed === "true",
      completed:
        req.query.completed === undefined
          ? true
          : req.query.completed === "true",
    };

    const filteredChildren =
      filterTreeByStatus({ ...rootNode, children: rootNode.children }, filters)
        ?.children ?? [];

    const result = {
      ...rootNode,
      children: filteredChildren,
    };

    return res.json(result);
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
