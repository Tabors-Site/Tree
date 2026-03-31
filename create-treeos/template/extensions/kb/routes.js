import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import log from "../../seed/log.js";
import NodeModel from "../../seed/models/node.js";
import UserModel from "../../seed/models/user.js";
import {
  isInitialized,
  getStatus,
  getStaleNotes,
  getUnplaced,
} from "./core.js";
import { handleMessage } from "./handler.js";

const router = express.Router();

// ── HTML Dashboard (GET with ?html) ──
router.get("/root/:rootId/kb", async (req, res, next) => {
  if (!("html" in req.query)) return next();
  try {
    const { isHtmlEnabled } = await import("../html-rendering/config.js");
    if (!isHtmlEnabled()) return next();
    const urlAuth = (await import("../html-rendering/urlAuth.js")).default;
    urlAuth(req, res, async () => {
      const { rootId } = req.params;
      const root = await NodeModel.findById(rootId).select("name metadata").lean();
      if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Not found");

      let status = null, stale = null, unplaced = null;
      if (await isInitialized(rootId)) {
        [status, stale, unplaced] = await Promise.all([
          getStatus(rootId), getStaleNotes(rootId), getUnplaced(rootId),
        ]);
      }

      // Check search capabilities
      const { getExtension } = await import("../loader.js");
      const hasEmbed = !!getExtension("embed");
      const hasScout = !!getExtension("scout");

      const { renderKbDashboard } = await import("./pages/dashboard.js");
      res.send(renderKbDashboard({
        rootId,
        rootName: root.name,
        status,
        stale,
        unplaced,
        token: req.query.token || null,
        userId: req.userId,
        hasEmbed,
        hasScout,
        inApp: !!req.query.inApp,
      }));
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, "Dashboard failed");
  }
});

/**
 * POST /root/:rootId/kb
 * Main entry. Routes tell vs ask based on intent.
 */
router.post("/root/:rootId/kb", authenticate, async (req, res) => {
  try {
    const { rootId } = req.params;
    const rawMessage = req.body.message;
    const message = Array.isArray(rawMessage) ? rawMessage.join(" ") : rawMessage;
    if (!message) return sendError(res, 400, ERR.INVALID_INPUT, "message required");

    const root = await NodeModel.findById(rootId).select("rootOwner contributors").lean();
    if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Tree not found");

    const userId = req.userId;
    const isOwner = root.rootOwner?.toString() === userId;
    const isContributor = root.contributors?.some(c => c.toString() === userId);
    if (!isOwner && !isContributor) return sendError(res, 403, ERR.FORBIDDEN, "No access");

    const { isExtensionBlockedAtNode } = await import("../../seed/tree/extensionScope.js");
    if (await isExtensionBlockedAtNode("kb", rootId)) {
      return sendError(res, 403, ERR.EXTENSION_BLOCKED, "KB is blocked on this branch.");
    }

    const user = await UserModel.findById(userId).select("username").lean();
    const username = user?.username || "user";

    const result = await handleMessage(message, { userId, username, rootId, res });

    if (result.error) {
      if (!res.headersSent) sendError(res, result.status || 500, result.code || ERR.FORBIDDEN, result.message);
      return;
    }

    if (!res.headersSent) sendOk(res, result);
  } catch (err) {
    log.error("KB", "Route error:", err.message);
    if (!res.headersSent) sendError(res, 500, ERR.INTERNAL, "KB request failed");
  }
});

router.get("/root/:rootId/kb/status", authenticate, async (req, res) => {
  try {
    const status = await getStatus(req.params.rootId);
    if (!status) return sendError(res, 404, ERR.TREE_NOT_FOUND, "KB not found");
    sendOk(res, status);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, "Status failed");
  }
});

router.get("/root/:rootId/kb/stale", authenticate, async (req, res) => {
  try {
    const stale = await getStaleNotes(req.params.rootId);
    sendOk(res, { stale, count: stale.length });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, "Stale query failed");
  }
});

router.get("/root/:rootId/kb/unplaced", authenticate, async (req, res) => {
  try {
    const items = await getUnplaced(req.params.rootId);
    sendOk(res, { items, count: items.length });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, "Unplaced query failed");
  }
});

export default router;
