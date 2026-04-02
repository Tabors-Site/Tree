import express from "express";
import { sendError, ERR } from "../../seed/protocol.js";
import urlAuth from "../html-rendering/urlAuth.js";
import { htmlOnly, buildQS } from "../html-rendering/htmlHelpers.js";
import Node from "../../seed/models/node.js";
import { renderCodebookPage } from "./pages/codebookPage.js";

export default function buildHtmlRoutes() {
  const router = express.Router();

  router.get("/root/:rootId/codebook", urlAuth, htmlOnly, async (req, res) => {
    try {
      const { rootId } = req.params;
      const userId = req.userId;
      const root = await Node.findById(rootId).select("name children").lean();
      if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Tree not found");

      const qs = buildQS(req);

      // Collect all node IDs in the tree via BFS
      const nodeIds = [rootId];
      const queue = [rootId];
      const nodeNames = new Map();
      nodeNames.set(rootId, root.name);

      while (queue.length > 0) {
        const batch = queue.splice(0, 50);
        const nodes = await Node.find({ parent: { $in: batch } })
          .select("_id name children parent")
          .lean();
        for (const n of nodes) {
          const id = String(n._id);
          nodeIds.push(id);
          nodeNames.set(id, n.name);
          queue.push(id);
        }
        if (nodeIds.length > 500) break;
      }

      // Batch fetch metadata for all nodes
      const nodesWithCodebook = await Node.find({
        _id: { $in: nodeIds },
        [`metadata.codebook.${userId}`]: { $exists: true },
      }).select("_id name metadata").lean();

      const entries = [];
      for (const node of nodesWithCodebook) {
        const meta = node.metadata instanceof Map
          ? node.metadata.get("codebook") || {}
          : node.metadata?.codebook || {};
        const userEntry = meta[userId];
        if (!userEntry?.dictionary || Object.keys(userEntry.dictionary).length === 0) continue;
        entries.push({
          nodeId: String(node._id),
          nodeName: node.name,
          dictionary: userEntry.dictionary,
          notesSinceCompression: userEntry.notesSinceCompression || 0,
          lastCompressed: userEntry.lastCompressed || null,
        });
      }

      res.send(renderCodebookPage({
        rootId,
        rootName: root.name,
        entries,
        qs,
      }));
    } catch (err) {
      sendError(res, 500, ERR.INTERNAL, "Codebook page failed");
    }
  });

  return router;
}
