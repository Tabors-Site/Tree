import express from "express";
import { sendError, ERR } from "../../seed/protocol.js";
import urlAuth from "../html-rendering/urlAuth.js";
import { htmlOnly } from "../html-rendering/htmlHelpers.js";
import Node from "../../seed/models/node.js";
import { isInitialized, getStatus, getMilestones } from "./core.js";
import { renderRecoveryDashboard } from "./pages/dashboard.js";

const router = express.Router();

router.get("/root/:rootId/recovery", urlAuth, htmlOnly, async (req, res) => {
  try {
    const { rootId } = req.params;
    const root = await Node.findById(rootId).select("name metadata").lean();
    if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Recovery tree not found");

    if (!(await isInitialized(rootId))) {
      return sendError(res, 404, ERR.TREE_NOT_FOUND, "Recovery tree not initialized");
    }

    const [status, milestones] = await Promise.all([
      getStatus(rootId),
      getMilestones(rootId),
    ]);

    res.send(renderRecoveryDashboard({
      rootId,
      rootName: root.name,
      status,
      milestones,
      token: req.query.token || null,
    }));
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, "Dashboard failed");
  }
});

export default router;
