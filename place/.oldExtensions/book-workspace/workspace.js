// Book workspace helpers. Small surface: initialize a project, promote
// a node's role, find the book project ancestor, walk chapter order.
//
// metadata.book-workspace namespace:
//   role: "project" | "part" | "chapter" | "scene"
//   title: human title (can differ from node name for ordering)
//   order: sort order within its siblings (optional; falls back to tree order)
//   targetWordCount: soft target for the leaf (chapter or scene)
//   lastDraftAt: ISO timestamp of most recent prose write
//
// The node `name` stays filesystem-like (e.g. "01-the-stale-kitchen") so
// the tree sorts naturally; `title` is the human-readable version shown
// in the compiled book.

import Node from "../../seed/models/node.js";
import log from "../../seed/log.js";

export const NS = "book-workspace";

function readMeta(node) {
  if (!node?.metadata) return null;
  if (node.metadata instanceof Map) return node.metadata.get(NS) || null;
  return node.metadata[NS] || null;
}

async function mutateMeta(nodeId, mutator, core) {
  if (!nodeId || typeof mutator !== "function") return null;
  try {
    const node = await Node.findById(nodeId);
    if (!node) return null;
    const current = readMeta(node) || {};
    const draft = { ...current };
    const out = mutator(draft) || draft;
    if (core?.metadata?.setExtMeta) {
      await core.metadata.setExtMeta(node, NS, out);
    } else {
      await Node.updateOne(
        { _id: node._id },
        { $set: { [`metadata.${NS}`]: out } },
      );
    }
    return out;
  } catch (err) {
    log.warn("BookWorkspace", `mutateMeta ${nodeId} failed: ${err.message}`);
    return null;
  }
}

export { readMeta, mutateMeta };

/**
 * Initialize a book project at `projectNodeId`. Idempotent. Sets role,
 * title (from the initial request or the node name), genre hint, and
 * initialized flag. Does NOT touch swarm state — swarm.ensureProject
 * handles that side.
 */
export async function initProject({ projectNodeId, title, description, core }) {
  return mutateMeta(projectNodeId, (draft) => {
    draft.role = "project";
    draft.initialized = true;
    draft.title = title || draft.title || null;
    if (description) draft.description = description;
    draft.initializedAt = draft.initializedAt || new Date().toISOString();
    return draft;
  }, core);
}

/**
 * Walk upward from any node, return the nearest book project. Null if
 * no book project exists in the ancestor chain.
 */
export async function findProjectForNode(nodeId) {
  let cursor = String(nodeId || "");
  let guard = 0;
  while (cursor && guard < 64) {
    const n = await Node.findById(cursor).select("_id name parent metadata").lean();
    if (!n) return null;
    const meta = readMeta(n);
    if (meta?.role === "project" && meta?.initialized) return n;
    if (!n.parent) return null;
    cursor = String(n.parent);
    guard++;
  }
  return null;
}

/**
 * Stamp a node with its role (part / chapter / scene) and metadata
 * (title, targetWordCount, order). Used by plan mode to scaffold
 * branch nodes with their authorial identity before swarm dispatches.
 */
export async function stampRole({ nodeId, role, title, order, targetWordCount, core }) {
  if (!nodeId || !role) return null;
  return mutateMeta(nodeId, (draft) => {
    draft.role = role;
    if (title != null) draft.title = title;
    if (order != null) draft.order = order;
    if (targetWordCount != null) draft.targetWordCount = targetWordCount;
    return draft;
  }, core);
}

/**
 * Count how many chapters (or leaves) exist under a node. Cheap
 * traversal — used by enrichContext to say "you're writing chapter 3
 * of 12".
 */
export async function countLeafChapters(projectNodeId) {
  if (!projectNodeId) return 0;
  let count = 0;
  const visited = new Set([String(projectNodeId)]);
  const queue = [String(projectNodeId)];
  let scanned = 0;
  while (queue.length > 0 && scanned < 400) {
    const id = queue.shift();
    scanned++;
    const node = await Node.findById(id).select("_id children metadata").lean();
    if (!node) continue;
    const meta = readMeta(node);
    if (meta?.role === "chapter") count++;
    if (Array.isArray(node.children)) {
      for (const kid of node.children) {
        const k = String(kid);
        if (!visited.has(k)) {
          visited.add(k);
          queue.push(k);
        }
      }
    }
  }
  return count;
}
