/**
 * Study Core
 *
 * Queue management, mastery tracking, gap detection, progress stats.
 * The tree holds curricula. The AI teaches through conversation.
 * Learn extension fetches content. Study organizes and tracks mastery.
 */

import log from "../../seed/log.js";
import { parseJsonSafe } from "../../seed/orchestrators/helpers.js";

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

// ── Constants ──

const MAX_HISTORY = 90;
const MASTERY_COMPLETE = 80;

const ROLES = {
  LOG: "log",
  QUEUE: "queue",
  ACTIVE: "active",
  COMPLETED: "completed",
  GAPS: "gaps",
  PROFILE: "profile",
  HISTORY: "history",
  TOPIC: "topic",
  SUBTOPIC: "subtopic",
  RESOURCES: "resources",
  QUEUE_ITEM: "queue-item",
  GAP_ITEM: "gap-item",
};

export { ROLES };

// ── Initialization ──

export async function isInitialized(rootId) {
  if (!_Node) return false;
  const root = await _Node.findById(rootId).select("metadata").lean();
  if (!root) return false;
  const meta = root.metadata instanceof Map
    ? root.metadata.get("study")
    : root.metadata?.study;
  return !!meta?.initialized;
}

export async function getSetupPhase(rootId) {
  if (!_Node) return null;
  const root = await _Node.findById(rootId).select("metadata").lean();
  if (!root) return null;
  const meta = root.metadata instanceof Map
    ? root.metadata.get("study")
    : root.metadata?.study;
  return meta?.setupPhase || (meta?.initialized ? "complete" : null);
}

export async function getProfile(rootId) {
  if (!_Node) return {};
  const nodes = await findStudyNodes(rootId);
  if (!nodes?.profile) return {};
  const node = await _Node.findById(nodes.profile.id).select("metadata").lean();
  if (!node) return {};
  const meta = node.metadata instanceof Map
    ? node.metadata.get("study")
    : node.metadata?.study;
  return meta?.profile || {};
}

// ── Find study nodes by role ──

export async function findStudyNodes(rootId) {
  if (!_Node) return null;
  const children = await _Node.find({ parent: rootId }).select("_id name metadata").lean();
  const result = {};

  for (const child of children) {
    const meta = child.metadata instanceof Map
      ? child.metadata.get("study")
      : child.metadata?.study;
    if (!meta?.role) continue;

    result[meta.role] = { id: String(child._id), name: child.name };
  }

  return result;
}

// ── Queue management ──

export async function getQueue(rootId) {
  const nodes = await findStudyNodes(rootId);
  if (!nodes?.queue) return [];

  const items = await _Node.find({ parent: nodes.queue.id }).select("_id name metadata dateCreated").lean();
  return items.map(item => {
    const meta = item.metadata instanceof Map
      ? item.metadata.get("study")
      : item.metadata?.study;
    const vals = item.metadata instanceof Map
      ? item.metadata.get("values")
      : item.metadata?.values;
    return {
      id: String(item._id),
      name: item.name,
      priority: vals?.priority || 0,
      status: meta?.status || "queued",
      url: meta?.url || null,
      added: item.dateCreated,
    };
  }).sort((a, b) => (b.priority || 0) - (a.priority || 0));
}

export async function addToQueue(rootId, topicName, userId, opts = {}) {
  const nodes = await findStudyNodes(rootId);
  if (!nodes?.queue) throw new Error("Study tree not scaffolded");

  const { createNode } = await import("../../seed/tree/treeManagement.js");
  const node = await createNode({ name: topicName, parentId: nodes.queue.id, userId });

  const studyMeta = { role: ROLES.QUEUE_ITEM, status: "queued" };
  if (opts.url) studyMeta.url = opts.url;
  await _metadata.setExtMeta(node, "study", studyMeta);

  if (opts.priority) {
    await _metadata.batchSetExtMeta(node._id, "values", { priority: opts.priority });
  }

  // If URL, fetch content and optionally decompose with learn extension
  if (opts.url) {
    try {
      // Fetch the URL content
      const response = await fetch(opts.url, {
        headers: { "User-Agent": "TreeOS/Study" },
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) {
        const text = await response.text();
        // Extract readable text (strip HTML tags if present)
        const content = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 500000); // cap at 500KB

        if (content.length > 100) {
          // Store fetched content as a note on the queue item
          const { createNote } = await import("../../seed/tree/notes.js");
          await createNote({ nodeId: String(node._id), content, contentType: "text", userId });

          // If learn extension available, decompose into tree structure
          const { getExtension } = await import("../loader.js");
          const learnExt = getExtension("learn");
          if (learnExt?.exports?.initLearnState && learnExt?.exports?.processQueue) {
            await learnExt.exports.initLearnState(String(node._id), 3000);
            await learnExt.exports.processQueue(String(node._id), userId, "system", 5);
            log.info("Study", `URL fetched and learn decomposition started: ${opts.url}`);
          } else {
            log.info("Study", `URL fetched (${content.length} chars), learn extension not available for decomposition`);
          }
        }
      }
    } catch (err) {
      log.verbose("Study", `URL fetch failed: ${err.message}`);
    }
  }

  return { id: String(node._id), name: topicName };
}

// ── Active topic management ──

export async function getActiveTopics(rootId) {
  const nodes = await findStudyNodes(rootId);
  if (!nodes?.active) return [];

  const topics = await _Node.find({ parent: nodes.active.id }).select("_id name metadata").lean();
  const result = [];

  for (const topic of topics) {
    const meta = topic.metadata instanceof Map
      ? topic.metadata.get("study")
      : topic.metadata?.study;
    if (meta?.role !== ROLES.TOPIC) continue;

    // Get subtopics
    const subtopics = await _Node.find({ parent: topic._id }).select("_id name metadata").lean();
    const subs = subtopics
      .filter(s => {
        const sm = s.metadata instanceof Map ? s.metadata.get("study") : s.metadata?.study;
        return sm?.role === ROLES.SUBTOPIC;
      })
      .map(s => {
        const vals = s.metadata instanceof Map ? s.metadata.get("values") : s.metadata?.values;
        const sm = s.metadata instanceof Map ? s.metadata.get("study") : s.metadata?.study;
        return {
          id: String(s._id),
          name: s.name,
          mastery: vals?.mastery || 0,
          attempts: vals?.attempts || 0,
          complete: (vals?.mastery || 0) >= MASTERY_COMPLETE,
          lastStudied: vals?.lastStudied || null,
        };
      });

    const completion = subs.length > 0
      ? Math.round(subs.filter(s => s.complete).length / subs.length * 100)
      : 0;

    result.push({
      id: String(topic._id),
      name: topic.name,
      subtopics: subs,
      completion,
      lastStudied: meta?.lastStudied || null,
    });
  }

  return result;
}

export async function moveToActive(rootId, queueItemId, userId) {
  const nodes = await findStudyNodes(rootId);
  if (!nodes?.active) throw new Error("Study tree not scaffolded");

  const item = await _Node.findById(queueItemId).select("name metadata").lean();
  if (!item) throw new Error("Queue item not found");

  // Create topic under Active
  const { createNode } = await import("../../seed/tree/treeManagement.js");
  const topicNode = await createNode({ name: item.name, parentId: nodes.active.id, userId });
  await _metadata.setExtMeta(topicNode, "study", { role: ROLES.TOPIC, lastStudied: new Date().toISOString() });

  // Create Resources child
  const resourcesNode = await createNode({ name: "Resources", parentId: topicNode._id, userId });
  await _metadata.setExtMeta(resourcesNode, "study", { role: ROLES.RESOURCES });

  // Update queue item status
  const queueNode = await _Node.findById(queueItemId);
  if (queueNode) {
    const existing = _metadata.getExtMeta(queueNode, "study") || {};
    await _metadata.setExtMeta(queueNode, "study", { ...existing, status: "active" });
  }

  return { topicId: String(topicNode._id), name: item.name };
}

// ── Mastery tracking ──

export async function updateMastery(subtopicId, score, userId) {
  const node = await _Node.findById(subtopicId);
  if (!node) throw new Error("Subtopic not found");

  const vals = _metadata.getExtMeta(node, "values") || {};
  const newMastery = Math.max(vals.mastery || 0, Math.min(score, 100));

  await _metadata.batchSetExtMeta(subtopicId, "values", {
    mastery: newMastery,
    attempts: (vals.attempts || 0) + 1,
    lastStudied: new Date().toISOString(),
  });

  // Check if topic is complete (all subtopics at 80%+)
  const parent = await _Node.findById(node.parent).select("metadata").lean();
  const parentMeta = parent?.metadata instanceof Map
    ? parent.metadata.get("study")
    : parent?.metadata?.study;

  if (parentMeta?.role === ROLES.TOPIC) {
    await checkTopicCompletion(String(node.parent), userId);
  }

  return { mastery: newMastery, complete: newMastery >= MASTERY_COMPLETE };
}

async function checkTopicCompletion(topicId, userId) {
  const subtopics = await _Node.find({ parent: topicId }).select("metadata").lean();
  let allComplete = true;
  let subtopicCount = 0;

  for (const sub of subtopics) {
    const sm = sub.metadata instanceof Map ? sub.metadata.get("study") : sub.metadata?.study;
    if (sm?.role !== ROLES.SUBTOPIC) continue;
    subtopicCount++;
    const vals = sub.metadata instanceof Map ? sub.metadata.get("values") : sub.metadata?.values;
    if ((vals?.mastery || 0) < MASTERY_COMPLETE) {
      allComplete = false;
    }
  }

  if (subtopicCount > 0 && allComplete) {
    // Find root to get Completed node
    const topic = await _Node.findById(topicId).select("parent name").lean();
    if (!topic) return;
    const activeNode = await _Node.findById(topic.parent).select("parent").lean();
    if (!activeNode) return;
    const rootId = String(activeNode.parent);

    const nodes = await findStudyNodes(rootId);
    if (!nodes?.completed) return;

    // Move topic from Active to Completed
    try {
      const { updateParentRelationship } = await import("../../seed/tree/treeManagement.js");
      await updateParentRelationship(topicId, nodes.completed.id, userId);
      log.info("Study", `Topic "${topic.name}" completed and moved to Completed`);
    } catch (err) {
      log.warn("Study", `Failed to move completed topic: ${err.message}`);
    }
  }
}

// ── Gap detection ──

export async function addGap(rootId, gapName, detectedDuring, userId) {
  const nodes = await findStudyNodes(rootId);
  if (!nodes?.gaps) return null;

  // Check if gap already exists
  const existing = await _Node.find({ parent: nodes.gaps.id, name: gapName }).select("_id").lean();
  if (existing.length > 0) return { id: String(existing[0]._id), name: gapName, existed: true };

  const { createNode } = await import("../../seed/tree/treeManagement.js");
  const gapNode = await createNode({ name: gapName, parentId: nodes.gaps.id, userId });
  await _metadata.setExtMeta(gapNode, "study", {
    role: ROLES.GAP_ITEM,
    detectedDuring,
    detectedAt: new Date().toISOString(),
  });
  await _metadata.batchSetExtMeta(gapNode._id, "values", { priority: 1 });

  return { id: String(gapNode._id), name: gapName };
}

export async function getGaps(rootId) {
  const nodes = await findStudyNodes(rootId);
  if (!nodes?.gaps) return [];

  const items = await _Node.find({ parent: nodes.gaps.id }).select("_id name metadata dateCreated").lean();
  return items.map(item => {
    const meta = item.metadata instanceof Map ? item.metadata.get("study") : item.metadata?.study;
    return {
      id: String(item._id),
      name: item.name,
      detectedDuring: meta?.detectedDuring || null,
      detectedAt: meta?.detectedAt || item.dateCreated,
    };
  });
}

// ── Progress stats ──

export async function getStudyProgress(rootId) {
  const nodes = await findStudyNodes(rootId);
  if (!nodes) return null;

  const queue = nodes.queue ? await _Node.countDocuments({ parent: nodes.queue.id }) : 0;
  const active = await getActiveTopics(rootId);
  const completedCount = nodes.completed ? await _Node.countDocuments({ parent: nodes.completed.id }) : 0;
  const gapCount = nodes.gaps ? await _Node.countDocuments({ parent: nodes.gaps.id }) : 0;

  // Current topic (most recently studied)
  let currentTopic = null;
  if (active.length > 0) {
    active.sort((a, b) => (b.lastStudied || "").localeCompare(a.lastStudied || ""));
    currentTopic = active[0];
  }

  // Current subtopic (lowest mastery in current topic)
  let currentSubtopic = null;
  if (currentTopic?.subtopics?.length > 0) {
    const incomplete = currentTopic.subtopics.filter(s => !s.complete);
    if (incomplete.length > 0) {
      incomplete.sort((a, b) => (a.mastery || 0) - (b.mastery || 0));
      currentSubtopic = incomplete[0];
    }
  }

  return {
    queue: { count: queue },
    active: currentTopic ? {
      topic: currentTopic.name,
      completion: currentTopic.completion,
      currentSubtopic: currentSubtopic?.name || null,
      mastery: currentSubtopic?.mastery || 0,
      lastStudied: currentTopic.lastStudied,
    } : null,
    gaps: { count: gapCount },
    completed: { allTime: completedCount },
    activeTopics: active.map(t => ({ name: t.name, completion: t.completion })),
  };
}

// ── Parse study input ──

export async function parseStudyInput(message, userId, username, rootId) {
  if (!_runChat) return null;

  const { answer } = await _runChat({
    userId, username, message,
    mode: "tree:study-log",
    rootId,
    slot: "study",
  });

  if (!answer) return null;
  return parseJsonSafe(answer);
}

// ── Record study session to History ──

export async function recordStudySession(rootId, session, userId) {
  const nodes = await findStudyNodes(rootId);
  if (!nodes?.history) return;

  try {
    const { createNote } = await import("../../seed/tree/notes.js");
    await createNote({
      nodeId: nodes.history.id,
      content: JSON.stringify({
        date: new Date().toISOString(),
        ...session,
      }),
      contentType: "text",
      userId,
    });
  } catch (err) {
    log.warn("Study", `History note failed: ${err.message}`);
  }
}
