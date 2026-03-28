// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import log from "../log.js";
import Chat from "../models/chat.js";
import Contribution from "../models/contribution.js";
import { getDescendantIds } from "../tree/treeFetch.js";
import { getLandConfigValue } from "../landConfig.js";

// ─────────────────────────────────────────────────────────────────────────
// LIMITS (configurable via land config, read at use time)
// ─────────────────────────────────────────────────────────────────────────

function MAX_SESSION_LIMIT() { return Math.max(1, Math.min(Number(getLandConfigValue("chatHistoryMaxSessions")) || 50, 500)); }
function MAX_CHATS_PER_SESSION() { return Math.max(1, Math.min(Number(getLandConfigValue("chatHistoryMaxChatsPerSession")) || 200, 2000)); }
function MAX_DESCENDANT_IDS() { return Math.max(10, Math.min(Number(getLandConfigValue("chatHistoryMaxDescendantIds")) || 500, 10000)); }
function MAX_CONTRIBUTIONS_PER_QUERY() { return Math.max(100, Math.min(Number(getLandConfigValue("chatHistoryMaxContributions")) || 5000, 50000)); }

// ─────────────────────────────────────────────────────────────────────────
// SHARED HELPERS
// ─────────────────────────────────────────────────────────────────────────

/**
 * Validate and clamp sessionLimit.
 */
function clampSessionLimit(sessionLimit) {
  const n = Number(sessionLimit);
  if (!n || n <= 0) return 10;
  return Math.min(n, MAX_SESSION_LIMIT());
}

/**
 * Validate a date string. Returns a Date or null if invalid.
 */
function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d;
}

/**
 * Build a time range filter for startMessage.time.
 */
function buildTimeFilter(startDate, endDate) {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start && !end) return null;
  const filter = {};
  if (start) filter.$gte = start;
  if (end) filter.$lte = end;
  return filter;
}

/**
 * Find the N most recent distinct session IDs matching a query.
 */
async function findRecentSessionIds(matchQuery, limit) {
  return Chat.aggregate([
    { $match: matchQuery },
    { $sort: { "startMessage.time": -1 } },
    { $group: { _id: "$sessionId", latestTime: { $first: "$startMessage.time" } } },
    { $sort: { latestTime: -1 } },
    { $limit: limit },
    { $project: { _id: 1 } },
  ]).then(docs => docs.map(d => d._id));
}

/**
 * Fetch chats for a list of session IDs with populates.
 * Caps per-session results to MAX_CHATS_PER_SESSION.
 */
async function fetchChatsForSessions(sessionIds, extraMatch = {}, populateUser = false) {
  const query = {
    sessionId: { $in: sessionIds },
    ...extraMatch,
  };

  const q = Chat.find(query);

  if (populateUser) {
    q.populate({ path: "userId", select: "username", model: "User" });
  }

  // Lean populates: only fetch the fields we need from references.
  // Skip the contributions populate entirely. We fetch contributions
  // directly by chatId below, which is faster and more accurate.
  q.populate({ path: "treeContext.targetNodeId", select: "name", model: "Node" });
  q.populate({ path: "llmProvider.connectionId", select: "name model", model: "LlmConnection" });
  q.sort({ "startMessage.time": -1 });

  // Hard ceiling: MAX_CHATS_PER_SESSION() * number of sessions
  q.limit(MAX_CHATS_PER_SESSION() * sessionIds.length);

  return q.lean();
}

/**
 * Attach contributions to chats by direct chatId lookup.
 * More accurate than the contributions[] array on the Chat doc
 * because it catches in-progress chats where the array hasn't been finalized.
 */
async function attachContributions(chats) {
  if (chats.length === 0) return;
  const chatIds = chats.map(c => c._id);

  const contribs = await Contribution.find({ chatId: { $in: chatIds } })
    .select("_id action nodeId wasAi date extensionData chatId")
    .populate({ path: "nodeId", select: "name" })
    .limit(MAX_CONTRIBUTIONS_PER_QUERY())
    .lean();

  if (contribs.length === 0) return;

  const byChat = new Map();
  for (const c of contribs) {
    const key = String(c.chatId);
    if (!byChat.has(key)) byChat.set(key, []);
    byChat.get(key).push(c);
  }
  for (const chat of chats) {
    const direct = byChat.get(String(chat._id));
    if (direct) chat.contributions = direct;
  }
}

/**
 * Group chats into sessions, sorted by time then chain index.
 * Returns session objects with metadata.
 */
function groupIntoSessions(sessionIds, chats) {
  const sessionMap = new Map();
  for (const sid of sessionIds) sessionMap.set(sid, []);

  for (const chat of chats) {
    const sid = chat.sessionId || "unknown";
    if (sessionMap.has(sid)) sessionMap.get(sid).push(chat);
  }

  return sessionIds
    .filter(sid => sessionMap.get(sid).length > 0)
    .map(sid => {
      const sessionChats = sessionMap.get(sid).sort((a, b) => {
        const ta = new Date(a.startMessage?.time || 0).getTime();
        const tb = new Date(b.startMessage?.time || 0).getTime();
        if (ta !== tb) return ta - tb;
        return (a.chainIndex || 0) - (b.chainIndex || 0);
      });
      // Cap per-session to prevent one massive orchestrator chain from dominating
      const capped = sessionChats.slice(0, MAX_CHATS_PER_SESSION());
      return {
        sessionId: sid,
        chats: capped,
        startTime: capped[0]?.startMessage?.time || null,
        chatCount: capped.length,
        truncated: sessionChats.length > MAX_CHATS_PER_SESSION,
      };
    });
}

// ─────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get chat history for a user, grouped by session.
 * Returns the N most recent sessions with their chain steps.
 */
async function getChats({ userId, sessionLimit = 10, sessionId, startDate, endDate }) {
  if (!userId) throw new Error("Missing required parameter: userId");

  const limit = clampSessionLimit(sessionLimit);
  const timeFilter = buildTimeFilter(startDate, endDate);

  try {
    // Find recent session IDs
    const matchQuery = { userId };
    if (timeFilter) matchQuery["startMessage.time"] = timeFilter;

    const sessionIds = sessionId
      ? [sessionId]
      : await findRecentSessionIds(matchQuery, limit);

    if (!sessionIds.length) {
      return { message: `No AI chats found for user ${userId}`, sessions: [] };
    }

    // Fetch chats + contributions
    const extraMatch = { userId };
    if (timeFilter) extraMatch["startMessage.time"] = timeFilter;

    const chats = await fetchChatsForSessions(sessionIds, extraMatch);
    await attachContributions(chats);

    return {
      message: "AI chats retrieved successfully",
      sessions: groupIntoSessions(sessionIds, chats),
    };
  } catch (err) {
    log.error("AI", "getChats:", err.message);
    throw new Error(err.message || "Database error occurred while retrieving AI chats.");
  }
}

/**
 * Get chat history for a node (and optionally its children), grouped by session.
 * Finds sessions that touched the node via contributions or tree context.
 */
async function getNodeChats({ nodeId, sessionLimit = 10, sessionId, startDate, endDate, includeChildren = false }) {
  if (!nodeId) throw new Error("Missing required parameter: nodeId");

  const limit = clampSessionLimit(sessionLimit);
  const timeFilter = buildTimeFilter(startDate, endDate);

  try {
    // Resolve target node IDs (capped to prevent explosion on wide trees)
    let nodeIds;
    if (includeChildren) {
      const all = await getDescendantIds(nodeId);
      const maxDesc = MAX_DESCENDANT_IDS();
      nodeIds = all.slice(0, maxDesc);
      if (all.length > maxDesc) {
        log.warn("AI", `getNodeChats: descendant expansion capped at ${maxDesc} (tree has ${all.length})`);
      }
    } else {
      nodeIds = [nodeId];
    }

    // Path A: sessions via contributions that touched these nodes
    const contribQuery = { nodeId: { $in: nodeIds } };
    if (timeFilter) contribQuery.date = timeFilter;
    const contribSessionIds = await Contribution.distinct("sessionId", contribQuery);

    // Path B: sessions via Chat.treeContext.targetNodeId
    const treeCtxQuery = { "treeContext.targetNodeId": { $in: nodeIds } };
    if (timeFilter) treeCtxQuery["startMessage.time"] = timeFilter;
    const treeCtxSessionIds = await Chat.distinct("sessionId", treeCtxQuery);

    // Union and deduplicate
    const allSessionIds = [...new Set([...contribSessionIds, ...treeCtxSessionIds])].filter(Boolean);

    if (sessionId && !allSessionIds.includes(sessionId)) {
      return { message: `No AI chats found for node ${nodeId}`, sessions: [] };
    }
    if (allSessionIds.length === 0) {
      return { message: `No AI chats found for node ${nodeId}`, sessions: [] };
    }

    // Find the N most recent sessions from the candidate set
    const targetSessionIds = sessionId
      ? [sessionId]
      : await findRecentSessionIds({ sessionId: { $in: allSessionIds } }, limit);

    if (!targetSessionIds.length) {
      return { message: `No AI chats found for node ${nodeId}`, sessions: [] };
    }

    // Fetch chats + contributions
    const chats = await fetchChatsForSessions(targetSessionIds, {}, true);
    await attachContributions(chats);

    return {
      message: "AI chats retrieved successfully",
      sessions: groupIntoSessions(targetSessionIds, chats),
    };
  } catch (err) {
    log.error("AI", "getNodeChats:", err.message);
    throw new Error(err.message || "Database error occurred while retrieving AI chats.");
  }
}

export { getChats, getNodeChats };
