import express from "express";
import authenticate from "../../middleware/authenticate.js";
import Node from "../../db/models/node.js";
import User from "../../db/models/user.js";
import log from "../../core/log.js";

const router = express.Router();

router.post("/root/:rootId/fitness", authenticate, async (req, res) => {
  try {
    const { rootId } = req.params;
    const rawMessage = req.body.message;
    const message = Array.isArray(rawMessage) ? rawMessage.join(" ") : rawMessage;
    if (!message) return res.status(400).json({ error: "message required" });

    const root = await Node.findById(rootId).select("rootOwner contributors").lean();
    if (!root) return res.status(404).json({ error: "Tree not found" });

    const userId = req.userId;
    const isOwner = root.rootOwner?.toString() === userId;
    const isContributor = root.contributors?.some(c => c.toString() === userId);
    if (!isOwner && !isContributor) {
      return res.status(403).json({ error: "No access to this tree" });
    }

    const user = await User.findById(userId).select("username").lean();
    const { runChat } = await import("../../ws/conversation.js");

    // Detect intent: logging (numbers, reps, sets, weights) vs coaching (everything else)
    const isLogging = /\b(\d+\s*x\s*\d+|\d+\s*reps?|\d+\s*sets?|\d+\s*lbs?|\d+\s*kg|logged|done|finished|completed)\b/i.test(message);
    const mode = isLogging ? "tree:fitness-log" : "tree:fitness-coach";

    const { answer, aiChatId } = await runChat({
      userId,
      username: user.username,
      message,
      mode,
      rootId,
      res,
    });

    res.json({ success: true, answer, aiChatId, mode });
  } catch (err) {
    log.error("Fitness", "Chat error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
