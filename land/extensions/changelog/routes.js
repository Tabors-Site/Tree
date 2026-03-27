import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { getChangelog, summarizeChangelog, parseSince } from "./core.js";

const router = express.Router();

// GET /node/:nodeId/changelog
// Query params: since (24h, 7d, 2w, 30d, ISO date), userId, land (boolean)
router.get("/node/:nodeId/changelog", authenticate, async (req, res) => {
  try {
    const opts = {
      since: req.query.since || "24h",
      userId: req.query.userId || null,
      land: req.query.land === "true",
      limit: parseInt(req.query.limit) || 500,
    };

    const { contributions, since } = await getChangelog(req.params.nodeId, opts);

    if (contributions.length === 0) {
      return sendOk(res, {
        summary: `No changes since ${since.toISOString()}.`,
        contributions: 0,
        since: since.toISOString(),
      });
    }

    const narrative = await summarizeChangelog(
      req.params.nodeId,
      contributions,
      req.userId,
      req.username || "system",
      opts,
    );

    sendOk(res, {
      ...narrative,
      contributions: contributions.length,
      since: since.toISOString(),
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
