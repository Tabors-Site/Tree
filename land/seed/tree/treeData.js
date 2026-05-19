// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
/**
 * Pure data query functions for tree nodes.
 * No req/res. No route handlers. Just data in, data out.
 *
 * Route handlers live in routes/api/. This file is kernel-only.
 *
 * All recursive traversals are capped by depth and node count.
 * No function in this file can trigger unbounded DB queries.
 */

import log from "../core/log.js";
import Node from "../models/node.js";
import Artifact from "../models/artifact.js";
import Did from "../models/did.js";
import { ARTIFACT_ORIGIN } from "../core/protocol.js";
import { getLandConfigValue } from "../landConfig.js";

// Configurable caps. Read at call time so config changes take effect.
function maxTreeDepth() { return Number(getLandConfigValue("treeSummaryMaxDepth")) || 4; }
function maxTreeNodes() { return Number(getLandConfigValue("treeSummaryMaxNodes")) || 60; }
function maxArtifactsPerQuery() { return Math.min(Number(getLandConfigValue("artifactQueryLimit")) || 5000, 50000); }
function maxAncestorDepth() { return Math.max(5, Math.min(Number(getLandConfigValue("treeAncestorDepth")) || 50, 200)); }
function maxDidsPerNode() { return Math.max(10, Math.min(Number(getLandConfigValue("treeDidsPerNode")) || 500, 10000)); }
function maxArtifactsPerNodeQuery() { return Math.max(10, Math.min(Number(getLandConfigValue("treeArtifactsPerNode")) || 100, 1000)); }
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
 * Artifacts capped. Children resolved by name only (no recursive load).
 */
export async function getNodeForAi(nodeId) {
  if (!nodeId) throw new Error("Node ID is required");

  const node = await Node.findById(nodeId).lean();
  if (!node) throw new Error(`Node ${nodeId} not found`);

  const artifacts = await Artifact.find({ nodeId: node._id, origin: ARTIFACT_ORIGIN.IBP })
    .populate("beingId", "name -_id")
    .sort({ createdAt: -1 })
    .limit(maxArtifactsPerNodeQuery())
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
    parentNodeId,
    parentName,
    children,
    artifacts: artifacts.map(a => ({
      name: a.beingId?.name || "Unknown",
      content: a.content,
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
export async function getTreeForAi(rootId, _filter = null) {
  if (!rootId) throw new Error("Root node ID is required");

  const depthCap = maxTreeDepth();
  const nodeCap = maxTreeNodes();
  let nodeCount = 0;

  // Status filtering retired with Node.status (kernel doesn't claim a
  // universal state machine). Callers that need to hide subsets at a
  // position should set domain-specific metadata flags via extensions
  // and filter at consumption time.

  async function buildNode(nodeId, depth) {
    if (depth > depthCap || nodeCount >= nodeCap) return null;

    const node = await Node.findById(nodeId).select("_id name type children").lean();
    if (!node) return null;

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
 *
 * filters.includeMetadata: when true, attaches the node's metadata
 * to each entry. Default off (the structure stays slim for callers
 * that just want the shape). HTML overview pages and the CLI tree
 * view opt in so they can render Ruler crowns and other extension
 * markers (governing.role, swarm.role, etc.).
 */
export async function getTreeStructure(rootId, filters = {}) {
  if (!rootId) throw new Error("Root node ID is required");

  const includeMetadata = filters.includeMetadata === true;
  const FIELDS = includeMetadata
    ? "_id name type children parent systemRole metadata"
    : "_id name type children parent systemRole";
  const depthCap = maxTreeDepth() + 2; // structure needs slightly more depth than AI summary
  const nodeCap = maxTreeNodes() * 5; // structure serves HTML, needs more nodes

  let nodeCount = 0;

  async function buildNode(nodeId, depth) {
    if (depth > depthCap || nodeCount >= nodeCap) return null;

    const node = await Node.findById(nodeId).select(FIELDS).lean();
    if (!node) return null;

    nodeCount++;

    const children = [];
    if (node.children?.length > 0 && depth < depthCap && nodeCount < nodeCap) {
      for (const childId of node.children) {
        if (nodeCount >= nodeCap) break;
        const child = await buildNode(childId, depth + 1);
        if (child) children.push(child);
      }
    }

    const out = { _id: node._id, name: node.name, type: node.type || null, parent: node.parent, children };
    if (includeMetadata && node.metadata) out.metadata = node.metadata;
    return out;
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
 * Get full node data with contributions, artifacts, ancestors, and status filtering.
 * Contributions and artifacts capped per node. Total nodes capped.
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

    node.contributions = await Did.find({ nodeId: node._id })
      .sort({ date: -1 })
      .limit(maxDidsPerNode())
      .lean();

    const artifacts = await Artifact.find({ nodeId: node._id, origin: ARTIFACT_ORIGIN.IBP })
      .populate("beingId", "name -_id")
      .sort({ createdAt: -1 })
      .limit(maxArtifactsPerNodeQuery())
      .lean();
    node.artifacts = artifacts.map(a => ({ name: a.beingId?.name || "Unknown", content: a.content }));

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

  // Status filtering retired with Node.status; return the populated tree.
  return rootNode;
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
