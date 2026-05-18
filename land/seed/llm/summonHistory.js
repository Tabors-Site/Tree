// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import log from "../log.js";
import Summon from "../models/summon.js";
import Did from "../models/did.js";
import { getDescendantIds } from "../tree/treeFetch.js";
import { getLandConfigValue } from "../landConfig.js";
import { canonicalIbpAddress, parseIbpAddress, ibpAddressIncludes } from "./ibpAddress.js";

// ─────────────────────────────────────────────────────────────────────────
// LIMITS (configurable via land config, read at use time)
// ─────────────────────────────────────────────────────────────────────────

function MAX_SESSION_LIMIT() { return Math.max(1, Math.min(Number(getLandConfigValue("summonHistoryMaxSessions")) || 50, 500)); }
function MAX_CHATS_PER_SESSION() { return Math.max(1, Math.min(Number(getLandConfigValue("summonHistoryMaxPerSession")) || 200, 2000)); }
function MAX_DESCENDANT_IDS() { return Math.max(10, Math.min(Number(getLandConfigValue("summonHistoryMaxDescendantIds")) || 500, 10000)); }
function MAX_CONTRIBUTIONS_PER_QUERY() { return Math.max(100, Math.min(Number(getLandConfigValue("summonHistoryMaxDids")) || 5000, 50000)); }

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
  return Summon.aggregate([
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

  const q = Summon.find(query);

  if (populateUser) {
    q.populate({ path: "beingIn", select: "username", model: "Being" });
  }

  // Lean populates: only fetch the fields we need from references.
  // Skip the contributions populate entirely. We fetch contributions
  // directly by summonId below, which is faster and more accurate.
  q.populate({ path: "treeContext.targetNodeId", select: "name", model: "Node" });
  q.populate({ path: "llmProvider.connectionId", select: "name model", model: "LlmConnection" });
  q.sort({ "startMessage.time": -1 });

  // Hard ceiling: MAX_CHATS_PER_SESSION() * number of sessions
  q.limit(MAX_CHATS_PER_SESSION() * sessionIds.length);

  return q.lean();
}

/**
 * Attach contributions to chats by direct summonId lookup.
 * More accurate than the contributions[] array on the Chat doc
 * because it catches in-progress chats where the array hasn't been finalized.
 */
async function attachContributions(chats) {
  if (chats.length === 0) return;
  const chatIds = chats.map(c => c._id);

  const contribs = await Did.find({ summonId: { $in: chatIds } })
    .select("_id action nodeId date extensionData summonId")
    .populate({ path: "nodeId", select: "name" })
    .limit(MAX_CONTRIBUTIONS_PER_QUERY())
    .lean();

  if (contribs.length === 0) return;

  const byChat = new Map();
  for (const c of contribs) {
    const key = String(c.summonId);
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
        truncated: sessionChats.length > MAX_CHATS_PER_SESSION(),
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
async function getSummons({ beingId, sessionLimit = 10, sessionId, startDate, endDate }) {
  if (!beingId) throw new Error("Missing required parameter: beingId");

  const limit = clampSessionLimit(sessionLimit);
  const timeFilter = buildTimeFilter(startDate, endDate);

  try {
    // The function param is named `beingId` for caller ergonomics
    // (callers think of "this user's chats") but the Chat schema field
    // is `beingIn` — the asker side of the conversation. A user's chat
    // history is "all chats this being initiated."
    const matchQuery = { beingIn: beingId };
    if (timeFilter) matchQuery["startMessage.time"] = timeFilter;

    const sessionIds = sessionId
      ? [sessionId]
      : await findRecentSessionIds(matchQuery, limit);

    if (!sessionIds.length) {
      return { message: `No AI chats found for being ${beingId}`, sessions: [] };
    }

    // Fetch chats + contributions
    const extraMatch = { beingIn: beingId };
    if (timeFilter) extraMatch["startMessage.time"] = timeFilter;

    const chats = await fetchChatsForSessions(sessionIds, extraMatch);
    await attachContributions(chats);

    return {
      message: "AI chats retrieved successfully",
      sessions: groupIntoSessions(sessionIds, chats),
    };
  } catch (err) {
    log.error("AI", "getSummons:", err.message);
    throw new Error(err.message || "Database error occurred while retrieving AI chats.");
  }
}

/**
 * Get chat history for a node (and optionally its children), grouped by session.
 * Finds sessions that touched the node via contributions or tree context.
 */
async function getNodeSummons({ nodeId, sessionLimit = 10, sessionId, startDate, endDate, includeChildren = false }) {
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
        log.warn("AI", `getNodeSummons: descendant expansion capped at ${maxDesc} (tree has ${all.length})`);
      }
    } else {
      nodeIds = [nodeId];
    }

    // Path A: sessions via contributions that touched these nodes
    const contribQuery = { nodeId: { $in: nodeIds } };
    if (timeFilter) contribQuery.date = timeFilter;
    const contribSessionIds = await Did.distinct("sessionId", contribQuery);

    // Path B: sessions via Chat.treeContext.targetNodeId
    const treeCtxQuery = { "treeContext.targetNodeId": { $in: nodeIds } };
    if (timeFilter) treeCtxQuery["startMessage.time"] = timeFilter;
    const treeCtxSessionIds = await Summon.distinct("sessionId", treeCtxQuery);

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
    log.error("AI", "getNodeSummons:", err.message);
    throw new Error(err.message || "Database error occurred while retrieving AI chats.");
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Chat-level focus view. Fetch a single chat + its descendants via
// parentSummonId BFS, plus an ancestor trail for breadcrumb rendering.
// Shape mirrors getNodeSummons so the renderer doesn't fork.
// ─────────────────────────────────────────────────────────────────────────
async function getSummonChain(summonId, { maxDescendants = 200, maxDepth = 20, includeAncestors = true } = {}) {
  if (!summonId) throw new Error("Missing required parameter: summonId");
  try {
    const focus = await Summon.findById(summonId)
      .populate({ path: "treeContext.targetNodeId", select: "name", model: "Node" })
      .populate({ path: "llmProvider.connectionId", select: "name model", model: "LlmConnection" })
      .lean();
    if (!focus) {
      return { message: `No chat found for id ${summonId}`, sessions: [], ancestors: [] };
    }

    // Walk down via parentSummonId. Cap total descendants and depth so a
    // pathological chain never eats the request budget.
    const collected = [focus];
    let frontier = [String(focus._id)];
    let depth = 0;
    while (frontier.length > 0 && collected.length < maxDescendants && depth < maxDepth) {
      depth++;
      const kids = await Summon.find({ parentSummonId: { $in: frontier } })
        .populate({ path: "treeContext.targetNodeId", select: "name", model: "Node" })
        .populate({ path: "llmProvider.connectionId", select: "name model", model: "LlmConnection" })
        .lean();
      if (!kids.length) break;
      const remaining = maxDescendants - collected.length;
      const next = kids.slice(0, remaining);
      collected.push(...next);
      frontier = next.map((k) => String(k._id));
    }

    // Walk up via parentSummonId for breadcrumb. Stop at null or session
    // boundary (a chat with a different sessionId is another session's
    // root — shouldn't happen via normal dispatch but guard anyway).
    const ancestors = [];
    if (includeAncestors) {
      let cursorId = focus.parentSummonId ? String(focus.parentSummonId) : null;
      let hops = 0;
      while (cursorId && hops < 20) {
        hops++;
        const parent = await Summon.findById(cursorId)
          .select("_id sessionId chainIndex aiContext treeContext parentSummonId startMessage endMessage dispatchOrigin")
          .populate({ path: "treeContext.targetNodeId", select: "name", model: "Node" })
          .lean();
        if (!parent) break;
        if (String(parent.sessionId) !== String(focus.sessionId)) break;
        ancestors.unshift(parent);
        cursorId = parent.parentSummonId ? String(parent.parentSummonId) : null;
      }
    }

    await attachContributions(collected);

    // The renderer's `groupIntoChains` treats a chat as the chain root
    // only if `chainIndex === 0` OR `_id === rootSummonId`. In a focused
    // subtree the focus chat is neither — it inherited the session's
    // original rootSummonId (a user turn higher up). Rewrite rootSummonId
    // on the in-memory copies so the renderer groups the focused chain
    // correctly: all collected chats map to focus._id, focus itself
    // becomes the chain root. Doesn't touch DB.
    const focusIdStr = String(focus._id);
    for (const c of collected) {
      c.rootSummonId = focusIdStr;
    }

    return {
      message: "AI chat chain retrieved successfully",
      sessions: groupIntoSessions([String(focus.sessionId)], collected),
      ancestors,
    };
  } catch (err) {
    log.error("AI", "getSummonChain:", err.message);
    throw new Error(err.message || "Database error occurred while retrieving chat chain.");
  }
}

// ─────────────────────────────────────────────────────────────────────────
// PORTAL ADDRESS QUERIES
//
// Every chat is one stance addressing another. The canonical Portal
// Address — `<stance> :: <stance>` sorted lexicographically — is the
// natural identifier for grouping chats. There is no separate "thread"
// concept; "show me the conversation at this IBP Address" is just a
// query on `Chat.ibpAddress`.
//
// IBP Address queries co-exist with the position-centric and
// asker-centric queries above:
//   - getSummons        — asker-centric ("messages I sent").
//   - getNodeSummons    — position-centric ("messages that touched
//                       this node").
//   - getSummonsByIbpAddress / getIbpAddressesForBeing — stance-pair
//                       ("conversations at this IBP Address" or
//                       "every IBP Address this being is in").
//
// Position changes fork IBP Addresses naturally — the asker stance
// includes their current position, so navigating to a new position
// lands their next chat at a new IBP Address. The old IBP Address
// remains in history with its accumulated chats; the new one starts
// accumulating from there.
// ─────────────────────────────────────────────────────────────────────────

function MAX_CHATS_PER_PORTAL_ADDRESS() { return Math.max(20, Math.min(Number(getLandConfigValue("summonHistoryMaxSummonsPerIbpAddress")) || 500, 5000)); }
function MAX_PORTAL_ADDRESSES_PER_BEING() { return Math.max(10, Math.min(Number(getLandConfigValue("summonHistoryMaxIbpAddressesPerBeing")) || 200, 2000)); }

/**
 * Get every chat at an IBP Address, oldest-first.
 *
 * Pass `ibpAddress` directly when you already have it, OR `stances`
 * (an array of two stance strings) and the helper canonicalizes it for
 * you. Time-bounded queries pass startDate / endDate. The IBP Address
 * index `{ ibpAddress: 1, "startMessage.time": -1 }` handles both
 * shapes efficiently.
 */
async function getSummonsByIbpAddress({ ibpAddress, stances, startDate, endDate, limit } = {}) {
  let address = ibpAddress;
  if (!address && Array.isArray(stances) && stances.length === 2) {
    address = canonicalIbpAddress(stances[0], stances[1]);
  }
  if (!address) throw new Error("getSummonsByIbpAddress requires ibpAddress or stances[2]");

  const cap = Math.max(1, Math.min(Number(limit) || MAX_CHATS_PER_PORTAL_ADDRESS(), MAX_CHATS_PER_PORTAL_ADDRESS()));
  const query = { ibpAddress: address };
  const timeFilter = buildTimeFilter(startDate, endDate);
  if (timeFilter) query["startMessage.time"] = timeFilter;

  try {
    const chats = await Summon.find(query)
      .sort({ "startMessage.time": 1 })
      .limit(cap)
      .select("_id beingIn beingOut ibpAddress sessionId chainIndex rootSummonId parentSummonId dispatchOrigin startMessage endMessage aiContext treeContext llmProvider toolCalls")
      .lean();
    return {
      ibpAddress: address,
      chats,
      count: chats.length,
      truncated: chats.length >= cap,
    };
  } catch (err) {
    log.error("AI", "getSummonsByIbpAddress:", err.message);
    throw new Error(err.message || "Database error while retrieving IBP Address chats.");
  }
}

/**
 * List the distinct IBP Addresses a being participates in,
 * most-recent first.
 *
 * Inbox query. Returns one entry per IBP Address with the latest
 * exchange surfaced for rendering:
 *
 *   { ibpAddress, otherStances, lastChatId, lastTime, startMessage,
 *     endMessage, chatCount }
 *
 * `otherStances` is every stance in the IBP Address except the
 * being's — useful for labelling the inbox entry by who else is in
 * the conversation. The being is identified by matching their username
 * against the stance suffix (`@<username>`), so a being conversing
 * from multiple positions appears in each IBP Address they used.
 */
async function getIbpAddressesForBeing({ beingId, username, limit, startDate, endDate } = {}) {
  if (!beingId) throw new Error("getIbpAddressesForBeing requires beingId");
  const cap = Math.max(1, Math.min(Number(limit) || MAX_PORTAL_ADDRESSES_PER_BEING(), MAX_PORTAL_ADDRESSES_PER_BEING()));

  // Match chats where the being is either side. The indexed beingIn /
  // beingOut paths satisfy this OR efficiently; the IBP Address is
  // collapsed in the group stage.
  const match = {
    ibpAddress: { $ne: null },
    $or: [{ beingIn: String(beingId) }, { beingOut: String(beingId) }],
  };
  const timeFilter = buildTimeFilter(startDate, endDate);
  if (timeFilter) match["startMessage.time"] = timeFilter;

  try {
    const agg = await Summon.aggregate([
      { $match: match },
      { $sort: { "startMessage.time": -1 } },
      {
        $group: {
          _id: "$ibpAddress",
          lastChatId:   { $first: "$_id" },
          lastTime:     { $first: "$startMessage.time" },
          startMessage: { $first: "$startMessage" },
          endMessage:   { $first: "$endMessage" },
          beingIn:      { $first: "$beingIn" },
          beingOut:     { $first: "$beingOut" },
          chatCount:    { $sum: 1 },
        },
      },
      { $sort: { lastTime: -1 } },
      { $limit: cap },
    ]);

    const usernameSuffix = username ? `@${String(username)}` : null;
    return agg.map((row) => {
      const stances = parseIbpAddress(row._id);
      const otherStances = usernameSuffix
        ? stances.filter((s) => !s.endsWith(usernameSuffix))
        : stances; // caller didn't pass username — give them all stances
      return {
        ibpAddress: row._id,
        otherStances,
        chatCount:    row.chatCount,
        lastChatId:   row.lastChatId,
        lastTime:     row.lastTime,
        startMessage: row.startMessage,
        endMessage:   row.endMessage,
      };
    });
  } catch (err) {
    log.error("AI", "getIbpAddressesForBeing:", err.message);
    throw new Error(err.message || "Database error while listing IBP Addresses.");
  }
}

export { getSummons, getNodeSummons, getSummonChain, getSummonsByIbpAddress, getIbpAddressesForBeing };
