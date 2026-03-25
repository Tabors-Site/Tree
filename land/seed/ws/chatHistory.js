import log from "../log.js";
import Chat from "../models/chat.js";
import Contribution from "../models/contribution.js";
import { getDescendantIds } from "../tree/treeFetch.js";

async function getChats({
  userId,
  sessionLimit = 10,
  sessionId,
  startDate,
  endDate,
}) {
  try {
    if (!userId) {
      throw new Error("Missing required parameter: userId");
    }

    if (
      sessionLimit !== undefined &&
      (typeof sessionLimit !== "number" || sessionLimit <= 0)
    ) {
      throw new Error("Invalid sessionLimit: must be a positive number");
    }

    const query = { userId };

    if (sessionId) {
      query.sessionId = sessionId;
    }

    if (startDate || endDate) {
      query["startMessage.time"] = {};
      if (startDate) query["startMessage.time"].$gte = new Date(startDate);
      if (endDate) query["startMessage.time"].$lte = new Date(endDate);
    }

    // Step 1: Find the N most recent distinct sessions
    const sessionIds = sessionId
      ? [sessionId]
      : await Chat.aggregate([
          { $match: query },
          { $sort: { "startMessage.time": -1 } },
          {
            $group: {
              _id: "$sessionId",
              latestTime: { $first: "$startMessage.time" },
            },
          },
          { $sort: { latestTime: -1 } },
          { $limit: sessionLimit },
          { $project: { _id: 1 } },
        ]).then((docs) => docs.map((d) => d._id));

    if (!sessionIds.length) {
      return {
        message: `No AI chats found for user ${userId}`,
        sessions: [],
      };
    }

    // Step 2: Fetch all chats belonging to those sessions
    const chats = await Chat.find({
      userId,
      sessionId: { $in: sessionIds },
      ...(startDate || endDate
        ? { "startMessage.time": query["startMessage.time"] }
        : {}),
    })
      .populate({
        path: "contributions",
        select:
          "_id action nodeId nodeVersion wasAi energyUsed date extensionData",
        populate: { path: "nodeId", select: "name" },
      })
      .populate({
        path: "treeContext.targetNodeId",
        select: "name",
        model: "Node",
      })
      .populate({
        path: "llmProvider.connectionId",
        select: "name model",
        model: "LlmConnection",
      })
      .sort({ "startMessage.time": -1 })
      .lean();

    // Step 2b: Direct chatId lookup — always accurate, works for in-progress chats
    const chatIds = chats.map((c) => c._id);
    const directContribs = await Contribution.find({
      chatId: { $in: chatIds },
    })
      .select(
        "_id action nodeId nodeVersion wasAi energyUsed date understandingMeta chatId",
      )
      .populate({ path: "nodeId", select: "name" })
      .lean();

    if (directContribs.length > 0) {
      const contribsByChat = new Map();
      for (const c of directContribs) {
        const key = String(c.chatId);
        if (!contribsByChat.has(key)) contribsByChat.set(key, []);
        contribsByChat.get(key).push(c);
      }
      for (const chat of chats) {
        const direct = contribsByChat.get(String(chat._id));
        if (direct) chat.contributions = direct;
      }
    }

    // Step 3: Group into sessions (preserving newest-session-first order)
    const sessionMap = new Map();
    for (const sid of sessionIds) {
      sessionMap.set(sid, []);
    }

    for (const chat of chats) {
      const sid = chat.sessionId || "unknown";
      if (sessionMap.has(sid)) {
        sessionMap.get(sid).push(chat);
      }
    }
    // Sort each session's chats: time ascending (groups chains together), then chainIndex ascending (orders steps within chain)
    const sessions = sessionIds
      .filter((sid) => sessionMap.get(sid).length > 0)
      .map((sid) => {
        const sessionChats = sessionMap.get(sid).sort((a, b) => {
          const ta = new Date(a.startMessage?.time || 0).getTime();
          const tb = new Date(b.startMessage?.time || 0).getTime();
          if (ta !== tb) return ta - tb;
          return a.chainIndex - b.chainIndex;
        });
        return {
          sessionId: sid,
          chats: sessionChats,
          startTime: sessionChats[0]?.startMessage?.time || null,
          chatCount: sessionChats.length,
        };
      });

    return {
      message: "AI chats retrieved successfully",
      sessions,
    };
  } catch (err) {
    log.error("AI", "getChats:", err);
    throw new Error(
      err.message || "Database error occurred while retrieving AI chats.",
    );
  }
}

async function getNodeChats({
  nodeId,
  sessionLimit = 10,
  sessionId,
  startDate,
  endDate,
  includeChildren = false,
}) {
  try {
    if (!nodeId) {
      throw new Error("Missing required parameter: nodeId");
    }

    if (
      sessionLimit !== undefined &&
      (typeof sessionLimit !== "number" || sessionLimit <= 0)
    ) {
      throw new Error("Invalid sessionLimit: must be a positive number");
    }

    // Resolve target node IDs (just this node, or all descendants)
    const nodeIds = includeChildren ? await getDescendantIds(nodeId) : [nodeId];

    // Path A: Find sessionIds via Contributions that touched these nodes
    const contribQuery = { nodeId: { $in: nodeIds } };
    if (startDate || endDate) {
      contribQuery.date = {};
      if (startDate) contribQuery.date.$gte = new Date(startDate);
      if (endDate) contribQuery.date.$lte = new Date(endDate);
    }
    const contribSessionIds = await Contribution.distinct(
      "sessionId",
      contribQuery,
    );

    // Path B: Find sessionIds via Chat.treeContext.targetNodeId
    const treeCtxQuery = { "treeContext.targetNodeId": { $in: nodeIds } };
    if (startDate || endDate) {
      treeCtxQuery["startMessage.time"] = {};
      if (startDate)
        treeCtxQuery["startMessage.time"].$gte = new Date(startDate);
      if (endDate) treeCtxQuery["startMessage.time"].$lte = new Date(endDate);
    }
    const treeCtxSessionIds = await Chat.distinct("sessionId", treeCtxQuery);

    // Union and deduplicate
    const allSessionIds = [
      ...new Set([...contribSessionIds, ...treeCtxSessionIds]),
    ].filter(Boolean);

    if (sessionId) {
      // If filtering to a specific session, only keep it if it's in our set
      if (!allSessionIds.includes(sessionId)) {
        return {
          message: `No AI chats found for node ${nodeId}`,
          sessions: [],
        };
      }
    }

    if (allSessionIds.length === 0) {
      return { message: `No AI chats found for node ${nodeId}`, sessions: [] };
    }

    // Apply sessionLimit: find the N most recent sessions
    const targetSessionIds = sessionId
      ? [sessionId]
      : await Chat.aggregate([
          { $match: { sessionId: { $in: allSessionIds } } },
          { $sort: { "startMessage.time": -1 } },
          {
            $group: {
              _id: "$sessionId",
              latestTime: { $first: "$startMessage.time" },
            },
          },
          { $sort: { latestTime: -1 } },
          { $limit: sessionLimit },
          { $project: { _id: 1 } },
        ]).then((docs) => docs.map((d) => d._id));

    if (!targetSessionIds.length) {
      return { message: `No AI chats found for node ${nodeId}`, sessions: [] };
    }

    // Fetch all chats belonging to those sessions
    const chats = await Chat.find({
      sessionId: { $in: targetSessionIds },
    })
      .populate({
        path: "userId",
        select: "username",
        model: "User",
      })
      .populate({
        path: "contributions",
        select:
          "_id action nodeId nodeVersion wasAi energyUsed date extensionData",
        populate: { path: "nodeId", select: "name" },
      })
      .populate({
        path: "treeContext.targetNodeId",
        select: "name",
        model: "Node",
      })
      .populate({
        path: "llmProvider.connectionId",
        select: "name model",
        model: "LlmConnection",
      })
      .sort({ "startMessage.time": -1 })
      .lean();

    // Direct chatId lookup
    const chatIds = chats.map((c) => c._id);
    const directContribs = await Contribution.find({
      chatId: { $in: chatIds },
    })
      .select(
        "_id action nodeId nodeVersion wasAi energyUsed date understandingMeta chatId",
      )
      .populate({ path: "nodeId", select: "name" })
      .lean();

    if (directContribs.length > 0) {
      const contribsByChat = new Map();
      for (const c of directContribs) {
        const key = String(c.chatId);
        if (!contribsByChat.has(key)) contribsByChat.set(key, []);
        contribsByChat.get(key).push(c);
      }
      for (const chat of chats) {
        const direct = contribsByChat.get(String(chat._id));
        if (direct) chat.contributions = direct;
      }
    }

    // Group into sessions
    const sessionMap = new Map();
    for (const sid of targetSessionIds) {
      sessionMap.set(sid, []);
    }
    for (const chat of chats) {
      const sid = chat.sessionId || "unknown";
      if (sessionMap.has(sid)) {
        sessionMap.get(sid).push(chat);
      }
    }

    const sessions = targetSessionIds
      .filter((sid) => sessionMap.get(sid).length > 0)
      .map((sid) => {
        const sessionChats = sessionMap.get(sid).sort((a, b) => {
          const ta = new Date(a.startMessage?.time || 0).getTime();
          const tb = new Date(b.startMessage?.time || 0).getTime();
          if (ta !== tb) return ta - tb;
          return a.chainIndex - b.chainIndex;
        });
        return {
          sessionId: sid,
          chats: sessionChats,
          startTime: sessionChats[0]?.startMessage?.time || null,
          chatCount: sessionChats.length,
        };
      });

    return {
      message: "AI chats retrieved successfully",
      sessions,
    };
  } catch (err) {
    log.error("AI", "getNodeChats:", err);
    throw new Error(
      err.message || "Database error occurred while retrieving AI chats.",
    );
  }
}

export { getChats, getNodeChats };
