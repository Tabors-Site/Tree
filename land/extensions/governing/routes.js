// governing extension routes.
//
// Mounted at /api/v1/governing/*. Phase F absorbed the plan extension
// into governing; the dashboard's plan panel route lives here now.

import express from "express";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import authenticate from "../../seed/middleware/authenticate.js";
import Node from "../../seed/models/node.js";
import { readPlan } from "./state/planNode.js";
import { renderPlanPanel } from "./pages/planPanel.js";

const router = express.Router();

/**
 * GET /api/v1/governing/plan/:nodeId/panel.html
 * Server-rendered HTML fragment of the plan panel for this plan-type
 * node. Slot placeholder fetches and swaps it in.
 */
router.get("/governing/plan/:nodeId/panel.html", authenticate, async (req, res) => {
  try {
    const node = await Node.findById(req.params.nodeId).lean();
    if (!node) return res.status(404).send("");
    const qs = req.query.token ? `?token=${encodeURIComponent(req.query.token)}` : "";
    const out = await renderPlanPanel({
      node,
      nodeId: String(node._id),
      qs,
      isPublicAccess: !!req.query.share || !!req.query.publicShare,
    });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(out || "");
  } catch (err) {
    res.status(500).send(`<!-- governing plan panel error: ${err.message} -->`);
  }
});

/**
 * GET /api/v1/governing/plan/:nodeId
 * Read the plan-type node's identity. For diagnostic / audit views.
 * The active plan content lives on plan-emission-N children.
 */
router.get("/governing/plan/:nodeId", authenticate, async (req, res) => {
  try {
    const plan = await readPlan(req.params.nodeId);
    return sendOk(res, { plan });
  } catch (err) {
    return sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
