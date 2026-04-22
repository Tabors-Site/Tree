import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import log from "../../seed/log.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { getFlowForPosition } from "./core.js";
import urlAuth from "../html-rendering/urlAuth.js";
import { htmlOnly } from "../html-rendering/htmlHelpers.js";
import { esc } from "../html-rendering/html/utils.js";

const router = express.Router();

// GET /flow/signal/:signalId?html — rich detail for a single cascade signal.
// Renders a chronological hop timeline, source/target links, status pills,
// ext badges, and the raw payload JSON. Every nodeId is a clickable link
// back into the chat/tree context that generated the hop.
router.get("/flow/signal/:signalId", urlAuth, htmlOnly, async (req, res) => {
  try {
    const { signalId } = req.params;
    const { getCascadeResults } = await import("../../seed/tree/cascade.js");
    const results = await getCascadeResults(signalId);
    const hops = Array.isArray(results) ? [...results] : [];
    hops.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));

    // Auth preserving query string for every link.
    const qs = req.query.token ? `?token=${encodeURIComponent(req.query.token)}&html` : `?html`;

    // Resolve participating node ids → names (best effort).
    const Node = (await import("../../seed/models/node.js")).default;
    const ids = new Set();
    for (const h of hops) {
      if (h?.source) ids.add(String(h.source));
      if (h?.nodeId) ids.add(String(h.nodeId));
    }
    const nameMap = new Map();
    if (ids.size > 0) {
      try {
        const docs = await Node.find({ _id: { $in: [...ids] } }).select("_id name").lean();
        for (const d of docs) nameMap.set(String(d._id), d.name);
      } catch {}
    }

    const STATUS_COLOR = {
      succeeded: "#4ade80",
      failed:    "#f87171",
      rejected:  "#fb7185",
      queued:    "#60a5fa",
      awaiting:  "#a78bfa",
      partial:   "#fcd34d",
    };
    const statusColor = (s) => STATUS_COLOR[s] || "#64748b";
    const nodeLink = (id, label) => {
      if (!id) return "—";
      const name = nameMap.get(String(id)) || String(id).slice(0, 8);
      return `<a class="node-link" href="/api/v1/node/${esc(id)}/chats${qs}" title="View chats at this node">${esc(label || name)}</a>`;
    };

    const first = hops[0];
    const last = hops[hops.length - 1];
    const totalMs = first && last ? (new Date(last.timestamp || 0) - new Date(first.timestamp || 0)) : 0;
    const statuses = new Set(hops.map((h) => h.status).filter(Boolean));
    const finalStatus = last?.status || "unknown";

    const hopHtml = hops.map((h, i) => {
      const status = h.status || "unknown";
      const color = statusColor(status);
      const ts = h.timestamp ? new Date(h.timestamp) : null;
      const prev = i > 0 ? hops[i - 1] : null;
      const deltaMs = prev && ts ? (ts - new Date(prev.timestamp || 0)) : null;
      const depthStr = h.depth != null ? `depth ${h.depth}` : "";
      const ext = h.extName || h.extension || "";
      const summary = h.summary || h.reason || "";
      // Pull the useful action line out of payload so operators can read
      // "write ui/ui.js" instead of having to expand the details block.
      let payloadLine = "";
      if (h.payload && typeof h.payload === "object") {
        const act = h.payload.action || h.payload.kind;
        const path = h.payload.filePath || h.payload.path;
        const reason = h.payload.reason;
        const parts = [];
        if (act) parts.push(`<code>${esc(act)}</code>`);
        if (path) parts.push(esc(path));
        if (reason) parts.push(`<em>${esc(reason)}</em>`);
        payloadLine = parts.join(" · ");
      }
      const payloadPretty = h.payload != null ? JSON.stringify(h.payload, null, 2) : null;
      const resultPretty = h.result != null ? JSON.stringify(h.result, null, 2) : null;

      // Route line: a cascade result always has a source (where the handler
      // ran). Target (nodeId) is only set when the handler specifically
      // targeted another node. If target is missing, show "at <source>"
      // rather than "source → —".
      const srcLabel = nameMap.get(String(h.source)) || (h.source ? String(h.source).slice(0,8) : "?");
      const tgtLabel = h.nodeId && h.nodeId !== h.source ? (nameMap.get(String(h.nodeId)) || String(h.nodeId).slice(0,8)) : null;
      const routeHtml = tgtLabel
        ? `<span class="hop-at">at</span> ${nodeLink(h.source, srcLabel)} <span class="arrow">→</span> ${nodeLink(h.nodeId, tgtLabel)}`
        : `<span class="hop-at">at</span> ${nodeLink(h.source, srcLabel)}`;

      return `
        <div class="hop">
          <div class="hop-rail"><span class="hop-dot" style="background:${color}"></span></div>
          <div class="hop-body">
            <div class="hop-head">
              <span class="hop-status" style="background:${color}22;color:${color};border-color:${color}44">${esc(status)}</span>
              ${ext ? `<span class="hop-ext">${esc(ext)}</span>` : ""}
              ${depthStr ? `<span class="hop-depth">${esc(depthStr)}</span>` : ""}
              <span class="hop-time">${ts ? esc(ts.toLocaleString()) : "?"}</span>
              ${deltaMs != null ? `<span class="hop-delta">+${Math.round(deltaMs)}ms</span>` : ""}
            </div>
            <div class="hop-route">${routeHtml}</div>
            ${payloadLine ? `<div class="hop-action">${payloadLine}</div>` : ""}
            ${summary ? `<div class="hop-summary">${esc(summary)}</div>` : ""}
            ${payloadPretty || resultPretty ? `
              <details class="hop-json">
                <summary>raw JSON</summary>
                ${payloadPretty ? `<div class="hop-json-label">payload</div><pre>${esc(payloadPretty)}</pre>` : ""}
                ${resultPretty ? `<div class="hop-json-label">result</div><pre>${esc(resultPretty)}</pre>` : ""}
              </details>
            ` : ""}
          </div>
        </div>`;
    }).join("");

    res.send(`<!doctype html>
<html lang="en"><head>
  <meta charset="UTF-8">
  <title>signal ${esc(signalId).slice(0,8)} · Flow</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: #030712; color: #e5e7eb; padding: 24px 20px; }
    .wrap { max-width: 1000px; margin: 0 auto; display: flex; flex-direction: column; gap: 18px; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
    h1 { font-size: 1.2rem; font-weight: 600; color: #f1f5f9; letter-spacing: -0.01em; }
    .id { font-family: ui-monospace, Menlo, monospace; font-size: 0.78rem; color: #64748b; margin-top: 3px; word-break: break-all; }
    .back { font-size: 0.82rem; color: #5eead4; text-decoration: none; padding: 6px 14px; border: 1px solid rgba(94,234,212,0.3); border-radius: 8px; }
    .back:hover { background: rgba(94,234,212,0.1); }

    .summary { display: flex; gap: 10px; flex-wrap: wrap; font-size: 0.82rem; }
    .chip { padding: 5px 12px; border-radius: 999px; border: 1px solid rgba(148,163,184,0.2); background: rgba(30,41,59,0.5); color: #cbd5e1; display: inline-flex; align-items: center; gap: 6px; }
    .chip strong { color: #f1f5f9; font-weight: 600; }

    .card { background: linear-gradient(180deg, #1a2234 0%, #131a2a 100%); border: 1px solid rgba(148,163,184,0.12); border-radius: 14px; padding: 18px; }
    .card-title { font-size: 0.72rem; font-weight: 700; color: #94a3b8; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 14px; }

    .timeline { display: flex; flex-direction: column; gap: 14px; }
    .hop { display: grid; grid-template-columns: 20px 1fr; gap: 10px; }
    .hop-rail { display: flex; flex-direction: column; align-items: center; }
    .hop-dot { width: 12px; height: 12px; border-radius: 50%; margin-top: 6px; box-shadow: 0 0 0 3px rgba(148,163,184,0.08); }
    .hop-body { background: rgba(30,41,59,0.5); border: 1px solid rgba(148,163,184,0.08); border-radius: 10px; padding: 10px 14px; }
    .hop-head { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; margin-bottom: 6px; font-size: 0.74rem; color: #94a3b8; }
    .hop-status { padding: 2px 8px; border-radius: 999px; font-size: 0.7rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; border: 1px solid; }
    .hop-ext { color: #5eead4; font-weight: 500; }
    .hop-depth { color: #64748b; }
    .hop-time { margin-left: auto; font-variant-numeric: tabular-nums; }
    .hop-delta { color: #64748b; font-family: ui-monospace, Menlo, monospace; font-size: 0.72rem; }
    .hop-route { font-size: 0.92rem; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .hop-route .arrow { color: #64748b; }
    .hop-at { color: #64748b; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; }
    .hop-action { margin-top: 4px; font-size: 0.86rem; color: #cbd5e1; display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
    .hop-action code { background: rgba(94,234,212,0.08); color: #5eead4; padding: 1px 6px; border-radius: 4px; font-family: ui-monospace, Menlo, monospace; font-size: 0.78rem; }
    .hop-action em { color: #fca5a5; font-style: normal; }
    .node-link { color: #f1f5f9; text-decoration: none; border-bottom: 1px dotted rgba(148,163,184,0.4); }
    .node-link:hover { color: #5eead4; border-bottom-color: #5eead4; }
    .hop-summary { margin-top: 4px; font-size: 0.82rem; color: #cbd5e1; }
    .hop-json { margin-top: 8px; font-size: 0.8rem; }
    .hop-json summary { cursor: pointer; color: #64748b; padding: 2px 0; }
    .hop-json summary:hover { color: #cbd5e1; }
    .hop-json-label { font-size: 0.7rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; margin: 8px 0 4px; }
    .hop-json pre { background: rgba(3,7,18,0.6); padding: 10px 12px; border-radius: 8px; font-size: 0.74rem; line-height: 1.5; color: #cbd5e1; font-family: ui-monospace, Menlo, monospace; overflow-x: auto; border: 1px solid rgba(148,163,184,0.08); }

    .empty { padding: 40px 20px; text-align: center; color: #64748b; font-style: italic; }
  </style>
</head><body>
  <div class="wrap">
    <div class="head">
      <div>
        <h1>Cascade signal <span style="color:${statusColor(finalStatus)}">· ${esc(finalStatus)}</span></h1>
        <div class="id">${esc(signalId)}</div>
      </div>
      <div style="display:flex;gap:8px">
        <a href="/dashboard/flow${qs}" class="back">Flow Dashboard</a>
        <a href="javascript:history.back()" class="back">← Back</a>
      </div>
    </div>

    <div class="summary">
      <span class="chip"><strong>${hops.length}</strong> hop${hops.length === 1 ? "" : "s"}</span>
      <span class="chip"><strong>${statuses.size}</strong> status${statuses.size === 1 ? "" : "es"}</span>
      ${totalMs > 0 ? `<span class="chip"><strong>${Math.round(totalMs)}</strong>ms span</span>` : ""}
      ${first?.timestamp ? `<span class="chip">started ${esc(new Date(first.timestamp).toLocaleString())}</span>` : ""}
    </div>

    <div class="card">
      <div class="card-title">Hop Timeline</div>
      <p style="color:#94a3b8;font-size:0.82rem;line-height:1.5;margin-bottom:14px">
        A cascade signal fires when content is written at a cascade-enabled node.
        Every extension's <code style="background:rgba(94,234,212,0.08);color:#5eead4;padding:1px 5px;border-radius:3px;font-family:ui-monospace,Menlo,monospace;font-size:0.78rem">onCascade</code>
        handler runs against the signal and reports a result — each row below is one of those reports.
        Click any node name to jump to that node's chats.
      </p>
      ${hops.length === 0 ? `<div class="empty">No hops recorded for this signalId.</div>` : `<div class="timeline">${hopHtml}</div>`}
    </div>
  </div>
</body></html>`);
  } catch (err) {
    log.error("Flow", "Signal detail error:", err.message);
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
