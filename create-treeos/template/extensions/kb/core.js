/**
 * KB Core
 *
 * Tell it things. Ask it things. The tree organizes.
 * The AI answers from what it knows.
 */

import log from "../../seed/log.js";
import Contribution from "../../seed/models/contribution.js";
import { setNodeMode } from "../../seed/modes/registry.js";

let _Node = null;
let _Note = null;
let _runChat = null;
let _metadata = null;

export function configure({ Node, Note, runChat, metadata }) {
  _Node = Node;
  _Note = Note;
  _runChat = runChat;
  _metadata = metadata;
}

const ROLES = {
  LOG: "log",
  TOPICS: "topics",
  UNPLACED: "unplaced",
  PROFILE: "profile",
  HISTORY: "history",
};

const STALE_DAYS = 90;

// ── Scaffold ──

export async function scaffold(rootId, userId) {
  if (!_Node) throw new Error("KB core not configured");
  const { createNode } = await import("../../seed/tree/treeManagement.js");

  const logNode = await createNode({ name: "Log", parentId: rootId, userId });
  const topicsNode = await createNode({ name: "Topics", parentId: rootId, userId });
  const unplacedNode = await createNode({ name: "Unplaced", parentId: rootId, userId });
  const profileNode = await createNode({ name: "Profile", parentId: rootId, userId });
  const historyNode = await createNode({ name: "History", parentId: rootId, userId });

  const tags = [
    [logNode, ROLES.LOG],
    [topicsNode, ROLES.TOPICS],
    [unplacedNode, ROLES.UNPLACED],
    [profileNode, ROLES.PROFILE],
    [historyNode, ROLES.HISTORY],
  ];

  for (const [node, role] of tags) {
    await _metadata.setExtMeta(node, "kb", { role });
  }

  await setNodeMode(rootId, "respond", "tree:kb-tell");
  await setNodeMode(logNode._id, "respond", "tree:kb-tell");

  const root = await _Node.findById(rootId);
  if (root) {
    await _metadata.setExtMeta(root, "kb", {
      initialized: true,
      setupPhase: "base",
      profile: {
        name: root.name || "Knowledge Base",
        maintainers: [userId],
        readers: ["*"],
      },
    });
  }

  const ids = {};
  for (const [node, role] of tags) ids[role] = String(node._id);

  log.info("KB", `Scaffolded under ${rootId}`);
  return ids;
}

// ── Find nodes ──

export async function findKbNodes(rootId) {
  if (!_Node) return null;
  const children = await _Node.find({ parent: rootId }).select("_id name metadata").lean();
  const result = {};
  for (const child of children) {
    const meta = child.metadata instanceof Map ? child.metadata.get("kb") : child.metadata?.kb;
    if (meta?.role) result[meta.role] = { id: String(child._id), name: child.name };
  }
  return result;
}

export async function isInitialized(rootId) {
  if (!_Node) return false;
  const root = await _Node.findById(rootId).select("metadata").lean();
  if (!root) return false;
  const meta = root.metadata instanceof Map ? root.metadata.get("kb") : root.metadata?.kb;
  return !!meta?.initialized;
}

export async function getSetupPhase(rootId) {
  if (!_Node) return null;
  const root = await _Node.findById(rootId).select("metadata").lean();
  if (!root) return null;
  const meta = root.metadata instanceof Map ? root.metadata.get("kb") : root.metadata?.kb;
  return meta?.setupPhase || (meta?.initialized ? "complete" : null);
}

export async function completeSetup(rootId) {
  const root = await _Node.findById(rootId);
  if (!root) return;
  const existing = _metadata.getExtMeta(root, "kb") || {};
  await _metadata.setExtMeta(root, "kb", { ...existing, setupPhase: "complete" });
}

// ── Intent routing ──

export function routeKbIntent(message) {
  const lower = message.toLowerCase().trim();
  if (lower === "be") return "review";
  if (/^(what|how|why|when|where|who|is |are |does |do |can |show |tell me|explain)\b/.test(lower))
    return "ask";
  return "tell";
}

// ── Recently edited note IDs (filters out false stale positives) ──

async function getRecentlyEditedNoteIds(noteIds, sinceDate) {
  if (noteIds.length === 0) return new Set();
  const edits = await Contribution.find({
    action: "note",
    "noteAction.action": "edit",
    "noteAction.noteId": { $in: noteIds },
    date: { $gte: sinceDate },
  }).select("noteAction.noteId").lean();
  return new Set(edits.map(e => e.noteAction?.noteId).filter(Boolean));
}

// ── Status ──

export async function getStatus(rootId) {
  if (!_Node || !_Note) return null;
  const nodes = await findKbNodes(rootId);
  if (!nodes) return null;

  const root = await _Node.findById(rootId).select("name metadata").lean();
  const kbMeta = root?.metadata instanceof Map ? root.metadata.get("kb") : root?.metadata?.kb;

  // Count topics and notes
  let topicCount = 0;
  let noteCount = 0;
  const coverage = [];
  const topicNoteCounts = {};

  if (nodes.topics) {
    const topics = await _Node.find({ parent: nodes.topics.id }).select("_id name").lean();
    topicCount = topics.length;

    for (const t of topics) {
      const children = await _Node.find({ parent: t._id }).select("_id").lean();
      const nodeIds = [String(t._id), ...children.map(c => String(c._id))];
      const count = await _Note.countDocuments({ nodeId: { $in: nodeIds } });
      noteCount += count;
      coverage.push(t.name);
      topicNoteCounts[t.name] = count;
    }
  }

  // Stale notes (created long ago AND not recently edited)
  const staleDate = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);
  const topicNodeIds = await getTopicNodeIds(nodes);

  const candidateStale = await _Note.find({
    nodeId: { $in: topicNodeIds },
    createdAt: { $lt: staleDate },
  }).select("_id nodeId createdAt").lean();

  const candidateIds = candidateStale.map(n => String(n._id));
  const recentlyEdited = await getRecentlyEditedNoteIds(candidateIds, staleDate);
  const trueStale = candidateStale.filter(n => !recentlyEdited.has(String(n._id)));

  // Stale branches (group by topic ancestor)
  const staleBranches = [];
  const branchStaleMap = {};
  for (const n of trueStale) {
    const node = await _Node.findById(n.nodeId).select("name").lean();
    const name = node?.name || "unknown";
    const days = Math.floor((Date.now() - new Date(n.createdAt).getTime()) / (24 * 60 * 60 * 1000));
    if (!branchStaleMap[name] || days > branchStaleMap[name]) {
      branchStaleMap[name] = days;
    }
  }
  for (const [name, days] of Object.entries(branchStaleMap)) {
    staleBranches.push(`${name} (${days} days)`);
  }
  staleBranches.sort((a, b) => {
    const da = parseInt(a.match(/\((\d+)/)?.[1] || "0");
    const db = parseInt(b.match(/\((\d+)/)?.[1] || "0");
    return db - da;
  });

  // Unplaced count
  let unplacedCount = 0;
  if (nodes.unplaced) {
    unplacedCount = await _Note.countDocuments({ nodeId: nodes.unplaced.id });
  }

  // Recent updates: merge recent creates and recent edits
  const recentCreated = await _Note.find({ nodeId: { $in: topicNodeIds } })
    .sort({ createdAt: -1 })
    .limit(5)
    .select("_id nodeId createdAt")
    .lean();

  const recentEdits = await Contribution.find({
    action: "note",
    "noteAction.action": "edit",
    nodeId: { $in: topicNodeIds },
  }).sort({ date: -1 }).limit(5).select("nodeId date").lean();

  // Merge and deduplicate by nodeId, sort by most recent
  const updateMap = new Map();
  for (const n of recentCreated) {
    const node = await _Node.findById(n.nodeId).select("name").lean();
    if (node) updateMap.set(String(n.nodeId), { name: node.name, date: n.createdAt });
  }
  for (const e of recentEdits) {
    const existing = updateMap.get(String(e.nodeId));
    if (!existing || new Date(e.date) > new Date(existing.date)) {
      const node = await _Node.findById(e.nodeId).select("name").lean();
      if (node) updateMap.set(String(e.nodeId), { name: node.name, date: e.date });
    }
  }
  const recentUpdates = [...updateMap.values()]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5);

  return {
    name: root?.name || kbMeta?.profile?.name || "Knowledge Base",
    profile: kbMeta?.profile || null,
    topicCount,
    noteCount,
    topicNoteCounts,
    staleNotes: trueStale.length,
    staleBranches: staleBranches.slice(0, 10),
    unplacedCount,
    coverage: coverage.slice(0, 20),
    recentUpdates,
  };
}

async function getTopicNodeIds(nodes) {
  if (!nodes?.topics || !_Node) return [];
  const topics = await _Node.find({ parent: nodes.topics.id }).select("_id").lean();
  const ids = [nodes.topics.id, ...topics.map(t => String(t._id))];
  // One level of children
  for (const t of topics) {
    const children = await _Node.find({ parent: t._id }).select("_id").lean();
    ids.push(...children.map(c => String(c._id)));
  }
  return ids;
}

export async function getStaleNotes(rootId) {
  if (!_Node || !_Note) return [];
  const nodes = await findKbNodes(rootId);
  if (!nodes) return [];

  const staleDate = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);
  const nodeIds = await getTopicNodeIds(nodes);

  const candidates = await _Note.find({
    nodeId: { $in: nodeIds },
    createdAt: { $lt: staleDate },
  })
    .sort({ createdAt: 1 })
    .limit(50)
    .select("_id nodeId content createdAt")
    .lean();

  // Filter out notes that were recently edited
  const candidateIds = candidates.map(n => String(n._id));
  const recentlyEdited = await getRecentlyEditedNoteIds(candidateIds, staleDate);

  const results = [];
  for (const n of candidates) {
    if (recentlyEdited.has(String(n._id))) continue;
    const node = await _Node.findById(n.nodeId).select("name").lean();
    results.push({
      noteId: String(n._id),
      nodeId: n.nodeId,
      nodeName: node?.name || "unknown",
      preview: typeof n.content === "string" ? n.content.slice(0, 200) : "",
      lastUpdated: n.createdAt,
      daysStale: Math.floor((Date.now() - new Date(n.createdAt).getTime()) / (24 * 60 * 60 * 1000)),
    });
  }
  return results;
}

export async function getUnplaced(rootId) {
  if (!_Node || !_Note) return [];
  const nodes = await findKbNodes(rootId);
  if (!nodes?.unplaced) return [];

  const notes = await _Note.find({ nodeId: nodes.unplaced.id })
    .sort({ createdAt: -1 })
    .limit(50)
    .select("content createdAt")
    .lean();

  return notes.map(n => ({
    content: typeof n.content === "string" ? n.content.slice(0, 300) : "",
    date: n.createdAt,
  }));
}

// ── Maintainer check ──

export async function isMaintainer(rootId, userId) {
  if (!_Node) return false;
  const root = await _Node.findById(rootId).select("metadata rootOwner").lean();
  if (!root) return false;
  if (root.rootOwner?.toString() === userId) return true;
  const kbMeta = root.metadata instanceof Map ? root.metadata.get("kb") : root.metadata?.kb;
  return (kbMeta?.profile?.maintainers || []).includes(userId);
}
