// TreeOS Seed . AGPL-3.0 . https://treeos.ai
/**
 * Pure data query functions for tree nodes.
 * No req/res. No route handlers. Just data in, data out.
 *
 * Route handlers live in routes/api/. This file is kernel-only.
 *
 * All recursive traversals are capped by depth and node count.
 * No function in this file can trigger unbounded DB queries.
 */

import log from "../log.js";
import Node from "../models/node.js";
import Note from "../models/note.js";
import Contribution from "../models/contribution.js";
import { NODE_STATUS, CONTENT_TYPE } from "../protocol.js";
import { getLandConfigValue } from "../landConfig.js";

// Configurable caps. Read at call time so config changes take effect.
function maxTreeDepth() { return Number(getLandConfigValue("treeSummaryMaxDepth")) || 4; }
function maxTreeNodes() { return Number(getLandConfigValue("treeSummaryMaxNodes")) || 60; }
function maxNotesPerQuery() { return Math.min(Number(getLandConfigValue("noteQueryLimit")) || 5000, 50000); }
function maxAncestorDepth() { return Math.max(5, Math.min(Number(getLandConfigValue("treeAncestorDepth")) || 50, 200)); }
function maxContributionsPerNode() { return Math.max(10, Math.min(Number(getLandConfigValue("treeContributionsPerNode")) || 500, 10000)); }
function maxNotesPerNodeQuery() { return Math.max(10, Math.min(Number(getLandConfigValue("treeNotesPerNode")) || 100, 1000)); }
function maxChildrenResolve() { return Math.max(10, Math.min(Number(getLandConfigValue("treeMaxChildrenResolve")) || 200, 1000)); }
function maxAllDataDepth() { return Math.max(5, Math.min(Number(getLandConfigValue("treeAllDataDepth")) || 20, 50)); }
const MAX_STRIP_DEPTH = 10; // not configurable, internal safety

/**
 * Get a node's name by ID.
 */
export async function getNodeName(nodeId) {
  if (!nodeId) return null;
  const doc = await Node.findById(nodeId, "name").lean();
  return doc?.name || null;
}

/**
 * Get a node formatted for AI consumption.
 * Notes capped. Children resolved by name only (no recursive load).
 */
export async function getNodeForAi(nodeId) {
  if (!nodeId) throw new Error("Node ID is required");

  const node = await Node.findById(nodeId).lean();
  if (!node) throw new Error(`Node ${nodeId} not found`);

  const notes = await Note.find({ nodeId: node._id, contentType: CONTENT_TYPE.TEXT })
    .populate("userId", "username -_id")
    .sort({ createdAt: -1 })
    .limit(maxNotesPerNodeQuery())
    .lean();

  const parentNodeId = node.parent ? node.parent.toString() : null;
  const parentName = parentNodeId ? await getNodeName(parentNodeId) : "None. Root";

  const children = Array.isArray(node.children)
    ? await Promise.all(
        node.children.slice(0, maxChildrenResolve()).map(async (childId) => ({
          id: childId.toString(),
          name: (await getNodeName(childId)) || "Unknown",
        })),
      )
    : [];

  const result = {
    id: node._id.toString(),
    name: node.name,
    status: node.status || NODE_STATUS.ACTIVE,
    parentNodeId,
    parentName,
    children,
    notes: notes.map(n => ({
      username: n.userId?.username || "Unknown",
      content: n.content,
    })),
  };

  if (node.type) result.type = node.type;

  return result;
}

/**
 * Get a simplified tree for AI consumption.
 * Depth and node count capped via config (treeSummaryMaxDepth, treeSummaryMaxNodes).
 * Returns JSON string of { tree: { id, name, type?, children[] } }
 */
export async function getTreeForAi(rootId, filter = null) {
  if (!rootId) throw new Error("Root node ID is required");

  const depthCap = maxTreeDepth();
  const nodeCap = maxTreeNodes();
  let nodeCount = 0;

  const filters = !filter
    ? { [NODE_STATUS.ACTIVE]: true, [NODE_STATUS.TRIMMED]: false, [NODE_STATUS.COMPLETED]: true }
    : { [NODE_STATUS.ACTIVE]: !!filter.active, [NODE_STATUS.TRIMMED]: !!filter.trimmed, [NODE_STATUS.COMPLETED]: !!filter.completed };

  const allowedStatuses = new Set();
  if (filters[NODE_STATUS.ACTIVE]) allowedStatuses.add(NODE_STATUS.ACTIVE);
  if (filters[NODE_STATUS.TRIMMED]) allowedStatuses.add(NODE_STATUS.TRIMMED);
  if (filters[NODE_STATUS.COMPLETED]) allowedStatuses.add(NODE_STATUS.COMPLETED);

  async function buildNode(nodeId, depth) {
    if (depth > depthCap || nodeCount >= nodeCap) return null;

    const node = await Node.findById(nodeId).select("_id name type status children").lean();
    if (!node) return null;

    const status = node.status || NODE_STATUS.ACTIVE;
    if (!allowedStatuses.has(status)) return null;

    nodeCount++;
    const simplified = { id: node._id.toString(), name: node.name?.replace(/\s+/g, " ").trim() };
    if (node.type) simplified.type = node.type;

    if (node.children?.length > 0 && depth < depthCap && nodeCount < nodeCap) {
      const kids = [];
      for (const childId of node.children) {
        if (nodeCount >= nodeCap) break;
        const child = await buildNode(childId, depth + 1);
        if (child) kids.push(child);
      }
      if (kids.length > 0) simplified.children = kids;
    }

    return simplified;
  }

  const tree = await buildNode(rootId, 0);
  if (!tree) return JSON.stringify({});
  return JSON.stringify({ tree });
}

/**
 * Get tree structure (lightweight, just IDs, names, types, status).
 * Uses iterative traversal with depth and node caps.
 */
export async function getTreeStructure(rootId, filters = {}) {
  if (!rootId) throw new Error("Root node ID is required");

  const FIELDS = "_id name type status children parent systemRole";
  const depthCap = maxTreeDepth() + 2; // structure needs slightly more depth than AI summary
  const nodeCap = maxTreeNodes() * 5; // structure serves HTML, needs more nodes

  const allowedStatuses = [];
  if (filters.active !== false) allowedStatuses.push(NODE_STATUS.ACTIVE);
  if (filters.trimmed === true) allowedStatuses.push(NODE_STATUS.TRIMMED);
  if (filters.completed !== false) allowedStatuses.push(NODE_STATUS.COMPLETED);

  let nodeCount = 0;

  async function buildNode(nodeId, depth) {
    if (depth > depthCap || nodeCount >= nodeCap) return null;

    const node = await Node.findById(nodeId).select(FIELDS).lean();
    if (!node) return null;

    nodeCount++;
    const status = node.status || NODE_STATUS.ACTIVE;

    const children = [];
    if (node.children?.length > 0 && depth < depthCap && nodeCount < nodeCap) {
      for (const childId of node.children) {
        if (nodeCount >= nodeCap) break;
        const child = await buildNode(childId, depth + 1);
        if (child) children.push(child);
      }
    }

    // Filter: skip nodes with wrong status and no children (never skip the root)
    if (depth > 0 && !allowedStatuses.includes(status) && children.length === 0) return null;

    return { _id: node._id, name: node.name, type: node.type || null, status, parent: node.parent, children };
  }

  const rootNode = await buildNode(rootId, 0);
  if (!rootNode) throw new Error("Node not found");

  // Ancestors (capped)
  const ancestors = [];
  let currentId = rootNode.parent;
  let ancestorDepth = 0;
  while (currentId && ancestorDepth < maxAncestorDepth()) {
    const parentNode = await Node.findById(currentId).select("_id name parent systemRole").lean();
    if (!parentNode || parentNode.systemRole) break;
    ancestors.push(parentNode);
    currentId = parentNode.parent;
    ancestorDepth++;
  }
  rootNode.ancestors = ancestors;

  return rootNode;
}

/**
 * Get full node data with contributions, notes, ancestors, and status filtering.
 * Contributions and notes capped per node. Total nodes capped.
 */
export async function getAllNodeData(rootId, filters = {}) {
  if (!rootId) throw new Error("Root node ID is required");

  const nodeCap = maxTreeNodes() * 10;
  let nodeCount = 0;

  async function buildNode(nodeId, depth) {
    if (depth > maxAllDataDepth() || nodeCount >= nodeCap) return null;

    let node = await Node.findById(nodeId).lean();
    if (!node) return null;

    nodeCount++;
    node = stripMetadataSecrets(node);

    node.contributions = await Contribution.find({ nodeId: node._id })
      .sort({ date: -1 })
      .limit(maxContributionsPerNode())
      .lean();

    const notes = await Note.find({ nodeId: node._id, contentType: CONTENT_TYPE.TEXT })
      .populate("userId", "username -_id")
      .sort({ createdAt: -1 })
      .limit(maxNotesPerNodeQuery())
      .lean();
    node.notes = notes.map(n => ({ username: n.userId?.username || "Unknown", content: n.content }));

    if (node.children?.length > 0) {
      const kids = [];
      for (const childId of node.children) {
        if (nodeCount >= nodeCap) break;
        const child = await buildNode(childId, depth + 1);
        if (child) kids.push(child);
      }
      node.children = kids;
    } else {
      node.children = [];
    }

    return node;
  }

  const rootNode = await buildNode(rootId, 0);
  if (!rootNode) return null;

  // Ancestors (capped)
  const ancestors = [];
  let currentId = rootNode.parent;
  let ancestorDepth = 0;
  while (currentId && ancestorDepth < maxAncestorDepth()) {
    const parentNode = await Node.findById(currentId).select("_id name parent systemRole").lean();
    if (!parentNode || parentNode.systemRole) break;
    ancestors.push(parentNode);
    currentId = parentNode.parent;
    ancestorDepth++;
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
  if (filters[NODE_STATUS.ACTIVE] === true) allowedStatuses.push(NODE_STATUS.ACTIVE);
  if (filters[NODE_STATUS.TRIMMED] === true) allowedStatuses.push(NODE_STATUS.TRIMMED);
  if (filters[NODE_STATUS.COMPLETED] === true) allowedStatuses.push(NODE_STATUS.COMPLETED);

  const filteringEnabled =
    filters[NODE_STATUS.ACTIVE] !== undefined || filters[NODE_STATUS.TRIMMED] !== undefined || filters[NODE_STATUS.COMPLETED] !== undefined;

  const status = node.status || NODE_STATUS.ACTIVE;
  const filteredChildren = node.children?.map(child => filterTreeByStatus(child, filters)).filter(Boolean) || [];

  if (!filteringEnabled) return { ...node, children: filteredChildren };

  const nodeMatches = allowedStatuses.includes(status);
  if (!nodeMatches && filteredChildren.length === 0) return null;

  return { ...node, children: filteredChildren };
}

// ─────────────────────────────────────────────────────────────────────────
// METADATA SECRET STRIPPING
// ─────────────────────────────────────────────────────────────────────────

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
    const cleaned = stripDeep(data, 0);
    if (cleaned !== data) {
      meta[ns] = cleaned;
      changed = true;
    }
  }

  if (changed) node.metadata = meta;
  return node;
}

function stripDeep(obj, depth) {
  if (!obj || typeof obj !== "object" || depth > MAX_STRIP_DEPTH) return obj;
  if (Array.isArray(obj)) return obj.map(item => stripDeep(item, depth + 1));

  const result = {};
  let stripped = false;
  for (const [key, val] of Object.entries(obj)) {
    if (isSensitiveKey(key)) { stripped = true; continue; }
    result[key] = val && typeof val === "object" ? stripDeep(val, depth + 1) : val;
  }
  return stripped ? result : obj;
}
