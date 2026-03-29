import log from "../../seed/log.js";
import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { getContributions } from "../../seed/tree/contributions.js";

const router = express.Router();

router.get(
  "/node/:nodeId/contributions",
  authenticate,
  async (req, res) => {
    try {
      const { nodeId } = req.params;

      const rawLimit = req.query.limit;
      const limit = rawLimit !== undefined ? Number(rawLimit) : undefined;

      if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
        return sendError(res, 400, ERR.INVALID_INPUT, "Invalid limit");
      }

      const rawOffset = req.query.offset;
      const offset = rawOffset !== undefined ? Math.max(0, Number(rawOffset) || 0) : 0;

      const result = await getContributions({
        nodeId,
        limit,
        offset,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
      });

      sendOk(res, { nodeId, offset, ...result });
    } catch (err) {
      log.error("API", err);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  },
);

export default router;
