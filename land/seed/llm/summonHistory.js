// TreeOS Seed . AGPL-3.0 . https://treeos.ai
//
// summonHistory.js — read surface for Summon records on the slim shape.
//
// Conversation grouping under the slim shape:
//   sessionId           → rootCorrelation        (the chain root id)
//   parentSummonId      → inReplyTo              (reply graph)
//   rootSummonId        → rootCorrelation        (chain root)
//   startMessage.time   → summonedAt             (wake time)
//   chainIndex          → ordering by summonedAt
//   aiContext.mode      → activeRole
//   treeContext.targetNodeId → not on Summon; readers walk substrate
//   toolCalls[]         → Did.find({ summonId, action: "tool-call" })
//
// Existing API surface preserved (getSummons/getNodeSummons/getSummonChain/
// getSummonsByIbpAddress/getIbpAddressesForBeing) so callers don't change.
// Internally "session" now means "chain root" — a rootCorrelation groups
// every Summon in one reply tree.
import log from "../log.js";
import Summon from "../models/summon.js";
import Did from "../models/did.js";
import { getDescendantIds } from "../tree/treeFetch.js";
import { getLandConfigValue } from "../landConfig.js";
import { canonicalIbpAddress, parseIbpAddress } from "./ibpAddress.js";

// ─────────────────────────────────────────────────────────────────────────
// LIMITS
// ─────────────────────────────────────────────────────────────────────────

function MAX_SESSION_LIMIT()       { return Math.max(1, Math.min(Number(getLandConfigValue("summonHistoryMaxSessions")) || 50, 500)); }
function MAX_CHATS_PER_SESSION()   { return Math.max(1, Math.min(Number(getLandConfigValue("summonHistoryMaxPerSession")) || 200, 2000)); }
function MAX_DESCENDANT_IDS()      { return Math.max(10, Math.min(Number(getLandConfigValue("summonHistoryMaxDescendantIds")) || 500, 10000)); }
function MAX_CONTRIBUTIONS_PER_QUERY() { return Math.max(100, Math.min(Number(getLandConfigValue("summonHistoryMaxDids")) || 5000, 50000)); }
function MAX_CHATS_PER_PORTAL_ADDRESS() { return Math.max(20, Math.min(Number(getLandConfigValue("summonHistoryMaxSummonsPerIbpAddress")) || 500, 5000)); }
function MAX_PORTAL_ADDRESSES_PER_BEING() { return Math.max(10, Math.min(Number(getLandConfigValue("summonHistoryMaxIbpAddressesPerBeing")) || 200, 2000)); }

// ─────────────────────────────────────────────────────────────────────────
// SHARED HELPERS
// ─────────────────────────────────────────────────────────────────────────

function clampSessionLimit(sessionLimit) {
  const n = Number(sessionLimit);
  if (!n || n <= 0) return 10;
  return Math.min(n, MAX_SESSION_LIMIT());
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

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
 * Find the N most-recent distinct rootCorrelations matching a query.
 * A rootCorrelation groups every Summon in one reply tree — the new
 * "session" for grouping purposes.
 */
async function findRecentRootCorrelations(matchQuery, limit) {
  return Summon.aggregate([
    { $match: matchQuery },
    { $sort: { summonedAt: -1 } },
    { $group: { _id: "$rootCorrelation", latestTime: { $first: "$summonedAt" } } },
    { $sort: { latestTime: -1 } },
    { $limit: limit },
    { $project: { _id: 1 } },
  ]).then((docs) => docs.map((d) => d._id).filter(Boolean));
}

/**
 * Fetch Summons under a list of rootCorrelations.
 * Caps per-root results to MAX_CHATS_PER_SESSION.
 */
async function fetchSummonsForRoots(roots, extraMatch = {}, populateUser = false) {
  const query = { rootCorrelation: { $in: roots }, ...extraMatch };
  const q = Summon.find(query);
  if (populateUser) q.populate({ path: "beingIn", select: "username", model: "Being" });
  q.populate({ path: "llmProvider.connectionId", select: "name model", model: "LlmConnection" });
  q.sort({ summonedAt: -1 });
  q.limit(MAX_CHATS_PER_SESSION() * roots.length);
  return q.lean();
}

/**
 * Attach Dids (action="tool-call" plus other audit entries) by direct
 * summonId lookup. More accurate than any in-document array.
 */
async function attachDids(summons) {
  if (!summons.length) return;
  const summonIds = summons.map((s) => s._id);
  const dids = await Did.find({ summonId: { $in: summonIds } })
    .select("_id action nodeId date extensionData summonId toolCall")
    .populate({ path: "nodeId", select: "name" })
    .limit(MAX_CONTRIBUTIONS_PER_QUERY())
    .lean();
  if (!dids.length) return;
  const byChat = new Map();
  for (const d of dids) {
    const key = String(d.summonId);
    if (!byChat.has(key)) byChat.set(key, []);
    byChat.get(key).push(d);
  }
  for (const s of summons) {
    const direct = byChat.get(String(s._id));
    if (direct) s.dids = direct;
  }
}

/**
 * Group Summons into chains, one per rootCorrelation, ordered by
 * summonedAt. Returns chain objects with metadata. The legacy field
 * name `sessions` is preserved for the renderer's external shape.
 */
function groupIntoChains(roots, summons) {
  const byRoot = new Map();
  for (const r of roots) byRoot.set(r, []);
  for (const s of summons) {
    const k = s.rootCorrelation || "unknown";
    if (byRoot.has(k)) byRoot.get(k).push(s);
  }
  return roots
    .filter((r) => byRoot.get(r) && byRoot.get(r).length > 0)
    .map((r) => {
      const chain = byRoot.get(r).sort((a, b) => {
        const ta = new Date(a.summonedAt || 0).getTime();
        const tb = new Date(b.summonedAt || 0).getTime();
        return ta - tb;
      });
      const capped = chain.slice(0, MAX_CHATS_PER_SESSION());
      return {
        sessionId:  r,         // legacy name kept for renderer compat
        chats:      capped,
        startTime:  capped[0]?.summonedAt || null,
        chatCount:  capped.length,
        truncated:  chain.length > MAX_CHATS_PER_SESSION(),
      };
    });
}

// ─────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get Summon history for a being, grouped by chain (rootCorrelation).
 * Returns the N most recent chains.
 */
async function getSummons({ beingId, sessionLimit = 10, sessionId, startDate, endDate }) {
  if (!beingId) throw new Error("Missing required parameter: beingId");
  const limit = clampSessionLimit(sessionLimit);
  const timeFilter = buildTimeFilter(startDate, endDate);

  try {
    // "A being's history" = every Summon they initiated (beingIn).
    const matchQuery = { beingIn: beingId };
    if (timeFilter) matchQuery.summonedAt = timeFilter;

    const roots = sessionId
      ? [sessionId]
      : await findRecentRootCorrelations(matchQuery, limit);

    if (!roots.length) {
      return { message: `No AI chats found for being ${beingId}`, sessions: [] };
    }

    const extraMatch = {};
    if (timeFilter) extraMatch.summonedAt = timeFilter;

    const summons = await fetchSummonsForRoots(roots, extraMatch);
    await attachDids(summons);

    return {
      message: "AI chats retrieved successfully",
      sessions: groupIntoChains(roots, summons),
    };
  } catch (err) {
    log.error("AI", "getSummons:", err.message);
    throw new Error(err.message || "Database error occurred while retrieving AI chats.");
  }
}

/**
 * Get Summon history for a node (and optionally its descendants),
 * grouped by chain. Surfaces chains that touched the node via a Did.
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

    // The Summon row no longer carries treeContext.targetNodeId; Dids
    // (audit log of DO emissions, including tool calls) are the source
    // of truth for "what nodes did this chain touch."
    const didQuery = { nodeId: { $in: nodeIds } };
    if (timeFilter) didQuery.date = timeFilter;
    const touchedSummonIds = await Did.distinct("summonId", didQuery);
    if (!touchedSummonIds.length) {
      return { message: `No AI chats found for node ${nodeId}`, sessions: [] };
    }

    // Resolve the rootCorrelations covering those Summon ids.
    const roots = await Summon.distinct("rootCorrelation", { _id: { $in: touchedSummonIds } });
    const filtered = roots.filter(Boolean);

    if (sessionId && !filtered.includes(sessionId)) {
      return { message: `No AI chats found for node ${nodeId}`, sessions: [] };
    }
    if (!filtered.length) {
      return { message: `No AI chats found for node ${nodeId}`, sessions: [] };
    }

    const targetRoots = sessionId
      ? [sessionId]
      : await findRecentRootCorrelations({ rootCorrelation: { $in: filtered } }, limit);

    if (!targetRoots.length) {
      return { message: `No AI chats found for node ${nodeId}`, sessions: [] };
    }

    const summons = await fetchSummonsForRoots(targetRoots, {}, true);
    await attachDids(summons);

    return {
      message: "AI chats retrieved successfully",
      sessions: groupIntoChains(targetRoots, summons),
    };
  } catch (err) {
    log.error("AI", "getNodeSummons:", err.message);
    throw new Error(err.message || "Database error occurred while retrieving AI chats.");
  }
}

/**
 * Fetch a single Summon + its descendants via inReplyTo BFS, plus an
 * ancestor trail for breadcrumb rendering. Shape mirrors getNodeSummons
 * so the renderer doesn't fork.
 */
async function getSummonChain(summonId, { maxDescendants = 200, maxDepth = 20, includeAncestors = true } = {}) {
  if (!summonId) throw new Error("Missing required parameter: summonId");
  try {
    const focus = await Summon.findById(summonId)
      .populate({ path: "llmProvider.connectionId", select: "name model", model: "LlmConnection" })
      .lean();
    if (!focus) {
      return { message: `No chat found for id ${summonId}`, sessions: [], ancestors: [] };
    }

    // Walk down via inReplyTo. Cap descendants and depth.
    const collected = [focus];
    let frontier = [String(focus._id)];
    let depth = 0;
    while (frontier.length > 0 && collected.length < maxDescendants && depth < maxDepth) {
      depth++;
      const kids = await Summon.find({ inReplyTo: { $in: frontier } })
        .populate({ path: "llmProvider.connectionId", select: "name model", model: "LlmConnection" })
        .lean();
      if (!kids.length) break;
      const remaining = maxDescendants - collected.length;
      const next = kids.slice(0, remaining);
      collected.push(...next);
      frontier = next.map((k) => String(k._id));
    }

    // Walk up via inReplyTo for breadcrumb. Stop on null or chain-root change.
    const ancestors = [];
    if (includeAncestors) {
      let cursorId = focus.inReplyTo ? String(focus.inReplyTo) : null;
      let hops = 0;
      while (cursorId && hops < 20) {
        hops++;
        const parent = await Summon.findById(cursorId)
          .select("_id rootCorrelation activeRole inReplyTo startMessage endMessage summonedAt beingIn beingOut")
          .lean();
        if (!parent) break;
        if (String(parent.rootCorrelation) !== String(focus.rootCorrelation)) break;
        ancestors.unshift(parent);
        cursorId = parent.inReplyTo ? String(parent.inReplyTo) : null;
      }
    }

    await attachDids(collected);

    // The renderer groups by rootCorrelation. In a focused subtree,
    // rewrite rootCorrelation on the in-memory copies so the focus chat
    // becomes the chain root. DB unchanged.
    const focusIdStr = String(focus._id);
    for (const c of collected) {
      c.rootCorrelation = focusIdStr;
    }

    return {
      message: "AI chat chain retrieved successfully",
      sessions: groupIntoChains([focusIdStr], collected),
      ancestors,
    };
  } catch (err) {
    log.error("AI", "getSummonChain:", err.message);
    throw new Error(err.message || "Database error occurred while retrieving chat chain.");
  }
}

// ─────────────────────────────────────────────────────────────────────────
// IBP ADDRESS QUERIES
//
// Stance-pair-centric conversation views. An IBP Address groups every
// Summon between two stances; the row carries it directly. The legacy
// position-centric / asker-centric queries above co-exist; pick whichever
// shape fits the caller.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Every Summon at an IBP Address, oldest-first.
 *
 * Pass `ibpAddress` directly, OR `stances` (array of two stance strings)
 * and the helper canonicalizes. Time-bounded via startDate/endDate.
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
  if (timeFilter) query.summonedAt = timeFilter;

  try {
    const chats = await Summon.find(query)
      .sort({ summonedAt: 1 })
      .limit(cap)
      .select("_id beingIn beingOut ibpAddress activeRole rootCorrelation inReplyTo summonedAt receivedAt startMessage endMessage llmProvider")
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
 * List the distinct IBP Addresses a being participates in, newest first.
 * Returns one row per address with the latest exchange.
 */
async function getIbpAddressesForBeing({ beingId, username, limit, startDate, endDate } = {}) {
  if (!beingId) throw new Error("getIbpAddressesForBeing requires beingId");
  const cap = Math.max(1, Math.min(Number(limit) || MAX_PORTAL_ADDRESSES_PER_BEING(), MAX_PORTAL_ADDRESSES_PER_BEING()));

  const match = {
    ibpAddress: { $ne: null },
    $or: [{ beingIn: String(beingId) }, { beingOut: String(beingId) }],
  };
  const timeFilter = buildTimeFilter(startDate, endDate);
  if (timeFilter) match.summonedAt = timeFilter;

  try {
    const agg = await Summon.aggregate([
      { $match: match },
      { $sort: { summonedAt: -1 } },
      {
        $group: {
          _id:          "$ibpAddress",
          lastChatId:   { $first: "$_id" },
          lastTime:     { $first: "$summonedAt" },
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
        : stances;
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
