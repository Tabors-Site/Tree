import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import Node from "../../seed/models/node.js";
import { getGaps, clearGaps } from "./core.js";
import { getDescendantIds } from "../../seed/tree/treeFetch.js";

const router = express.Router();

// GET /node/:nodeId/gaps - gaps at this node
router.get("/node/:nodeId/gaps", authenticate, async (req, res) => {
  try {
    const gaps = await getGaps(req.params.nodeId);
    sendOk(res, { count: gaps.length, gaps: gaps.sort((a, b) => b.count - a.count) });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// DELETE /node/:nodeId/gaps - clear gaps
router.delete("/node/:nodeId/gaps", authenticate, async (req, res) => {
  try {
    await clearGaps(req.params.nodeId);
    sendOk(res, { message: "Gap records cleared" });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /gaps/land - all gaps aggregated across the land
router.get("/gaps/land", authenticate, async (req, res) => {
  try {
    // Find all tree roots
    const roots = await Node.find({ rootOwner: { $ne: null }, systemRole: null })
      .select("_id").lean();

    const aggregated = {};

    for (const root of roots) {
      const nodeIds = await getDescendantIds(root._id);
      for (const nid of nodeIds) {
        const gaps = await getGaps(nid);
        for (const gap of gaps) {
          if (!aggregated[gap.namespace]) {
            aggregated[gap.namespace] = { namespace: gap.namespace, totalCount: 0, nodeCount: 0, lastSeen: gap.lastSeen };
          }
          aggregated[gap.namespace].totalCount += gap.count;
          aggregated[gap.namespace].nodeCount++;
          if (gap.lastSeen > aggregated[gap.namespace].lastSeen) {
            aggregated[gap.namespace].lastSeen = gap.lastSeen;
          }
        }
      }
    }

    const sorted = Object.values(aggregated).sort((a, b) => b.totalCount - a.totalCount);
    sendOk(res, { count: sorted.length, gaps: sorted });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
