import AIChat from "../db/models/aiChat.js";

async function getAIChats({
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
      : await AIChat.aggregate([
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
    const chats = await AIChat.find({
      userId,
      sessionId: { $in: sessionIds },
      ...(startDate || endDate
        ? { "startMessage.time": query["startMessage.time"] }
        : {}),
    })
      .populate({
        path: "contributions",
        select: "_id action nodeId nodeVersion wasAi energyUsed date",
        populate: { path: "nodeId", select: "name" },
      })
      .populate({
        path: "treeContext.targetNodeId",
        select: "name",
        model: "Node",
      })
      .sort({ "startMessage.time": -1, chainIndex: -1 })
      .lean();

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
    // Reverse each session's chats → chronological (oldest first)
    const sessions = sessionIds
      .filter((sid) => sessionMap.get(sid).length > 0)
      .map((sid) => {
        const sessionChats = sessionMap.get(sid).reverse();
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
    console.error("Error in getAIChats:", err);
    throw new Error(
      err.message || "Database error occurred while retrieving AI chats.",
    );
  }
}

export { getAIChats };
