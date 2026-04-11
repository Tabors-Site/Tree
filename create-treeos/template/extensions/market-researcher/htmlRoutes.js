import express from "express";
import { sendError, ERR } from "../../seed/protocol.js";
import urlAuth from "../html-rendering/urlAuth.js";
import { htmlOnly } from "../html-rendering/htmlHelpers.js";
import Node from "../../seed/models/node.js";
import { isInitialized, getSectors, getRecentFindings, getWatchlist } from "./core.js";
import { renderResearchDashboard } from "./pages/dashboard.js";

const router = express.Router();

router.get("/root/:rootId/market-researcher", urlAuth, htmlOnly, async (req, res) => {
  try {
    const { rootId } = req.params;
    const root = await Node.findById(rootId).select("name metadata").lean();
    if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Research tree not found");

    if (!(await isInitialized(rootId))) {
      return sendError(res, 404, ERR.TREE_NOT_FOUND, "Market researcher not initialized");
    }

    const sectors = await getSectors(rootId);
    const findings = await getRecentFindings(rootId, 20);
    const watchlist = await getWatchlist(rootId);

    res.send(renderResearchDashboard({
      rootId,
      rootName: root.name,
      sectors,
      findings,
      watchlist,
      token: req.query.token || null,
      userId: req.user?._id?.toString() || req.user?.id || null,
      inApp: !!req.query.inApp,
    }));
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, "Research dashboard failed");
  }
});

export default router;
