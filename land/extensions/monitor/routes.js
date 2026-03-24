import express from "express";
import authenticate from "../../middleware/authenticate.js";
import User from "../../db/models/user.js";
import Contribution from "../../db/models/contribution.js";
import log from "../../core/log.js";

const router = express.Router();

// POST /land/activity - ask about land activity
router.post("/land/activity", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("profileType username").lean();
    if (!user || user.profileType !== "god") {
      return res.status(403).json({ error: "Requires god-tier." });
    }

    const rawQuery = req.body.query;
    const query = Array.isArray(rawQuery) ? rawQuery.join(" ") : rawQuery;
    if (!query) return res.status(400).json({ error: "query required" });

    const { runChat } = await import("../../ws/conversation.js");

    const { answer, aiChatId } = await runChat({
      userId: req.userId,
      username: user.username,
      message: query,
      mode: "land:monitor",
      res,
    });

    res.json({ success: true, answer, aiChatId });
  } catch (err) {
    log.error("Monitor", "Activity query error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /land/activity - quick stats without AI (for dashboards, health checks)
router.get("/land/activity", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("profileType").lean();
    if (!user || user.profileType !== "god") {
      return res.status(403).json({ error: "Requires god-tier." });
    }

    const now = new Date();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    const AIChat = (await import("../../db/models/aiChat.js")).default;
    const { getSessionsForUser } = await import("../../ws/sessionRegistry.js");
    const { hooks } = await import("../../core/hooks.js");
    const { getLoadedExtensionNames } = await import("../../extensions/loader.js");

    // Aggregate stats
    const [
      contributionsToday,
      contributionsWeek,
      aiChatsToday,
      aiChatsWeek,
      totalUsers,
    ] = await Promise.all([
      Contribution.countDocuments({ date: { $gte: oneDayAgo } }),
      Contribution.countDocuments({ date: { $gte: oneWeekAgo } }),
      AIChat.countDocuments({ "startMessage.time": { $gte: oneDayAgo } }),
      AIChat.countDocuments({ "startMessage.time": { $gte: oneWeekAgo } }),
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
    const modeBreakdown = await AIChat.aggregate([
      { $match: { "startMessage.time": { $gte: oneDayAgo } } },
      { $group: { _id: "$aiContext.path", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    res.json({
      period: { today: oneDayAgo, week: oneWeekAgo },
      today: {
        contributions: contributionsToday,
        aiChats: aiChatsToday,
        actions: actionBreakdown.map(a => ({ action: a._id, count: a.count })),
        modes: modeBreakdown.map(m => ({ mode: m._id, count: m.count })),
      },
      week: {
        contributions: contributionsWeek,
        aiChats: aiChatsWeek,
      },
      system: {
        users: totalUsers,
        extensions: getLoadedExtensionNames().length,
        hooks: hooks.list(),
      },
    });
  } catch (err) {
    log.error("Monitor", "Stats error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
