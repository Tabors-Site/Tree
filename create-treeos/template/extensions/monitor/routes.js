import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import User from "../../seed/models/user.js";
import Contribution from "../../seed/models/contribution.js";
import log from "../../seed/log.js";

const router = express.Router();

// POST /land/activity - ask about land activity
router.post("/land/activity", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("isAdmin username").lean();
    if (!user || !user.isAdmin) {
      return sendError(res, 403, ERR.FORBIDDEN, "Requires admin.");
    }

    const rawQuery = req.body.query;
    const query = Array.isArray(rawQuery) ? rawQuery.join(" ") : rawQuery;
    if (!query) return sendError(res, 400, ERR.INVALID_INPUT, "query required");

    const { runChat } = await import("../../seed/llm/conversation.js");

    const { answer, chatId } = await runChat({
      userId: req.userId,
      username: user.username,
      message: query,
      mode: "land:monitor",
      res,
    });

    sendOk(res, { answer, chatId });
  } catch (err) {
    log.error("Monitor", "Activity query error:", err.message);
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /land/activity - quick stats without AI (for dashboards, health checks)
router.get("/land/activity", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("isAdmin").lean();
    if (!user || !user.isAdmin) {
      return sendError(res, 403, ERR.FORBIDDEN, "Requires god-tier.");
    }

    const now = new Date();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    const Chat = (await import("../../seed/models/chat.js")).default;
    const { getSessionsForUser } = await import("../../seed/ws/sessionRegistry.js");
    const { hooks } = await import("../../seed/hooks.js");
    const { getLoadedExtensionNames } = await import("../../extensions/loader.js");

    // Aggregate stats
    const [
      contributionsToday,
      contributionsWeek,
      chatsToday,
      chatsWeek,
      totalUsers,
    ] = await Promise.all([
      Contribution.countDocuments({ date: { $gte: oneDayAgo } }),
      Contribution.countDocuments({ date: { $gte: oneWeekAgo } }),
      Chat.countDocuments({ "startMessage.time": { $gte: oneDayAgo } }),
      Chat.countDocuments({ "startMessage.time": { $gte: oneWeekAgo } }),
      User.countDocuments({}),
    ]);

    // Action breakdown today
    const actionBreakdown = await Contribution.aggregate([
      { $match: { date: { $gte: oneDayAgo } } },
      { $group: { _id: "$action", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    // AI mode breakdown today
    const modeBreakdown = await Chat.aggregate([
      { $match: { "startMessage.time": { $gte: oneDayAgo } } },
      { $group: { _id: { zone: "$aiContext.zone", mode: "$aiContext.mode" }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    sendOk(res, {
      period: { today: oneDayAgo, week: oneWeekAgo },
      today: {
        contributions: contributionsToday,
        chats: chatsToday,
        actions: actionBreakdown.map(a => ({ action: a._id, count: a.count })),
        modes: modeBreakdown.map(m => ({ mode: m._id, count: m.count })),
      },
      week: {
        contributions: contributionsWeek,
        chats: chatsWeek,
      },
      system: {
        users: totalUsers,
        extensions: getLoadedExtensionNames().length,
        hooks: hooks.list(),
      },
    });
  } catch (err) {
    log.error("Monitor", "Stats error:", err.message);
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
