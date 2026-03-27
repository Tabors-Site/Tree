import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import log from "../../seed/log.js";

let Node = null;
let User = null;
export function setModels(models) { Node = models.Node; User = models.User; }

const router = express.Router();

router.post("/root/:rootId/food", authenticate, async (req, res) => {
  try {
    const { rootId } = req.params;
    const rawMessage = req.body.message;
    const message = Array.isArray(rawMessage) ? rawMessage.join(" ") : rawMessage;
    if (!message) return sendError(res, 400, ERR.INVALID_INPUT, "message required");

    const root = await Node.findById(rootId).select("rootOwner contributors").lean();
    if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Tree not found");

    const userId = req.userId;
    const isOwner = root.rootOwner?.toString() === userId;
    const isContributor = root.contributors?.some(c => c.toString() === userId);
    if (!isOwner && !isContributor) {
      return sendError(res, 403, ERR.FORBIDDEN, "No access to this tree");
    }

    // Check spatial scope: is food blocked at this position?
    const { isExtensionBlockedAtNode } = await import("../../seed/tree/extensionScope.js");
    if (await isExtensionBlockedAtNode("food", rootId)) {
      return sendError(res, 403, ERR.EXTENSION_BLOCKED, "Food tracking is blocked on this branch. Navigate to a branch where food is active.");
    }

    const user = await User.findById(userId).select("username").lean();
    const { runChat } = await import("../../seed/ws/conversation.js");

    // Detect intent: logging food intake vs coaching/planning
    const isLogging = /\b(ate|had|eaten|drank|i ate|i had|logged|breakfast|lunch|dinner|snack|\d+\s*cal|\d+\s*g\b)/i.test(message);
    const mode = isLogging ? "tree:food-log" : "tree:food-coach";

    const { answer, chatId } = await runChat({
      userId,
      username: user.username,
      message,
      mode,
      rootId,
      res,
    });

    if (!res.headersSent) sendOk(res, { answer, chatId, mode });
  } catch (err) {
    log.error("Food", "Chat error:", err.message);
    if (!res.headersSent) sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
