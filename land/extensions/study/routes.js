import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import log from "../../seed/log.js";
import NodeModel from "../../seed/models/node.js";
import UserModel from "../../seed/models/user.js";
import {
  isInitialized,
  getStudyProgress,
  getGaps,
  addToQueue,
  switchToTopic,
  deactivateTopic,
  removeFromQueue,
} from "./core.js";
import { handleMessage } from "./handler.js";

let Node = NodeModel;
export function setServices({ Node: N }) { if (N) Node = N; }

const router = express.Router();

/**
 * POST /root/:rootId/study
 */
router.post("/root/:rootId/study", authenticate, async (req, res) => {
  try {
    const { rootId } = req.params;
    const rawMessage = req.body.message;
    const message = Array.isArray(rawMessage) ? rawMessage.join(" ") : (rawMessage || "");

    const root = await Node.findById(rootId).select("rootOwner contributors").lean();
    if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Tree not found");

    const userId = req.userId;
    const isOwner = root.rootOwner?.toString() === userId;
    const isContributor = root.contributors?.some(c => c.toString() === userId);
    if (!isOwner && !isContributor) return sendError(res, 403, ERR.FORBIDDEN, "No access");

    const { isExtensionBlockedAtNode } = await import("../../seed/tree/extensionScope.js");
    if (await isExtensionBlockedAtNode("study", rootId)) {
      return sendError(res, 403, ERR.EXTENSION_BLOCKED, "Study is blocked on this branch.");
    }

    const user = await UserModel.findById(userId).select("username").lean();
    const username = user?.username || "user";

    const result = await handleMessage(message, { userId, username, rootId, res });

    if (result.error) {
      if (!res.headersSent) sendError(res, result.status || 500, result.code || ERR.INTERNAL, result.message);
      return;
    }

    if (!res.headersSent) sendOk(res, result);
  } catch (err) {
    log.error("Study", "Route error:", err.message);
    if (!res.headersSent) sendError(res, 500, ERR.INTERNAL, "Study request failed");
  }
});

/**
 * POST /root/:rootId/study/queue - needlearn shortcut
 */
router.post("/root/:rootId/study/queue", authenticate, async (req, res) => {
  try {
    const { rootId } = req.params;
    const rawTopic = req.body.topic;
    const topic = Array.isArray(rawTopic) ? rawTopic.join(" ") : rawTopic;
    if (!topic) return sendError(res, 400, ERR.INVALID_INPUT, "topic required");

    if (!(await isInitialized(rootId))) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Study tree not initialized. Use 'study' first.");
    }

    const isUrl = /^https?:\/\//.test(topic);
    const result = await addToQueue(rootId, topic, req.userId, { url: isUrl ? topic : null });
    sendOk(res, { queued: result.name, url: isUrl || undefined });
  } catch (err) {
    log.error("Study", "Queue error:", err.message);
    sendError(res, 500, ERR.INTERNAL, "Queue add failed");
  }
});

/**
 * GET /root/:rootId/study/status
 */
router.get("/root/:rootId/study/status", authenticate, async (req, res) => {
  try {
    const progress = await getStudyProgress(req.params.rootId);
    if (!progress) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Study tree not found");
    sendOk(res, progress);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, "Status failed");
  }
});

/**
 * GET /root/:rootId/study/gaps
 */
router.get("/root/:rootId/study/gaps", authenticate, async (req, res) => {
  try {
    const gaps = await getGaps(req.params.rootId);
    sendOk(res, { gaps });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, "Gaps failed");
  }
});

/**
 * POST /root/:rootId/study/switch - activate a queue item
 */
router.post("/root/:rootId/study/switch", authenticate, async (req, res) => {
  try {
    const { rootId } = req.params;
    const rawTopic = req.body.topic;
    const topic = Array.isArray(rawTopic) ? rawTopic.join(" ") : rawTopic;
    if (!topic) return sendError(res, 400, ERR.INVALID_INPUT, "topic required");

    if (!(await isInitialized(rootId))) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Study tree not initialized.");
    }

    const result = await switchToTopic(rootId, topic, req.userId);
    if (result.alreadyActive) {
      sendOk(res, { answer: `"${result.name}" is already active.`, name: result.name });
    } else {
      sendOk(res, { answer: `Switched to "${result.name}".`, name: result.name });
    }
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * POST /root/:rootId/study/deactivate - move active topic back to queue
 */
router.post("/root/:rootId/study/deactivate", authenticate, async (req, res) => {
  try {
    const { rootId } = req.params;
    const rawTopic = req.body.topic;
    const topic = Array.isArray(rawTopic) ? rawTopic.join(" ") : rawTopic;
    if (!topic) return sendError(res, 400, ERR.INVALID_INPUT, "topic required");

    if (!(await isInitialized(rootId))) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Study tree not initialized.");
    }

    const result = await deactivateTopic(rootId, topic, req.userId);
    sendOk(res, { answer: `Deactivated "${result.name}". Moved back to queue.`, name: result.name });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * POST /root/:rootId/study/remove - delete from queue or active
 */
router.post("/root/:rootId/study/remove", authenticate, async (req, res) => {
  try {
    const { rootId } = req.params;
    const rawTopic = req.body.topic;
    const topic = Array.isArray(rawTopic) ? rawTopic.join(" ") : rawTopic;
    if (!topic) return sendError(res, 400, ERR.INVALID_INPUT, "topic required");

    if (!(await isInitialized(rootId))) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Study tree not initialized.");
    }

    const result = await removeFromQueue(rootId, topic, req.userId);
    sendOk(res, { answer: `Removed "${result.name}".`, name: result.name });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
