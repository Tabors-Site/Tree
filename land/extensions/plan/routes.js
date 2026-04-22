// plan extension routes.
//
// Mounted at /api/v1/plan/*. The plan panel's inline edit form posts
// here; other extensions call the plan api directly and never hit
// these routes.

import express from "express";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import authenticate from "../../seed/middleware/authenticate.js";
import Node from "../../seed/models/node.js";
import {
  readPlan,
  addStep,
  updateStep,
  deleteStep,
} from "./state/plan.js";
import { renderPlanPanel } from "./pages/planPanel.js";

const router = express.Router();

/**
 * GET /api/v1/plan/node/:nodeId/panel.html
 * Server side rendered HTML fragment of the plan panel for this
 * node. The slot placeholder fetches this and swaps it in.
 *
 * Lives on the regular extension router (mounted at /api/v1) rather
 * than the page router (/). The slot's `<script>` fetches with a
 * matching /api/v1 prefix so cross origin / auth behavior is
 * predictable. Auth uses standard JWT — view only HTML rendering
 * for someone who can read the node.
 */
router.get("/plan/node/:nodeId/panel.html", authenticate, async (req, res) => {
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
    res.status(500).send(`<!-- plan panel fragment error: ${err.message} -->`);
  }
});

/**
 * POST /api/v1/plan/node/:nodeId/steps
 * Body: { kind, title, ...kindSpecificFields }
 * Appends a new step. Returns the created step with its id.
 */
router.post("/plan/node/:nodeId/steps", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const step = req.body || {};
    if (!step.kind) {
      return sendError(res, 400, ERR.INVALID_INPUT, "step.kind is required");
    }
    const created = await addStep(nodeId, step, null);
    if (!created) return sendError(res, 500, ERR.INTERNAL, "addStep failed");
    return sendOk(res, { step: created });
  } catch (err) {
    return sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * PATCH /api/v1/plan/node/:nodeId/steps/:stepId
 * Body: partial patch { title?, status?, spec?, files?, ... }
 * Idempotent: no op when the patch matches the existing step.
 * Tags the write with _userEdit so the propagation hook (in consumer
 * extensions) can fire sibling signals.
 */
router.patch("/plan/node/:nodeId/steps/:stepId", authenticate, async (req, res) => {
  try {
    const { nodeId, stepId } = req.params;
    const patch = req.body || {};
    const result = await updateStep(nodeId, stepId, patch, null, { userEdit: true });
    return sendOk(res, result);
  } catch (err) {
    return sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * DELETE /api/v1/plan/node/:nodeId/steps/:stepId
 */
router.delete("/plan/node/:nodeId/steps/:stepId", authenticate, async (req, res) => {
  try {
    const { nodeId, stepId } = req.params;
    const result = await deleteStep(nodeId, stepId, null);
    return sendOk(res, result);
  } catch (err) {
    return sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * GET /api/v1/plan/node/:nodeId
 * Read the plan. Primarily for debugging / audit views.
 */
router.get("/plan/node/:nodeId", authenticate, async (req, res) => {
  try {
    const plan = await readPlan(req.params.nodeId);
    return sendOk(res, { plan });
  } catch (err) {
    return sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
