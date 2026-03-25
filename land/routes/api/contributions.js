import log from "../../seed/log.js";
import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { getContributions } from "../../seed/tree/contributions.js";
import getNodeName from "./helpers/getNameById.js";
import { resolveVersion } from "../../seed/tree/treeFetch.js";
import { getExtension } from "../../extensions/loader.js";

// readAuth: delegates to html-rendering's urlAuth if installed, otherwise requires hard auth
function readAuth(req, res, next) {
  const handler = getExtension("html-rendering")?.exports?.urlAuth;
  if (handler) return handler(req, res, next);
  return authenticate(req, res, next);
}
function html() { return getExtension("html-rendering")?.exports || {}; }

const router = express.Router();

// Resolve "latest" to actual prestige number for any route with :version
router.param("version", async (req, res, next, val) => {
  try {
    req.params.version = String(await resolveVersion(req.params.nodeId, val));
    next();
  } catch (err) {
    return sendError(res, 404, ERR.NODE_NOT_FOUND, err.message);
  }
});

router.get(
  "/node/:nodeId/:version/contributions",
  readAuth,
  async (req, res) => {
    try {
      const { nodeId, version } = req.params;
      const parsedVersion = Number(version);

      if (isNaN(parsedVersion)) {
        return sendError(res, 400, ERR.INVALID_INPUT, "Invalid version");
      }

      const rawLimit = req.query.limit;
      const limit = rawLimit !== undefined ? Number(rawLimit) : undefined;

      if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
        return sendError(res, 400, ERR.INVALID_INPUT, "Invalid limit");
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
        return sendOk(res, { nodeId, version: parsedVersion, ...result });
      }

      const nodeName = await getNodeName(nodeId);
      const contributions = result.contributions || [];

      return res.send(
        html().renderContributions({
          nodeId,
          version: parsedVersion,
          nodeName,
          contributions,
          queryString,
        }),
      );
    } catch (err) {
      log.error("API", err);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  },
);

// Versionless alias (protocol-compliant)
router.get("/node/:nodeId/contributions", readAuth, async (req, res, next) => {
  try {
    req.params.version = String(await resolveVersion(req.params.nodeId, "latest"));
    req.url = `/node/${req.params.nodeId}/${req.params.version}/contributions`;
    router.handle(req, res, next);
  } catch (err) {
    return sendError(res, 404, ERR.NODE_NOT_FOUND, err.message);
  }
});

export default router;
