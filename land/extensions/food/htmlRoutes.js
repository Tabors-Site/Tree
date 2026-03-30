import express from "express";
import { sendError, ERR } from "../../seed/protocol.js";
import urlAuth from "../html-rendering/urlAuth.js";
import { htmlOnly } from "../html-rendering/htmlHelpers.js";
import Node from "../../seed/models/node.js";
import { isInitialized, getDailyPicture } from "./core.js";
import { renderFoodDashboard } from "./pages/dashboard.js";

const router = express.Router();

router.get("/root/:rootId/food", urlAuth, htmlOnly, async (req, res) => {
  try {
    const { rootId } = req.params;
    const root = await Node.findById(rootId).select("name metadata").lean();
    if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Food tree not found");

    if (!(await isInitialized(rootId))) {
      return sendError(res, 404, ERR.TREE_NOT_FOUND, "Food tree not initialized");
    }

    const picture = await getDailyPicture(rootId);

    res.send(renderFoodDashboard({
      rootId,
      rootName: root.name,
      picture,
      token: req.query.token || null,
      userId: req.user?._id?.toString() || req.user?.id || null,
    }));
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, "Dashboard failed");
  }
});

export default router;
