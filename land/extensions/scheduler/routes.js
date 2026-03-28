import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import {
  scanTree,
  getCachedTimeline,
  getWeekTimeline,
  calculateReliability,
} from "./core.js";
import { getExtMeta } from "../../seed/tree/extensionMetadata.js";
import Node from "../../seed/models/node.js";

const router = express.Router();

/**
 * GET /scheduler/check?rootId=...&week=true
 * Returns due, upcoming, overdue for a tree.
 */
router.get("/scheduler/check", authenticate, async (req, res) => {
  try {
    const { rootId, week } = req.query;
    if (!rootId) return sendError(res, 400, ERR.INVALID_INPUT, "rootId is required");

    if (week === "true") {
      const items = await getWeekTimeline(rootId);
      return sendOk(res, { week: items || [] });
    }

    let timeline = getCachedTimeline(rootId);
    if (!timeline) {
      timeline = await scanTree(rootId);
    }
    if (!timeline) {
      return sendOk(res, { due: [], upcoming: [], overdue: [] });
    }

    sendOk(res, {
      due: timeline.due,
      upcoming: timeline.upcoming,
      overdue: timeline.overdue,
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * GET /scheduler/timeline?rootId=...
 * Same as check but with full node details.
 */
router.get("/scheduler/timeline", authenticate, async (req, res) => {
  try {
    const { rootId } = req.query;
    if (!rootId) return sendError(res, 400, ERR.INVALID_INPUT, "rootId is required");

    const timeline = await scanTree(rootId);
    if (!timeline) {
      return sendOk(res, { due: [], upcoming: [], overdue: [], lastScan: null });
    }

    sendOk(res, timeline);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * GET /scheduler/reliability/:nodeId
 * Returns completion patterns for a specific node.
 */
router.get("/scheduler/reliability/:nodeId", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const node = await Node.findById(nodeId).select("name metadata").lean();
    if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");

    const schedulerMeta = getExtMeta(node, "scheduler");
    if (!schedulerMeta?.completions?.length) {
      return sendOk(res, {
        nodeName: node.name,
        message: "No completion history",
        totalCompletions: 0,
      });
    }

    const reliability = calculateReliability(schedulerMeta.completions);
    sendOk(res, { nodeName: node.name, ...reliability });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
