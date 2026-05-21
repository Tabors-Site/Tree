import express from "express";
import { sendError, ERR } from "../../seed/protocol.js";
import urlAuth from "../html-rendering/urlAuth.js";
import { htmlOnly, buildQS } from "../html-rendering/htmlHelpers.js";
import Node from "../../seed/models/node.js";
import { getArtifacts } from "../../seed/tree/artifacts.js";
import { getLandRootId } from "../../seed/landRoot.js";
import { renderMemoryPage } from "./pages/memoryPage.js";

export default function buildHtmlRoutes() {
  const router = express.Router();

  router.get("/user/:beingId/home-memory", urlAuth, htmlOnly, async (req, res) => {
    try {
      const beingId = req.params.beingId;
      if (!req.beingId || String(req.beingId) !== String(beingId)) {
        return sendError(res, 403, ERR.FORBIDDEN, "Can only view your own home memory");
      }

      const qs = buildQS(req);
      const landRootId = getLandRootId();
      const homeName = `.home-${beingId.slice(0, 8)}`;

      const homeTree = await Node.findOne({ parent: landRootId, name: homeName })
        .select("_id").lean();

      let memories = [];
      let reminders = [];

      if (homeTree) {
        const memoriesNode = await Node.findOne({ parent: String(homeTree._id), name: "memories" })
          .select("_id").lean();
        if (memoriesNode) {
          const result = await getArtifacts({ nodeId: String(memoriesNode._id), limit: 50 });
          memories = result?.artifacts || [];
        }

        const remindersNode = await Node.findOne({ parent: String(homeTree._id), name: "reminders" })
          .select("_id").lean();
        if (remindersNode) {
          const result = await getArtifacts({ nodeId: String(remindersNode._id), limit: 20 });
          reminders = result?.artifacts || [];
        }
      }

      res.send(renderMemoryPage({
        username: req.username || "unknown",
        memories,
        reminders,
        qs,
      }));
    } catch (err) {
      sendError(res, 500, ERR.INTERNAL, "Home memory page failed");
    }
  });

  return router;
}
