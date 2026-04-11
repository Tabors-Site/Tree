import express from "express";
import { sendError, ERR } from "../../seed/protocol.js";
import urlAuth from "../html-rendering/urlAuth.js";
import { htmlOnly } from "../html-rendering/htmlHelpers.js";
import Node from "../../seed/models/node.js";
import { isInitialized, getMonthSummary, getRecentTransactions } from "./core.js";
import { renderFinanceDashboard } from "./pages/dashboard.js";

const router = express.Router();

router.get("/root/:rootId/finance", urlAuth, htmlOnly, async (req, res) => {
  try {
    const { rootId } = req.params;
    const root = await Node.findById(rootId).select("name metadata").lean();
    if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Finance tree not found");

    if (!(await isInitialized(rootId))) {
      return sendError(res, 404, ERR.TREE_NOT_FOUND, "Finance not initialized");
    }

    const summary = await getMonthSummary(rootId);
    const recentTransactions = await getRecentTransactions(rootId, 20);

    res.send(renderFinanceDashboard({
      rootId,
      rootName: root.name,
      summary,
      recentTransactions,
      token: req.query.token || null,
      userId: req.user?._id?.toString() || req.user?.id || null,
      inApp: !!req.query.inApp,
    }));
  } catch (err) {
    const log = (await import("../../seed/log.js")).default;
    log.error("Finance", `Dashboard error: ${err.message}`);
    sendError(res, 500, ERR.INTERNAL, "Finance dashboard failed");
  }
});

export default router;
