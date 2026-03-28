import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { getRings, assembleRingData } from "./core.js";
import { getExtension } from "../loader.js";

let htmlAuth = authenticate;
export function resolveHtmlAuth() {
  const htmlExt = getExtension("html-rendering");
  if (htmlExt?.exports?.urlAuth) htmlAuth = htmlExt.exports.urlAuth;
}

const router = express.Router();

// GET /root/:rootId/rings - all rings (annual + recent monthly)
router.get("/root/:rootId/rings", htmlAuth, async (req, res) => {
  try {
    const { rootId } = req.params;
    const { monthly, annual } = await getRings(rootId);

    sendOk(res, {
      rootId,
      annual: annual.map(r => ({
        date: r.ringDate,
        treeAge: r.treeAge,
        character: r.character,
        essence: r.essence,
        structure: r.structure,
        vitals: r.vitals,
      })),
      monthly: monthly.map(r => ({
        date: r.ringDate,
        treeAge: r.treeAge,
        character: r.character,
        essence: r.essence,
        structure: r.structure,
        vitals: r.vitals,
      })),
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /root/:rootId/rings/current - live assembly, no storage
router.get("/root/:rootId/rings/current", htmlAuth, async (req, res) => {
  try {
    const { rootId } = req.params;
    const ringData = await assembleRingData(rootId);
    if (!ringData) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Tree not found");

    sendOk(res, ringData);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /root/:rootId/rings/:period - specific ring (year like "2027" or month like "2027-03")
router.get("/root/:rootId/rings/:period", htmlAuth, async (req, res) => {
  try {
    const { rootId, period } = req.params;
    const { monthly, annual } = await getRings(rootId);

    // Try annual first (4-digit year)
    if (/^\d{4}$/.test(period)) {
      const ring = annual.find(r => r.ringDate?.startsWith(period));
      if (ring) return sendOk(res, ring);
      return sendError(res, 404, ERR.NODE_NOT_FOUND, `No annual ring for ${period}`);
    }

    // Try monthly (YYYY-MM)
    if (/^\d{4}-\d{2}$/.test(period)) {
      const ring = monthly.find(r => r.ringDate?.startsWith(period));
      if (ring) return sendOk(res, ring);
      return sendError(res, 404, ERR.NODE_NOT_FOUND, `No monthly ring for ${period}`);
    }

    sendError(res, 400, ERR.INVALID_INPUT, "Period must be a year (2027) or month (2027-03)");
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
