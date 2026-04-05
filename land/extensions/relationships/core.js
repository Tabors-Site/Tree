/**
 * Relationships Core
 *
 * People in your life. Track who matters. The tree notices.
 */

import log from "../../seed/log.js";
import { setNodeMode } from "../../seed/modes/registry.js";

let _Node = null;
let _Note = null;
let _metadata = null;

export function configure({ Node, Note, metadata }) {
  _Node = Node;
  _Note = Note;
  _metadata = metadata;
}

const ROLES = {
  LOG: "log",
  PEOPLE: "people",
  IDEAS: "ideas",
  PROFILE: "profile",
  HISTORY: "history",
};

export { ROLES };

// ── Scaffold ──

export async function scaffold(rootId, userId) {
  if (!_Node) throw new Error("Relationships core not configured");
  const { createNode } = await import("../../seed/tree/treeManagement.js");

  const logNode = await createNode({ name: "Log", parentId: rootId, userId });
  const peopleNode = await createNode({ name: "People", parentId: rootId, userId });
  const ideasNode = await createNode({ name: "Ideas", parentId: rootId, userId });
  const profileNode = await createNode({ name: "Profile", parentId: rootId, userId });
  const historyNode = await createNode({ name: "History", parentId: rootId, userId });

  const tags = [
    [logNode, ROLES.LOG],
    [peopleNode, ROLES.PEOPLE],
    [ideasNode, ROLES.IDEAS],
    [profileNode, ROLES.PROFILE],
    [historyNode, ROLES.HISTORY],
  ];

  for (const [node, role] of tags) {
    await _metadata.setExtMeta(node, "relationships", { role });
  }

  await setNodeMode(rootId, "respond", "tree:relationships-coach");
  await setNodeMode(logNode._id, "respond", "tree:relationships-log");

  const root = await _Node.findById(rootId);
  if (root) {
    await _metadata.setExtMeta(root, "relationships", {
      initialized: true,
      setupPhase: "complete",
    });
  }

  const ids = {};
  for (const [node, role] of tags) ids[role] = String(node._id);

  log.info("Relationships", `Scaffolded under ${rootId}`);
  return ids;
}

// ── Find nodes ──

export async function findRelNodes(rootId) {
  if (!_Node) return null;
  const children = await _Node.find({ parent: rootId }).select("_id name metadata").lean();
  const result = {};
  for (const child of children) {
    const meta = child.metadata instanceof Map
      ? child.metadata.get("relationships")
      : child.metadata?.relationships;
    if (meta?.role) result[meta.role] = { id: String(child._id), name: child.name };
  }
  return result;
}

export async function isInitialized(rootId) {
  if (!_Node) return false;
  const root = await _Node.findById(rootId).select("metadata").lean();
  if (!root) return false;
  const meta = root.metadata instanceof Map
    ? root.metadata.get("relationships")
    : root.metadata?.relationships;
  return !!meta?.initialized;
}

export async function getSetupPhase(rootId) {
  if (!_Node) return null;
  const root = await _Node.findById(rootId).select("metadata").lean();
  if (!root) return null;
  const meta = root.metadata instanceof Map
    ? root.metadata.get("relationships")
    : root.metadata?.relationships;
  return meta?.setupPhase || (meta?.initialized ? "complete" : null);
}

export async function completeSetup(rootId) {
  const root = await _Node.findById(rootId);
  if (!root) return;
  const existing = _metadata.getExtMeta(root, "relationships") || {};
  await _metadata.setExtMeta(root, "relationships", { ...existing, setupPhase: "complete" });
}

// ── People ──

/**
 * Find or create a person node under People.
 * Returns { id, name, isNew }.
 */
export async function findOrCreatePerson(rootId, personName, userId) {
  const nodes = await findRelNodes(rootId);
  if (!nodes?.people) return null;

  const peopleId = nodes.people.id;
  const children = await _Node.find({ parent: peopleId }).select("_id name").lean();

  // Case-insensitive match
  const lower = personName.toLowerCase().trim();
  const existing = children.find(c => c.name.toLowerCase() === lower);
  if (existing) return { id: String(existing._id), name: existing.name, isNew: false };

  // Create new person node
  const { createNode } = await import("../../seed/tree/treeManagement.js");
  const node = await createNode({ name: personName.trim(), parentId: peopleId, userId });
  await _metadata.setExtMeta(node, "relationships", { role: "person" });
  log.verbose("Relationships", `Created person: ${personName}`);
  return { id: String(node._id), name: node.name, isNew: true };
}

/**
 * Get all people under this root.
 */
export async function getPeople(rootId) {
  const nodes = await findRelNodes(rootId);
  if (!nodes?.people) return [];

  const children = await _Node.find({ parent: nodes.people.id })
    .select("_id name metadata").lean();

  return children.map(c => {
    const meta = c.metadata instanceof Map
      ? c.metadata.get("relationships")
      : c.metadata?.relationships;
    return {
      id: String(c._id),
      name: c.name,
      role: meta?.role || "person",
      relation: meta?.relation || null,
      lastContact: meta?.lastContact || null,
      noteCount: meta?.noteCount || 0,
    };
  });
}

/**
 * Get recent interactions from the log.
 */
export async function getRecentInteractions(rootId, limit = 10) {
  const nodes = await findRelNodes(rootId);
  if (!nodes?.log) return [];

  const { getNotes } = await import("../../seed/tree/notes.js");
  const result = await getNotes({ nodeId: nodes.log.id, limit });
  return result?.notes || [];
}

/**
 * Get ideas (things to do for people).
 */
export async function getIdeas(rootId) {
  const nodes = await findRelNodes(rootId);
  if (!nodes?.ideas) return [];

  const { getNotes } = await import("../../seed/tree/notes.js");
  const result = await getNotes({ nodeId: nodes.ideas.id, limit: 20 });
  return result?.notes || [];
}
