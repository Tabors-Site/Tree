import express from "express";
import { sendError, ERR } from "../../seed/protocol.js";
import urlAuth from "../html-rendering/urlAuth.js";
import { htmlOnly } from "../html-rendering/htmlHelpers.js";
import { getProfile } from "./core.js";
import { renderInverseProfile } from "./pages/profile.js";

export default function buildHtmlRoutes() {
  const router = express.Router();

  router.get("/user/:beingId/inverse", urlAuth, htmlOnly, async (req, res) => {
    try {
      const beingId = req.params.beingId;
      if (!req.beingId || String(req.beingId) !== String(beingId)) {
        return sendError(res, 403, ERR.FORBIDDEN, "Can only view your own inverse profile");
      }

      const data = await getProfile(beingId);
      const token = req.query.token ? `token=${encodeURIComponent(req.query.token)}` : "";
      const qs = token ? `?${token}&html` : "?html";

      res.send(renderInverseProfile({
        beingId,
        username: req.username || "unknown",
        profile: data?.profile || {},
        stats: data?.stats || {},
        corrections: data?.corrections || [],
        lastUpdated: data?.lastUpdated || null,
        queryString: qs,
      }));
    } catch (err) {
      sendError(res, 500, ERR.INTERNAL, "Inverse profile page failed");
    }
  });

  return router;
}
