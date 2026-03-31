import express from "express";
import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import { sendError, ERR } from "../../seed/protocol.js";
import urlAuth from "../html-rendering/urlAuth.js";
import { htmlOnly, buildQS, tokenQS } from "../html-rendering/htmlHelpers.js";
import { getExtension } from "../loader.js";
import { renderGateway } from "./pages/gateway.js";

export default function buildGatewayHtmlRoutes() {
  const router = express.Router();

  router.get("/root/:rootId/gateway", urlAuth, htmlOnly, async (req, res) => {
    try {
      const { rootId } = req.params;
      const root = await Node.findById(rootId).select("name rootOwner contributors").lean();
      if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Tree not found");
      if (String(root.rootOwner) !== String(req.userId)) {
        return sendError(res, 403, ERR.FORBIDDEN, "Owner only");
      }

      let channels = [];
      try {
        const gw = getExtension("gateway");
        if (gw?.exports?.getChannelsForRoot) channels = await gw.exports.getChannelsForRoot(rootId);
      } catch {}

      return res.send(renderGateway({
        rootId, rootName: root.name, queryString: buildQS(req), channels,
      }));
    } catch (err) {
      log.error("HTML", "Gateway render error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  return router;
}
