/**
 * Scheduler Core
 *
 * Timeline builder, completion tracker, reliability calculator.
 * Reads metadata.schedule (ISO date) and metadata.reeffectTime (hours)
 * from nodes. Never writes to schedules data. Writes completions to
 * metadata.scheduler on each node.
 */

import log from "../../seed/log.js";
import { getDescendantIds } from "../../seed/tree/treeFetch.js";
import { getExtMeta, setExtMeta } from "../../seed/tree/extensionMetadata.js";

// ── Dependencies (set by configure) ──

let _Node = null;
let _hooks = null;

export function configure({ Node, hooks }) {
  _Node = Node;
  _hooks = hooks;
}

// ── Per-tree cached timelines ──

const timelines = new Map(); // rootId -> { due, upcoming, overdue, lastScan }

// ── Notified items (avoid duplicate notifications per cycle) ──

const notified = new Set(); // "nodeId:scheduledFor" keys

// ── Default config ──

const DEFAULTS = {
  lookaheadHours: 24,
  overdueThresholdHours: 1,
  suppressDuringAttention: true,
  maxCompletions: 50,
};

/**
 * Read scheduler config from the .config system node.
 */
async function getConfig(rootId) {
  if (!_Node) return DEFAULTS;
  try {
    const configNode = await _Node.findOne({
      parent: rootId,
      name: ".config",
    }).select("metadata").lean();
    if (!configNode) return DEFAULTS;
    const meta = configNode.metadata instanceof Map
      ? configNode.metadata.get("scheduler")
      : configNode.metadata?.scheduler;
    return { ...DEFAULTS, ...(meta || {}) };
  } catch {
    return DEFAULTS;
  }
}

// ── Timeline scanning ──

/**
 * Scan a tree for scheduled items. Categorize into due/upcoming/overdue.
 * Uses getDescendantIds to find all nodes in the tree.
 */
export async function scanTree(rootId) {
  if (!_Node || !rootId) return null;

  const config = await getConfig(rootId);
  const now = Date.now();
  const overdueThreshold = config.overdueThresholdHours * 3600000;
  const lookahead = config.lookaheadHours * 3600000;

  // Find all nodes in this tree that have a schedule set
  const descendantIds = await getDescendantIds(rootId, { maxResults: 10000 });
  const allIds = [rootId, ...descendantIds];

  const scheduledNodes = await _Node.find({
    _id: { $in: allIds },
    "metadata.schedule": { $exists: true, $ne: null },
  }).select("_id name status metadata").lean();

  const due = [];
  const upcoming = [];
  const overdue = [];

  for (const node of scheduledNodes) {
    const meta = node.metadata instanceof Map
      ? Object.fromEntries(node.metadata)
      : (node.metadata || {});

    const rawSchedule = meta.schedule;
    if (!rawSchedule) continue;

    const scheduledFor = new Date(rawSchedule).getTime();
    if (isNaN(scheduledFor)) continue;

    const delta = scheduledFor - now;
    const isCompleted = node.status === "completed";
    const nodeId = String(node._id);
    const nodeName = node.name;

    if (delta <= 0 && !isCompleted && Math.abs(delta) > overdueThreshold) {
      overdue.push({
        nodeId,
        nodeName,
        scheduledFor: new Date(scheduledFor).toISOString(),
        daysOverdue: Math.round((Math.abs(delta) / 86400000) * 10) / 10,
      });
    } else if (delta <= 0 && !isCompleted) {
      due.push({
        nodeId,
        nodeName,
        scheduledFor: new Date(scheduledFor).toISOString(),
        overdueSince: Math.round(Math.abs(delta) / 60000),
      });
    } else if (delta > 0 && delta <= lookahead && !isCompleted) {
      upcoming.push({
        nodeId,
        nodeName,
        scheduledFor: new Date(scheduledFor).toISOString(),
        hoursUntil: Math.round((delta / 3600000) * 10) / 10,
      });
    }
  }

  // Sort: due by most overdue first, upcoming by soonest first
  due.sort((a, b) => b.overdueSince - a.overdueSince);
  upcoming.sort((a, b) => a.hoursUntil - b.hoursUntil);
  overdue.sort((a, b) => b.daysOverdue - a.daysOverdue);

  const timeline = { due, upcoming, overdue, lastScan: now };
  timelines.set(rootId, timeline);

  return timeline;
}

/**
 * Get cached timeline for a tree. Returns null if never scanned.
 */
export function getCachedTimeline(rootId) {
  return timelines.get(rootId) || null;
}

// ── Signaling ──

/**
 * Signal newly due items via notifications and gateway.
 * Only fires once per item per cycle (deduped by notified set).
 */
export async function signalDueItems(rootId, timeline, userId) {
  if (!timeline?.due?.length && !timeline?.overdue?.length) return;

  const items = [...(timeline.due || []), ...(timeline.overdue || [])];
  const newItems = items.filter(item => {
    const key = `${item.nodeId}:${item.scheduledFor}`;
    if (notified.has(key)) return false;
    notified.add(key);
    return true;
  });

  if (newItems.length === 0) return;

  // Fire scheduler:itemDue hook for each new item
  if (_hooks) {
    for (const item of newItems) {
      _hooks.run("scheduler:itemDue", {
        rootId,
        nodeId: item.nodeId,
        nodeName: item.nodeName,
        scheduledFor: item.scheduledFor,
        userId,
      }).catch(() => {});
    }
  }

  // Notifications (persistent)
  try {
    const { getExtension } = await import("../loader.js");
    const notifExt = getExtension("notifications");
    if (notifExt?.exports?.Notification) {
      for (const item of newItems) {
        const isDue = item.overdueSince != null;
        notifExt.exports.Notification.create({
          userId,
          rootId,
          type: "schedule:due",
          title: `${item.nodeName} is ${isDue ? "due now" : "overdue"}`,
          content: `Scheduled for ${item.scheduledFor}`,
        }).catch(() => {});
      }
    }
  } catch {}

  // Gateway (external channels)
  try {
    const { getExtension } = await import("../loader.js");
    const gw = getExtension("gateway");
    if (gw?.exports?.dispatchNotifications) {
      const notifications = newItems.map(item => ({
        type: "schedule:due",
        title: `${item.nodeName} is ${item.overdueSince != null ? "due" : "overdue"}`,
        content: `Scheduled for ${item.scheduledFor}`,
        rootId,
      }));
      gw.exports.dispatchNotifications(rootId, notifications).catch(() => {});
    }
  } catch {}
}

// ── Completion tracking ──

/**
 * Record a completion when a scheduled node is marked completed.
 * Writes to metadata.scheduler.completions[] on the node.
 */
export async function recordCompletion(node, scheduledFor) {
  if (!_Node) return;

  const nodeId = String(node._id || node);
  const doc = node._id ? node : await _Node.findById(nodeId);
  if (!doc) return;

  const config = await getConfig(null); // maxCompletions is global
  const existing = getExtMeta(doc, "scheduler");
  const completions = Array.isArray(existing.completions) ? existing.completions : [];

  const scheduledTime = new Date(scheduledFor).getTime();
  const completedAt = Date.now();
  const deltaMinutes = Math.round((completedAt - scheduledTime) / 60000);

  completions.push({ completedAt, scheduledFor: scheduledTime, deltaMinutes });

  // Cap at maxCompletions
  while (completions.length > config.maxCompletions) {
    completions.shift();
  }

  await setExtMeta(doc, "scheduler", { completions });

  log.verbose("Scheduler", `Recorded completion for "${doc.name}": ${deltaMinutes > 0 ? "+" : ""}${deltaMinutes}min`);
}

// ── Reliability calculator ──

/**
 * Calculate reliability metrics from a completions array.
 */
export function calculateReliability(completions) {
  if (!Array.isArray(completions) || completions.length === 0) {
    return null;
  }

  const deltas = completions.map(c => c.deltaMinutes).filter(d => typeof d === "number");
  if (deltas.length === 0) return null;

  const averageDeltaMinutes = Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length);
  const onTimeCount = deltas.filter(d => Math.abs(d) < 60).length;
  const onTimeRate = Math.round((onTimeCount / deltas.length) * 100);

  // Streak: consecutive on-time from most recent
  let streak = 0;
  for (let i = deltas.length - 1; i >= 0; i--) {
    if (Math.abs(deltas[i]) < 60) streak++;
    else break;
  }

  return {
    averageDeltaMinutes,
    onTimeRate,
    streak,
    totalCompletions: completions.length,
    recentCompletions: completions.slice(-5).map(c => ({
      completedAt: new Date(c.completedAt).toISOString(),
      scheduledFor: new Date(c.scheduledFor).toISOString(),
      deltaMinutes: c.deltaMinutes,
    })),
  };
}

// ── Week view ──

/**
 * Get timeline for the full week (7 days lookahead).
 */
export async function getWeekTimeline(rootId) {
  if (!_Node || !rootId) return null;

  const now = Date.now();
  const weekMs = 7 * 24 * 3600000;

  const descendantIds = await getDescendantIds(rootId, { maxResults: 10000 });
  const allIds = [rootId, ...descendantIds];

  const scheduledNodes = await _Node.find({
    _id: { $in: allIds },
    "metadata.schedule": { $exists: true, $ne: null },
  }).select("_id name status metadata").lean();

  const items = [];
  for (const node of scheduledNodes) {
    const meta = node.metadata instanceof Map
      ? Object.fromEntries(node.metadata)
      : (node.metadata || {});

    const rawSchedule = meta.schedule;
    if (!rawSchedule) continue;

    const scheduledFor = new Date(rawSchedule).getTime();
    if (isNaN(scheduledFor)) continue;

    const delta = scheduledFor - now;
    if (delta > weekMs) continue; // beyond this week

    items.push({
      nodeId: String(node._id),
      nodeName: node.name,
      scheduledFor: new Date(scheduledFor).toISOString(),
      status: node.status || "active",
      isPast: delta <= 0,
    });
  }

  items.sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor));
  return items;
}

// ── Cleanup ──

/**
 * Clear all cached timelines. Called on shutdown.
 */
export function clearAll() {
  timelines.clear();
  notified.clear();
}
