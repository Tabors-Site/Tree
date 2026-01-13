import express from "express";
import urlAuth from "../middleware/urlAuth.js";
import authenticate from "../middleware/authenticate.js";

import UnderstandingRun from "../db/models/understandingRun.js";
import UnderstandingNode from "../db/models/understandingNode.js";
import { getNotes } from "../core/notes.js";
const router = express.Router();

import { createUnderstandingRun } from "../core/understanding.js";
import Node from "../db/models/node.js";
function buildQueryString(req) {
  const allowedParams = ["token", "html"];

  const filtered = Object.entries(req.query)
    .filter(([key]) => allowedParams.includes(key))
    .map(([key, val]) =>
      val === "" ? key : `${key}=${encodeURIComponent(val)}`
    )
    .join("&");

  return filtered ? `?${filtered}` : "";
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

    // 🔒 Validate root node
    const rootNode = await Node.findById(nodeId).lean();
    if (!rootNode) {
      return res.status(404).json({
        error: "Root node not found",
      });
    }

    // 🧠 Create understanding run
    const result = await createUnderstandingRun(nodeId, perspective);
    if ("html" in req.query) {
      return res.redirect(
        `/api/root/${nodeId}/understandings/run/${
          result.understandingRunId
        }?token=${req.query.token ?? ""}&html`
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

      const topology = new Map(Object.entries(run.topology || {}));

      const nodes = await UnderstandingNode.find({
        _id: { $in: Object.values(run.nodeMap ?? {}) },
      })
        .select("_id realNodeId perspectiveStates")
        .lean();

      const byId = new Map(nodes.map((n) => [String(n._id), n]));

      // ✅ completion is run-relative
      const completed = {};
      for (const node of nodes) {
        const topo = topology.get(String(node._id));
        const state = node.perspectiveStates?.[run._id];

        let isCompleted = false;

        if (state) {
          // Case 1: reached its declared max merge layer
          if (state.currentLayer >= topo.mergeLayer) {
            isCompleted = true;
          }
          // Case 2: final root — children are all completed
          else if (topo.parent === null && topo.children.length > 0) {
            isCompleted = topo.children.every((cid) => {
              const child = byId.get(String(cid));
              const childState = child?.perspectiveStates?.[run._id];
              const childTopo = topology.get(String(cid));
              return (
                childState &&
                childTopo &&
                childState.currentLayer >= childTopo.mergeLayer
              );
            });
          }
        }

        completed[node._id] = isCompleted;
      }

      const data = {
        understandingRunId: run._id,
        rootNodeId: run.rootNodeId,
        perspective: run.perspective,
        maxDepth: run.maxDepth,
        createdAt: run.createdAt,
        nodeMap: run.nodeMap ?? {},
        completed,
      };

      // JSON mode
      const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
      if (!wantHtml) {
        return res.json({
          ...data,
          nodes,
          topology: run.topology,
        });
      }

      // 🌳 Build tree from topology
      const buildTree = (uNodeId) => {
        const node = byId.get(String(uNodeId));
        const topo = topology.get(String(uNodeId));
        if (!node || !topo) return null;

        return {
          ...node,
          depthFromRoot: topo.depthFromRoot,
          mergeLayer: topo.mergeLayer,
          childNodes: topo.children.map(buildTree).filter(Boolean),
        };
      };

      // Find root
      const rootEntry = [...topology.entries()].find(
        ([, topo]) => topo.parent === null
      );
      let rootFinalEncoding = null;
      let rootIsCompleted = false;

      if (rootEntry) {
        const rootUNodeId = rootEntry[0];
        const rootNode = byId.get(String(rootUNodeId));
        const rootState = rootNode?.perspectiveStates?.[run._id];

        rootIsCompleted = !!completed[rootUNodeId];

        if (rootIsCompleted && rootState?.encoding) {
          rootFinalEncoding = rootState.encoding;
        }
      }

      const tree = rootEntry ? buildTree(rootEntry[0]) : null;

      // 📊 Progress
      const totalNodes = nodes.length;
      const completedCount = Object.values(completed).filter(Boolean).length;
      const progressPercent =
        totalNodes > 0 ? Math.round((completedCount / totalNodes) * 100) : 0;

      const rainbow = [
        "#667eea",
        "#4ECDC4",
        "#45B7D1",
        "#FFA07A",
        "#98D8C8",
        "#F7DC6F",
        "#BB8FCE",
        "#85C1E2",
      ];

      // 🎨 Render tree with modern styling
      const renderTree = (node, depth = 0) => {
        if (!node) return "";

        const isCompleted = completed[node._id];
        const color = rainbow[depth % rainbow.length];
        const statusIcon = isCompleted ? "✓" : "○";

        const perspectiveState = node.perspectiveStates?.[run._id];
        const encoding = perspectiveState?.encoding || "";
        const encodingSummary = encoding
          ? encoding.length > 150
            ? encoding.slice(0, 150) + "..."
            : encoding
          : "No encoding yet";

        let html = `
          <div class="tree-node" style="margin-left:${depth * 24}px;">
            <div class="tree-node-header ${
              isCompleted ? "completed" : "pending"
            }" 
                 style="border-left-color: ${color};">
              <div onclick="toggleNode('${node._id}')">
                <div class="node-status">
                  <span class="status-icon ${
                    isCompleted ? "completed" : "pending"
                  }">${statusIcon}</span>
                  <span class="expand-icon">▸</span>
                </div>
                <div class="node-info">
                  <div class="node-ids">
                    <a href="/api/${
                      node.realNodeId
                    }${qs}" class="node-link" onclick="event.stopPropagation();">
                      📄 ${node.realNodeId.slice(0, 8)}...
                    </a>
                    <span class="separator">•</span>
                    <a href="/api/root/${run.rootNodeId}/understandings/${
          node._id
        }${qs}" class="understanding-link" onclick="event.stopPropagation();">
                      🧠 ${node._id.slice(0, 8)}...
                    </a>
                  </div>
                  <div class="node-meta">
                    Depth ${node.depthFromRoot} • Layer ${node.mergeLayer}
                  </div>
                  ${
                    encoding
                      ? `<div class="encoding-preview">${encodingSummary}</div>`
                      : ""
                  }
                </div>
              </div>
              <div id="detail-${node._id}" class="node-details">
                <div class="detail-row">
                  <strong>This Run's Understanding Results:</strong> 
                  <a href="/api/root/${run.rootNodeId}/understandings/run/${
          run._id
        }/${
          node._id
        }${qs}" class="detail-link" onclick="event.stopPropagation();">
                    <code>${node._id}</code>
                  </a>
                </div>
                <div class="detail-row">
                  <strong>Real Node:</strong> 
                  <a href="/api/${
                    node.realNodeId
                  }${qs}" class="detail-link" onclick="event.stopPropagation();">
                    <code>${node.realNodeId}</code>
                  </a>
                </div>
                <div class="detail-row">
                  <strong>Status:</strong> 
                  <span class="status-badge ${
                    isCompleted ? "completed" : "pending"
                  }">
                    ${isCompleted ? "Completed" : "Pending"}
                  </span>
                </div>
                ${
                  encoding
                    ? `
                  <div class="detail-row encoding-full">
                    <strong>Full Encoding:</strong>
                    <pre>${encoding}</pre>
                  </div>
                `
                    : ""
                }
              </div>
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
  <title>Understanding Run Progress</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      color: #1a1a1a;
    }

    .container {
      max-width: 1000px;
      margin: 0 auto;
    }

    /* Back Navigation */
    .back-nav {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }

    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      color: #667eea;
      text-decoration: none;
      border-radius: 10px;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.2s;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .back-link:hover {
      background: white;
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
    }

    /* Header Section */
    .header {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 28px;
      margin-bottom: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .header h1 {
      font-size: 28px;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 16px;
      line-height: 1.3;
    }

    .run-info {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
      margin-top: 16px;
    }

    .info-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .info-label {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #888;
    }

    .info-value {
      font-size: 14px;
      font-weight: 600;
      color: #1a1a1a;
    }

    .run-id {
      background: #f0f0f0;
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 12px;
      font-family: 'SF Mono', Monaco, monospace;
      color: #666;
    }

    /* Progress Section */
    .progress-section {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 28px;
      margin-bottom: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .progress-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }

    .progress-title {
      font-size: 18px;
      font-weight: 700;
      color: #1a1a1a;
    }

    .progress-stats {
      font-size: 24px;
      font-weight: 700;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .progress-bar-container {
      height: 40px;
      background: #f0f0f0;
      border-radius: 20px;
      overflow: hidden;
      position: relative;
      box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1);
    }

    .progress-bar {
      height: 100%;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 20px;
      transition: width 0.6s ease;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding-right: 16px;
      box-shadow: 0 2px 8px rgba(102, 126, 234, 0.4);
    }

    .progress-text {
      color: white;
      font-weight: 700;
      font-size: 14px;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    }

    .progress-detail {
      margin-top: 12px;
      text-align: center;
      font-size: 14px;
      color: #666;
    }

    /* Tree Section */
    .tree-section {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 28px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .tree-section h2 {
      font-size: 20px;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 20px;
    }

    /* Tree Nodes */
    .tree-node {
      margin-bottom: 8px;
    }

    .tree-node-header {
      display: flex;
      flex-direction: column;
      padding: 16px;
      background: #f8f9fa;
      border-radius: 12px;
      border-left: 4px solid #667eea;
      transition: all 0.2s;
    }

    .tree-node-header > div:first-child {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      width: 100%;
      cursor: pointer;
    }

    .tree-node-header:hover {
      background: white;
      transform: translateX(4px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    }

    .tree-node-header.completed {
      background: #e8f5e9;
    }

    .tree-node-header.completed:hover {
      background: #c8e6c9;
    }

    .node-status {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    .status-icon {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 16px;
      flex-shrink: 0;
    }

    .status-icon.completed {
      background: #4caf50;
      color: white;
    }

    .status-icon.pending {
      background: #e0e0e0;
      color: #757575;
    }

    .expand-icon {
      color: #999;
      font-size: 14px;
      transition: transform 0.2s;
    }

    .tree-node-header.expanded .expand-icon {
      transform: rotate(90deg);
    }

    .node-info {
      flex: 1;
      min-width: 0;
    }

    .node-ids {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 6px;
    }

    .node-link, .understanding-link {
      font-size: 14px;
      font-weight: 600;
      text-decoration: none;
      padding: 4px 8px;
      border-radius: 6px;
      transition: all 0.2s;
    }

    .node-link {
      color: #667eea;
      background: rgba(102, 126, 234, 0.1);
    }

    .node-link:hover {
      background: rgba(102, 126, 234, 0.2);
      transform: translateY(-1px);
    }

    .understanding-link {
      color: #764ba2;
      background: rgba(118, 75, 162, 0.1);
    }

    .understanding-link:hover {
      background: rgba(118, 75, 162, 0.2);
      transform: translateY(-1px);
    }

    .separator {
      color: #ccc;
    }

    .node-meta {
      font-size: 12px;
      color: #888;
      margin-bottom: 6px;
    }

    .encoding-preview {
      font-size: 13px;
      color: #555;
      line-height: 1.5;
      margin-top: 8px;
      font-style: italic;
    }

    .node-details {
      display: none;
      margin-top: 16px;
      padding-top: 16px;
      border-top: 2px solid rgba(0, 0, 0, 0.06);
      width: 100%;
    }

    .node-details.visible {
      display: block;
    }

    .detail-row {
      margin-bottom: 12px;
      font-size: 14px;
    }

    .detail-row:last-child {
      margin-bottom: 0;
    }

    .detail-row strong {
      display: block;
      margin-bottom: 4px;
      color: #666;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .detail-row code {
      background: #f5f5f5;
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-family: 'SF Mono', Monaco, monospace;
      color: #666;
      word-break: break-all;
      display: inline-block;
    }

    .detail-link {
      text-decoration: none;
      display: inline-block;
      transition: transform 0.2s;
    }

    .detail-link:hover {
      transform: translateY(-1px);
    }

    .detail-link code {
      cursor: pointer;
      transition: all 0.2s;
    }

    .detail-link:hover code {
      background: #e3f2fd;
      color: #667eea;
    }

    .detail-row pre {
      background: #f5f5f5;
      padding: 12px;
      border-radius: 6px;
      font-size: 13px;
      font-family: 'SF Mono', Monaco, monospace;
      color: #333;
      line-height: 1.6;
      overflow-x: auto;
      white-space: pre-wrap;
      word-wrap: break-word;
    }

    .encoding-full {
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid #e0e0e0;
    }

    .status-badge {
      display: inline-block;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      text-transform: capitalize;
    }

    .status-badge.completed {
      background: #e8f5e9;
      color: #388e3c;
    }

    .status-badge.pending {
      background: #fff3e0;
      color: #f57c00;
    }

    /* Responsive Design */
    @media (max-width: 640px) {
      body {
        padding: 16px;
      }

      .header,
      .progress-section,
      .tree-section {
        padding: 20px;
      }

      .header h1 {
        font-size: 24px;
      }

      .run-info {
        grid-template-columns: 1fr;
      }

      .progress-bar-container {
        height: 32px;
      }

      .progress-stats {
        font-size: 20px;
      }

      .tree-node-header {
        flex-direction: column;
        gap: 8px;
      }

      .node-ids {
        flex-direction: column;
        align-items: flex-start;
      }

      .back-nav {
        flex-direction: column;
      }

      .back-link {
        justify-content: center;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="/api/root/${run.rootNodeId}${qs}" class="back-link">
        ← Back to Tree
      </a>
      <a href="/api/root/${
        run.rootNodeId
      }/understandings${qs}" class="back-link">
        Understanding Runs
      </a>
    </div>

    <!-- Header -->
    <div class="header">
      <h1>Understanding Run Progress</h1>
      <div class="run-info">
        <div class="info-item">
          <div class="info-label">Run ID</div>
          <div class="info-value">
           <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
  <span class="run-id" id="runIdCode">${run._id}</span>

  <button
    id="copyRunIdBtn"
    title="Copy Run ID"
    style="background: none; border: none; cursor: pointer; padding: 4px; opacity: 0.6; font-size: 16px;"
  >
    📋
  </button>

  <button
    id="copyForAiBtn"
    title="Copy AI command"
    style="
      padding: 6px 10px;
      border-radius: 8px;
      border: none;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      background: linear-gradient(135deg, #667eea, #764ba2);
      color: white;
    "
  >
    🤖 Copy for AI
  </button>
</div>

          </div>
        </div>
        <div class="info-item">
          <div class="info-label">Max Depth</div>
          <div class="info-value">${run.maxDepth}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Created</div>
          <div class="info-value">${createdDate}</div>
        </div>
      </div>
    </div>

    <!-- Perspective Section -->
    <div class="header" style="padding: 20px 28px;">
      <div class="info-label" style="margin-bottom: 8px;">Perspective</div>
      <div style="font-size: 16px; font-weight: 600; color: #1a1a1a; font-style: italic;">${
        run.perspective
      }</div>
    </div>

    <!-- Progress Section -->
    <div class="progress-section">
    ${
      rootIsCompleted && rootFinalEncoding
        ? `
  <div class="header" style="
    padding: 28px;
    margin-bottom: 24px;
    border-left: 6px solid #4caf50;
  ">
    <div class="info-label" style="margin-bottom: 8px;">
      Final Understanding Generated
    </div>
    <div style="
      font-size: 14px;
      line-height: 1.7;
      white-space: pre-wrap;
      word-break: break-word;
      background: #f5f5f5;
      padding: 16px;
      border-radius: 10px;
      font-family: 'SF Mono', Monaco, monospace;
      color: #333;
    ">
      ${rootFinalEncoding}
    </div>
  </div>
`
        : ""
    }

      <div class="progress-header">
        <div class="progress-title">Compression Progress</div>
        <div class="progress-stats">${progressPercent}%</div>
      </div>
      <div class="progress-bar-container">
        <div class="progress-bar" style="width: ${progressPercent}%;">
          ${
            progressPercent > 10
              ? `<span class="progress-text">${progressPercent}%</span>`
              : ""
          }
        </div>
      </div>
      <div class="progress-detail">
        ${completedCount} of ${totalNodes} nodes completed
      </div>
    </div>

    <!-- Tree Section -->
    <div class="tree-section">
      <h2>Understanding Tree</h2>
      ${tree ? renderTree(tree) : "<p>No tree available</p>"}
    </div>
  </div>

  <script>
    // Copy Run ID functionality
    const copyBtn = document.getElementById("copyRunIdBtn");
    const runIdCode = document.getElementById("runIdCode");

    if (copyBtn && runIdCode) {
      copyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(runIdCode.textContent).then(() => {
          copyBtn.textContent = "✔️";
          setTimeout(() => (copyBtn.textContent = "📋"), 900);
        });
      });

      copyBtn.addEventListener("mouseenter", () => {
        copyBtn.style.opacity = "1";
        copyBtn.style.transform = "scale(1.1)";
      });

      copyBtn.addEventListener("mouseleave", () => {
        copyBtn.style.opacity = "0.6";
        copyBtn.style.transform = "scale(1)";
      });
      
    }

    function toggleNode(id) {
      const details = document.getElementById('detail-' + id);
      const header = details.closest('.tree-node-header');
      
      if (details.classList.contains('visible')) {
        details.classList.remove('visible');
        header.classList.remove('expanded');
      } else {
        details.classList.add('visible');
        header.classList.add('expanded');
      }
    }
  </script>

  <script>
  const copyForAiBtn = document.getElementById("copyForAiBtn");

  if (copyForAiBtn) {
const aiText = \`understanding-finisher rootId ${run.rootNodeId}, run ${
        run._id
      }\`;

    copyForAiBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(aiText).then(() => {
        const original = copyForAiBtn.textContent;
        copyForAiBtn.textContent = "✔ Now paste into ChatGPT with tree tool enabled";
        setTimeout(() => {
          copyForAiBtn.textContent = original;
        }, 4000);
      });
    });
  }
</script>

</body>
</html>
      `);
    } catch (err) {
      console.error("Error fetching UnderstandingRun:", err);
      return res.status(500).json({ error: err.message });
    }
  }
);

router.get(
  "/root/:nodeId/understandings/:understandingNodeId",
  urlAuth,
  async (req, res) => {
    try {
      const { understandingNodeId, nodeId } = req.params;
      const { runId } = req.query;

      /* =========================
         Load Understanding Node
         ========================= */

      const uNode = await UnderstandingNode.findById(
        understandingNodeId
      ).lean();

      if (!uNode) {
        return res.status(404).json({ error: "UnderstandingNode not found" });
      }

      const realNode = await Node.findById(uNode.realNodeId)
        .select("name prestige")
        .lean();

      /* =========================
         Optional Run Context
         ========================= */

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

      /* =========================
         Notes (for leaf / context)
         ========================= */

      const notesResult = await getNotes({
        nodeId: realNode._id,
        version: realNode.prestige,
      });

      /* =========================
         Build Encoding History
         ========================= */

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
        }
      );

      /* =========================
         JSON Response
         ========================= */

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

      /* =========================
         HTML Rendering
         ========================= */

      const qs = buildQueryString(req);
      const hasEncodings = encodingHistory.length > 0;

      const backTreeUrl = `/api/root/${nodeId}${qs}`;
      const backUnderstandingsUrl = `/api/root/${nodeId}/understandings${qs}`;
      const realNodeUrl = `/api/${data.realNode.id}${qs}`;

      return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <title>Understandings for ${data.realNode.name}</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      color: #1a1a1a;
    }

    .container {
      max-width: 1000px;
      margin: 0 auto;
    }

    /* Back Navigation */
    .back-nav {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }

    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      color: #667eea;
      text-decoration: none;
      border-radius: 10px;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.2s;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .back-link:hover {
      background: white;
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
    }

    /* Header Section */
    .header {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 28px;
      margin-bottom: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .header h1 {
      font-size: 28px;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 8px;
      line-height: 1.3;
    }

    .header h1 a {
      color: #1a1a1a;
      text-decoration: none;
      transition: color 0.2s;
    }

    .header h1 a:hover {
      color: #667eea;
    }

    .node-ids {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 12px;
      flex-wrap: wrap;
    }

    .node-id-label {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #888;
    }

    code {
      background: #f0f0f0;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 13px;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
      color: #666;
      word-break: break-all;
    }

    .id-container {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .copy-btn {
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px;
      opacity: 0.6;
      font-size: 16px;
      transition: opacity 0.2s, transform 0.2s;
    }

    .copy-btn:hover {
      opacity: 1;
      transform: scale(1.1);
    }

    a code {
      cursor: pointer;
      transition: all 0.2s;
      text-decoration: none;
    }

    a:hover code {
      background: #e3f2fd;
      color: #667eea;
    }

    /* Run Context Card */
    .context-card {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 20px 28px;
      margin-bottom: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .context-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 16px;
      margin-top: 12px;
    }

    .context-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .context-label {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #888;
    }

    .context-value {
      font-size: 15px;
      font-weight: 600;
      color: #1a1a1a;
    }

    /* Content Section */
    .content-section {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 28px;
      margin-bottom: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .content-section h2 {
      font-size: 20px;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .section-icon {
      font-size: 24px;
    }

    /* Encoding Cards */
    .encoding-list {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .encoding-card {
      border-left: 4px solid #667eea;
      padding: 20px;
      background: #f8f9fa;
      border-radius: 12px;
      transition: all 0.2s;
    }

    .encoding-card:hover {
      transform: translateX(4px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    }

    .encoding-card.current {
      border-left-color: #4caf50;
      background: linear-gradient(135deg, #e8f5e9 0%, #f1f8f4 100%);
    }

    .encoding-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 12px;
      gap: 12px;
      flex-wrap: wrap;
    }

    .encoding-meta {
      flex: 1;
      min-width: 200px;
    }

    .encoding-run {
      font-size: 13px;
      color: #666;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .encoding-run strong {
      color: #667eea;
    }

    .encoding-run a {
      text-decoration: none;
      color: inherit;
    }

    .encoding-run code {
      font-size: 12px;
      cursor: pointer;
    }

    .encoding-run a:hover code {
      background: #e3f2fd;
      color: #667eea;
    }

    .encoding-details {
      font-size: 12px;
      color: #888;
      margin-bottom: 8px;
    }

    .status-badge {
      display: inline-block;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      text-transform: capitalize;
    }

    .status-badge.completed {
      background: #e8f5e9;
      color: #388e3c;
    }

    .status-badge.pending {
      background: #fff3e0;
      color: #f57c00;
    }

    .encoding-content {
      background: white;
      padding: 16px;
      border-radius: 8px;
      font-size: 14px;
      line-height: 1.7;
      color: #333;
      white-space: pre-wrap;
      word-wrap: break-word;
      margin-bottom: 12px;
    }

    .encoding-footer {
      font-size: 12px;
      color: #999;
    }

    .current-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      background: #4caf50;
      color: white;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
    }

    /* Notes Section */
    .notes-list {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .note-card {
      padding: 16px 20px;
      border-radius: 12px;
      border-left: 4px solid #f57c00;
      background: #fff8f0;
      transition: all 0.2s;
    }

    .note-card:hover {
      transform: translateX(4px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    }

    .note-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      font-size: 13px;
      font-weight: 600;
      color: #666;
    }

    .note-avatar {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: #f57c00;
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
    }

    .note-content {
      font-size: 14px;
      line-height: 1.6;
      color: #333;
      white-space: pre-wrap;
      word-wrap: break-word;
    }

    .empty-state {
      text-align: center;
      padding: 40px;
      color: #999;
      font-style: italic;
    }

    /* Responsive Design */
    @media (max-width: 640px) {
      body {
        padding: 16px;
      }

      .header,
      .context-card,
      .content-section {
        padding: 20px;
      }

      .header h1 {
        font-size: 24px;
      }

      .context-grid {
        grid-template-columns: 1fr;
      }

      .encoding-header {
        flex-direction: column;
      }

      .back-nav {
        flex-direction: column;
      }

      .back-link {
        justify-content: center;
      }

      code {
        font-size: 11px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="${backTreeUrl}" class="back-link">
        ← Back to Tree
      </a>
      <a href="${backUnderstandingsUrl}" class="back-link">
        Understanding Runs
      </a>
    </div>

    <!-- Header -->
    <div class="header">
      <h1>
        <a href="${realNodeUrl}">Understandings for ${data.realNode.name}</a>
      </h1>
      <div class="node-ids">
        <span class="node-id-label">Understanding Node:</span>
        <div class="id-container">
          <code id="understandingNodeId">${data.understandingNodeId}</code>
          <button class="copy-btn" onclick="copyId('understandingNodeId', this)" title="Copy ID">📋</button>
        </div>
      </div>
      <div class="node-ids">
        <span class="node-id-label">Real Node:</span>
        <div class="id-container">
          <a href="${realNodeUrl}">
            <code id="realNodeId">${data.realNode.id}</code>
          </a>
          <button class="copy-btn" onclick="copyId('realNodeId', this)" title="Copy ID">📋</button>
        </div>
      </div>
    </div>

    ${
      data.runContext
        ? `
    <!-- Run Context -->
    <div class="context-card">
      <div style="font-size: 14px; font-weight: 600; color: #667eea; margin-bottom: 8px;">
        Current Run Context
      </div>
      <div class="context-grid">
        <div class="context-item">
          <div class="context-label">Run ID</div>
          <div class="context-value">
            <code style="font-size: 12px;">${data.runContext.runId}</code>
          </div>
        </div>
        <div class="context-item">
          <div class="context-label">Depth</div>
          <div class="context-value">${
            data.runContext.structure?.depthFromRoot ?? "-"
          }</div>
        </div>
        <div class="context-item">
          <div class="context-label">Merge Layer</div>
          <div class="context-value">${
            data.runContext.structure?.mergeLayer ?? "-"
          }</div>
        </div>
        <div class="context-item">
          <div class="context-label">Children</div>
          <div class="context-value">${
            data.runContext.structure?.childrenCount ?? 0
          }</div>
        </div>
      </div>
    </div>
    `
        : ""
    }

    <!-- Encoding History -->
    <div class="content-section">
      <h2>
        <span class="section-icon">📚</span>
        Compression History
      </h2>

      ${
        hasEncodings
          ? `
        <div class="encoding-list">
          ${encodingHistory
            .map((e) => {
              const runUrl = `/api/root/${nodeId}/understandings/run/${e.runId}${qs}`;
              const runIdUnique = e.runId.replace(/-/g, "");
              return `
            <div class="encoding-card ${e.isCurrentRun ? "current" : ""}">
              <div class="encoding-header">
                <div class="encoding-meta">
                  <div class="encoding-run">
                    <strong>Run:</strong>
                    <a href="${runUrl}">
                      <code id="runId_${runIdUnique}">${e.runId}</code>
                    </a>
                    <button class="copy-btn" onclick="copyId('runId_${runIdUnique}', this)" title="Copy Run ID">📋</button>
                    ${
                      e.isCurrentRun
                        ? '<span class="current-badge">⭐ Current</span>'
                        : ""
                    }
                  </div>
                  <div class="encoding-details">
                    ${e.perspective} • Layer ${e.currentLayer}
                  </div>
                </div>
                ${
                  e.encoding
                    ? `
                  <span class="status-badge completed">
                    ✓ Completed
                  </span>
                `
                    : `
                  <span class="status-badge pending">
                    ○ In Progress
                  </span>
                `
                }
              </div>

              ${
                e.encoding
                  ? `
                <div class="encoding-content">${e.encoding}</div>
              `
                  : `
                <div class="encoding-content" style="background: #fff3e0; color: #f57c00; font-style: italic;">
                  Compression in progress...
                </div>
              `
              }

              <div class="encoding-footer">
                Updated: ${new Date(e.updatedAt).toLocaleString()}
              </div>
            </div>
          `;
            })
            .join("")}
        </div>
      `
          : `
        <div class="empty-state">
          No compression history yet
        </div>
      `
      }
    </div>

    ${
      !hasEncodings && data.notesToBeCompressed.length > 0
        ? `
    <!-- Notes to be Compressed -->
    <div class="content-section">
      <h2>
        <span class="section-icon">📝</span>
        Notes to be Compressed
      </h2>

      <div class="notes-list">
        ${data.notesToBeCompressed
          .map(
            (n) => `
          <div class="note-card">
            <div class="note-header">
              <div class="note-avatar">👤</div>
              <span>@${n.username}</span>
            </div>
            <div class="note-content">${n.content}</div>
          </div>
        `
          )
          .join("")}
      </div>
    </div>
    `
        : ""
    }
  </div>
</body>
</html>`);
    } catch (err) {
      console.error("Error fetching UnderstandingNode:", err);
      return res.status(500).json({ error: err.message });
    }
  }
);

router.get("/root/:nodeId/understandings", urlAuth, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const queryString = buildQueryString(req);

    // Validate root
    const root = await Node.findById(nodeId).select("_id name userId").lean();

    if (!root) {
      return res.status(404).json({ error: "Root not found" });
    }

    // Fetch runs for THIS root
    const runs = await UnderstandingRun.find({
      rootNodeId: nodeId,
    })
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

    /* =========================
         HTML
         ========================= */

    const rows = data.understandings
      .map(
        (r) => `
<tr>
  <td>
    <a href="/api/root/${nodeId}/understandings/run/${r._id}${queryString}">
      ${r.perspective}
    </a>
  </td>

  <td>${r.maxDepth ?? "-"}</td>
  <td>${new Date(r.createdAt).toLocaleString()}</td>
</tr>
`
      )
      .join("");

    return res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Understandings — ${data.rootName}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body {
      font-family: system-ui, -apple-system;
      background: linear-gradient(135deg,#667eea,#764ba2);
      padding: 24px;
    }
    .card {
      background: white;
      max-width: 900px;
      margin: auto;
      border-radius: 14px;
      padding: 24px;
      box-shadow: 0 10px 30px rgba(0,0,0,.15);
    }
    h1 {
      margin-bottom: 8px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 16px;
    }
    th, td {
      padding: 10px;
      border-bottom: 1px solid #e0e0e0;
      text-align: left;
    }
    th {
      font-size: 12px;
      text-transform: uppercase;
      color: #666;
    }
    a {
      color: #667eea;
      font-weight: 600;
      text-decoration: none;
    }
    .actions {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
    }
    form {
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid #eee;
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
    }
    input {
      padding: 10px 12px;
      font-size: 14px;
      border-radius: 8px;
      border: 1px solid #ccc;
    }
    button {
      padding: 10px 16px;
      border-radius: 8px;
      border: none;
      background: #667eea;
      color: white;
      font-weight: 600;
      cursor: pointer;
    }
       .header-subtitle {
    font-size: 14px;
    color: #888;
    margin-bottom: 16px;
  }
  </style>
</head>
<body>
  <div class="card">
    <div class="actions">
      <a href="/api/root/${nodeId}${queryString}">← Back to Tree</a>
    </div>

    <h1>Understanding Runs For Tree</h1>
      <div class="header-subtitle">
  Use the <strong>understanding-finisher</strong> tool in ChatGPT.
  For example, copy the <strong>understanding-run-id</strong> and invoke
  <em>understanding-finisher(run-id, root-id)</em>. Keep pushing it forward until it is finished.
  The selected perspective determines how your data is understood. New perspectives are revealing.
</div>

<br />
    <div style="color:#666;">Root: <strong>${data.rootName}</strong></div>


    ${
      data.understandings.length
        ? `
    <table>
      <thead>
        <tr>
          <th>Perspective</th>
          <th>Max Depth</th>
          <th>Created</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    `
        : `<p style="margin-top:16px;"><em>No understandings yet.</em></p>`
    }

    <form method="POST" action="/api/root/${nodeId}/understandings${queryString}">
      <input
        type="text"
        name="perspective"
        placeholder="Perspective"
      />
      <button type="submit">Create Understanding</button>
    </form>
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

      /* =========================
         Load Understanding Node
         ========================= */

      const uNode = await UnderstandingNode.findById(
        understandingNodeId
      ).lean();

      if (!uNode) {
        return res.status(404).json({ error: "UnderstandingNode not found" });
      }

      const realNode = await Node.findById(uNode.realNodeId)
        .select("name prestige")
        .lean();

      /* =========================
         Load Run
         ========================= */

      const run = await UnderstandingRun.findById(runId).lean();
      if (!run) {
        return res.status(404).json({ error: "UnderstandingRun not found" });
      }

      /* =========================
         Notes → Chats
         ========================= */

      const notesResult = await getNotes({
        nodeId: realNode._id,
        version: realNode.prestige,
      });

      const chats = (notesResult?.notes ?? []).map((n) => ({
        role: n.username === "assistant" ? "assistant" : "user",
        content: n.content,
        username: n.username,
        createdAt: n.createdAt,
      }));

      /* =========================
         Final Message (per run)
         ========================= */

      const state = uNode.perspectiveStates?.[runId] ?? null;
      const finalMessage = state?.encoding ?? null;

      // ✅ NEW: completion = presence of final message
      const isCompleted = Boolean(finalMessage);

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
        chats,
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

      const backTreeUrl = `/api/root/${nodeId}${qs}`;
      const backRunUrl = `/api/root/${nodeId}/understandings/run/${runId}${qs}`;

      return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <title>${data.realNode.name} – Compression</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      color: #1a1a1a;
    }

    .container {
      max-width: 1000px;
      margin: 0 auto;
    }

    /* Back Navigation */
    .back-nav {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }

    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      color: #667eea;
      text-decoration: none;
      border-radius: 10px;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.2s;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .back-link:hover {
      background: white;
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
    }

    /* Header Section */
    .header {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 28px;
      margin-bottom: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
      position: relative;
      overflow: hidden;
    }

    ${
      !isCompleted
        ? `
    .header::before {
      content: '';
      position: absolute;
      top: 0;
      left: -100%;
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, transparent, rgba(102, 126, 234, 0.1), transparent);
      animation: shimmer 2s infinite;
    }

    @keyframes shimmer {
      0% { left: -100%; }
      100% { left: 100%; }
    }
    `
        : ""
    }

    .header h1 {
      font-size: 28px;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 12px;
      line-height: 1.3;
    }

    .header-meta {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 600;
      animation: ${!isCompleted ? "pulse 2s ease-in-out infinite" : "none"};
    }

    .status-badge.processing {
      background: linear-gradient(135deg, #FFA07A 0%, #FF6B6B 100%);
      color: white;
      box-shadow: 0 4px 15px rgba(255, 107, 107, 0.3);
    }

    .status-badge.completed {
      background: linear-gradient(135deg, #4caf50 0%, #2e7d32 100%);
      color: white;
      box-shadow: 0 4px 15px rgba(76, 175, 80, 0.3);
    }

    @keyframes pulse {
      0%, 100% { 
        transform: scale(1);
        box-shadow: 0 4px 15px rgba(255, 107, 107, 0.3);
      }
      50% { 
        transform: scale(1.05);
        box-shadow: 0 6px 20px rgba(255, 107, 107, 0.5);
      }
    }

    .spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .perspective-tag {
      font-size: 13px;
      color: #666;
      padding: 6px 12px;
      background: #f0f0f0;
      border-radius: 6px;
      font-style: italic;
    }

    /* Content Sections */
    .content-section {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 28px;
      margin-bottom: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
      animation: fadeIn 0.5s ease-out;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .content-section h2 {
      font-size: 20px;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .section-icon {
      font-size: 24px;
    }

    /* Compressed Output */
    .compressed-output {
      background: linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%);
      border-left: 4px solid #4caf50;
      padding: 20px;
      border-radius: 12px;
      font-size: 15px;
      line-height: 1.8;
      color: #1a1a1a;
      white-space: pre-wrap;
      word-wrap: break-word;
      box-shadow: 0 4px 12px rgba(76, 175, 80, 0.15);
      animation: slideIn 0.6s ease-out;
    }

    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateX(-20px);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }

    /* Chat Messages */
    .chat-list {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .chat-message {
      padding: 16px 20px;
      border-radius: 12px;
      border-left: 4px solid;
      animation: fadeIn 0.4s ease-out;
      transition: all 0.2s;
    }

    .chat-message:hover {
      transform: translateX(4px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    }

    .chat-message.user {
      background: #fff8f0;
      border-left-color: #f57c00;
    }

    .chat-message.assistant {
      background: #f1f8f4;
      border-left-color: #2e7d32;
    }

    .chat-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      font-size: 13px;
      font-weight: 600;
      color: #666;
    }

    .chat-avatar {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
    }

    .chat-message.user .chat-avatar {
      background: #f57c00;
      color: white;
    }

    .chat-message.assistant .chat-avatar {
      background: #2e7d32;
      color: white;
    }

    .chat-content {
      font-size: 14px;
      line-height: 1.6;
      color: #333;
      white-space: pre-wrap;
      word-wrap: break-word;
    }

    .empty-state {
      text-align: center;
      padding: 40px;
      color: #999;
      font-style: italic;
    }

    /* Processing Indicator */
    .processing-indicator {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 20px;
      background: linear-gradient(135deg, rgba(255, 160, 122, 0.1) 0%, rgba(255, 107, 107, 0.1) 100%);
      border-radius: 12px;
      margin-bottom: 24px;
      animation: pulse 2s ease-in-out infinite;
    }

    .processing-dots {
      display: flex;
      gap: 6px;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #667eea;
      animation: bounce 1.4s ease-in-out infinite;
    }

    .dot:nth-child(1) { animation-delay: 0s; }
    .dot:nth-child(2) { animation-delay: 0.2s; }
    .dot:nth-child(3) { animation-delay: 0.4s; }

    @keyframes bounce {
      0%, 80%, 100% { 
        transform: scale(0);
        opacity: 0.5;
      }
      40% { 
        transform: scale(1);
        opacity: 1;
      }
    }

    /* Auto-refresh notification */
    .auto-refresh {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      padding: 12px 20px;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      font-size: 13px;
      font-weight: 600;
      color: #667eea;
      display: flex;
      align-items: center;
      gap: 8px;
      animation: slideUp 0.5s ease-out;
    }

    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    /* Responsive Design */
    @media (max-width: 640px) {
      body {
        padding: 16px;
      }

      .header,
      .content-section {
        padding: 20px;
      }

      .header h1 {
        font-size: 24px;
      }

      .back-nav {
        flex-direction: column;
      }

      .back-link {
        justify-content: center;
      }

      .auto-refresh {
        bottom: 16px;
        right: 16px;
        left: 16px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="${backTreeUrl}" class="back-link">
        ← Back to Tree
      </a>
      <a href="${backRunUrl}" class="back-link">
        Back to Run Progress
      </a>
    </div>

    <!-- Header -->
    <div class="header">
      <h1>${data.realNode.name}</h1>
      <div class="header-meta">
        <span class="status-badge ${isCompleted ? "completed" : "processing"}">
          ${
            isCompleted
              ? "✓ Compressed"
              : '<span class="spinner"></span> Processing'
          }
        </span>
        <span class="perspective-tag">${data.perspective}</span>
      </div>
    </div>

    ${
      !isCompleted
        ? `
    <!-- Processing Indicator -->
    <div class="processing-indicator">
      <div class="processing-dots">
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
      </div>
      <span style="font-weight: 600; color: #667eea;">
        Compressing notes into understanding...
      </span>
    </div>
    `
        : ""
    }

    ${
      isCompleted
        ? `
    <!-- Compressed Output (Phase 2) -->
    <div class="content-section">
      <h2>
        <span class="section-icon">✨</span>
        Compressed Understanding
      </h2>
      <div class="compressed-output">${finalMessage}</div>
    </div>
    `
        : ""
    }

    <!-- Original Notes (always visible) -->
    <div class="content-section">
      <h2>
        <span class="section-icon">${isCompleted ? "📝" : "🔄"}</span>
        ${isCompleted ? "Original Notes" : "Notes Being Compressed"}
      </h2>

      ${
        chats.length
          ? `
        <div class="chat-list">
          ${chats
            .map(
              (c) => `
            <div class="chat-message ${c.role}">
              <div class="chat-header">
                <div class="chat-avatar">${
                  c.role === "assistant" ? "🤖" : "👤"
                }</div>
                <span>@${c.username}</span>
              </div>
              <div class="chat-content">${c.content}</div>
            </div>
          `
            )
            .join("")}
        </div>
      `
          : `
        <div class="empty-state">No notes available</div>
      `
      }
    </div>

    ${
      !isCompleted
        ? `
    <!-- Auto-refresh notification -->
    <div class="auto-refresh">
      <div class="spinner"></div>
      Checking for updates...
    </div>
    `
        : ""
    }
  </div>

  ${
    !isCompleted
      ? `
  <script>
    // Auto-refresh every 3 seconds when processing
    let refreshCount = 0;
    const maxRefreshes = 100; // Safety limit

    function checkForUpdates() {
      if (refreshCount >= maxRefreshes) {
        console.log('Max refresh limit reached');
        return;
      }
      
      refreshCount++;
      
      // Add a small random delay to make it feel more organic
      const delay = 3000 + Math.random() * 1000;
      
      setTimeout(() => {
        window.location.reload();
      }, delay);
    }

    // Start checking
    checkForUpdates();
  </script>
  `
      : ""
  }
</body>
</html>`);
    } catch (err) {
      console.error("Error fetching run node view:", err);
      return res.status(500).json({ error: err.message });
    }
  }
);

export default router;
