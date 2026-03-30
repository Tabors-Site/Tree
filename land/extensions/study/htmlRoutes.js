/**
 * Study HTML Routes
 *
 * Server-rendered dashboard. Reads the tree. Renders what's there.
 */

import express from "express";
import { sendError, ERR } from "../../seed/protocol.js";
import urlAuth from "../html-rendering/urlAuth.js";
import { htmlOnly } from "../html-rendering/htmlHelpers.js";
import Node from "../../seed/models/node.js";
import {
  getQueue,
  getActiveTopics,
  getGaps,
  getStudyProgress,
  getProfile,
  getCompletedTopics,
  getStudyHistory,
} from "./core.js";
import { renderStudyDashboard } from "./pages/dashboard.js";

const router = express.Router();

// GET /root/:rootId/study?html - Full dashboard
router.get("/root/:rootId/study", urlAuth, htmlOnly, async (req, res) => {
  try {
    const { rootId } = req.params;
    const root = await Node.findById(rootId).select("name metadata").lean();
    if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Study tree not found");

    const meta = root.metadata instanceof Map ? root.metadata.get("study") : root.metadata?.study;
    let queue = [], activeTopics = [], gaps = [], progress = null, profile = {}, completed = [], history = [];
    if (meta?.initialized) {
      [queue, activeTopics, gaps, progress, profile, completed, history] = await Promise.all([
        getQueue(rootId),
        getActiveTopics(rootId),
        getGaps(rootId),
        getStudyProgress(rootId),
        getProfile(rootId),
        getCompletedTopics(rootId),
        getStudyHistory(rootId),
      ]);
    }

    res.send(renderStudyDashboard({
      rootId,
      rootName: root.name,
      queue,
      activeTopics,
      gaps,
      progress,
      profile,
      completed,
      history,
      token: req.query.token || null,
      userId: req.userId,
      qs: req.query,
    }));
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, "Dashboard failed");
  }
});

export default router;
