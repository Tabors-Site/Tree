import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import log from "../../seed/log.js";
import NodeModel from "../../seed/models/node.js";
import UserModel from "../../seed/models/user.js";
import { isInitialized, findFoodNodes, getDailyPicture } from "./core.js";
import { handleMessage } from "./handler.js";

let Node = NodeModel;
export function setServices({ Node: N }) { if (N) Node = N; }

const router = express.Router();

// ── HTML Dashboard (GET with ?html) ──
router.get("/root/:rootId/food", async (req, res, next) => {
  if (!("html" in req.query)) return next();
  try {
    const { isHtmlEnabled } = await import("../html-rendering/config.js");
    if (!isHtmlEnabled()) return next();
    const urlAuth = (await import("../html-rendering/urlAuth.js")).default;
    urlAuth(req, res, async () => {
      const { rootId } = req.params;
      const root = await Node.findById(rootId).select("name metadata").lean();
      if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Not found");
      let picture = null;
      if (await isInitialized(rootId)) {
        const { getDailyPicture } = await import("./core.js");
        picture = await getDailyPicture(rootId);
      }
      const { renderFoodDashboard } = await import("./pages/dashboard.js");
      res.send(renderFoodDashboard({ rootId, rootName: root.name, picture, token: req.query.token || null, userId: req.userId }));
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, "Dashboard failed");
  }
});

/**
 * POST /root/:rootId/food
 *
 * Three paths:
 * 1. First use (not initialized): scaffold tree, run coach mode for setup conversation
 * 2. Food input (has food words): parse, cascade, respond with totals
 * 3. Questions/advice: route to coach mode at the Daily node
 */
router.post("/root/:rootId/food", authenticate, async (req, res) => {
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

    // Check spatial scope
    const { isExtensionBlockedAtNode } = await import("../../seed/tree/extensionScope.js");
    if (await isExtensionBlockedAtNode("food", rootId)) {
      return sendError(res, 403, ERR.EXTENSION_BLOCKED, "Food tracking is blocked on this branch.");
    }

    const user = await UserModel.findById(userId).select("username").lean();
    const username = user?.username || "user";

    const result = await handleMessage(message, { userId, username, rootId, res });
    if (!res.headersSent) sendOk(res, result);
  } catch (err) {
    log.error("Food", "Route error:", err.message);
    if (!res.headersSent) sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * GET /root/:rootId/food/daily
 * Today's nutrition dashboard.
 */
router.get("/root/:rootId/food/daily", authenticate, async (req, res) => {
  try {
    const picture = await getDailyPicture(req.params.rootId);
    if (!picture) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Food tree not found or not initialized");
    sendOk(res, picture);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * GET /root/:rootId/food/week
 * Weekly nutrition review (last 7 days from History node).
 */
router.get("/root/:rootId/food/week", authenticate, async (req, res) => {
  try {
    const foodNodes = await findFoodNodes(req.params.rootId);
    if (!foodNodes?.history) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Food tree not found");

    const Note = (await import("../../seed/models/note.js")).default;
    const notes = await Note.find({ nodeId: foodNodes.history.id })
      .sort({ createdAt: -1 })
      .limit(7)
      .select("content createdAt")
      .lean();

    const days = notes
      .map(n => { try { return JSON.parse(n.content); } catch { return null; } })
      .filter(Boolean);

    sendOk(res, { days, count: days.length });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * GET /root/:rootId/food/profile
 * Dietary profile and goals.
 */
router.get("/root/:rootId/food/profile", authenticate, async (req, res) => {
  try {
    const picture = await getDailyPicture(req.params.rootId);
    if (!picture) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Food tree not found");
    sendOk(res, { profile: picture.profile || null, macros: { protein: picture.protein, carbs: picture.carbs, fats: picture.fats } });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
