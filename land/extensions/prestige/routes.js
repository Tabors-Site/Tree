import log from "../../seed/log.js";
import express from "express";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import authenticate from "../../seed/middleware/authenticate.js";
import { addPrestige } from "./core.js";
import Node from "../../seed/models/node.js";

const router = express.Router();

async function useLatest(req, res, next) {
  try {
    const node = await Node.findById(req.params.nodeId).select("prestige").lean();
    if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");
    req.params.version = String(0);
    next();
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
}

const prestigeHandler = async (req, res) => {
  try {
    const { nodeId, version } = req.params;
    const userId = req.userId;

    const nextVersion = Number(version) + 1;

    if (Number.isNaN(nextVersion)) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Invalid version");
    }

    const result = await addPrestige({
      nodeId,
      userId,
    });

    if ("html" in req.query) {
      return res.redirect(
        `/api/v1/node/${nodeId}/${nextVersion}?token=${req.query.token ?? ""}&html`,
      );
    }

    sendOk(res, result);
  } catch (err) {
 log.error("Prestige", "prestige error:", err);
    sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
};

router.post("/node/:nodeId/prestige", authenticate, useLatest, prestigeHandler);
router.post("/node/:nodeId/:version/prestige", authenticate, prestigeHandler);

export default router;
