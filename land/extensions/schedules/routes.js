import log from "../../seed/log.js";
import express from "express";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import authenticate from "../../seed/middleware/authenticate.js";
import { updateSchedule } from "./core.js";

// Node model wired from init via setNodeModel before routes are used.
let _Node = null;
export function setNodeModel(Node) { _Node = Node; }

const router = express.Router();

async function useLatest(req, res, next) {
  try {
    const node = await _Node.findById(req.params.nodeId).select("prestige").lean();
    if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");
    req.params.version = String(0);
    next();
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
}

const editScheduleHandler = async (req, res) => {
  try {
    const { nodeId, version } = req.params;
    const userId = req.userId;

    const newSchedule = req.body?.newSchedule || req.query?.newSchedule;
    const reeffectTime = req.body?.reeffectTime ?? req.query?.reeffectTime;

    if (reeffectTime === undefined) {
      return sendError(res, 400, ERR.INVALID_INPUT, "reeffectTime is required");
    }

    const result = await updateSchedule({
      nodeId,
      versionIndex: Number(version),
      newSchedule,
      reeffectTime: Number(reeffectTime),
      userId,
    });

    if ("html" in req.query) {
      return res.redirect(
        `/api/v1/node/${nodeId}/${version}?token=${req.query.token ?? ""}&html`,
      );
    }

    sendOk(res, result);
  } catch (err) {
    log.error("Schedules", "editSchedule error:", err);
    sendError(res, err.status || 400, ERR.INVALID_INPUT, err.message);
  }
};

router.post("/node/:nodeId/editSchedule", authenticate, useLatest, editScheduleHandler);
router.post("/node/:nodeId/:version/editSchedule", authenticate, editScheduleHandler);

export default router;
