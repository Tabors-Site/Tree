import Node from "../../db/models/node.js";

/**
 * Check if a tree's visibility allows public access.
 */
export function isPublic(visibility) {
  return visibility === "public";
}

/**
 * Walk from any node up to its root and return public access info.
 * Returns null if the node/tree doesn't exist or is a system tree.
 */
export async function resolvePublicRoot(nodeId) {
  if (!nodeId) return null;

  let node = await Node.findById(nodeId)
    .select("parent rootOwner visibility llmAssignments")
    .lean();

  if (!node) return null;

  while (!node.rootOwner || node.rootOwner === "SYSTEM") {
    if (!node.parent) return null;

    node = await Node.findById(node.parent)
      .select("parent rootOwner visibility llmAssignments systemRole")
      .lean();

    if (!node) return null;
    if (node.systemRole) return null;
  }

  return {
    rootId: node._id.toString(),
    visibility: node.visibility || "private",
    rootOwner: node.rootOwner,
    llmAssignments: node.llmAssignments || {},
  };
}

/**
 * Check if a tree has LLM enabled (default slot set and not "none").
 */
export function hasTreeLlm(llmAssignments) {
  if (!llmAssignments) return false;
  if (llmAssignments.default === "none") return false;
  return !!(llmAssignments.default);
}
