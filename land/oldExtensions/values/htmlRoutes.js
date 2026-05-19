import express from "express";
import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import { sendError, ERR } from "../../seed/protocol.js";
import urlAuth from "../html-rendering/urlAuth.js";
import { htmlOnly, buildQS, tokenQS } from "../html-rendering/htmlHelpers.js";
import { getExtension } from "../loader.js";
import { renderValuesPage } from "./pages/values.js";

export default function buildValuesHtmlRoutes() {
  const router = express.Router();

  router.get("/root/:nodeId/values", urlAuth, htmlOnly, async (req, res) => {
    try {
      const { nodeId } = req.params;
      let result = { flat: [], tree: {} };
      try {
        const values = getExtension("values");
        if (values?.exports?.getGlobalValuesTreeAndFlat) {
          result = await values.exports.getGlobalValuesTreeAndFlat(nodeId);
        }
      } catch {}

      return res.send(renderValuesPage({
        nodeId, queryString: buildQS(req), result,
      }));
    } catch (err) {
      log.error("HTML", "Values page render error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  return router;
}
