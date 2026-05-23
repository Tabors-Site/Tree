import express from "express";
import { sendError, ERR } from "../../seed/protocol.js";
import urlAuth from "../html-rendering/urlAuth.js";
import { htmlOnly } from "../html-rendering/htmlHelpers.js";
import Node from "../../seed/models/node.js";
import { getExerciseState, getWeeklyStats, getProfile } from "./core.js";
import { renderFitnessDashboard } from "./pages/dashboard.js";

const router = express.Router();

router.get("/root/:rootId/fitness", urlAuth, htmlOnly, async (req, res) => {
  try {
    const { rootId } = req.params;
    const root = await Node.findById(rootId).select("name metadata").lean();
    if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Fitness tree not found");

    const meta = root.metadata instanceof Map ? root.metadata.get("fitness") : root.metadata?.fitness;
    if (!meta?.initialized) {
      return sendError(res, 404, ERR.TREE_NOT_FOUND, "Fitness tree not initialized");
    }

    const [state, weekly, profile] = await Promise.all([
      getExerciseState(rootId),
      getWeeklyStats(rootId),
      getProfile(rootId),
    ]);

    res.send(renderFitnessDashboard({
      rootId,
      rootName: root.name,
      state,
      weekly,
      profile,
      token: req.query.token || null,
    }));
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, "Dashboard failed");
  }
});

export default router;
