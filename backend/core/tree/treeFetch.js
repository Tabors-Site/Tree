import Node from "../../db/models/node.js";
import Note from "../../db/models/notes.js"; // adjust import

import User from "../../db/models/user.js";

export async function resolveVersion(nodeId, version) {
  if (version === "latest") {
    const node = await Node.findById(nodeId).select("prestige").lean();
    if (!node) throw new Error("Node not found");
    return node.prestige;
  }
  return Number(version);
}

export async function buildPathString(nodeId) {
  const segments = [];
  let cursor = nodeId;
  const maxDepth = 50; // safety guard against circular refs
  let depth = 0;

  while (cursor && depth < maxDepth) {
    const node = await Node.findById(cursor)
      .select("_id name parent")
      .lean()
      .exec();

    if (!node) break;

    segments.unshift(node.name);

    if (!node.parent) break; // no parent = root, stop
    cursor = node.parent;
    depth++;
  }

  return segments.join(" > ");
}

// Batch version: returns path for multiple node IDs
// Useful when navigate returns candidates
export async function buildPathStrings(nodeIds) {
  const results = {};
  for (const id of nodeIds) {
    results[id] = await buildPathString(id);
  }
  return results;
}

export async function getRootNodesForUser(userId) {
  if (!userId) {
    throw new Error("userId is required");
  }

  const user = await User.findById(userId)
    .populate("roots", "name _id")
    .lean()
    .exec();

  if (!user || !Array.isArray(user.roots) || user.roots.length === 0) {
    return [];
  }

  return user.roots.map((node) => ({
    _id: node._id.toString(),
    name: node.name,
  }));
}

export async function resolveRootNode(nodeId) {
  if (!nodeId) {
    throw new Error("nodeId is required");
  }

  let node = await Node.findById(nodeId)
    .select("parent rootOwner contributors")
    .lean()
    .exec();

  if (!node) {
    throw new Error("Node not found");
  }

  while (!node.rootOwner) {
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

  return node;
}

export async function isDescendant(ancestorId, nodeId) {
  let current = await Node.findById(nodeId).select("parent");

  while (current && current.parent) {
    if (current.parent.toString() === ancestorId.toString()) {
      return true;
    }
    current = await Node.findById(current.parent).select("parent");
  }

  return false;
}

export async function getDescendantIds(nodeId) {
  const queue = [nodeId];
  const visited = new Set([nodeId]);
  while (queue.length > 0) {
    const batch = queue.splice(0, 100);
    const nodes = await Node.find({ _id: { $in: batch } })
      .select("_id children")
      .lean();
    for (const n of nodes) {
      if (Array.isArray(n.children)) {
        for (const childId of n.children) {
          const cid = String(childId);
          if (!visited.has(cid)) {
            visited.add(cid);
            queue.push(cid);
          }
        }
      }
    }
  }
  return [...visited];
}

export async function getDeletedBranchesForUser(userId) {
  if (!userId) {
    throw new Error("userId is required");
  }

  const deletedNodes = await Node.find({
    parent: "deleted",
    rootOwner: userId,
  })
    .select("_id name")
    .lean()
    .exec();

  return deletedNodes.map((n) => ({
    _id: n._id.toString(),
    name: n.name,
  }));
}

export async function getActiveLeafExecutionFrontier(rootId) {
  if (!rootId) {
    throw new Error("rootId is required");
  }

  const rootNode = await Node.findById(rootId)
    .select("_id name children versions")
    .lean()
    .exec();

  if (!rootNode) {
    return { rootId, leaves: [] };
  }

  const leaves = [];

  // ---- helpers ----

  function getCurrentVersion(node) {
    if (!Array.isArray(node.versions) || node.versions.length === 0) {
      return null;
    }
    return node.versions.reduce((latest, v) =>
      v.prestige > latest.prestige ? v : latest,
    );
  }

  function isActive(node) {
    return getCurrentVersion(node)?.status === "active";
  }

  // ---- TRUE DFS (post-order) ----
  async function traverse(node, depth, path) {
    const currentVersion = getCurrentVersion(node);
    if (!currentVersion || currentVersion.status !== "active") {
      return false;
    }

    let foundDeeperActive = false;

    const childrenIds = Array.isArray(node.children) ? node.children : [];

    if (childrenIds.length > 0) {
      const children = await Node.find({ _id: { $in: childrenIds } })
        .select("_id name children versions")
        .lean()
        .exec();

      const childrenById = new Map(children.map((c) => [c._id.toString(), c]));

      const orderedChildren = childrenIds
        .map((id) => childrenById.get(id.toString()))
        .filter(Boolean);

      for (const child of orderedChildren) {
        const childHasActive = await traverse(child, depth + 1, [
          ...path,
          child.name,
        ]);
        if (childHasActive) {
          foundDeeperActive = true;
        }
      }
    }

    // ✅ Leaf = no active descendants
    if (!foundDeeperActive) {
      leaves.push({
        nodeId: node._id.toString(),
        name: node.name,
        path,
        depth,

        // 🔑 version context
        versionPrestige: currentVersion.prestige,
        versionStatus: currentVersion.status,

        next: false,
      });
    }

    return true;
  }

  await traverse(rootNode, 0, []);

  // First leaf in post-order DFS = deepest-leftmost
  if (leaves.length > 0) {
    leaves[0].next = true;
  }

  return {
    rootId,
    leaves,
  };
}
const TREE_SUMMARY_MAX_DEPTH = 4;
const TREE_SUMMARY_MAX_NODES = 60;

export async function buildDeepTreeSummary(
  rootId,
  { includeEncodings = false, includeIds = false } = {},
) {
  let nodeCount = 0;

  // Optionally load navigation encodings from the latest understanding run
  let encodingMap = null;
  if (includeEncodings) {
    try {
      const { default: UnderstandingRun } =
        await import("../../db/models/understandingRun.js");
      const { default: UnderstandingNode } =
        await import("../../db/models/understandingNode.js");

      const latestRun = await UnderstandingRun.findOne({
        rootNodeId: rootId,
        perspective: { $regex: /^Summarize this section/ },
      })
        .sort({ createdAt: -1 })
        .select("_id")
        .lean();

      if (latestRun) {
        const runId = latestRun._id;
        const uNodes = await UnderstandingNode.find({})
          .select("realNodeId perspectiveStates")
          .lean();
        encodingMap = new Map();
        for (const uNode of uNodes) {
          const state =
            uNode.perspectiveStates?.get?.(runId) ||
            (uNode.perspectiveStates && uNode.perspectiveStates[runId]);
          if (state?.encoding) {
            encodingMap.set(uNode.realNodeId, state.encoding);
          }
        }
      }
    } catch (err) {
      console.warn("⚠️ Failed to load understanding encodings:", err.message);
    }
  }

  async function walkNode(nodeId, depth) {
    if (nodeCount >= TREE_SUMMARY_MAX_NODES) return null;
    nodeCount++;

    const ctx = await getContextForAi(nodeId, {
      includeChildren: true,
      includeParentChain: false,
      includeValues: true,
      includeNotes: true,
    });

    const indent = "  ".repeat(depth);
    const values = ctx.version?.values;
    const valueStr =
      values && Object.keys(values).length > 0
        ? ` (${Object.entries(values)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ")})`
        : "";

    const noteStr =
      ctx.noteCount > 0
        ? ` [${ctx.noteCount} note${ctx.noteCount > 1 ? "s" : ""}]`
        : "";

    // Append truncated encoding if available
    let encodingStr = "";
    if (encodingMap) {
      const encoding = encodingMap.get(String(nodeId));
      if (encoding && encoding.trim()) {
        const truncated =
          encoding.length > 80 ? encoding.slice(0, 77) + "..." : encoding;
        encodingStr = ` — "${truncated}"`;
      }
    }

    const idStr = includeIds ? ` [id:${ctx.id}]` : "";
    let line = `${indent}- ${ctx.name}${idStr}${noteStr}${valueStr}${encodingStr}`;

    if (depth < TREE_SUMMARY_MAX_DEPTH && ctx.children?.length > 0) {
      const childLines = [];
      for (const child of ctx.children) {
        if (nodeCount >= TREE_SUMMARY_MAX_NODES) {
          childLines.push(
            `${"  ".repeat(depth + 1)}- ... (${ctx.children.length - childLines.length} more)`,
          );
          break;
        }
        const childResult = await walkNode(child.id, depth + 1);
        if (childResult) childLines.push(childResult);
      }
      if (childLines.length > 0) {
        line += "\n" + childLines.join("\n");
      }
    } else if (ctx.children?.length > 0) {
      line += ` [${ctx.children.length} children]`;
    }

    return line;
  }

  const result = await walkNode(rootId, 0);
  if (!result) return "(empty tree)";
  return `Tree structure:\n${result}`;
}
export async function getNavigationContext(nodeId, { search } = {}) {
  if (!nodeId) {
    throw new Error("nodeId is required");
  }

  // ---- Load current node ----
  const current = await Node.findById(nodeId)
    .select("_id name parent children")
    .lean()
    .exec();

  if (!current) {
    throw new Error("Node not found");
  }

  const isRoot = !current.parent;

  // ---- Find the tree root (needed for scoped search) ----
  let root;
  if (isRoot) {
    root = { id: current._id.toString(), name: current.name };
  } else {
    let cursor = current;
    while (cursor.parent) {
      const next = await Node.findById(cursor.parent)
        .select("_id name parent")
        .lean()
        .exec();
      if (!next) break;
      cursor = next;
    }
    root = { id: cursor._id.toString(), name: cursor.name };
  }

  // ---- If search is provided, find matching nodes WITHIN THIS TREE ONLY ----
  if (search) {
    const regex = new RegExp(search, "i");

    // Collect all descendant IDs from root using BFS
    const treeNodeIds = await collectDescendantIds(root.id);

    // Search only within those IDs
    const matches = await Node.find({
      _id: { $in: treeNodeIds },
      name: { $regex: regex },
    })
      .select("_id name parent")
      .limit(10)
      .lean()
      .exec();

    const results = await Promise.all(
      matches.map(async (n) => ({
        id: n._id.toString(),
        name: n.name,
        path: await buildPathString(n._id),
      })),
    );

    return {
      current: {
        id: current._id.toString(),
        name: current.name,
        isRoot,
      },
      searchResults: results,
      root,
    };
  }

  // ---- Parent ----
  let parent = null;
  let siblings = [];

  if (current.parent && current.parent !== "deleted") {
    parent = await Node.findById(current.parent)
      .select("_id name children")
      .lean()
      .exec();

    if (parent?.children?.length) {
      const siblingIds = parent.children.filter(
        (id) => id.toString() !== current._id.toString(),
      );

      if (siblingIds.length > 0) {
        const siblingNodes = await Node.find({
          _id: { $in: siblingIds },
        })
          .select("_id name")
          .lean()
          .exec();

        const siblingMap = new Map(
          siblingNodes.map((n) => [n._id.toString(), n]),
        );

        siblings = siblingIds
          .map((id) => siblingMap.get(id.toString()))
          .filter(Boolean)
          .map((n) => ({
            id: n._id.toString(),
            name: n.name,
          }));
      }
    }
  }

  // ---- Children (adaptive depth based on budget) ----
  const maxNodes = 50;
  const children = await getChildrenAdaptive(current.children, maxNodes);

  // ---- Final shape ----
  return {
    current: {
      id: current._id.toString(),
      name: current.name,
      isRoot,
    },
    parent: parent ? { id: parent._id.toString(), name: parent.name } : null,
    children,
    siblings,
    root,
  };
}

/**
 * BFS to collect all descendant node IDs from a root.
 * Caps at MAX_TREE_SIZE to prevent runaway on huge trees.
 */
async function collectDescendantIds(rootId, maxSize = 500) {
  const ids = [];
  const queue = [rootId];

  while (queue.length > 0 && ids.length < maxSize) {
    const batch = queue.splice(0, Math.min(queue.length, 50));
    ids.push(...batch);

    const nodes = await Node.find({ _id: { $in: batch } })
      .select("children")
      .lean()
      .exec();

    for (const node of nodes) {
      if (node.children?.length > 0) {
        for (const childId of node.children) {
          if (ids.length + queue.length < maxSize) {
            queue.push(childId);
          }
        }
      }
    }
  }

  return ids;
}

// ---- Adaptive child fetcher with node budget ----
async function getChildrenAdaptive(childIds, budget) {
  if (!Array.isArray(childIds) || childIds.length === 0 || budget <= 0) {
    return [];
  }

  const childNodes = await Node.find({ _id: { $in: childIds } })
    .select("_id name children")
    .lean()
    .exec();

  const childMap = new Map(childNodes.map((n) => [n._id.toString(), n]));

  // First pass: build entries, count how many nodes this level costs
  const entries = [];
  for (const id of childIds) {
    const node = childMap.get(id.toString());
    if (!node) continue;
    entries.push({
      id: node._id.toString(),
      name: node.name,
      childCount: node.children?.length || 0,
      rawChildren: node.children || [],
    });
  }

  const thisLevelCost = entries.length;
  const remaining = budget - thisLevelCost;

  // If no budget left for deeper levels, return flat
  if (remaining <= 0) {
    return entries.map(({ id, name, childCount }) => ({
      id,
      name,
      ...(childCount > 0 ? { childCount } : {}),
    }));
  }

  // Count total grandchildren across all entries
  const totalGrandchildren = entries.reduce((sum, e) => sum + e.childCount, 0);

  // If all grandchildren fit in remaining budget, expand everything
  // Otherwise, don't expand any (keeps it consistent rather than partial)
  const canExpand = totalGrandchildren > 0 && totalGrandchildren <= remaining;

  const results = [];
  for (const entry of entries) {
    const result = { id: entry.id, name: entry.name };

    if (canExpand && entry.rawChildren.length > 0) {
      // Distribute remaining budget proportionally
      const share = Math.floor(
        (entry.rawChildren.length / totalGrandchildren) * remaining,
      );
      result.children = await getChildrenAdaptive(
        entry.rawChildren,
        Math.max(share, entry.rawChildren.length), // at minimum show names
      );
    } else if (entry.childCount > 0) {
      // Can't expand, just show count so agent knows there's more
      result.childCount = entry.childCount;
    }

    results.push(result);
  }

  return results;
}

export async function getContextForAi(nodeId, options = {}) {
  if (!nodeId) throw new Error("nodeId is required");

  const {
    includeNotes = true,
    includeSiblings = false,
    includeChildren = true,
    includeParentChain = false,
    includeValues = true,
    includeScripts = false,
    includeDirectives = false,
  } = options;

  // ---- Load node ----
  const node = await Node.findById(nodeId).lean().exec();
  if (!node) throw new Error(`Node ${nodeId} not found`);

  const currentPrestige = node.prestige || 0;
  const currentVersion = node.versions?.[currentPrestige] || null;

  // ---- Base context ----
  const context = {
    id: node._id.toString(),
    name: node.name,
    isRoot: !node.parent,
    prestige: currentPrestige,
    totalVersions: node.versions?.length || 0,
  };

  // ---- Current version data ----
  if (currentVersion) {
    context.version = {
      status: currentVersion.status,
      dateCreated: currentVersion.dateCreated,
    };

    if (currentVersion.schedule) {
      context.version.schedule = currentVersion.schedule;
    }

    if (includeValues) {
      const values =
        currentVersion.values instanceof Map
          ? Object.fromEntries(currentVersion.values)
          : currentVersion.values || {};

      const goals =
        currentVersion.goals instanceof Map
          ? Object.fromEntries(currentVersion.goals)
          : currentVersion.goals || {};

      // Only include if there's actual data
      if (Object.keys(values).length > 0) {
        context.version.values = values;
      }
      if (Object.keys(goals).length > 0) {
        context.version.goals = goals;
      }
    }
  }

  // ---- Notes (current version only) ----
  if (includeNotes) {
    const noteCount = await Note.countDocuments({
      nodeId: node._id,
      version: currentPrestige,
      contentType: "text",
    });

    context.noteCount = noteCount;

    if (noteCount > 0) {
      // Just the most recent 3 as preview
      const recentNotes = await Note.find({
        nodeId: node._id,
        version: currentPrestige,
        contentType: "text",
      })
        .sort({ _id: -1 })
        .limit(3)
        .populate("userId", "username -_id")
        .lean()
        .exec();

      const MAX_PREVIEW = 200;
      context.notes = recentNotes.map((n) => {
        const content = n.content || "";
        return {
          id: n._id.toString(),
          username: n.userId?.username || "Unknown",
          preview:
            content.length > MAX_PREVIEW
              ? content.slice(0, MAX_PREVIEW) + "…"
              : content,
        };
      });
    }
  }

  // ---- Parent ----
  if (node.parent) {
    const parentNode = await Node.findById(node.parent)
      .select("_id name")
      .lean()
      .exec();

    if (parentNode) {
      context.parent = {
        id: parentNode._id.toString(),
        name: parentNode.name,
      };
    }
  } else {
    context.parent = null; // root node
  }

  // ---- Parent chain (full path) ----
  if (includeParentChain) {
    context.path = await buildPathString(nodeId);
  }

  // ---- Children ----
  if (includeChildren && node.children?.length > 0) {
    const childNodes = await Node.find({ _id: { $in: node.children } })
      .select("_id name")
      .lean()
      .exec();

    const childMap = new Map(childNodes.map((n) => [n._id.toString(), n]));

    context.children = node.children
      .map((id) => childMap.get(id.toString()))
      .filter(Boolean)
      .map((n) => ({
        id: n._id.toString(),
        name: n.name,
      }));
  } else {
    context.children = [];
  }

  // ---- Siblings ----
  if (includeSiblings && node.parent) {
    const parentNode = await Node.findById(node.parent)
      .select("children")
      .lean()
      .exec();

    if (parentNode?.children?.length > 1) {
      const siblingIds = parentNode.children.filter(
        (id) => id.toString() !== node._id.toString(),
      );

      const siblingNodes = await Node.find({ _id: { $in: siblingIds } })
        .select("_id name")
        .lean()
        .exec();

      const siblingMap = new Map(
        siblingNodes.map((n) => [n._id.toString(), n]),
      );

      context.siblings = siblingIds
        .map((id) => siblingMap.get(id.toString()))
        .filter(Boolean)
        .map((n) => ({
          id: n._id.toString(),
          name: n.name,
        }));
    }
  }

  // ---- Scripts ----
  if (includeScripts && node.scripts?.length > 0) {
    context.scripts = node.scripts.map((s) => ({
      id: s._id,
      name: s.name,
    }));
  }

  // ---- Directives (future) ----
  if (includeDirectives && node.directives?.length > 0) {
    context.directives = node.directives;
  }

  return context;
}
