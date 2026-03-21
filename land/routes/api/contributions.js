import express from "express";
import urlAuth from "../../middleware/urlAuth.js";
import { getContributions } from "../../core/tree/contributions.js";
import getNodeName from "./helpers/getNameById.js";
import { resolveVersion } from "../../core/tree/treeFetch.js";
import { renderContributions } from "./html/contributions.js";

const router = express.Router();

// Resolve "latest" to actual prestige number for any route with :version
router.param("version", async (req, res, next, val) => {
  try {
    req.params.version = String(await resolveVersion(req.params.nodeId, val));
    next();
  } catch (err) {
    return res.status(404).json({ error: err.message });
  }
});

router.get(
  "/node/:nodeId/:version/contributions",
  urlAuth,
  async (req, res) => {
    try {
      const { nodeId, version } = req.params;
      const parsedVersion = Number(version);

      if (isNaN(parsedVersion)) {
        return res.status(400).json({ error: "Invalid version" });
      }

      const rawLimit = req.query.limit;
      const limit = rawLimit !== undefined ? Number(rawLimit) : undefined;

      if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
        return res.status(400).json({ error: "Invalid limit" });
      }

      const filtered = Object.entries(req.query)
        .filter(([k]) => ["token", "html"].includes(k))
        .map(([k, v]) => (v === "" ? k : `${k}=${v}`))
        .join("&");

      const queryString = filtered ? `?${filtered}` : "";

      const result = await getContributions({
        nodeId,
        version: parsedVersion,
        limit,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
      });

      const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");

      if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
        return res.json({ nodeId, version: parsedVersion, ...result });
      }

      const nodeName = await getNodeName(nodeId);
      const contributions = result.contributions || [];

      return res.send(
        renderContributions({
          nodeId,
          version: parsedVersion,
          nodeName,
          contributions,
          queryString,
        }),
      );
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  },
);

export default router;
