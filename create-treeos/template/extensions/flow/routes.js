import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import log from "../../seed/log.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { getFlowForPosition } from "./core.js";

const router = express.Router();

// GET /node/:nodeId/flow - Cascade flow scoped to position
// Land root: all flow. Tree root: tree-wide flow. Node: that node's flow.
router.get("/node/:nodeId/flow", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const limit = Math.min(Math.max(parseInt(req.query.limit || "50", 10), 1), 500);
    const data = await getFlowForPosition(nodeId, limit);
    sendOk(res, data);
  } catch (err) {
    log.error("Flow", "Error reading flow:", err.message);
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /flow/stats - partition sizes, today's count, retention
router.get("/flow/stats", authenticate, async (req, res) => {
  try {
    const Node = (await import("../../seed/models/node.js")).default;
    const { SYSTEM_ROLE } = await import("../../seed/protocol.js");
    const { getLandConfigValue } = await import("../../seed/landConfig.js");

    const flowNode = await Node.findOne({ systemRole: SYSTEM_ROLE.FLOW }).select("_id children").lean();
    if (!flowNode) return sendOk(res, { message: "No .flow node found" });

    const partitions = await Node.find({ parent: flowNode._id })
      .select("name metadata")
      .sort({ name: -1 })
      .lean();

    const today = new Date().toISOString().slice(0, 10);
    const ttl = parseInt(getLandConfigValue("resultTTL") || "604800", 10);
    const maxPerDay = parseInt(getLandConfigValue("flowMaxResultsPerDay") || "10000", 10);

    const partitionStats = partitions.map((p) => {
      const results = p.metadata instanceof Map
        ? p.metadata.get("results") || {}
        : p.metadata?.results || {};
      return { date: p.name, signalCount: Object.keys(results).length };
    });

    const todayPartition = partitionStats.find((p) => p.date === today);

    sendOk(res, {
      partitionCount: partitions.length,
      oldestPartition: partitions.length > 0 ? partitions[partitions.length - 1].name : null,
      newestPartition: partitions.length > 0 ? partitions[0].name : null,
      todaySignals: todayPartition?.signalCount || 0,
      todayCap: maxPerDay,
      resultTTLDays: Math.round(ttl / 86400),
      partitions: partitionStats,
    });
  } catch (err) {
    log.error("Flow", "Stats error:", err.message);
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
