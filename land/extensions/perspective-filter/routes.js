import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import Node from "../../seed/models/node.js";
import { resolvePerspective } from "./core.js";

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

export default router;
