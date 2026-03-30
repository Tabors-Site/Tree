import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import log from "../../seed/log.js";
import NodeModel from "../../seed/models/node.js";
import UserModel from "../../seed/models/user.js";
import {
  isInitialized,
  findRecoveryNodes,
  getStatus,
  getPatterns,
  getMilestones,
  getHistory,
  addSubstance,
} from "./core.js";
import { handleMessage } from "./handler.js";

const router = express.Router();

// ── HTML Dashboard (GET with ?html) ──
router.get("/root/:rootId/recovery", async (req, res, next) => {
  if (!("html" in req.query)) return next();
  try {
    const { isHtmlEnabled } = await import("../html-rendering/config.js");
    if (!isHtmlEnabled()) return next();
    const urlAuth = (await import("../html-rendering/urlAuth.js")).default;
    urlAuth(req, res, async () => {
      const { rootId } = req.params;
      const root = await NodeModel.findById(rootId).select("name metadata").lean();
      if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Not found");
      let status = null, milestones = null, patterns = null, history = null;
      if (await isInitialized(rootId)) {
        [status, milestones, patterns, history] = await Promise.all([
          getStatus(rootId), getMilestones(rootId), getPatterns(rootId), getHistory(rootId),
        ]);
      }
      const { renderRecoveryDashboard } = await import("./pages/dashboard.js");
      res.send(renderRecoveryDashboard({ rootId, rootName: root.name, status, milestones, patterns, history, token: req.query.token || null, userId: req.userId }));
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, "Dashboard failed");
  }
});

/**
 * POST /root/:rootId/recovery
 * Main entry point. Three paths: setup, check-in, questions.
 */
router.post("/root/:rootId/recovery", authenticate, async (req, res) => {
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
    if (await isExtensionBlockedAtNode("recovery", rootId)) {
      return sendError(res, 403, ERR.EXTENSION_BLOCKED, "Recovery is blocked on this branch.");
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
    log.error("Recovery", "Route error:", err.message);
    if (!res.headersSent) sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * GET /root/:rootId/recovery/check
 */
router.get("/root/:rootId/recovery/check", authenticate, async (req, res) => {
  try {
    const status = await getStatus(req.params.rootId);
    if (!status) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Recovery tree not found");
    sendOk(res, status);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * GET /root/:rootId/recovery/patterns
 */
router.get("/root/:rootId/recovery/patterns", authenticate, async (req, res) => {
  try {
    const patterns = await getPatterns(req.params.rootId);
    sendOk(res, { patterns });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * GET /root/:rootId/recovery/milestones
 */
router.get("/root/:rootId/recovery/milestones", authenticate, async (req, res) => {
  try {
    const milestones = await getMilestones(req.params.rootId);
    sendOk(res, { milestones });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * GET /root/:rootId/recovery/taper
 */
router.get("/root/:rootId/recovery/taper", authenticate, async (req, res) => {
  try {
    const nodes = await findRecoveryNodes(req.params.rootId);
    if (!nodes) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Recovery tree not found");

    const Note = (await import("../../seed/models/note.js")).default;
    const taperData = {};

    for (const [name, sub] of Object.entries(nodes.substances || {})) {
      if (!sub.schedule) continue;
      const notes = await Note.find({ nodeId: sub.schedule })
        .sort({ createdAt: 1 })
        .select("content createdAt")
        .lean();
      taperData[name] = notes.map(n => n.content);

      // Current dose values
      if (sub.doses) {
        const doseNode = await NodeModel.findById(sub.doses).select("metadata").lean();
        const values = doseNode?.metadata instanceof Map ? doseNode.metadata.get("values") : doseNode?.metadata?.values;
        if (values) {
          taperData[name + "_status"] = {
            today: values.today || 0,
            target: values.target || 0,
            finalTarget: values.finalTarget || 0,
            streak: values.streak || 0,
          };
        }
      }
    }

    sendOk(res, { taper: taperData });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * POST /root/:rootId/recovery/substance
 * Add a new substance to track.
 */
router.post("/root/:rootId/recovery/substance", authenticate, async (req, res) => {
  try {
    const { name, startingTarget, finalTarget } = req.body;
    if (!name) return sendError(res, 400, ERR.INVALID_INPUT, "Substance name required");

    const result = await addSubstance(req.params.rootId, name, req.userId, { startingTarget, finalTarget });
    sendOk(res, result);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
