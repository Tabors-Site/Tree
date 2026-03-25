// TreeOS Seed . AGPL-3.0 . https://treeos.ai
/**
 * Pure data query functions for tree nodes.
 * No req/res. No route handlers. Just data in, data out.
 *
 * Route handlers live in routes/api/. This file is kernel-only.
 */

import log from "../log.js";
import Node from "../models/node.js";
import Note from "../models/note.js";
import Contribution from "../models/contribution.js";

/**
 * Get a node's name by ID.
 */
export async function getNodeName(nodeId) {
  const doc = await Node.findById(nodeId, "name").lean();
  return doc?.name || null;
}

/**
 * Get a node formatted for AI consumption.
 * Returns: { id, name, status, type, parentNodeId, parentName, children, notes, values, goals }
 */
export async function getNodeForAi(nodeId) {
  if (!nodeId) throw new Error("Node ID is required");

  const node = await Node.findById(nodeId).lean().exec();
  if (!node) throw new Error(`Node ${nodeId} not found`);

  const notes = await Note.find({ nodeId: node._id, contentType: "text" })
    .populate("userId", "username -_id")
    .lean()
    .exec();

  const parentNodeId = node.parent ? node.parent.toString() : null;
  const parentName = parentNodeId ? await getNodeName(parentNodeId) : "None. Root";

  const children = Array.isArray(node.children)
    ? await Promise.all(
        node.children.map(async (childId) => ({
          id: childId.toString(),
          name: (await getNodeName(childId)) || "Unknown",
        })),
      )
    : [];

  const meta = node.metadata instanceof Map ? Object.fromEntries(node.metadata) : (node.metadata || {});
  const values = meta.values || {};
  const goals = meta.goals || {};

  const result = {
    id: node._id.toString(),
    name: node.name,
    status: node.status || "active",
    parentNodeId,
    parentName,
    children,
    notes: notes.map((n) => ({
      username: n.userId?.username || "Unknown",
      content: n.content,
    })),
  };

  if (node.type) result.type = node.type;
  if (Object.keys(values).length > 0) result.values = values;
  if (Object.keys(goals).length > 0) result.goals = goals;

  return result;
}

/**
 * Get a simplified tree for AI consumption.
 * Returns JSON string of { tree: { id, name, type?, children[] } }
 */
export async function getTreeForAi(rootId, filter = null) {
  if (!rootId) throw new Error("Root node ID is required");

  const rootNode = await Node.findById(rootId).populate("children").exec();
  if (!rootNode) throw new Error("Node not found");

  const filters = !filter
    ? { active: true, trimmed: false, completed: true }
    : { active: !!filter.active, trimmed: !!filter.trimmed, completed: !!filter.completed };

  const populateChildrenRecursive = async (node) => {
    if (node.children?.length > 0) {
      node.children = await Node.populate(node.children, { path: "children" });
      for (const child of node.children) {
        await populateChildrenRecursive(child);
      }
    }
  };

  await populateChildrenRecursive(rootNode);

  const filtered = filterTreeByStatus(
    rootNode.toObject ? rootNode.toObject() : rootNode,
    filters,
  );

  if (!filtered) return JSON.stringify({});

  const simplifyNode = async (node) => {
    const simplified = {
      id: node._id.toString(),
      name: node.name?.replace(/\s+/g, " ").trim(),
    };
    if (node.type) simplified.type = node.type;
    if (node.children?.length > 0) {
      simplified.children = [];
      for (const child of node.children) {
        simplified.children.push(await simplifyNode(child));
      }
    }
    return simplified;
  };

  const tree = await simplifyNode(filtered);
  return JSON.stringify({ tree });
}

/**
 * Get tree structure (lightweight, just IDs, names, types, status).
 */
export async function getTreeStructure(rootId, filters = {}) {
  if (!rootId) throw new Error("Root node ID is required");

  const FIELDS = "_id name type status children parent systemRole";

  const populateRecursive = async (nodeId) => {
    const node = await Node.findById(nodeId)
      .select(FIELDS)
      .populate("children", FIELDS)
      .lean()
      .exec();
    if (!node) return null;

    if (node.children?.length > 0) {
      const populated = [];
      for (const child of node.children) {
        const childData = await populateRecursive(child._id);
        if (childData) populated.push(childData);
      }
      node.children = populated;
    }
    return node;
  };

  const rootNode = await populateRecursive(rootId);
  if (!rootNode) throw new Error("Node not found");

  const ancestors = [];
  let currentId = rootNode.parent?._id || rootNode.parent;
  while (currentId) {
    const parentNode = await Node.findById(currentId).select("_id name parent systemRole").lean().exec();
    if (!parentNode || parentNode.systemRole) break;
    ancestors.push(parentNode);
    currentId = parentNode.parent;
  }
  rootNode.ancestors = ancestors;

  const allowedStatuses = [];
  if (filters.active !== false) allowedStatuses.push("active");
  if (filters.trimmed === true) allowedStatuses.push("trimmed");
  if (filters.completed !== false) allowedStatuses.push("completed");

  const filterAndFlatten = (node, isRoot = false) => {
    const status = node.status || "active";
    const children = (node.children || []).map((c) => filterAndFlatten(c, false)).filter(Boolean);
    if (!isRoot && !allowedStatuses.includes(status) && children.length === 0) return null;
    return { _id: node._id, name: node.name, type: node.type || null, status, parent: node.parent, children };
  };

  return filterAndFlatten(rootNode, true);
}

/**
 * Get full node data with contributions, notes, ancestors, and status filtering.
 * Returns the root node object with all children populated recursively.
 */
export async function getAllNodeData(rootId, filters = {}) {
  if (!rootId) throw new Error("Root node ID is required");

  const populateNodeRecursive = async (nodeId) => {
    let node = await Node.findById(nodeId).populate("children").lean().exec();
    if (!node) return null;

    node = stripMetadataSecrets(node);

    const contributions = await Contribution.find({ nodeId: node._id }).exec();
    node.contributions = contributions;

    const notes = await Note.find({ nodeId: node._id, contentType: "text" })
      .populate("userId", "username -_id").lean().exec();
    node.notes = notes.map((n) => ({ username: n.userId?.username || "Unknown", content: n.content }));

    if (node.children?.length > 0) {
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
  if (!rootNode) return null;

  const ancestors = [];
  let currentId = rootNode.parent?._id || rootNode.parent;
  while (currentId) {
    const parentNode = await Node.findById(currentId).select("_id name parent systemRole").lean().exec();
    if (!parentNode || parentNode.systemRole) break;
    ancestors.push(parentNode);
    currentId = parentNode.parent;
  }
  rootNode.ancestors = ancestors;

  const statusFilters = {
    active: filters.active !== undefined ? filters.active : true,
    trimmed: filters.trimmed !== undefined ? filters.trimmed : false,
    completed: filters.completed !== undefined ? filters.completed : true,
  };

  const filteredChildren = filterTreeByStatus({ ...rootNode, children: rootNode.children }, statusFilters)?.children ?? [];
  return { ...rootNode, children: filteredChildren };
}

/**
 * Filter a populated tree by status.
 */
export function filterTreeByStatus(node, filters) {
  if (!node) return null;

  const allowedStatuses = [];
  if (filters.active === true) allowedStatuses.push("active");
  if (filters.trimmed === true) allowedStatuses.push("trimmed");
  if (filters.completed === true) allowedStatuses.push("completed");

  const filteringEnabled =
    filters.active !== undefined || filters.trimmed !== undefined || filters.completed !== undefined;

  const status = node.status || "active";
  const filteredChildren = node.children?.map((child) => filterTreeByStatus(child, filters)).filter(Boolean) || [];

  if (!filteringEnabled) return { ...node, children: filteredChildren };

  const nodeMatches = allowedStatuses.includes(status);
  if (!nodeMatches && filteredChildren.length === 0) return null;

  return { ...node, children: filteredChildren };
}

/**
 * Strip sensitive fields from node metadata before sending to clients.
 */
// Suffix-match sensitive keys. Covers future extensions without kernel changes.
const SENSITIVE_SUFFIXES = ["key", "secret", "token", "password", "mnemonic", "phrase"];
function isSensitiveKey(key) {
  const lower = key.toLowerCase();
  return SENSITIVE_SUFFIXES.some(s => lower.endsWith(s));
}

export function stripMetadataSecrets(node) {
  if (!node) return node;
  const meta = node.metadata instanceof Map ? Object.fromEntries(node.metadata) : (node.metadata || {});
  let changed = false;

  for (const [ns, data] of Object.entries(meta)) {
    if (!data || typeof data !== "object") continue;
    const cleaned = stripDeep(data);
    if (cleaned !== data) {
      meta[ns] = cleaned;
      changed = true;
    }
  }

  if (changed) node.metadata = meta;
  return node;
}

function stripDeep(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(item => stripDeep(item));

  const result = {};
  let stripped = false;
  for (const [key, val] of Object.entries(obj)) {
    if (isSensitiveKey(key)) { stripped = true; continue; }
    result[key] = val && typeof val === "object" ? stripDeep(val) : val;
  }
  return stripped ? result : obj;
}
