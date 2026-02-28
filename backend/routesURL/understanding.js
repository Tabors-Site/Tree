import express from "express";
import urlAuth from "../middleware/urlAuth.js";
import authenticate from "../middleware/authenticate.js";

import UnderstandingRun from "../db/models/understandingRun.js";
import UnderstandingNode from "../db/models/understandingNode.js";
import { getNotes } from "../core/notes.js";
const router = express.Router();

import { createUnderstandingRun } from "../core/understanding.js";
import { orchestrateUnderstanding } from "../ws/orchestrator/understandOrchestrator.js";
import Node from "../db/models/node.js";
function buildQueryString(req) {
  const allowedParams = ["token", "html"];

  const filtered = Object.entries(req.query)
    .filter(([key]) => allowedParams.includes(key))
    .map(([key, val]) =>
      val === "" ? key : `${key}=${encodeURIComponent(val)}`,
    )
    .join("&");

  return filtered ? `?${filtered}` : "";
}
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
const rainbow = [
  "#ff3b30",
  "#ff9500",
  "#ffcc00",
  "#34c759",
  "#32ade6",
  "#5856d6",
  "#af52de",
];
router.post("/root/:nodeId/understandings", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { perspective = "general" } = req.body;
    const userId = req.userId;

    // 🔒 Validate root node
    const rootNode = await Node.findById(nodeId).lean();
    if (!rootNode) {
      return res.status(404).json({
        error: "Root node not found",
      });
    }

    // 🧠 Create understanding run
    const result = await createUnderstandingRun(nodeId, userId, perspective);
    if ("html" in req.query) {
      return res.redirect(
        `/api/v1/root/${nodeId}/understandings/run/${
          result.understandingRunId
        }?token=${req.query.token ?? ""}&html`,
      );
    }
    return res.status(201).json({
      success: true,
      rootNodeId: nodeId,
      ...result,
    });
  } catch (err) {
    console.error("Error creating understanding run:", err);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

router.post(
  "/root/:nodeId/understandings/run/:runId/orchestrate",
  authenticate,
  async (req, res) => {
    const { nodeId, runId } = req.params;
    const userId = req.userId;
    const username = req.username;

    try {
      const result = await orchestrateUnderstanding({
        rootId: nodeId,
        userId,
        username,
        runId,
        source: "api",
      });

      if ("html" in req.query && result.success) {
        return res.redirect(
          `/api/v1/root/${nodeId}/understandings/run/${runId}?token=${req.query.token ?? ""}&html`,
        );
      }

      return res.json(result);
    } catch (err) {
      console.error("Understanding orchestration error:", err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  },
);

router.get(
  "/root/:nodeId/understandings/run/:runId",
  urlAuth,
  async (req, res) => {
    try {
      const { runId, nodeId } = req.params;
      const qs = buildQueryString(req);

      const run = await UnderstandingRun.findById(runId).lean();
      if (!run) {
        return res.status(404).json({ error: "UnderstandingRun not found" });
      }

      const topology = new Map(
        Object.entries(run.topology || {}).map(([k, v]) => [String(k), v]),
      );

      const uNodeIds = Object.values(run.nodeMap ?? {}).map(String);

      const nodes = await UnderstandingNode.find({
        _id: { $in: uNodeIds },
      })
        .select("_id realNodeId perspectiveStates")
        .lean();

      const byId = new Map(nodes.map((n) => [String(n._id), n]));

      // Load real node names for display
      const realNodeIds = nodes.map((n) => n.realNodeId);
      const realNodes = await Node.find({ _id: { $in: realNodeIds } })
        .select("_id name")
        .lean();
      const realNameById = new Map(
        realNodes.map((n) => [String(n._id), n.name]),
      );

      // Safe perspectiveStates accessor
      const getPS = (node, rid) => {
        const ps = node?.perspectiveStates;
        if (!ps) return null;
        if (ps instanceof Map) return ps.get(rid) || ps.get(String(rid));
        return ps[rid] || ps[String(rid)] || null;
      };

      const ridStr = String(run._id);

      // Completion check
      const completed = {};
      for (const node of nodes) {
        const topo = topology.get(String(node._id));
        const state = getPS(node, ridStr);
        completed[node._id] =
          !!state && !!topo && state.currentLayer >= topo.mergeLayer;
      }

      // JSON mode
      const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
      if (!wantHtml) {
        return res.json({
          understandingRunId: run._id,
          rootNodeId: run.rootNodeId,
          perspective: run.perspective,
          maxDepth: run.maxDepth,
          createdAt: run.createdAt,
          nodeMap: run.nodeMap ?? {},
          completed,
          nodes,
          topology: run.topology,
        });
      }

      // Build tree
      const buildTree = (uNodeId) => {
        const node = byId.get(String(uNodeId));
        const topo = topology.get(String(uNodeId));
        if (!node || !topo) return null;

        return {
          ...node,
          name: realNameById.get(String(node.realNodeId)) || "Untitled",
          depthFromRoot: topo.depthFromRoot,
          mergeLayer: topo.mergeLayer,
          childCount: topo.children.length,
          childNodes: topo.children.map(buildTree).filter(Boolean),
        };
      };

      const rootEntry = [...topology.entries()].find(
        ([, topo]) => topo.parent === null,
      );

      let rootFinalEncoding = null;
      let rootIsCompleted = false;

      if (rootEntry) {
        const rootUNodeId = rootEntry[0];
        rootIsCompleted = !!completed[rootUNodeId];
        if (rootIsCompleted) {
          const rootNode = byId.get(String(rootUNodeId));
          const rootState = getPS(rootNode, ridStr);
          if (rootState?.encoding) rootFinalEncoding = rootState.encoding;
        }
      }

      const tree = rootEntry ? buildTree(rootEntry[0]) : null;

      // Progress
      const totalNodes = nodes.length;
      const completedCount = Object.values(completed).filter(Boolean).length;
      const progressPercent =
        totalNodes > 0 ? Math.round((completedCount / totalNodes) * 100) : 0;

      // Render tree nodes as glass dropdown panes
      const renderTree = (node, depth = 0) => {
        if (!node) return "";

        const isCompleted = completed[node._id];
        const state = getPS(node, ridStr);
        const encoding = state?.encoding || "";
        const layer = state?.currentLayer ?? "-";
        const isLeaf = node.childCount === 0;
        const statusEmoji = isCompleted ? "✅" : "⏳";
        const typeLabel = isLeaf ? "Leaf" : `${node.childCount} children`;

        const encodingPreview = encoding
          ? escapeHtml(
              encoding.length > 120 ? encoding.slice(0, 120) + "…" : encoding,
            )
          : "";

        let html = `
          <div class="tree-item" style="margin-left: ${depth * 20}px; animation-delay: ${0.05 * depth}s;">
            <div class="tree-pane ${isCompleted ? "complete" : "pending"}" onclick="togglePane('${node._id}')">
              <div class="pane-header">
                <div class="pane-left">
                  <span class="pane-status">${statusEmoji}</span>
                  <div class="pane-title-group">
<span class="pane-name">${escapeHtml(node.name)}</span>
                    <span class="pane-meta">${typeLabel} · Layer ${layer}/${node.mergeLayer}</span>
                  </div>
                </div>
                <span class="pane-chevron" id="chev-${node._id}">▸</span>
              </div>
              ${encodingPreview ? `<div class="pane-preview">${encodingPreview}</div>` : ""}
            </div>

            <div class="pane-body" id="body-${node._id}">
              <div class="pane-detail-grid">
                <a href="/api/v1/node/${node.realNodeId}${qs}" class="pane-id-link" onclick="event.stopPropagation();">
                  📄 View Node
                </a>
                <a href="/api/v1/root/${run.rootNodeId}/understandings/${node._id}${qs}" class="pane-id-link" onclick="event.stopPropagation();">
                  🧠 Understanding
                </a>
              </div>
              ${
                encoding
                  ? `
              <div class="pane-encoding">
                <div class="pane-encoding-label">Encoding</div>
<pre>${escapeHtml(encoding)}</pre>
              </div>
              `
                  : `<div class="pane-encoding-label" style="margin-top:8px;">No encoding yet</div>`
              }
            </div>
          </div>
        `;

        for (const child of node.childNodes || []) {
          html += renderTree(child, depth + 1);
        }

        return html;
      };

      const createdDate = new Date(run.createdAt).toLocaleString();

      return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
<title>Understanding · ${escapeHtml(run.perspective.slice(0, 40))}</title>
  <style>
    /* =========================================================
       GLOBAL VARIABLES
       ========================================================= */
    :root {
      --glass-water-rgb: 115, 111, 230;
      --glass-alpha: 0.28;
      --glass-alpha-hover: 0.38;
    }

    /* =========================================================
       RESET & BASE
       ========================================================= */
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-tap-highlight-color: transparent;
    }

    html, body {
      background: #736fe6;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto",
        "Oxygen", "Ubuntu", "Cantarell", sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      min-height: 100dvh;
      padding: 20px;
      color: #1a1a1a;
      position: relative;
      overflow-x: hidden;
      touch-action: manipulation;
    }

    /* =========================================================
       ANIMATED BACKGROUND
       ========================================================= */
    body::before,
    body::after {
      content: "";
      position: fixed;
      border-radius: 50%;
      opacity: 0.08;
      animation: float 20s infinite ease-in-out;
      pointer-events: none;
    }

    body::before {
      width: 600px;
      height: 600px;
      background: white;
      top: -300px;
      right: -200px;
      animation-delay: -5s;
    }

    body::after {
      width: 400px;
      height: 400px;
      background: white;
      bottom: -200px;
      left: -100px;
      animation-delay: -10s;
    }

    @keyframes float {
      0%, 100% { transform: translateY(0) rotate(0deg); }
      50% { transform: translateY(-30px) rotate(5deg); }
    }

    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(30px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* =========================================================
       LAYOUT
       ========================================================= */
    .container {
      max-width: 900px;
      margin: 0 auto;
      position: relative;
      z-index: 1;
    }

    /* =========================================================
       GLASS BUTTONS
       ========================================================= */
    .glass-btn,
    .back-link {
      position: relative;
      overflow: hidden;
      padding: 10px 20px;
      border-radius: 980px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      white-space: nowrap;
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      color: white;
      text-decoration: none;
      font-family: inherit;
      font-size: 15px;
      font-weight: 600;
      letter-spacing: -0.2px;
      border: 1px solid rgba(255, 255, 255, 0.28);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      cursor: pointer;
      transition: background 0.3s cubic-bezier(0.4, 0, 0.2, 1),
        transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
        box-shadow 0.3s ease;
    }

    .glass-btn::before,
    .back-link::before {
      content: "";
      position: absolute;
      inset: -40%;
      background:
        radial-gradient(120% 60% at 0% 0%, rgba(255, 255, 255, 0.35), transparent 60%),
        linear-gradient(120deg, transparent 30%, rgba(255, 255, 255, 0.25), transparent 70%);
      opacity: 0;
      transform: translateX(-30%) translateY(-10%);
      transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      pointer-events: none;
    }

    .glass-btn:hover,
    .back-link:hover {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
      transform: translateY(-2px);
    }

    .glass-btn:hover::before,
    .back-link:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

    .glass-btn:active,
    .back-link:active {
      background: rgba(var(--glass-water-rgb), 0.45);
      transform: translateY(0);
    }

    /* =========================================================
       GLASS CARDS
       ========================================================= */
    .glass-card {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      border-radius: 16px;
      padding: 28px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.28);
      margin-bottom: 24px;
      animation: fadeInUp 0.6s ease-out both;
      position: relative;
      overflow: hidden;
    }

    .glass-card::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.05));
      pointer-events: none;
    }

    .glass-card h1 {
      font-size: 28px;
      font-weight: 600;
      letter-spacing: -0.5px;
      line-height: 1.3;
      margin-bottom: 8px;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      color: white;
    }

    .glass-card h2 {
      font-size: 18px;
      font-weight: 600;
      color: white;
      margin-bottom: 16px;
      letter-spacing: -0.3px;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    /* =========================================================
       NAV
       ========================================================= */
    .back-nav {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
      animation: fadeInUp 0.5s ease-out;
    }

    /* =========================================================
       META
       ========================================================= */
    .run-meta {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-top: 16px;
    }

    .meta-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .meta-label {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: rgba(255, 255, 255, 0.7);
    }

    .meta-value {
      font-size: 16px;
      font-weight: 600;
      color: white;
    }

    .id-chip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      background: rgba(255, 255, 255, 0.15);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .id-chip:hover {
      background: rgba(255, 255, 255, 0.25);
    }

    .id-chip code {
      font-size: 12px;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
      color: white;
      background: transparent;
    }

    .id-chip .copy-icon {
      font-size: 14px;
      opacity: 0.7;
      transition: opacity 0.2s;
    }

    .id-chip:hover .copy-icon { opacity: 1; }

    /* =========================================================
       PERSPECTIVE
       ========================================================= */
    .perspective-text {
      font-size: 16px;
      font-weight: 600;
      color: white;
      font-style: italic;
      line-height: 1.5;
    }

    /* =========================================================
       PROGRESS
       ========================================================= */
    .progress-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }

    .progress-label {
      font-size: 16px;
      font-weight: 600;
      color: white;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    .progress-pct {
      font-size: 24px;
      font-weight: 700;
      color: white;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    .progress-track {
      height: 14px;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 7px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.15);
    }

    .progress-fill {
      height: 100%;
      background: rgba(255, 255, 255, 0.6);
      border-radius: 7px;
      transition: width 0.6s ease;
      box-shadow: 0 0 12px rgba(255, 255, 255, 0.3);
    }

    .progress-sub {
      margin-top: 10px;
      text-align: center;
      font-size: 13px;
      color: rgba(255, 255, 255, 0.7);
    }

    /* =========================================================
       FINAL ENCODING
       ========================================================= */
    .final-card {
      border-left: 5px solid rgba(72, 187, 120, 0.8);
    }

    .final-card pre {
      background: rgba(0, 0, 0, 0.25);
      color: rgba(255, 255, 255, 0.9);
      padding: 16px;
      border-radius: 10px;
      font-size: 13px;
      line-height: 1.7;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
      white-space: pre-wrap;
      word-break: break-word;
      border: 1px solid rgba(255, 255, 255, 0.1);
      margin-top: 10px;
    }

    /* =========================================================
       TREE PANES
       ========================================================= */
    .tree-item {
      margin-bottom: 6px;
      animation: fadeInUp 0.4s ease-out both;
    }

    .tree-pane {
      background: rgba(var(--glass-water-rgb), 0.22);
      backdrop-filter: blur(18px) saturate(130%);
      -webkit-backdrop-filter: blur(18px) saturate(130%);
      border: 1px solid rgba(255, 255, 255, 0.22);
      border-radius: 12px;
      padding: 14px 18px;
      cursor: pointer;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
      overflow: hidden;
    }

    .tree-pane::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.03));
      pointer-events: none;
    }

    .tree-pane:hover {
      background: rgba(var(--glass-water-rgb), 0.32);
      transform: translateX(4px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
    }

    .tree-pane.complete {
      border-left: 3px solid rgba(72, 187, 120, 0.7);
    }

    .tree-pane.pending {
      border-left: 3px solid rgba(255, 255, 255, 0.25);
    }

    .pane-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .pane-left {
      display: flex;
      align-items: center;
      gap: 12px;
      flex: 1;
      min-width: 0;
    }

    .pane-status {
      font-size: 18px;
      flex-shrink: 0;
    }

    .pane-title-group {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .pane-name {
      font-size: 15px;
      font-weight: 600;
      color: white;
      letter-spacing: -0.2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .pane-meta {
      font-size: 12px;
      color: rgba(255, 255, 255, 0.6);
      font-weight: 500;
    }

    .pane-chevron {
      color: rgba(255, 255, 255, 0.5);
      font-size: 14px;
      transition: transform 0.25s ease;
      flex-shrink: 0;
    }

    .pane-chevron.open {
      transform: rotate(90deg);
    }

    .pane-preview {
      margin-top: 8px;
      font-size: 13px;
      color: rgba(255, 255, 255, 0.55);
      line-height: 1.5;
      font-style: italic;
    }

    /* Expanded body */
    .pane-body {
      display: none;
      margin-top: 8px;
      padding: 16px 18px;
      background: rgba(var(--glass-water-rgb), 0.18);
      backdrop-filter: blur(14px) saturate(120%);
      -webkit-backdrop-filter: blur(14px) saturate(120%);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 10px;
      animation: fadeInUp 0.25s ease-out;
    }

    .pane-body.open { display: block; }

    .pane-detail-grid {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }

    .pane-id-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 8px;
      color: white;
      text-decoration: none;
      font-size: 13px;
      font-weight: 600;
      transition: all 0.2s;
    }

    .pane-id-link:hover {
      background: rgba(255, 255, 255, 0.22);
      transform: translateY(-1px);
    }

    .pane-encoding-label {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: rgba(255, 255, 255, 0.6);
    }

    .pane-encoding pre {
      background: rgba(0, 0, 0, 0.25);
      color: rgba(255, 255, 255, 0.85);
      padding: 14px;
      border-radius: 8px;
      font-size: 13px;
      line-height: 1.6;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
      white-space: pre-wrap;
      word-break: break-word;
      border: 1px solid rgba(255, 255, 255, 0.08);
      margin-top: 8px;
    }

    /* =========================================================
       RESPONSIVE
       ========================================================= */
    @media (max-width: 640px) {
      body { padding: 16px; }
      .container { max-width: 100%; }
      .glass-card { padding: 20px; }
      .glass-card h1 { font-size: 24px; }
      .run-meta { grid-template-columns: 1fr; }
      .back-nav { flex-direction: column; }
      .back-link { width: 100%; justify-content: center; }
      .pane-detail-grid { flex-direction: column; }
      .pane-id-link { width: 100%; justify-content: center; }
      .pane-name { font-size: 14px; }
    }

    .process-btn {
      margin-top: 14px;
      padding: 10px 24px;
      border-radius: 980px;
      border: 1px solid rgba(72, 187, 178, 0.4);
      background: rgba(72, 187, 178, 0.25);
      color: white;
      font-weight: 600;
      font-size: 14px;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.3s;
      width: 100%;
    }
    .process-btn:hover:not(:disabled) {
      background: rgba(72, 187, 178, 0.4);
      transform: translateY(-1px);
    }
    .process-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .process-status {
      margin-top: 8px;
      font-size: 13px;
      font-weight: 500;
      display: none;
    }
  </style>
</head>
<body>
  <div class="container">

    <div class="back-nav">
      <a href="/api/v1/root/${run.rootNodeId}${qs}" class="back-link">← Back to Tree</a>
      <a href="/api/v1/root/${run.rootNodeId}/understandings${qs}" class="back-link">🧠 All Runs</a>
    </div>

    <!-- Header -->
    <div class="glass-card" style="animation-delay: 0.1s;">
      <h1>🧠 Understanding Run</h1>
      <div class="run-meta">
        <div class="meta-item">
          <div class="meta-label">Run ID</div>
          <div class="meta-value">
            <div class="id-chip" onclick="copyText('${run._id}', this)">
              <code>${run._id}</code>
              <span class="copy-icon">📋</span>
            </div>
          </div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Depth</div>
          <div class="meta-value">${run.maxDepth}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Nodes</div>
          <div class="meta-value">${totalNodes}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Created</div>
          <div class="meta-value">${createdDate}</div>
        </div>
      </div>
    </div>

    <!-- Perspective -->
    <div class="glass-card" style="animation-delay: 0.15s; padding: 20px 28px;">
      <div class="meta-label" style="margin-bottom: 8px;">Perspective</div>
<div class="perspective-text">${escapeHtml(run.perspective)}</div>
    </div>

    ${
      rootIsCompleted && rootFinalEncoding
        ? `
    <!-- Final Understanding -->
    <div class="glass-card final-card" style="animation-delay: 0.2s;">
      <div class="meta-label" style="margin-bottom: 4px;">✅ Final Understanding</div>
<pre>${escapeHtml(rootFinalEncoding)}</pre>
    </div>
    `
        : ""
    }

    <!-- Progress -->
    <div class="glass-card" style="animation-delay: 0.25s;">
      <div class="progress-row">
        <div class="progress-label">Progress</div>
        <div class="progress-pct">${progressPercent}%</div>
      </div>
      <div class="progress-track">
        <div class="progress-fill" style="width: ${progressPercent}%;"></div>
      </div>
      <div class="progress-sub">${completedCount} of ${totalNodes} nodes compressed</div>
      ${
        !rootIsCompleted
          ? `
      <button id="processBtn" class="process-btn" onclick="startProcess()">
        <span id="processBtnLabel">🧠 Process</span>
      </button>
      <div id="processStatus" class="process-status"></div>
      `
          : ""
      }
    </div>

    <!-- Tree -->
    <div class="glass-card" style="animation-delay: 0.3s;">
      <h2>Compression Tree</h2>
      ${tree ? renderTree(tree) : "<p style='color: rgba(255,255,255,0.6);'>No tree available</p>"}
    </div>

  </div>

  <script>
    function togglePane(id) {
      const body = document.getElementById('body-' + id);
      const chev = document.getElementById('chev-' + id);
      if (!body) return;
      body.classList.toggle('open');
      chev?.classList.toggle('open');
    }

    function copyText(text, el) {
      navigator.clipboard.writeText(text).then(() => {
        const icon = el.querySelector('.copy-icon');
        if (icon) {
          icon.textContent = '✔️';
          setTimeout(() => icon.textContent = '📋', 900);
        }
      });
    }

    async function startProcess() {
      var btn = document.getElementById('processBtn');
      var label = document.getElementById('processBtnLabel');
      var status = document.getElementById('processStatus');
      if (!btn) return;

      btn.disabled = true;
      label.textContent = '⏳ Processing…';
      status.style.display = 'block';
      status.style.color = 'rgba(255,255,255,0.6)';
      status.textContent = 'Running understanding orchestrator — this may take a while…';

      try {
        var res = await fetch('/api/v1/root/${run.rootNodeId}/understandings/run/${run._id}/orchestrate', {
          method: 'POST',
        });
        var data = await res.json();
        if (data.success) {
          status.style.color = 'rgba(72, 187, 120, 0.9)';
          status.textContent = data.alreadyComplete
            ? '✓ Already complete'
            : '✓ Done — ' + (data.nodesProcessed || 0) + ' nodes processed';
          label.textContent = '✅ Complete';
          setTimeout(function() { location.reload(); }, 1500);
        } else {
          status.style.color = 'rgba(255, 107, 107, 0.9)';
          status.textContent = '✕ ' + (data.error || 'Failed');
          label.textContent = '🧠 Retry';
          btn.disabled = false;
        }
      } catch (err) {
        status.style.color = 'rgba(255, 107, 107, 0.9)';
        status.textContent = '✕ Network error';
        label.textContent = '🧠 Retry';
        btn.disabled = false;
      }
    }
  </script>
</body>
</html>
      `);
    } catch (err) {
      console.error("Error fetching UnderstandingRun:", err);
      return res.status(500).json({ error: err.message });
    }
  },
);

router.get(
  "/root/:nodeId/understandings/:understandingNodeId",
  urlAuth,
  async (req, res) => {
    try {
      const { understandingNodeId, nodeId } = req.params;
      const { runId } = req.query;

      const uNode =
        await UnderstandingNode.findById(understandingNodeId).lean();
      if (!uNode) {
        return res.status(404).json({ error: "UnderstandingNode not found" });
      }

      const realNode = await Node.findById(uNode.realNodeId)
        .select("name prestige")
        .lean();

      let run = null;
      let structure = null;

      if (runId) {
        run = await UnderstandingRun.findById(runId).lean();
        if (!run) {
          return res.status(404).json({ error: "UnderstandingRun not found" });
        }

        const topo = run.topology?.[understandingNodeId];
        if (topo) {
          structure = {
            depthFromRoot: topo.depthFromRoot,
            mergeLayer: topo.mergeLayer,
            childrenCount: topo.children.length,
          };
        }
      }

      const notesResult = await getNotes({
        nodeId: realNode._id,
        version: realNode.prestige,
      });

      const encodingHistory = Object.entries(uNode.perspectiveStates || {}).map(
        ([stateRunId, state]) => {
          const isCurrentRun = runId && stateRunId === runId;
          const isCompleted =
            run &&
            run.topology?.[understandingNodeId] &&
            state.currentLayer === run.topology[understandingNodeId].mergeLayer;

          return {
            runId: stateRunId,
            perspective: state.perspective,
            currentLayer: state.currentLayer,
            encoding: state.encoding,
            updatedAt: state.updatedAt,
            isCurrentRun,
            isCompleted,
          };
        },
      );

      const data = {
        understandingNodeId: uNode._id,
        realNode: {
          id: uNode.realNodeId,
          name: realNode?.name ?? "Unknown",
        },
        runContext: run
          ? {
              runId: run._id,
              perspective: run.perspective,
              structure,
            }
          : null,
        encodingHistory,
        createdAt: uNode.createdAt,
        notesToBeCompressed: (notesResult?.notes ?? []).map((n) => ({
          content: n.content,
          username: n.username,
          createdAt: n.createdAt,
        })),
      };

      const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
      if (!wantHtml) {
        return res.json(data);
      }

      const qs = buildQueryString(req);
      const hasEncodings = encodingHistory.length > 0;

      const backTreeUrl = `/api/v1/root/${nodeId}${qs}`;
      const backUnderstandingsUrl = `/api/v1/root/${nodeId}/understandings${qs}`;
      const realNodeUrl = `/api/v1/node/${data.realNode.id}${qs}`;

      return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
<title>Understanding · ${escapeHtml(data.realNode.name)}</title>  <style>
    /* =========================================================
       GLOBAL VARIABLES
       ========================================================= */
    :root {
      --glass-water-rgb: 115, 111, 230;
      --glass-alpha: 0.28;
      --glass-alpha-hover: 0.38;
    }

    /* =========================================================
       RESET & BASE
       ========================================================= */
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-tap-highlight-color: transparent;
    }

    html, body {
      background: #736fe6;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto",
        "Oxygen", "Ubuntu", "Cantarell", sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      min-height: 100dvh;
      padding: 20px;
      color: #1a1a1a;
      position: relative;
      overflow-x: hidden;
      touch-action: manipulation;
    }

    /* =========================================================
       ANIMATED BACKGROUND
       ========================================================= */
    body::before,
    body::after {
      content: "";
      position: fixed;
      border-radius: 50%;
      opacity: 0.08;
      animation: float 20s infinite ease-in-out;
      pointer-events: none;
    }

    body::before {
      width: 600px; height: 600px;
      background: white; top: -300px; right: -200px;
      animation-delay: -5s;
    }

    body::after {
      width: 400px; height: 400px;
      background: white; bottom: -200px; left: -100px;
      animation-delay: -10s;
    }

    @keyframes float {
      0%, 100% { transform: translateY(0) rotate(0deg); }
      50% { transform: translateY(-30px) rotate(5deg); }
    }

    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(30px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* =========================================================
       LAYOUT
       ========================================================= */
    .container {
      max-width: 900px;
      margin: 0 auto;
      position: relative;
      z-index: 1;
    }

    /* =========================================================
       GLASS BUTTONS
       ========================================================= */
    .back-link {
      position: relative;
      overflow: hidden;
      padding: 10px 20px;
      border-radius: 980px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      white-space: nowrap;
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      color: white;
      text-decoration: none;
      font-family: inherit;
      font-size: 15px;
      font-weight: 600;
      letter-spacing: -0.2px;
      border: 1px solid rgba(255, 255, 255, 0.28);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      cursor: pointer;
      transition: background 0.3s cubic-bezier(0.4, 0, 0.2, 1),
        transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
        box-shadow 0.3s ease;
    }

    .back-link::before {
      content: "";
      position: absolute;
      inset: -40%;
      background:
        radial-gradient(120% 60% at 0% 0%, rgba(255, 255, 255, 0.35), transparent 60%),
        linear-gradient(120deg, transparent 30%, rgba(255, 255, 255, 0.25), transparent 70%);
      opacity: 0;
      transform: translateX(-30%) translateY(-10%);
      transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      pointer-events: none;
    }

    .back-link:hover {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
      transform: translateY(-2px);
    }

    .back-link:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

    .back-link:active {
      background: rgba(var(--glass-water-rgb), 0.45);
      transform: translateY(0);
    }

    /* =========================================================
       GLASS CARDS
       ========================================================= */
    .glass-card {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      border-radius: 16px;
      padding: 28px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.28);
      margin-bottom: 24px;
      animation: fadeInUp 0.6s ease-out both;
      position: relative;
      overflow: hidden;
    }

    .glass-card::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.05));
      pointer-events: none;
    }

    .glass-card h1 {
      font-size: 28px;
      font-weight: 600;
      letter-spacing: -0.5px;
      line-height: 1.3;
      margin-bottom: 12px;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      color: white;
    }

    .glass-card h1 a {
      color: white;
      text-decoration: none;
      transition: opacity 0.2s;
    }

    .glass-card h1 a:hover { opacity: 0.8; }

    .glass-card h2 {
      font-size: 18px;
      font-weight: 600;
      color: white;
      margin-bottom: 16px;
      letter-spacing: -0.3px;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      display: flex;
      align-items: center;
      gap: 10px;
    }

    /* =========================================================
       NAV
       ========================================================= */
    .back-nav {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
      animation: fadeInUp 0.5s ease-out;
    }

    /* =========================================================
       ID ROWS
       ========================================================= */
    .id-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 10px;
      padding: 10px 14px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 10px;
    }

    .id-label {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: rgba(255, 255, 255, 0.6);
      flex-shrink: 0;
    }

    .id-row code {
      font-size: 12px;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
      color: white;
      background: transparent;
      word-break: break-all;
      flex: 1;
    }

    .id-row a {
      color: white;
      text-decoration: none;
      transition: opacity 0.2s;
    }

    .id-row a:hover { opacity: 0.8; }

    .copy-btn {
      background: rgba(255, 255, 255, 0.15);
      border: 1px solid rgba(255, 255, 255, 0.2);
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 14px;
      opacity: 0.7;
      transition: all 0.2s;
      flex-shrink: 0;
      color: white;
    }

    .copy-btn:hover {
      opacity: 1;
      background: rgba(255, 255, 255, 0.25);
      transform: scale(1.05);
    }

    .copy-btn::before { display: none; }

    /* =========================================================
       CONTEXT META
       ========================================================= */
    .context-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 14px;
      margin-top: 12px;
    }

    .ctx-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .ctx-label {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: rgba(255, 255, 255, 0.6);
    }

    .ctx-value {
      font-size: 16px;
      font-weight: 600;
      color: white;
    }

    .ctx-value code {
      font-size: 11px;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
      color: rgba(255, 255, 255, 0.8);
      background: transparent;
    }

    /* =========================================================
       ENCODING CARDS
       ========================================================= */
    .encoding-list {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .enc-card {
      padding: 18px 20px;
      background: rgba(var(--glass-water-rgb), 0.22);
      backdrop-filter: blur(18px) saturate(130%);
      -webkit-backdrop-filter: blur(18px) saturate(130%);
      border: 1px solid rgba(255, 255, 255, 0.22);
      border-left: 4px solid rgba(255, 255, 255, 0.3);
      border-radius: 12px;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
      overflow: hidden;
    }

    .enc-card::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.02));
      pointer-events: none;
    }

    .enc-card:hover {
      background: rgba(var(--glass-water-rgb), 0.32);
      transform: translateX(4px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
    }

    .enc-card.current {
      border-left-color: rgba(72, 187, 120, 0.7);
    }

    .enc-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }

    .enc-meta { flex: 1; min-width: 200px; }

    .enc-run-row {
      font-size: 13px;
      color: rgba(255, 255, 255, 0.7);
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .enc-run-row strong { color: rgba(255, 255, 255, 0.9); }

    .enc-run-row a {
      color: white;
      text-decoration: none;
    }

    .enc-run-row a:hover { opacity: 0.8; }

    .enc-run-row code {
      font-size: 11px;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
      color: rgba(255, 255, 255, 0.7);
      background: transparent;
      cursor: pointer;
    }

    .enc-details {
      font-size: 15px;
      color: rgba(255, 255, 255, 0.6);
      margin-bottom: 6px;
      font-style: italic;
    }

    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 6px 14px;
      border-radius: 980px;
      font-size: 13px;
      font-weight: 600;
      border: 1px solid rgba(255, 255, 255, 0.2);
      flex-shrink: 0;
    }

    .status-pill.complete {
      background: rgba(72, 187, 120, 0.25);
      color: white;
    }

    .status-pill.pending {
      background: rgba(245, 124, 0, 0.25);
      color: white;
    }

    .current-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 10px;
      background: rgba(72, 187, 120, 0.35);
      border: 1px solid rgba(72, 187, 120, 0.4);
      color: white;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
    }

    .enc-content {
      background: rgba(0, 0, 0, 0.2);
      padding: 16px;
      border-radius: 10px;
      font-size: 14px;
      line-height: 1.7;
      color: rgba(255, 255, 255, 0.85);
      white-space: pre-wrap;
      word-wrap: break-word;
      border: 1px solid rgba(255, 255, 255, 0.08);
      margin-bottom: 10px;
    }

    .enc-content.in-progress {
      background: rgba(245, 124, 0, 0.12);
      border-color: rgba(245, 124, 0, 0.2);
      color: rgba(255, 255, 255, 0.6);
      font-style: italic;
    }

    .enc-footer {
      font-size: 12px;
      color: rgba(255, 255, 255, 0.4);
    }

    /* =========================================================
       NOTES
       ========================================================= */
    .notes-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .note-card {
      padding: 14px 18px;
      border-radius: 12px;
      border-left: 3px solid rgba(245, 124, 0, 0.6);
      background: rgba(245, 124, 0, 0.12);
      border: 1px solid rgba(245, 124, 0, 0.2);
      border-left-width: 3px;
      border-left-color: rgba(245, 124, 0, 0.6);
      transition: all 0.2s;
      position: relative;
      overflow: hidden;
    }

    .note-card::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.01));
      pointer-events: none;
    }

    .note-card:hover {
      transform: translateX(4px);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
    }

    .note-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      font-size: 13px;
      font-weight: 600;
      color: rgba(255, 255, 255, 0.65);
    }

    .note-avatar {
      width: 24px; height: 24px;
      border-radius: 50%;
      background: rgba(245, 124, 0, 0.5);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      flex-shrink: 0;
    }

    .note-content {
      font-size: 14px;
      line-height: 1.6;
      color: rgba(255, 255, 255, 0.85);
      white-space: pre-wrap;
      word-wrap: break-word;
    }

    .empty-state {
      text-align: center;
      padding: 40px;
      color: rgba(255, 255, 255, 0.5);
      font-style: italic;
    }

    /* =========================================================
       RESPONSIVE
       ========================================================= */
    @media (max-width: 640px) {
      body { padding: 16px; }
      .container { max-width: 100%; }
      .glass-card { padding: 20px; }
      .glass-card h1 { font-size: 24px; }
      .back-nav { flex-direction: column; }
      .back-link { width: 100%; justify-content: center; }
      .context-grid { grid-template-columns: 1fr; }
      .enc-header { flex-direction: column; }
      .id-row code { font-size: 11px; }
    }
  </style>
</head>
<body>
  <div class="container">

    <div class="back-nav">
      <a href="${backTreeUrl}" class="back-link">← Back to Tree</a>
      <a href="${backUnderstandingsUrl}" class="back-link">🧠 All Runs</a>
    </div>

    <!-- Header -->
    <div class="glass-card" style="animation-delay: 0.1s;">
<h1><a href="${realNodeUrl}">🧠 ${escapeHtml(data.realNode.name)}</a></h1>
      <div style="font-size: 14px; font-weight: 600; color: rgba(255,255,255,0.55); letter-spacing: 0.3px; text-transform: uppercase; margin-bottom: 8px;">Understanding Node</div>

      <div class="id-row">
        <span class="id-label">Understanding</span>
        <code id="uNodeId">${data.understandingNodeId}</code>
        <button class="copy-btn" onclick="copyId('uNodeId', this)">📋</button>
      </div>

      <div class="id-row">
        <span class="id-label">Real Node</span>
        <a href="${realNodeUrl}"><code id="realId">${data.realNode.id}</code></a>
        <button class="copy-btn" onclick="copyId('realId', this)">📋</button>
      </div>
    </div>

    ${
      data.runContext
        ? `
    <!-- Run Context -->
    <div class="glass-card" style="animation-delay: 0.15s;">
      <h2>Current Run Context</h2>
      <div class="context-grid">
        <div class="ctx-item">
          <div class="ctx-label">Run ID</div>
          <div class="ctx-value"><code>${data.runContext.runId}</code></div>
        </div>
        <div class="ctx-item">
          <div class="ctx-label">Depth</div>
          <div class="ctx-value">${data.runContext.structure?.depthFromRoot ?? "-"}</div>
        </div>
        <div class="ctx-item">
          <div class="ctx-label">Merge Layer</div>
          <div class="ctx-value">${data.runContext.structure?.mergeLayer ?? "-"}</div>
        </div>
        <div class="ctx-item">
          <div class="ctx-label">Children</div>
          <div class="ctx-value">${data.runContext.structure?.childrenCount ?? 0}</div>
        </div>
      </div>
    </div>
    `
        : ""
    }

    <!-- Encoding History -->
    <div class="glass-card" style="animation-delay: ${data.runContext ? "0.2s" : "0.15s"};">
      <h2>📚 Compression History</h2>

      ${
        hasEncodings
          ? `
        <div class="encoding-list">
          ${encodingHistory
            .map((e, i) => {
              const runUrl = `/api/v1/root/${nodeId}/understandings/run/${e.runId}${qs}`;
              const runIdClean = e.runId.replace(/-/g, "");
              return `
            <div class="enc-card ${e.isCurrentRun ? "current" : ""}" style="animation: fadeInUp 0.4s ease-out both; animation-delay: ${0.25 + i * 0.06}s;">
              <div class="enc-header">
                <div class="enc-meta">
                  <div class="enc-run-row">
                    <strong>Run:</strong>
                    <a href="${runUrl}"><code id="rid_${runIdClean}">${e.runId}</code></a>
                    <button class="copy-btn" onclick="copyId('rid_${runIdClean}', this)">📋</button>
                    ${e.isCurrentRun ? '<span class="current-badge">⭐ Current</span>' : ""}
                  </div>
                  <div class="enc-details">
${escapeHtml(e.perspective)} · Layer ${e.currentLayer}
                  </div>
                </div>
                ${
                  e.encoding
                    ? '<span class="status-pill complete">✅ Completed</span>'
                    : '<span class="status-pill pending">⏳ In Progress</span>'
                }
              </div>

              ${
                e.encoding
                  ? `<div class="enc-content">${escapeHtml(e.encoding)}</div>`
                  : `<div class="enc-content in-progress">Compression in progress…</div>`
              }

              <div class="enc-footer">
                Updated: ${new Date(e.updatedAt).toLocaleString()}
              </div>
            </div>
          `;
            })
            .join("")}
        </div>
      `
          : `
        <div class="empty-state">No compression history yet</div>
      `
      }
    </div>

    ${
      !hasEncodings && data.notesToBeCompressed.length > 0
        ? `
    <!-- Notes -->
    <div class="glass-card" style="animation-delay: 0.25s;">
      <h2>📝 Notes to be Compressed</h2>
      <div class="notes-list">
        ${data.notesToBeCompressed
          .map(
            (n, i) => `
          <div class="note-card" style="animation: fadeInUp 0.4s ease-out both; animation-delay: ${0.3 + i * 0.06}s;">
            <div class="note-header">
              <div class="note-avatar">👤</div>
              <span>@${escapeHtml(n.username)}</span>
            </div>
            <div class="note-content">${escapeHtml(n.content)}</div>
          </div>
        `,
          )
          .join("")}
      </div>
    </div>
    `
        : ""
    }

  </div>

  <script>
    function copyId(elemId, btn) {
      const el = document.getElementById(elemId);
      if (!el) return;
      navigator.clipboard.writeText(el.textContent.trim()).then(() => {
        btn.textContent = '✔️';
        setTimeout(() => btn.textContent = '📋', 900);
      });
    }
  </script>
</body>
</html>`);
    } catch (err) {
      console.error("Error fetching UnderstandingNode:", err);
      return res.status(500).json({ error: err.message });
    }
  },
);
router.get("/root/:nodeId/understandings", urlAuth, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const queryString = buildQueryString(req);

    const root = await Node.findById(nodeId).select("_id name userId").lean();
    if (!root) {
      return res.status(404).json({ error: "Root not found" });
    }

    const runs = await UnderstandingRun.find({ rootNodeId: nodeId })
      .sort({ createdAt: -1 })
      .lean();

    const data = {
      rootNodeId: root._id,
      rootName: root.name,
      understandings: runs.map((r) => ({
        _id: r._id,
        perspective: r.perspective,
        maxDepth: r.maxDepth,
        createdAt: r.createdAt,
      })),
    };

    const wantHtml = "html" in req.query;
    if (!wantHtml) {
      return res.json(data);
    }

    const runCards = data.understandings
      .map(
        (r, i) => `
        <a href="/api/v1/root/${nodeId}/understandings/run/${r._id}${queryString}" 
           class="run-card" 
           style="animation-delay: ${0.15 + i * 0.06}s;">
          <div class="run-card-header">
            <span class="run-perspective">${r.perspective}</span>
            <span class="run-chevron">→</span>
          </div>
          <div class="run-card-meta">
            <span>Depth ${r.maxDepth ?? "-"}</span>
            <span class="run-sep">·</span>
            <span>${new Date(r.createdAt).toLocaleString()}</span>
          </div>
        </a>
      `,
      )
      .join("");

    return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <title>Understandings · ${data.rootName}</title>
  <style>
    /* =========================================================
       GLOBAL VARIABLES
       ========================================================= */
    :root {
      --glass-water-rgb: 115, 111, 230;
      --glass-alpha: 0.28;
      --glass-alpha-hover: 0.38;
    }

    /* =========================================================
       RESET & BASE
       ========================================================= */
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-tap-highlight-color: transparent;
    }

    html, body {
      background: #736fe6;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto",
        "Oxygen", "Ubuntu", "Cantarell", sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      min-height: 100dvh;
      padding: 20px;
      color: #1a1a1a;
      position: relative;
      overflow-x: hidden;
      touch-action: manipulation;
    }

    /* =========================================================
       ANIMATED BACKGROUND
       ========================================================= */
    body::before,
    body::after {
      content: "";
      position: fixed;
      border-radius: 50%;
      opacity: 0.08;
      animation: float 20s infinite ease-in-out;
      pointer-events: none;
    }

    body::before {
      width: 600px; height: 600px;
      background: white; top: -300px; right: -200px;
      animation-delay: -5s;
    }

    body::after {
      width: 400px; height: 400px;
      background: white; bottom: -200px; left: -100px;
      animation-delay: -10s;
    }

    @keyframes float {
      0%, 100% { transform: translateY(0) rotate(0deg); }
      50% { transform: translateY(-30px) rotate(5deg); }
    }

    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(30px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* =========================================================
       LAYOUT
       ========================================================= */
    .container {
      max-width: 900px;
      margin: 0 auto;
      position: relative;
      z-index: 1;
    }

    /* =========================================================
       GLASS BUTTONS
       ========================================================= */
    .back-link,
    .create-btn {
      position: relative;
      overflow: hidden;
      padding: 10px 20px;
      border-radius: 980px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      white-space: nowrap;
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      color: white;
      text-decoration: none;
      font-family: inherit;
      font-size: 15px;
      font-weight: 600;
      letter-spacing: -0.2px;
      border: 1px solid rgba(255, 255, 255, 0.28);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      cursor: pointer;
      transition: background 0.3s cubic-bezier(0.4, 0, 0.2, 1),
        transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
        box-shadow 0.3s ease;
    }

    .back-link::before,
    .create-btn::before {
      content: "";
      position: absolute;
      inset: -40%;
      background:
        radial-gradient(120% 60% at 0% 0%, rgba(255, 255, 255, 0.35), transparent 60%),
        linear-gradient(120deg, transparent 30%, rgba(255, 255, 255, 0.25), transparent 70%);
      opacity: 0;
      transform: translateX(-30%) translateY(-10%);
      transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      pointer-events: none;
    }

    .back-link:hover,
    .create-btn:hover {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
      transform: translateY(-2px);
    }

    .back-link:hover::before,
    .create-btn:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

    .back-link:active,
    .create-btn:active {
      background: rgba(var(--glass-water-rgb), 0.45);
      transform: translateY(0);
    }

    .create-btn {
      --glass-water-rgb: 72, 187, 178;
      --glass-alpha: 0.34;
      --glass-alpha-hover: 0.46;
    }

    /* =========================================================
       GLASS CARDS
       ========================================================= */
    .glass-card {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      border-radius: 16px;
      padding: 28px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.28);
      margin-bottom: 24px;
      animation: fadeInUp 0.6s ease-out both;
      position: relative;
      overflow: hidden;
    }

    .glass-card::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.05));
      pointer-events: none;
    }

    .glass-card h1 {
      font-size: 28px;
      font-weight: 600;
      letter-spacing: -0.5px;
      line-height: 1.3;
      margin-bottom: 8px;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      color: white;
    }

    .glass-card h2 {
      font-size: 18px;
      font-weight: 600;
      color: white;
      margin-bottom: 16px;
      letter-spacing: -0.3px;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    /* =========================================================
       NAV
       ========================================================= */
    .back-nav {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
      animation: fadeInUp 0.5s ease-out;
    }

    /* =========================================================
       HEADER META
       ========================================================= */
    .header-sub {
      font-size: 14px;
      color: rgba(255, 255, 255, 0.65);
      line-height: 1.5;
      margin-bottom: 16px;
    }

    .root-chip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 14px;
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      color: white;
    }

    /* =========================================================
       RUN CARDS
       ========================================================= */
    .runs-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 24px;
    }

    .run-card {
      display: block;
      text-decoration: none;
      padding: 22px 24px;
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      border: 1px solid rgba(255, 255, 255, 0.28);
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
      overflow: hidden;
      animation: fadeInUp 0.5s ease-out both;
    }

    .run-card::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.02));
      pointer-events: none;
    }

    .run-card:hover {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
      transform: translateY(-2px);
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.18),
        inset 0 1px 0 rgba(255, 255, 255, 0.3);
    }

    .run-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
    }

    .run-perspective {
      font-size: 17px;
      font-weight: 600;
      color: white;
      letter-spacing: -0.3px;
      line-height: 1.4;
      flex: 1;
      min-width: 0;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    .run-chevron {
      color: rgba(255, 255, 255, 0.4);
      font-size: 18px;
      flex-shrink: 0;
      transition: transform 0.25s ease, color 0.25s ease;
    }

    .run-card:hover .run-chevron {
      color: rgba(255, 255, 255, 0.8);
      transform: translateX(4px);
    }

    .run-card-meta {
      font-size: 13px;
      color: rgba(255, 255, 255, 0.55);
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    .run-sep { opacity: 0.4; }

    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: rgba(255, 255, 255, 0.5);
      font-style: italic;
      font-size: 15px;
    }

    /* =========================================================
       CREATE FORM
       ========================================================= */
    .create-form {
      display: flex;
      gap: 12px;
      align-items: stretch;
      flex-wrap: wrap;
    }

    .create-input {
      flex: 1;
      min-width: 200px;
      padding: 12px 16px;
      font-size: 15px;
      border-radius: 12px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      background: rgba(255, 255, 255, 0.15);
      color: white;
      font-family: inherit;
      font-weight: 500;
      transition: all 0.2s;
    }

    .create-input::placeholder {
      color: rgba(255, 255, 255, 0.45);
    }

    .create-input:focus {
      outline: none;
      border-color: rgba(255, 255, 255, 0.6);
      background: rgba(255, 255, 255, 0.25);
      box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.15);
      transform: translateY(-2px);
    }

    /* =========================================================
       RESPONSIVE
       ========================================================= */
    @media (max-width: 640px) {
      body { padding: 16px; }
      .container { max-width: 100%; }
      .glass-card { padding: 20px; }
      .glass-card h1 { font-size: 24px; }
      .back-nav { flex-direction: column; }
      .back-link { width: 100%; justify-content: center; }
      .create-form { flex-direction: column; }
      .create-input { width: 100%; min-width: 0; }
      .create-btn { width: 100%; }
    }
  </style>
</head>
<body>
  <div class="container">

    <div class="back-nav">
      <a href="/api/v1/root/${nodeId}${queryString}" class="back-link">← Back to Tree</a>
    </div>

    <!-- Header -->
    <div class="glass-card" style="animation-delay: 0.1s;">
      <h1>🧠 Understanding Runs</h1>
      <div class="header-sub">
        Each perspective reveals different insights from the same tree.
      </div>
      <div class="root-chip">${data.rootName}</div>
    </div>

    <!-- Runs -->
    ${
      data.understandings.length
        ? `
      <div class="runs-list">
        ${runCards}
      </div>
    `
        : `
      <div class="glass-card" style="animation-delay: 0.15s;">
        <div class="empty-state">No understanding runs yet. Create one below.</div>
      </div>
    `
    }

    <!-- Create -->
    <div class="glass-card" style="animation-delay: 0.2s;">
      <h2>New Understanding</h2>
      <form method="POST" action="/api/v1/root/${nodeId}/understandings${queryString}" class="create-form">
        <input
          type="text"
          name="perspective"
          placeholder="Enter a perspective…"
          class="create-input"
          required
        />
        <button type="submit" class="create-btn">Create</button>
      </form>
    </div>

  </div>
</body>
</html>`);
  } catch (err) {
    console.error("Error fetching understandings:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get(
  "/root/:nodeId/understandings/run/:runId/:understandingNodeId",
  urlAuth,
  async (req, res) => {
    try {
      const { runId, understandingNodeId, nodeId } = req.params;
      const qs = buildQueryString(req);

      const root = await Node.findById(nodeId).select("_id name userId").lean();
      if (!root) {
        return res.status(404).json({ error: "Root not found" });
      }

      const uNode =
        await UnderstandingNode.findById(understandingNodeId).lean();
      if (!uNode) {
        return res.status(404).json({ error: "UnderstandingNode not found" });
      }

      const realNode = await Node.findById(uNode.realNodeId)
        .select("name prestige")
        .lean();

      const run = await UnderstandingRun.findById(runId).lean();
      if (!run) {
        return res.status(404).json({ error: "UnderstandingRun not found" });
      }

      // Safe perspectiveStates accessor
      const getPS = (node, rid) => {
        const ps = node?.perspectiveStates;
        if (!ps) return null;
        if (ps instanceof Map) return ps.get(rid) || ps.get(String(rid));
        return ps[rid] || ps[String(rid)] || null;
      };

      const ridStr = String(runId);
      const state = getPS(uNode, ridStr);
      const finalMessage = state?.encoding ?? null;
      const isCompleted = Boolean(finalMessage);

      /* =========================
         Determine leaf vs merge from topology
         ========================= */
      const topology = new Map(
        Object.entries(run.topology || {}).map(([k, v]) => [String(k), v]),
      );
      const topo = topology.get(String(understandingNodeId));
      const childIds = topo?.children || [];
      const isLeaf = childIds.length === 0;

      /* =========================
         Leaf: load notes
         Merge: load child encodings
         ========================= */
      let chats = [];
      let childEncodings = [];

      if (isLeaf) {
        const notesResult = await getNotes({
          nodeId: realNode._id,
          version: realNode.prestige,
        });

        chats = (notesResult?.notes ?? []).map((n) => ({
          role: n.username === "assistant" ? "assistant" : "user",
          content: n.content,
          username: n.username,
          createdAt: n.createdAt,
        }));
      } else {
        // Load child understanding nodes
        const childUNodes = await UnderstandingNode.find({
          _id: { $in: childIds.map(String) },
        }).lean();

        // Load their real node names
        const childRealIds = childUNodes.map((n) => n.realNodeId);
        const childRealNodes = await Node.find({ _id: { $in: childRealIds } })
          .select("_id name")
          .lean();
        const childNameById = new Map(
          childRealNodes.map((n) => [String(n._id), n.name]),
        );

        childEncodings = childUNodes.map((child) => {
          const childState = getPS(child, ridStr);
          const childTopo = topology.get(String(child._id));
          return {
            understandingNodeId: child._id,
            realNodeId: child.realNodeId,
            name: childNameById.get(String(child.realNodeId)) || "Untitled",
            encoding: childState?.encoding ?? null,
            currentLayer: childState?.currentLayer ?? null,
            mergeLayer: childTopo?.mergeLayer ?? null,
            isComplete:
              childState &&
              childTopo &&
              childState.currentLayer >= childTopo.mergeLayer,
          };
        });
      }

      /* =========================
         JSON Response
         ========================= */
      const data = {
        runId,
        understandingNodeId,
        realNode: {
          id: uNode.realNodeId,
          name: realNode?.name ?? "Unknown",
        },
        perspective: run.perspective,
        finalMessage,
        isLeaf,
        chats: isLeaf ? chats : [],
        childEncodings: isLeaf ? [] : childEncodings,
        isCompleted,
        updatedAt: state?.updatedAt ?? null,
      };

      const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
      if (!wantHtml) {
        return res.json(data);
      }

      /* =========================
         HTML Rendering
         ========================= */
      const backTreeUrl = `/api/v1/root/${nodeId}${qs}`;
      const backRunUrl = `/api/v1/root/${nodeId}/understandings/run/${runId}${qs}`;

      // Build the inputs section based on leaf vs merge
      let inputsHtml = "";

      if (isLeaf) {
        // Show original notes
        if (chats.length) {
          inputsHtml = `
            <div class="chat-list">
              ${chats
                .map(
                  (c, i) => `
                <div class="chat-msg ${c.role}" style="animation: fadeInUp 0.4s ease-out both; animation-delay: ${0.4 + i * 0.06}s;">
                  <div class="chat-head">
                    <div class="chat-avatar">${c.role === "assistant" ? "🤖" : "👤"}</div>
<span>@${escapeHtml(c.username)}</span>
                  </div>
<div class="chat-body">${escapeHtml(c.content)}</div>
                </div>
              `,
                )
                .join("")}
            </div>
          `;
        } else {
          inputsHtml = `<div class="empty-state">No notes on this node</div>`;
        }
      } else {
        // Show child encodings that were merged
        if (childEncodings.length) {
          inputsHtml = `
            <div class="child-encodings-list">
              ${childEncodings
                .map(
                  (child, i) => `
                <div class="child-encoding-pane" style="animation: fadeInUp 0.4s ease-out both; animation-delay: ${0.4 + i * 0.08}s;">
                  <div class="child-pane-header" onclick="toggleChild('${child.understandingNodeId}')">
                    <div class="child-pane-left">
                      <span class="child-status">${child.isComplete ? "✅" : "⏳"}</span>
                      <div class="child-pane-info">
<span class="child-pane-name">${escapeHtml(child.name)}</span>
                        <span class="child-pane-meta">Layer ${child.currentLayer ?? "-"}/${child.mergeLayer ?? "-"}</span>
                      </div>
                    </div>
                    <span class="child-chevron" id="cchev-${child.understandingNodeId}">▸</span>
                  </div>
                  <div class="child-pane-body" id="cbody-${child.understandingNodeId}">
                    ${
                      child.encoding
                        ? `
                        <pre class="child-encoding-text">${escapeHtml(child.encoding)}</pre>
                    `
                        : `
                      <div class="empty-state" style="padding: 16px;">No encoding yet</div>
                    `
                    }
                    <a href="/api/v1/root/${nodeId}/understandings/run/${runId}/${child.understandingNodeId}${qs}" class="child-detail-link" onclick="event.stopPropagation();">
                      View Details →
                    </a>
                  </div>
                </div>
              `,
                )
                .join("")}
            </div>
          `;
        } else {
          inputsHtml = `<div class="empty-state">No child nodes found</div>`;
        }
      }

      const inputsSectionTitle = isLeaf
        ? isCompleted
          ? "📝 Original Notes"
          : "🔄 Notes Being Compressed"
        : isCompleted
          ? "🔗 Merged Child Encodings"
          : "🔗 Child Encodings Being Merged";

      return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
<title>${escapeHtml(data.realNode.name)} – Compression</title>  <style>
    /* =========================================================
       GLOBAL VARIABLES
       ========================================================= */
    :root {
      --glass-water-rgb: 115, 111, 230;
      --glass-alpha: 0.28;
      --glass-alpha-hover: 0.38;
    }

    /* =========================================================
       RESET & BASE
       ========================================================= */
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-tap-highlight-color: transparent;
    }

    html, body {
      background: #736fe6;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto",
        "Oxygen", "Ubuntu", "Cantarell", sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      min-height: 100dvh;
      padding: 20px;
      color: #1a1a1a;
      position: relative;
      overflow-x: hidden;
      touch-action: manipulation;
    }

    /* =========================================================
       ANIMATED BACKGROUND
       ========================================================= */
    body::before,
    body::after {
      content: "";
      position: fixed;
      border-radius: 50%;
      opacity: 0.08;
      animation: float 20s infinite ease-in-out;
      pointer-events: none;
    }

    body::before {
      width: 600px; height: 600px;
      background: white; top: -300px; right: -200px;
      animation-delay: -5s;
    }

    body::after {
      width: 400px; height: 400px;
      background: white; bottom: -200px; left: -100px;
      animation-delay: -10s;
    }

    @keyframes float {
      0%, 100% { transform: translateY(0) rotate(0deg); }
      50% { transform: translateY(-30px) rotate(5deg); }
    }

    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(30px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* =========================================================
       LAYOUT
       ========================================================= */
    .container {
      max-width: 900px;
      margin: 0 auto;
      position: relative;
      z-index: 1;
    }

    /* =========================================================
       GLASS BUTTONS
       ========================================================= */
    .back-link {
      position: relative;
      overflow: hidden;
      padding: 10px 20px;
      border-radius: 980px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      white-space: nowrap;
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      color: white;
      text-decoration: none;
      font-family: inherit;
      font-size: 15px;
      font-weight: 600;
      letter-spacing: -0.2px;
      border: 1px solid rgba(255, 255, 255, 0.28);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      cursor: pointer;
      transition: background 0.3s cubic-bezier(0.4, 0, 0.2, 1),
        transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
        box-shadow 0.3s ease;
    }

    .back-link::before {
      content: "";
      position: absolute;
      inset: -40%;
      background:
        radial-gradient(120% 60% at 0% 0%, rgba(255, 255, 255, 0.35), transparent 60%),
        linear-gradient(120deg, transparent 30%, rgba(255, 255, 255, 0.25), transparent 70%);
      opacity: 0;
      transform: translateX(-30%) translateY(-10%);
      transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      pointer-events: none;
    }

    .back-link:hover {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
      transform: translateY(-2px);
    }

    .back-link:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

    .back-link:active {
      background: rgba(var(--glass-water-rgb), 0.45);
      transform: translateY(0);
    }

    /* =========================================================
       GLASS CARDS
       ========================================================= */
    .glass-card {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      border-radius: 16px;
      padding: 28px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.28);
      margin-bottom: 24px;
      animation: fadeInUp 0.6s ease-out both;
      position: relative;
      overflow: hidden;
    }

    .glass-card::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.05));
      pointer-events: none;
    }

    .glass-card h1 {
      font-size: 28px;
      font-weight: 600;
      letter-spacing: -0.5px;
      line-height: 1.3;
      margin-bottom: 12px;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      color: white;
    }

    .glass-card h2 {
      font-size: 18px;
      font-weight: 600;
      color: white;
      margin-bottom: 16px;
      letter-spacing: -0.3px;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      display: flex;
      align-items: center;
      gap: 10px;
    }

    /* =========================================================
       NAV
       ========================================================= */
    .back-nav {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
      animation: fadeInUp 0.5s ease-out;
    }

    /* =========================================================
       META
       ========================================================= */
    .header-meta {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .node-type-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 980px;
      font-size: 13px;
      font-weight: 600;
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: rgba(255, 255, 255, 0.85);
    }

    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 18px;
      border-radius: 980px;
      font-size: 14px;
      font-weight: 600;
      border: 1px solid rgba(255, 255, 255, 0.25);
    }

    .status-pill.complete {
      background: rgba(72, 187, 120, 0.3);
      color: white;
      box-shadow: 0 0 20px rgba(72, 187, 120, 0.15);
    }

    .status-pill.processing {
      background: rgba(255, 160, 122, 0.3);
      color: white;
      animation: breathe 2.5s ease-in-out infinite;
    }

    @keyframes breathe {
      0%, 100% { box-shadow: 0 0 12px rgba(255, 160, 122, 0.2); }
      50% { box-shadow: 0 0 28px rgba(255, 160, 122, 0.4); }
    }

    .perspective-chip {
      font-size: 13px;
      color: rgba(255, 255, 255, 0.8);
      padding: 6px 14px;
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 8px;
      font-style: italic;
    }

    .spinner {
      display: inline-block;
      width: 14px; height: 14px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    /* =========================================================
       PROCESSING
       ========================================================= */
    .processing-card {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 14px;
      padding: 22px;
      animation: breathe 2.5s ease-in-out infinite;
    }

    .processing-dots { display: flex; gap: 6px; }

    .dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.7);
      animation: bounce 1.4s ease-in-out infinite;
    }

    .dot:nth-child(1) { animation-delay: 0s; }
    .dot:nth-child(2) { animation-delay: 0.2s; }
    .dot:nth-child(3) { animation-delay: 0.4s; }

    @keyframes bounce {
      0%, 80%, 100% { transform: scale(0); opacity: 0.4; }
      40% { transform: scale(1); opacity: 1; }
    }

    .processing-text {
      font-weight: 600;
      color: rgba(255, 255, 255, 0.85);
      font-size: 14px;
    }

    /* =========================================================
       ENCODING REVEAL
       ========================================================= */
    .encoding-card {
      border-left: 5px solid rgba(72, 187, 120, 0.7);
    }

    .encoding-text {
      background: rgba(0, 0, 0, 0.25);
      color: rgba(255, 255, 255, 0.9);
      padding: 20px;
      border-radius: 12px;
      font-size: 14px;
      line-height: 1.8;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
      white-space: pre-wrap;
      word-break: break-word;
      border: 1px solid rgba(255, 255, 255, 0.1);
      position: relative;
      overflow: hidden;
      min-height: 48px;
    }

    .encoding-text.revealing::after {
      content: "▊";
      color: rgba(72, 187, 120, 0.9);
      animation: blink 0.6s step-end infinite;
      font-weight: 300;
    }

    @keyframes blink { 50% { opacity: 0; } }

    .encoding-text.revealing::before {
      content: "";
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 2px;
      background: linear-gradient(90deg,
        transparent,
        rgba(72, 187, 120, 0.6),
        rgba(255, 255, 255, 0.8),
        rgba(72, 187, 120, 0.6),
        transparent
      );
      animation: scanDown 2s ease-in-out infinite;
      z-index: 1;
    }

    @keyframes scanDown {
      0% { top: 0; opacity: 1; }
      100% { top: 100%; opacity: 0; }
    }

    .encoding-card.revealed {
      animation: glowPulse 1.5s ease-out;
    }

    @keyframes glowPulse {
      0% { box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.25), 0 0 40px rgba(72, 187, 120, 0.4); }
      100% { box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.25); }
    }

    /* =========================================================
       CHAT MESSAGES (leaf inputs)
       ========================================================= */
    .chat-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .chat-msg {
      padding: 14px 18px;
      border-radius: 12px;
      transition: all 0.2s;
      position: relative;
      overflow: hidden;
    }

    .chat-msg::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02));
      pointer-events: none;
    }

    .chat-msg:hover {
      transform: translateX(4px);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
    }

    .chat-msg.user {
      background: rgba(245, 124, 0, 0.15);
      border: 1px solid rgba(245, 124, 0, 0.2);
      border-left: 3px solid rgba(245, 124, 0, 0.7);
    }

    .chat-msg.assistant {
      background: rgba(72, 187, 120, 0.12);
      border: 1px solid rgba(72, 187, 120, 0.2);
      border-left: 3px solid rgba(72, 187, 120, 0.7);
    }

    .chat-head {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      font-size: 13px;
      font-weight: 600;
      color: rgba(255, 255, 255, 0.7);
    }

    .chat-avatar {
      width: 24px; height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      flex-shrink: 0;
    }

    .chat-msg.user .chat-avatar { background: rgba(245, 124, 0, 0.5); color: white; }
    .chat-msg.assistant .chat-avatar { background: rgba(72, 187, 120, 0.5); color: white; }

    .chat-body {
      font-size: 14px;
      line-height: 1.6;
      color: rgba(255, 255, 255, 0.85);
      white-space: pre-wrap;
      word-wrap: break-word;
    }

    /* =========================================================
       CHILD ENCODING PANES (merge inputs)
       ========================================================= */
    .child-encodings-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .child-encoding-pane {
      border-radius: 12px;
      overflow: hidden;
    }

    .child-pane-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 18px;
      background: rgba(var(--glass-water-rgb), 0.22);
      backdrop-filter: blur(18px) saturate(130%);
      -webkit-backdrop-filter: blur(18px) saturate(130%);
      border: 1px solid rgba(255, 255, 255, 0.22);
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
      overflow: hidden;
    }

    .child-pane-header::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.02));
      pointer-events: none;
    }

    .child-pane-header:hover {
      background: rgba(var(--glass-water-rgb), 0.32);
      transform: translateX(4px);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
    }

    .child-pane-left {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
      flex: 1;
    }

    .child-status { font-size: 16px; flex-shrink: 0; }

    .child-pane-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .child-pane-name {
      font-size: 15px;
      font-weight: 600;
      color: white;
      letter-spacing: -0.2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .child-pane-meta {
      font-size: 12px;
      color: rgba(255, 255, 255, 0.55);
      font-weight: 500;
    }

    .child-chevron {
      color: rgba(255, 255, 255, 0.5);
      font-size: 14px;
      transition: transform 0.25s ease;
      flex-shrink: 0;
    }

    .child-chevron.open { transform: rotate(90deg); }

    .child-pane-body {
      display: none;
      margin-top: 6px;
      padding: 16px 18px;
      background: rgba(var(--glass-water-rgb), 0.15);
      backdrop-filter: blur(14px) saturate(120%);
      -webkit-backdrop-filter: blur(14px) saturate(120%);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 10px;
      animation: fadeInUp 0.25s ease-out;
    }

    .child-pane-body.open { display: block; }

    .child-encoding-text {
      background: rgba(0, 0, 0, 0.2);
      color: rgba(255, 255, 255, 0.85);
      padding: 14px;
      border-radius: 8px;
      font-size: 13px;
      line-height: 1.6;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
      white-space: pre-wrap;
      word-break: break-word;
      border: 1px solid rgba(255, 255, 255, 0.08);
      margin: 0;
    }

    .child-detail-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-top: 12px;
      padding: 8px 14px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 8px;
      color: white;
      text-decoration: none;
      font-size: 13px;
      font-weight: 600;
      transition: all 0.2s;
    }

    .child-detail-link:hover {
      background: rgba(255, 255, 255, 0.2);
      transform: translateY(-1px);
    }

    /* =========================================================
       EMPTY / MISC
       ========================================================= */
    .empty-state {
      text-align: center;
      padding: 40px;
      color: rgba(255, 255, 255, 0.5);
      font-style: italic;
    }

    /* =========================================================
       REFRESH TOAST
       ========================================================= */
    .refresh-toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: rgba(var(--glass-water-rgb), 0.5);
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      padding: 12px 20px;
      border-radius: 980px;
      border: 1px solid rgba(255, 255, 255, 0.25);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
      font-size: 13px;
      font-weight: 600;
      color: white;
      display: flex;
      align-items: center;
      gap: 10px;
      animation: fadeInUp 0.5s ease-out;
      z-index: 100;
    }

    /* =========================================================
       RESPONSIVE
       ========================================================= */
    @media (max-width: 640px) {
      body { padding: 16px; }
      .container { max-width: 100%; }
      .glass-card { padding: 20px; }
      .glass-card h1 { font-size: 24px; }
      .back-nav { flex-direction: column; }
      .back-link { width: 100%; justify-content: center; }
      .header-meta { flex-direction: column; align-items: flex-start; }
      .refresh-toast { bottom: 16px; right: 16px; left: 16px; }
      .child-pane-header { padding: 12px 14px; }
    }
  </style>
</head>
<body>
  <div class="container">

    <div class="back-nav">
      <a href="${backTreeUrl}" class="back-link">← Back to Tree</a>
      <a href="${backRunUrl}" class="back-link">🧠 Run Progress</a>
    </div>

    <!-- Header -->
    <div class="glass-card" style="animation-delay: 0.1s;">
<h1>${escapeHtml(data.realNode.name)}</h1>
      <div class="header-meta">
        <span class="node-type-badge">${isLeaf ? "🍃 Leaf" : "🔗 Merge · " + childEncodings.length + " children"}</span>
        <span class="status-pill ${isCompleted ? "complete" : "processing"}">
          ${
            isCompleted
              ? "✅ Compressed"
              : '<span class="spinner"></span> Processing'
          }
        </span>
<span class="perspective-chip">${escapeHtml(data.perspective)}</span>
      </div>
    </div>

    ${
      !isCompleted
        ? `
    <div class="glass-card processing-card" style="animation-delay: 0.15s;">
      <div class="processing-dots">
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
      </div>
      <span class="processing-text">${isLeaf ? "Compressing notes…" : "Merging child encodings…"}</span>
    </div>
    `
        : ""
    }

    ${
      isCompleted
        ? `
    <div class="glass-card encoding-card" id="encodingCard" style="animation-delay: 0.2s;">
      <h2>✨ ${isLeaf ? "Compressed Understanding" : "Merged Understanding"}</h2>
      <div class="encoding-text revealing" id="encodingText"></div>
    </div>
    `
        : ""
    }

    <!-- Inputs -->
    <div class="glass-card" style="animation-delay: ${isCompleted ? "0.35s" : "0.2s"};">
      <h2>${inputsSectionTitle}</h2>
      ${inputsHtml}
    </div>

    ${
      !isCompleted
        ? `
    <div class="refresh-toast">
      <span class="spinner"></span>
      Checking for updates…
    </div>
    `
        : ""
    }

  </div>

  ${
    isCompleted
      ? `
  <script>
    // Typewriter reveal
    (function() {
      const full = ${JSON.stringify(finalMessage)};
      const el = document.getElementById('encodingText');
      const card = document.getElementById('encodingCard');
      if (!el || !full) return;

      let i = 0;
      const speed = Math.max(8, Math.min(30, 2000 / full.length));

      function type() {
        if (i < full.length) {
          const chunk = Math.min(3, full.length - i);
          el.textContent += full.slice(i, i + chunk);
          i += chunk;
          el.scrollTop = el.scrollHeight;
          requestAnimationFrame(() => setTimeout(type, speed));
        } else {
          el.classList.remove('revealing');
          card.classList.add('revealed');
        }
      }

      setTimeout(type, 700);
    })();

    // Toggle child panes
    function toggleChild(id) {
      const body = document.getElementById('cbody-' + id);
      const chev = document.getElementById('cchev-' + id);
      if (!body) return;
      body.classList.toggle('open');
      chev?.classList.toggle('open');
    }
  </script>
  `
      : `
  <script>
    function toggleChild(id) {
      const body = document.getElementById('cbody-' + id);
      const chev = document.getElementById('cchev-' + id);
      if (!body) return;
      body.classList.toggle('open');
      chev?.classList.toggle('open');
    }

    // Auto-refresh while processing
    (function() {
      let count = 0;
      function check() {
        if (count++ >= 100) return;
        setTimeout(() => window.location.reload(), 3000 + Math.random() * 1000);
      }
      check();
    })();
  </script>
  `
  }
</body>
</html>`);
    } catch (err) {
      console.error("Error fetching run node view:", err);
      return res.status(500).json({ error: err.message });
    }
  },
);

export default router;
