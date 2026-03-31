import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import log from "../../seed/log.js";
import NodeModel from "../../seed/models/node.js";
import UserModel from "../../seed/models/user.js";
import { handleMessage } from "./handler.js";

let Node = NodeModel;
export function setServices({ Node: N }) { if (N) Node = N; }

const router = express.Router();

// ── HTML Dashboard (GET with ?html) ──
router.get("/root/:rootId/fitness", async (req, res, next) => {
  if (!("html" in req.query)) return next();
  try {
    const { isHtmlEnabled } = await import("../html-rendering/config.js");
    if (!isHtmlEnabled()) return next();
    const urlAuth = (await import("../html-rendering/urlAuth.js")).default;
    urlAuth(req, res, async () => {
      const { rootId } = req.params;
      const root = await Node.findById(rootId).select("name metadata").lean();
      if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Not found");
      const meta = root.metadata instanceof Map ? root.metadata.get("fitness") : root.metadata?.fitness;
      let state = null, weekly = null, profile = null;
      if (meta?.initialized) {
        const core = await import("./core.js");
        [state, weekly, profile] = await Promise.all([core.getExerciseState(rootId), core.getWeeklyStats(rootId), core.getProfile(rootId)]);
      }
      const { renderFitnessDashboard } = await import("./pages/dashboard.js");
      res.send(renderFitnessDashboard({ rootId, rootName: root.name, state, weekly, profile, token: req.query.token || null, userId: req.userId, inApp: !!req.query.inApp }));
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, "Dashboard failed");
  }
});

/**
 * POST /root/:rootId/fitness
 *
 * Four paths:
 * 1. First use: scaffold base, enter plan mode for conversational setup
 * 2. Setup incomplete: continue plan mode
 * 3. Workout input: parse, route to exercise nodes, record history
 * 4. Intent-based: route to coach, review, or plan mode
 */
router.post("/root/:rootId/fitness", authenticate, async (req, res) => {
  try {
    const { rootId } = req.params;
    const rawMessage = req.body.message;
    const message = Array.isArray(rawMessage) ? rawMessage.join(" ") : rawMessage;
    if (!message) return sendError(res, 400, ERR.INVALID_INPUT, "message required");

    const root = await Node.findById(rootId).select("rootOwner contributors name").lean();
    if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Tree not found");

    const userId = req.userId;
    const isOwner = root.rootOwner?.toString() === userId;
    const isContributor = root.contributors?.some(c => c.toString() === userId);
    if (!isOwner && !isContributor) {
      return sendError(res, 403, ERR.FORBIDDEN, "No access to this tree");
    }

    const { isExtensionBlockedAtNode } = await import("../../seed/tree/extensionScope.js");
    if (await isExtensionBlockedAtNode("fitness", rootId)) {
      return sendError(res, 403, ERR.EXTENSION_BLOCKED, "Fitness is blocked on this branch.");
    }

    const user = await UserModel.findById(userId).select("username").lean();
    const username = user?.username || "user";

    const result = await handleMessage(message, { userId, username, rootId, res });
    if (!res.headersSent) sendOk(res, result);
  } catch (err) {
    log.error("Fitness", "Route error:", err.message);
    if (!res.headersSent) sendError(res, 500, ERR.INTERNAL, "Fitness request failed");
  }
});

export default router;
