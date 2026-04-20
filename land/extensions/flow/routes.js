import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import log from "../../seed/log.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { getFlowForPosition } from "./core.js";
import urlAuth from "../html-rendering/urlAuth.js";
import { htmlOnly } from "../html-rendering/htmlHelpers.js";
import { esc } from "../html-rendering/html/utils.js";

const router = express.Router();

// GET /flow/signal/:signalId?html - Stub HTML detail for a cascade
// signal. Links in the AI chats page point here so every signalId is a
// real target from day one. The rich redesign (timeline, hop chain,
// payload viewer) replaces this later — keep the route URL stable so
// existing links don't break.
router.get("/flow/signal/:signalId", urlAuth, htmlOnly, async (req, res) => {
  try {
    const { signalId } = req.params;
    const { getCascadeResults } = await import("../../seed/tree/cascade.js");
    const results = await getCascadeResults(signalId);
    const count = Array.isArray(results) ? results.length : 0;
    const body = JSON.stringify(results || [], null, 2);
    res.send(`<!doctype html>
<html lang="en"><head>
  <meta charset="UTF-8">
  <title>cascade ${esc(signalId).slice(0, 8)}</title>
  <style>
    body { font-family: ui-monospace, Menlo, monospace; padding: 20px; background: #0e0e12; color: #ddd; max-width: 1100px; margin: 0 auto; }
    h2 { color: #8ec4ff; font-size: 16px; margin: 0 0 8px 0; }
    .meta { color: rgba(255,255,255,0.55); font-size: 12px; margin-bottom: 16px; }
    .meta a { color: rgba(200,150,100,0.9); }
    pre { background: rgba(0,0,0,0.4); padding: 14px; border-radius: 6px; overflow: auto; font-size: 11px; line-height: 1.5; color: rgba(220,230,255,0.9); }
  </style>
</head><body>
  <div class="meta"><a href="javascript:history.back()">&larr; back</a> · cascade signal · stub view</div>
  <h2>signalId ${esc(signalId)}</h2>
  <div class="meta">${count} hop(s) recorded in .flow</div>
  <pre>${esc(body)}</pre>
</body></html>`);
  } catch (err) {
    log.error("Flow", "Signal detail stub error:", err.message);
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

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
