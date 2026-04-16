/**
 * Project lookup helpers shared between routes and the slot handler.
 *
 * Policy (per operator intent): the Run button lives on the project ROOT
 * node only, not on descendant files or directories. So `isProjectRoot`
 * checks the node itself, and `loadProject` loads that node's record for
 * the spawner. We do NOT walk ancestors — if the user is on a child file
 * node, we intentionally return null and hide the button.
 */

import Node from "../../../seed/models/node.js";
import path from "path";
import { DEFAULT_WORKSPACE_ROOT } from "../workspace.js";

const NS = "code-workspace";

function readMeta(node, ns = NS) {
  if (!node?.metadata) return null;
  if (node.metadata instanceof Map) return node.metadata.get(ns) || null;
  return node.metadata[ns] || null;
}

/**
 * Load the project node. Returns the lean doc only if this exact node is
 * an initialized code-workspace project. Null otherwise.
 */
export async function loadProjectNode(nodeId) {
  if (!nodeId) return null;
  const node = await Node.findById(nodeId).select("_id name metadata").lean();
  if (!node) return null;
  const data = readMeta(node);
  if (!data) return null;
  if (data.role !== "project") return null;
  if (!data.initialized) return null;
  return node;
}

/**
 * Compute the on-disk workspace path for a project. Uses the stored
 * workspacePath if present, otherwise falls back to the default convention.
 */
export function workspacePathFor(projectNode) {
  const data = readMeta(projectNode);
  if (data?.workspacePath) return data.workspacePath;
  return path.join(DEFAULT_WORKSPACE_ROOT, String(projectNode._id));
}
