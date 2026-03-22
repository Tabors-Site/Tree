import express from "express";
import authenticate from "../../middleware/authenticate.js";
import { updateSchedule } from "../../core/tree/schedules.js";
import Node from "../../db/models/node.js";

const router = express.Router();

async function useLatest(req, res, next) {
  try {
    const node = await Node.findById(req.params.nodeId).select("prestige").lean();
    if (!node) return res.status(404).json({ error: "Node not found" });
    req.params.version = String(node.prestige);
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

const editScheduleHandler = async (req, res) => {
  try {
    const { nodeId, version } = req.params;
    const userId = req.userId;

    const newSchedule = req.body?.newSchedule || req.query?.newSchedule;
    const reeffectTime = req.body?.reeffectTime ?? req.query?.reeffectTime;

    if (reeffectTime === undefined) {
      return res.status(400).json({
        error: "reeffectTime is required",
      });
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

    res.json({ success: true, ...result });
  } catch (err) {
    console.error("editSchedule error:", err);
    res.status(err.status || 400).json({ error: err.message });
  }
};

router.post("/node/:nodeId/editSchedule", authenticate, useLatest, editScheduleHandler);
router.post("/node/:nodeId/:version/editSchedule", authenticate, editScheduleHandler);

export default router;
