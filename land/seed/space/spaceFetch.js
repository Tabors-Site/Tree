// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Tree-path query helpers. Four small read primitives:
//
//   getNodeName       lookup a node's display name by id
//   buildPathString   human-readable "Root > Branch > Leaf" path for a node
//   resolveRootNode   walk to the rootOwner-bearing tree root
//   isDescendant      check whether one node sits beneath another

import Node from "../models/node.js";
import { SYSTEM_OWNER } from "../core/protocol.js";
import { getAncestorChain } from "./ancestorCache.js";

/**
 * Get a node's name by ID. Returns null if not found.
 */
export async function getNodeName(nodeId) {
  if (!nodeId) return null;
  const doc = await Node.findById(nodeId, "name").lean();
  return doc?.name || null;
}

/**
 * Build the display path "Root > Branch > Leaf" for a node. Walks the
 * ancestor cache once; sub-paths share entries across calls.
 */
export async function buildPathString(nodeId) {
  const chain = await getAncestorChain(nodeId);
  if (!chain || chain.length === 0) return "";
  const segments = [];
  for (const ancestor of chain) {
    if (ancestor.systemRole) break;
    if (ancestor.name) segments.push(ancestor.name);
  }
  // Chain is ordered node-to-root. Path is root-to-node.
  segments.reverse();
  return segments.join(" > ");
}

/**
 * Walk up the parent chain to the rootOwner-bearing tree root. The
 * .source self-tree counts as its own root (everything beneath it is
 * navigable but the tree-ownership boundary is .source itself).
 */
export async function resolveRootNode(nodeId) {
  if (!nodeId) throw new Error("nodeId is required");

  let node = await Node.findById(nodeId)
    .select("parent rootOwner contributors systemRole")
    .lean()
    .exec();

  if (!node) throw new Error("Node not found");
  if (node.systemRole === "source") return node;

  while (!node.rootOwner || node.rootOwner === SYSTEM_OWNER) {
    if (!node.parent) throw new Error("Invalid tree: no rootOwner found");
    node = await Node.findById(node.parent)
      .select("parent rootOwner contributors systemRole")
      .lean()
      .exec();
    if (!node) throw new Error("Broken tree");
    if (node.systemRole) {
      if (node.systemRole === "source") return node;
      throw new Error("Invalid tree: reached system node boundary");
    }
  }
  return node;
}

/**
 * Does `nodeId` sit beneath `ancestorId`? Walks up from `nodeId`,
 * stopping at depth 100 (safety cap).
 */
export async function isDescendant(ancestorId, nodeId) {
  let current = await Node.findById(nodeId).select("parent").lean();
  let depth = 0;
  const maxDepth = 100;
  while (current && current.parent && depth < maxDepth) {
    if (current.parent.toString() === ancestorId.toString()) return true;
    current = await Node.findById(current.parent).select("parent").lean();
    depth++;
  }
  return false;
}
