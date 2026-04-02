import express from "express";
import { sendError, ERR } from "../../seed/protocol.js";
import urlAuth from "../html-rendering/urlAuth.js";
import { htmlOnly, buildQS } from "../html-rendering/htmlHelpers.js";
import Node from "../../seed/models/node.js";
import { getNotes } from "../../seed/tree/notes.js";
import { getExtMeta } from "../../seed/tree/extensionMetadata.js";
import { renderConsciousnessPage } from "./pages/consciousness.js";

export default function buildHtmlRoutes() {
  const router = express.Router();

  router.get("/root/:rootId/consciousness", urlAuth, htmlOnly, async (req, res) => {
    try {
      const { rootId } = req.params;
      const root = await Node.findById(rootId).select("name metadata").lean();
      if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Tree not found");

      const qs = buildQS(req);

      // Walk the .inner chain to collect all layer data
      const layers = { inner: [], reflect: [], compare: [], narrative: null, prediction: null };

      // Layer 1: .inner notes
      const innerNode = await Node.findOne({ parent: rootId, name: ".inner" }).select("_id").lean();
      if (innerNode) {
        const result = await getNotes({ nodeId: String(innerNode._id), limit: 20 });
        layers.inner = result?.notes || [];

        // Layer 2: .inner.reflect notes
        const reflectNode = await Node.findOne({ parent: String(innerNode._id), name: ".reflect" }).select("_id").lean();
        if (reflectNode) {
          const rResult = await getNotes({ nodeId: String(reflectNode._id), limit: 10 });
          layers.reflect = rResult?.notes || [];

          // Layer 3: .inner.reflect.compare notes
          const compareNode = await Node.findOne({ parent: String(reflectNode._id), name: ".compare" }).select("_id").lean();
          if (compareNode) {
            const cResult = await getNotes({ nodeId: String(compareNode._id), limit: 5 });
            layers.compare = cResult?.notes || [];
          }
        }
      }

      // Layer 4-6: narrative metadata on root
      const meta = root.metadata instanceof Map ? Object.fromEntries(root.metadata) : (root.metadata || {});
      layers.narrative = meta.narrative || null;

      // Layer 7: prediction metadata on root
      layers.prediction = meta.prediction || null;

      res.send(renderConsciousnessPage({
        rootId,
        rootName: root.name,
        layers,
        qs,
        userId: req.userId,
      }));
    } catch (err) {
      sendError(res, 500, ERR.INTERNAL, "Consciousness page failed");
    }
  });

  return router;
}
