/**
 * Changelog Core
 *
 * Reads contributions scoped to a subtree, groups by node, and sends
 * to the AI for narrative construction. One LLM call with BACKGROUND priority.
 */

import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import Contribution from "../../seed/models/contribution.js";
import { getDescendantIds } from "../../seed/tree/treeFetch.js";
import { parseJsonSafe } from "../../seed/orchestrators/helpers.js";

let _runChat = null;
export function setRunChat(fn) { _runChat = fn; }

// ─────────────────────────────────────────────────────────────────────────
// TIME PARSING
// ─────────────────────────────────────────────────────────────────────────

/**
 * Parse a since string like "24h", "7d", "2w", "30d", or an ISO date.
 */
export function parseSince(since) {
  if (!since) return new Date(Date.now() - 86400000); // default 24h

  if (typeof since === "string") {
    const match = since.match(/^(\d+)(h|d|w|m)$/);
    if (match) {
      const n = parseInt(match[1], 10);
      const unit = match[2];
      const ms = { h: 3600000, d: 86400000, w: 604800000, m: 2592000000 }[unit];
      return new Date(Date.now() - n * ms);
    }
    // Try ISO date
    const d = new Date(since);
    if (!isNaN(d.getTime())) return d;
  }

  return new Date(Date.now() - 86400000); // fallback 24h
}

// ─────────────────────────────────────────────────────────────────────────
// CONTRIBUTION FETCHING
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get contributions scoped to a subtree within a time window.
 */
export async function getChangelog(nodeId, opts = {}) {
  const since = parseSince(opts.since);
  const limit = opts.limit || 500;

  // Scope: subtree or land
  let scopeIds;
  if (opts.land) {
    // Land scope: all contributions
    scopeIds = null; // no nodeId filter
  } else {
    const descendantIds = await getDescendantIds(nodeId, { maxResults: 10000 });
    scopeIds = [nodeId, ...descendantIds];
  }

  const query = { date: { $gte: since } };
  if (scopeIds) query.nodeId = { $in: scopeIds };
  if (opts.userId) query.userId = opts.userId;

  const contributions = await Contribution.find(query)
    .sort({ date: -1 })
    .limit(limit)
    .lean();

  return { contributions, since, scopeIds };
}

/**
 * Group contributions by nodeId with action counts.
 */
function groupContributions(contributions) {
  const byNode = new Map();

  for (const c of contributions) {
    const nid = c.nodeId || "unknown";
    if (!byNode.has(nid)) {
      byNode.set(nid, {
        nodeId: nid,
        actions: {},
        users: new Set(),
        autonomous: [],
        count: 0,
        lastDate: null,
      });
    }
    const group = byNode.get(nid);
    group.actions[c.action] = (group.actions[c.action] || 0) + 1;
    group.count++;
    if (c.userId) group.users.add(c.userId);
    if (!group.lastDate || c.date > group.lastDate) group.lastDate = c.date;

    // Track autonomous activity (intent, dreams)
    if (c.extensionData?.intent || c.action?.startsWith("intent:")) {
      group.autonomous.push({ by: "intent", action: c.action, date: c.date });
    }
    if (c.extensionData?.dreams || c.action?.startsWith("dream:")) {
      group.autonomous.push({ by: "dreams", action: c.action, date: c.date });
    }
  }

  return byNode;
}

/**
 * Detect stalled areas: active in previous window, silent in current.
 */
export async function getStalled(nodeId, since, previousWindowMs) {
  const prevSince = new Date(since.getTime() - (previousWindowMs || since.getTime() - Date.now() + 86400000));
  const descendantIds = await getDescendantIds(nodeId, { maxResults: 10000 });
  const scopeIds = [nodeId, ...descendantIds];

  // Nodes active in previous window
  const prevContribs = await Contribution.distinct("nodeId", {
    nodeId: { $in: scopeIds },
    date: { $gte: prevSince, $lt: since },
  });

  // Nodes active in current window
  const currentContribs = await Contribution.distinct("nodeId", {
    nodeId: { $in: scopeIds },
    date: { $gte: since },
  });

  const currentSet = new Set(currentContribs);
  const stalled = prevContribs.filter(id => !currentSet.has(id));

  // Get names for stalled nodes
  if (stalled.length === 0) return [];
  const nodes = await Node.find({ _id: { $in: stalled } }).select("_id name").lean();
  const nameMap = new Map(nodes.map(n => [String(n._id), n.name]));

  return stalled.map(id => ({
    nodeId: id,
    nodeName: nameMap.get(id) || "unknown",
    lastActivity: prevSince.toISOString(),
  }));
}

// ─────────────────────────────────────────────────────────────────────────
// AI NARRATIVE
// ─────────────────────────────────────────────────────────────────────────

/**
 * Summarize contributions into a narrative via AI.
 */
export async function summarizeChangelog(nodeId, contributions, userId, username, opts = {}) {
  if (!_runChat || contributions.length === 0) {
    return buildRawSummary(contributions, nodeId);
  }

  const grouped = groupContributions(contributions);

  // Get node names for all groups
  const nodeIds = [...grouped.keys()].filter(id => id !== "unknown");
  const nodes = await Node.find({ _id: { $in: nodeIds } }).select("_id name").lean();
  const nameMap = new Map(nodes.map(n => [String(n._id), n.name]));

  // Build summary text for the prompt
  const sections = [];
  for (const [nid, group] of grouped) {
    const name = nameMap.get(nid) || nid;
    const actionStr = Object.entries(group.actions)
      .map(([a, count]) => `${a}: ${count}`)
      .join(", ");
    const autoStr = group.autonomous.length > 0
      ? ` (autonomous: ${group.autonomous.map(a => `${a.by}:${a.action}`).join(", ")})`
      : "";
    sections.push(`${name}: ${actionStr}, ${group.users.size} user(s)${autoStr}`);
  }

  // Get stalled areas
  const since = parseSince(opts.since);
  let stalledInfo = "";
  try {
    const stalled = await getStalled(nodeId, since, since.getTime() - Date.now() + 86400000);
    if (stalled.length > 0) {
      stalledInfo = `\n\nStalled areas (active before, silent now): ${stalled.map(s => s.nodeName).join(", ")}`;
    }
  } catch {
    // Stalled detection failure is non-fatal
  }

  const prompt = `Summarize what changed in this branch. Focus on:
- New work (nodes created, notes written)
- Completed work (status changes to completed)
- Decisions (notes with high engagement)
- Stalled areas (active last period, nothing this period)
- Autonomous activity (contributions from intent, dreams)

Activity (${contributions.length} contributions):
${sections.join("\n")}${stalledInfo}

Return ONLY JSON:
{
  "new": [{ "nodeName": "...", "summary": "..." }],
  "active": [{ "nodeName": "...", "noteCount": 0, "summary": "..." }],
  "completed": [{ "nodeName": "...", "completedAt": "..." }],
  "stalled": [{ "nodeName": "...", "lastActivity": "..." }],
  "autonomous": [{ "action": "...", "by": "intent|dreams", "summary": "..." }],
  "contributors": [{ "username": "...", "actions": 0 }],
  "summary": "one paragraph overview"
}`;

  // Find rootId for runChat
  let rootId = null;
  try {
    const { resolveRootNode } = await import("../../seed/tree/treeFetch.js");
    const root = await resolveRootNode(nodeId);
    rootId = root?._id;
  } catch {
    // Root resolution failure is non-fatal
  }

  try {
    const { answer } = await _runChat({
      userId,
      username: username || "system",
      message: prompt,
      mode: "tree:respond",
      rootId,
    });

    if (!answer) return buildRawSummary(contributions, nodeId);
    const parsed = parseJsonSafe(answer);
    if (!parsed) return buildRawSummary(contributions, nodeId);
    return parsed;
  } catch (err) {
    log.debug("Changelog", `AI summarization failed: ${err.message}`);
    return buildRawSummary(contributions, nodeId);
  }
}

/**
 * Fallback raw summary when AI is unavailable.
 */
function buildRawSummary(contributions, nodeId) {
  const grouped = groupContributions(contributions);
  const allUsers = new Set();
  const allAutonomous = [];

  for (const group of grouped.values()) {
    for (const u of group.users) allUsers.add(u);
    allAutonomous.push(...group.autonomous);
  }

  return {
    new: [],
    active: [],
    completed: [],
    stalled: [],
    autonomous: allAutonomous.map(a => ({ action: a.action, by: a.by, summary: a.action })),
    contributors: [...allUsers].map(u => ({ username: u, actions: contributions.filter(c => c.userId === u).length })),
    summary: `${contributions.length} contributions across ${grouped.size} nodes by ${allUsers.size} user(s).`,
  };
}
