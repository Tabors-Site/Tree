/**
 * Study Setup
 *
 * Scaffolds the study tree. Log, Queue, Active, Completed, Gaps, Profile, History.
 * Topic and subtopic creators for the AI to build curricula conversationally.
 */

import log from "../../seed/log.js";
import { setNodeMode } from "../../seed/modes/registry.js";
import { ROLES } from "./core.js";

let _metadata = null;
let _Node = null;

export function setDeps({ metadata, Node }) {
  _metadata = metadata;
  _Node = Node;
}

// ── Base scaffold ──

export async function scaffold(rootId, userId) {
  if (!_Node) throw new Error("Study core not configured");
  const { createNode } = await import("../../seed/tree/treeManagement.js");

  const logNode = await createNode({ name: "Log", parentId: rootId, userId });
  const queueNode = await createNode({ name: "Queue", parentId: rootId, userId });
  const activeNode = await createNode({ name: "Active", parentId: rootId, userId });
  const completedNode = await createNode({ name: "Completed", parentId: rootId, userId });
  const gapsNode = await createNode({ name: "Gaps", parentId: rootId, userId });
  const profileNode = await createNode({ name: "Profile", parentId: rootId, userId });
  const historyNode = await createNode({ name: "History", parentId: rootId, userId });

  const nodes = [
    { node: logNode, role: ROLES.LOG },
    { node: queueNode, role: ROLES.QUEUE },
    { node: activeNode, role: ROLES.ACTIVE },
    { node: completedNode, role: ROLES.COMPLETED },
    { node: gapsNode, role: ROLES.GAPS },
    { node: profileNode, role: ROLES.PROFILE },
    { node: historyNode, role: ROLES.HISTORY },
  ];

  for (const { node, role } of nodes) {
    await _metadata.setExtMeta(node, "study", { role });
  }

  // Mode overrides
  await setNodeMode(rootId, "respond", "tree:study-coach");
  await setNodeMode(logNode._id, "respond", "tree:study-log");

  // Mark initialized with base phase
  const root = await _Node.findById(rootId);
  if (root) {
    await _metadata.setExtMeta(root, "study", { initialized: true, setupPhase: "complete" });
  }

  log.info("Study", "Scaffolded: Log, Queue, Active, Completed, Gaps, Profile, History");

  return {
    log: String(logNode._id),
    queue: String(queueNode._id),
    active: String(activeNode._id),
    completed: String(completedNode._id),
    gaps: String(gapsNode._id),
    profile: String(profileNode._id),
    history: String(historyNode._id),
  };
}

// ── Topic creators (AI calls these via tools) ──

export async function addTopic(activeNodeId, topicName, userId) {
  const { createNode } = await import("../../seed/tree/treeManagement.js");
  const topicNode = await createNode({ name: topicName, parentId: activeNodeId, userId });
  await _metadata.setExtMeta(topicNode, "study", { role: ROLES.TOPIC, lastStudied: new Date().toISOString() });

  // Create Resources child under topic
  const resourcesNode = await createNode({ name: "Resources", parentId: topicNode._id, userId });
  await _metadata.setExtMeta(resourcesNode, "study", { role: ROLES.RESOURCES });

  return { id: String(topicNode._id), name: topicName };
}

export async function addSubtopic(topicId, subtopicName, userId, opts = {}) {
  const { createNode } = await import("../../seed/tree/treeManagement.js");
  const subNode = await createNode({ name: subtopicName, parentId: topicId, userId });

  await _metadata.setExtMeta(subNode, "study", {
    role: ROLES.SUBTOPIC,
    order: opts.order || 0,
    prerequisites: opts.prerequisites || [],
  });

  // Initialize mastery values
  await _metadata.batchSetExtMeta(subNode._id, "values", {
    mastery: 0,
    attempts: 0,
    lastStudied: null,
  });

  return { id: String(subNode._id), name: subtopicName };
}

export async function completeSetup(rootId) {
  const root = await _Node.findById(rootId);
  if (!root) return;
  const existing = _metadata.getExtMeta(root, "study") || {};
  await _metadata.setExtMeta(root, "study", { ...existing, setupPhase: "complete" });
  log.info("Study", "Setup complete");
}

export async function saveProfile(rootId, profile) {
  const { findStudyNodes } = await import("./core.js");
  const nodes = await findStudyNodes(rootId);
  if (!nodes?.profile) return;

  const profileNode = await _Node.findById(nodes.profile.id);
  if (profileNode) {
    await _metadata.setExtMeta(profileNode, "study", {
      role: ROLES.PROFILE,
      profile,
    });
  }

  // Also mark setup as complete if it was base
  const root = await _Node.findById(rootId);
  if (root) {
    const existing = _metadata.getExtMeta(root, "study") || {};
    if (existing.setupPhase === "base") {
      await _metadata.setExtMeta(root, "study", { ...existing, setupPhase: "complete" });
    }
  }
}
