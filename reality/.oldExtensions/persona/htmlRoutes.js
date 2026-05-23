import express from "express";
import { sendError, ERR } from "../../seed/protocol.js";
import urlAuth from "../html-rendering/urlAuth.js";
import { htmlOnly, buildQS } from "../html-rendering/htmlHelpers.js";
import Node from "../../seed/models/node.js";
import { resolvePersonaFromChain, getAncestorChainFn } from "./index.js";
import { renderIdentityPage } from "./pages/identityPage.js";

export default function buildHtmlRoutes() {
  const router = express.Router();

  router.get("/root/:rootId/identity", urlAuth, htmlOnly, async (req, res) => {
    try {
      const { rootId } = req.params;
      const root = await Node.findById(rootId).select("name metadata").lean();
      if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Tree not found");

      const qs = buildQS(req);
      const meta = root.metadata instanceof Map ? Object.fromEntries(root.metadata) : (root.metadata || {});

      // Resolve persona at root via ancestor chain
      let persona = null;
      const getAncestorChain = getAncestorChainFn();
      if (getAncestorChain) {
        const chain = await getAncestorChain(rootId);
        if (chain) persona = resolvePersonaFromChain(chain);
      }
      // Fallback: read directly from root metadata
      if (!persona && meta.persona) persona = meta.persona;

      // Narrative (voice, initiative, identity) from root metadata
      const narrative = meta.narrative || null;

      // Find branch overrides: nodes in this tree with their own persona
      const overrides = [];
      const queue = [rootId];
      const visited = new Set([rootId]);
      while (queue.length > 0) {
        const batch = queue.splice(0, 50);
        const children = await Node.find({ parent: { $in: batch } })
          .select("_id name metadata")
          .lean();
        for (const child of children) {
          const id = String(child._id);
          if (visited.has(id)) continue;
          visited.add(id);
          queue.push(id);

          const childMeta = child.metadata instanceof Map
            ? child.metadata.get("persona")
            : child.metadata?.persona;
          if (childMeta) {
            overrides.push({ nodeId: id, nodeName: child.name, persona: childMeta });
          }
        }
        if (visited.size > 500) break;
      }

      res.send(renderIdentityPage({
        rootId,
        rootName: root.name,
        persona,
        narrative,
        overrides,
        qs,
      }));
    } catch (err) {
      sendError(res, 500, ERR.INTERNAL, "Identity page failed");
    }
  });

  return router;
}
