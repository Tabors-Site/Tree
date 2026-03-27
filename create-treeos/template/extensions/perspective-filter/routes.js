import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import Node from "../../seed/models/node.js";
import { resolvePerspective, setPerspective, clearPerspective, shouldDeliver } from "./core.js";

const router = express.Router();

// GET /node/:nodeId/perspective - effective perspective for a node (CLI endpoint)
router.get("/node/:nodeId/perspective", authenticate, async (req, res) => {
  try {
    const node = await Node.findById(req.params.nodeId)
      .select("name metadata parent systemRole")
      .lean();
    if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");

    const perspective = await resolvePerspective(node);

    const meta = node.metadata instanceof Map
      ? Object.fromEntries(node.metadata)
      : (node.metadata || {});
    const hasOwn = !!(meta.perspective?.accept?.length || meta.perspective?.reject?.length);

    sendOk(res, {
      nodeId: req.params.nodeId,
      nodeName: node.name,
      hasOwnPerspective: hasOwn,
      effectivePerspective: perspective || { accept: [], reject: [] },
      inherited: !hasOwn && perspective !== null,
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /node/:nodeId/perspective - set accept/reject
router.post("/node/:nodeId/perspective", authenticate, async (req, res) => {
  try {
    const { accept, reject } = req.body;
    if (!accept?.length && !reject?.length) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Provide at least one of accept or reject arrays");
    }
    const result = await setPerspective(req.params.nodeId, { accept, reject });
    sendOk(res, { message: "Perspective set", perspective: result });
  } catch (err) {
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

// DELETE /node/:nodeId/perspective - clear override
router.delete("/node/:nodeId/perspective", authenticate, async (req, res) => {
  try {
    await clearPerspective(req.params.nodeId);
    sendOk(res, { message: "Perspective cleared. Inheriting from parent." });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /node/:nodeId/perspective/test - dry run
router.post("/node/:nodeId/perspective/test", authenticate, async (req, res) => {
  try {
    const { signal } = req.body;
    const tags = typeof signal === "string" ? signal.split(":") : (Array.isArray(signal) ? signal : []);
    const node = await Node.findById(req.params.nodeId).select("metadata parent systemRole").lean();
    if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");
    const passes = await shouldDeliver(node, { tags });
    const perspective = await resolvePerspective(node);
    sendOk(res, { tags, passes, effectivePerspective: perspective || { accept: [], reject: [] } });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
