import express from "express";
import { sendError, ERR } from "../../seed/protocol.js";
import urlAuth from "../html-rendering/urlAuth.js";
import { htmlOnly } from "../html-rendering/htmlHelpers.js";
import Node from "../../seed/models/node.js";
import { isInitialized, getPortfolioSummary, getWatchlist } from "./core.js";
import { renderInvestorDashboard } from "./pages/dashboard.js";

const router = express.Router();

router.get("/root/:rootId/investor", urlAuth, htmlOnly, async (req, res) => {
  try {
    const { rootId } = req.params;
    const root = await Node.findById(rootId).select("name metadata").lean();
    if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Investor tree not found");

    if (!(await isInitialized(rootId))) {
      return sendError(res, 404, ERR.TREE_NOT_FOUND, "Investor not initialized");
    }

    const summary = await getPortfolioSummary(rootId);
    const watchlist = await getWatchlist(rootId);

    res.send(renderInvestorDashboard({
      rootId,
      rootName: root.name,
      summary,
      watchlist,
      token: req.query.token || null,
      userId: req.user?._id?.toString() || req.user?.id || null,
      inApp: !!req.query.inApp,
    }));
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, "Investor dashboard failed");
  }
});

export default router;
