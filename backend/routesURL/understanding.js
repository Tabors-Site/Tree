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
      const queryString = buildQueryString(req);

      const run = await UnderstandingRun.findById(runId).lean();
      if (!run) {
        return res.status(404).json({ error: "UnderstandingRun not found" });
      }

      const nodes = await UnderstandingNode.find({
        _id: { $in: Object.values(run.nodeMap ?? {}) },
      })
        .select(
          "_id realNodeId parent children mergeLayer depthFromRoot perspectiveStates"
        )
        .lean();

      const completed = {};
      for (const n of nodes) {
        const state = n.perspectiveStates?.[run._id];
        completed[n._id] = !!state && state.currentLayer === n.mergeLayer;
      }

      const data = {
        understandingRunId: run._id,
        rootNodeId: run.rootNodeId,
        perspective: run.perspective,
        maxDepth: run.maxDepth,
        createdAt: run.createdAt,
        nodeMap: run.nodeMap ?? {},
        nodes,
        completed,
      };

      // Check if HTML output is requested
      const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
      if (!wantHtml) {
        return res.json(data);
      }

      // Build tree structure
      const nodeById = new Map(nodes.map((n) => [n._id, { ...n }]));
      const rootNode = nodes.find((n) => n.parent === null);

      const buildTree = (nodeId) => {
        const node = nodeById.get(nodeId);
        if (!node) return null;

        return {
          ...node,
          childNodes: (node.children || []).map(buildTree).filter(Boolean),
        };
      };

      const tree = rootNode ? buildTree(rootNode._id) : null;

      // Calculate stats
      const totalNodes = nodes.length;
      const completedCount = Object.values(completed).filter(Boolean).length;
      const progressPercent =
        totalNodes > 0 ? Math.round((completedCount / totalNodes) * 100) : 0;

      const rainbow = [
        "#FF6B6B",
        "#4ECDC4",
        "#45B7D1",
        "#FFA07A",
        "#98D8C8",
        "#F7DC6F",
        "#BB8FCE",
        "#85C1E2",
      ];

      // Render tree recursively
      const renderTree = (node, depth = 0) => {
        if (!node) return "";

        const isCompleted = completed[node._id];
        const color = rainbow[depth % rainbow.length];
        const statusIcon = isCompleted ? "✓" : "○";
        const statusColor = isCompleted ? "#2e7d32" : "#757575";

        const perspectiveState = node.perspectiveStates?.[run._id];
        const encoding = perspectiveState?.encoding || "No encoding available";

        let html = `
          <div style="margin-left: ${
            depth * 20
          }px; border-left: 2px solid ${color}; padding-left: 10px; margin-top: 8px;">
            <div style="display: flex; align-items: center; gap: 8px; cursor: pointer;" onclick="toggleNode('${
              node._id
            }')">
              <span style="color: ${statusColor}; font-weight: bold; font-size: 18px;">${statusIcon}</span>
              <span style="color: #1976d2; font-size: 14px;">▸ ${node._id.slice(
                0,
                8
              )}...</span>
              <span style="color: #666; font-size: 12px;">Depth ${
                node.depthFromRoot
              } • Layer ${node.mergeLayer}</span>
            </div>
            <div id="detail-${
              node._id
            }" style="display: none; margin-top: 8px; padding: 12px; background: #f5f5f5; border-radius: 4px; font-size: 13px; line-height: 1.6;">
              <div style="margin-bottom: 8px;"><strong>Understanding Node ID:</strong> <span style="font-family: monospace; font-size: 12px;"> <a href="/api/root/${
                data.rootNodeId
              }/understandings/${node._id}${queryString}">${
          node._id
        }</span></div></a>
              <div style="margin-bottom: 8px;"><strong>Real Node ID:</strong> <span style="font-family: monospace; font-size: 12px;"><a href="/api/${
                node.realNodeId
              }${queryString}">${node.realNodeId}</span></div></a>
              <div style="margin-bottom: 12px;"><strong>Status:</strong> <span style="color: ${statusColor}; font-weight: bold;">${
          isCompleted ? "Completed" : "Pending"
        }</span></div>
              <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #ddd;">
                <strong style="display: block; margin-bottom: 6px;">Encoding:</strong>
                <div style="color: #444; white-space: pre-wrap; word-wrap: break-word;">${encoding}</div>
              </div>
            </div>
          </div>
        `;

        if (node.childNodes && node.childNodes.length > 0) {
          for (const child of node.childNodes) {
            html += renderTree(child, depth + 1);
          }
        }

        return html;
      };

      const currentUserId = req.userId ? req.userId.toString() : null;

      // Send HTML
      return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Understanding Run</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    html, body {
      width: 100%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
    }

    body {
      padding-bottom: 40px;
    }

    .top-nav {
      background: white;
      border-bottom: 1px solid #e0e0e0;
      padding: 12px 20px;
      display: flex;
      gap: 15px;
      align-items: center;
      flex-wrap: wrap;
    }

    .top-nav a {
      color: #1976d2;
      text-decoration: none;
      font-size: 14px;
    }

    .top-nav a:hover {
      text-decoration: underline;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
      padding: 20px;
    }

    .card {
      background: white;
      padding: 24px;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      margin-bottom: 20px;
    }

    .card h1 {
      margin: 0 0 16px 0;
      color: #1976d2;
      font-size: 24px;
    }

    .card h2 {
      margin: 0 0 16px 0;
      font-size: 18px;
      color: #333;
    }

    .info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
      margin-top: 16px;
    }

    .info-item-label {
      font-size: 12px;
      color: #757575;
      margin-bottom: 4px;
    }

    .info-item-value {
      font-size: 14px;
    }

    .info-item-value.mono {
      font-family: monospace;
    }

    .perspective-section {
      margin-top: 20px;
      padding: 16px;
      background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
      border-radius: 8px;
      border-left: 4px solid #667eea;
    }

    .perspective-label {
      font-size: 14px;
      font-weight: 700;
      color: #667eea;
      margin-bottom: 8px;
    }

    .perspective-value {
      font-size: 15px;
      color: #444;
      line-height: 1.6;
    }

    .progress-bar-container {
      flex: 1;
      background: #e0e0e0;
      height: 24px;
      border-radius: 12px;
      overflow: hidden;
    }

    .progress-bar-fill {
      background: linear-gradient(90deg, #2e7d32, #4caf50);
      height: 100%;
      transition: width 0.3s;
    }

    .progress-percent {
      font-size: 20px;
      font-weight: bold;
      color: #2e7d32;
      min-width: 60px;
      text-align: right;
    }

    .stats-row {
      display: flex;
      gap: 30px;
      font-size: 14px;
      color: #666;
      margin-top: 12px;
    }

    .toggle-button {
      background: #1976d2;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      margin-bottom: 16px;
    }

    .toggle-button:hover {
      background: #1565c0;
    }

    .json-data {
      background: #f5f5f5;
      padding: 16px;
      border-radius: 4px;
      overflow-x: auto;
      font-size: 12px;
      margin: 0;
      font-family: monospace;
    }

    @media (max-width: 640px) {
      .container {
        padding: 10px;
      }
      
      .card {
        padding: 16px;
      }

      .info-grid {
        grid-template-columns: 1fr;
      }
    }
      .header-section {
  margin-bottom: 24px;
  padding-bottom: 20px;
  border-bottom: 2px solid #e0e0e0;
}
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

.owner-info {
  font-size: 14px;
  color: #667eea;
  font-weight: 600;
  margin-bottom: 8px;
}

h1 {
  font-size: 28px;
  margin: 12px 0;
  font-weight: 700;
  line-height: 1.3;
}

  </style>
</head>
<body>
  ${
    currentUserId
      ? `
  
  `
      : ""
  }

  <div class="container">
  <div class="back-nav">

  <a href="/api/root/${nodeId}${queryString}" class="back-link">
 ← Back to Tree  </a>

  <a href="/api/root/${nodeId}/understandings${queryString}" class="back-link">
Understandings  </a>


</div>

    <!-- Header Card -->
    <div class="card">
      <h1>Understanding Run</h1>
      <div class="info-grid">
        <div>
          <div class="info-item-label">Run ID</div>
          <div class="info-item-value mono">${data.understandingRunId}</div>
        </div>
        <div>
          <div class="info-item-label">Root Node ID</div>
          <div class="info-item-value mono">
            <a href="/api/root/${
              data.rootNodeId
            }${queryString}" style="color: #1976d2; text-decoration: none;">${data.rootNodeId.slice(
        0,
        8
      )}...</a>
          </div>
        </div>
        <div>
          <div class="info-item-label">Max Depth</div>
          <div class="info-item-value">${data.maxDepth}</div>
        </div>
        <div>
          <div class="info-item-label">Created</div>
          <div class="info-item-value">${new Date(
            data.createdAt
          ).toLocaleString()}</div>
        </div>
      </div>

      <div class="perspective-section">
        <div class="perspective-label">Perspective</div>
        <div class="perspective-value">${data.perspective}</div>
      </div>
    </div>

    <!-- Progress Card -->
    <div class="card">
      <h2>Progress Overview</h2>
      <div style="display: flex; gap: 20px; align-items: center; margin-bottom: 12px;">
        <div class="progress-bar-container">
          <div class="progress-bar-fill" style="width: ${progressPercent}%;"></div>
        </div>
        <div class="progress-percent">${progressPercent}%</div>
      </div>
      <div class="stats-row">
        <div>
          <span style="color: #2e7d32; font-weight: bold;">✓</span> 
          ${completedCount} completed
        </div>
        <div>
          <span style="color: #757575; font-weight: bold;">○</span> 
          ${totalNodes - completedCount} pending
        </div>
        <div>
          <strong>Total:</strong> ${totalNodes} nodes
        </div>
      </div>
    </div>

    <!-- Node Tree Card -->
    <div class="card">
      <h2>Node Hierarchy</h2>
      <div style="font-size: 12px; color: #666; margin-bottom: 12px;">
        Click on any node to view details and encoding
      </div>
      ${
        tree
          ? renderTree(tree)
          : '<div style="color: #757575;">No tree structure available</div>'
      }
    </div>

   
  </div>

  <script>
    function toggleNode(nodeId) {
      const detail = document.getElementById('detail-' + nodeId);
      const arrow = event.currentTarget.querySelector('span:nth-child(2)');
      
      if (detail.style.display === 'none') {
        detail.style.display = 'block';
        arrow.textContent = arrow.textContent.replace('▸', '▾');
      } else {
        detail.style.display = 'none';
        arrow.textContent = arrow.textContent.replace('▾', '▸');
      }
    }

   
  </script>
</body>
</html>`);
    } catch (err) {
      console.error("Error fetching UnderstandingRun:", err);
      res.status(500).json({ error: err.message });
    }
  }
);
router.get(
  "/root/:nodeId/understandings/:understandingNodeId",
  urlAuth,
  async (req, res) => {
    try {
      const { understandingNodeId, nodeId } = req.params;

      const uNode = await UnderstandingNode.findById(
        understandingNodeId
      ).lean();

      if (!uNode) {
        return res.status(404).json({ error: "UnderstandingNode not found" });
      }

      const realNode = await Node.findById(uNode.realNodeId)
        .select("name prestige")
        .lean();
      const notesResult = await getNotes({
        nodeId: realNode._id,
        version: realNode.prestige,
      });
      const { runId } = req.query; // optional filter

      const state = runId ? uNode.perspectiveStates?.[runId] : null;

      const data = {
        understandingNodeId: uNode._id,
        realNode: {
          id: uNode.realNodeId,
          name: realNode?.name ?? "Unknown",
        },
        structure: {
          parent: uNode.parent,
          children: uNode.children,
          depthFromRoot: uNode.depthFromRoot,
          mergeLayer: uNode.mergeLayer,
        },
        perspectiveState: state,
        allPerspectiveStates: uNode.perspectiveStates,
        createdAt: uNode.createdAt,
        notesToBeCompressed: (notesResult?.notes ?? []).map((n) => ({
          content: n.content,
          username: n.username,
          createdAt: n.createdAt,
        })),
      };

      // Check if HTML output is requested
      const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
      if (!wantHtml) {
        return res.json(data);
      }

      // Determine if we have any encodings
      const allStates = Object.values(data.allPerspectiveStates || {});
      const hasEncodings = allStates.length > 0;
      const notes = data.notesToBeCompressed || [];

      const currentUserId = req.userId ? req.userId.toString() : null;
      const queryString = buildQueryString(req);

      // Send HTML
      return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${data.realNode.name} - Understanding Node</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

      html, body {
      width: 100%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
    }

    body {
      padding-bottom: 40px;
    }

    .top-nav {
      background: white;
      border-bottom: 1px solid #e0e0e0;
      padding: 12px 20px;
      display: flex;
      gap: 15px;
      align-items: center;
      flex-wrap: wrap;
    }

    .top-nav a {
      color: #1976d2;
      text-decoration: none;
      font-size: 14px;
    }

    .top-nav a:hover {
      text-decoration: underline;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
      padding: 20px;
    }

    .card {
      background: white;
      padding: 24px;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      margin-bottom: 20px;
    }

    .card h1 {
      margin: 0 0 16px 0;
      color: #1976d2;
      font-size: 24px;
    }

    .card h2 {
      margin: 0 0 16px 0;
      font-size: 18px;
      color: #333;
    }

    .card h3 {
      margin: 0 0 12px 0;
      font-size: 16px;
      color: #444;
    }

    .info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
      margin-top: 16px;
    }

    .info-item-label {
      font-size: 12px;
      color: #757575;
      margin-bottom: 4px;
    }

    .info-item-value {
      font-size: 14px;
    }

    .info-item-value.mono {
      font-family: monospace;
    }

    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
    }

    .status-badge.encoded {
      background: #e8f5e9;
      color: #2e7d32;
    }

    .status-badge.pending {
      background: #fff3e0;
      color: #f57c00;
    }

    .encoding-section {
      margin-top: 20px;
      padding: 16px;
      background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
      border-radius: 8px;
      border-left: 4px solid #667eea;
    }

    .encoding-label {
      font-size: 14px;
      font-weight: 700;
      color: #667eea;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .encoding-value {
      font-size: 15px;
      color: #444;
      line-height: 1.6;
      white-space: pre-wrap;
      word-wrap: break-word;
    }

    .note-item {
      padding: 16px;
      background: #f9f9f9;
      border-radius: 8px;
      border-left: 3px solid #1976d2;
      margin-bottom: 12px;
    }

    .note-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      font-size: 12px;
      color: #757575;
    }

    .note-author {
      font-weight: 600;
      color: #1976d2;
    }

    .note-content {
      font-size: 14px;
      color: #333;
      line-height: 1.6;
      white-space: pre-wrap;
      word-wrap: break-word;
    }

    .section-divider {
      margin: 24px 0;
      border: 0;
      border-top: 2px solid #e0e0e0;
    }

    .toggle-button {
      background: #1976d2;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      margin-bottom: 16px;
    }

    .toggle-button:hover {
      background: #1565c0;
    }

    .json-data {
      background: #f5f5f5;
      padding: 16px;
      border-radius: 4px;
      overflow-x: auto;
      font-size: 12px;
      margin: 0;
      font-family: monospace;
    }

    @media (max-width: 640px) {
      .container {
        padding: 10px;
      }
      
      .card {
        padding: 16px;
      }

      .info-grid {
        grid-template-columns: 1fr;
      }

      .note-meta {
        flex-direction: column;
        align-items: flex-start;
        gap: 4px;
      }
    }
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

.owner-info {
  font-size: 14px;
  color: #667eea;
  font-weight: 600;
  margin-bottom: 8px;
}

h1 {
  font-size: 28px;
  margin: 12px 0;
  font-weight: 700;
  line-height: 1.3;
}
  </style>
</head>
<body>
  ${
    currentUserId
      ? `
    <div class="back-nav">

  <a href="/api/root/${nodeId}${queryString}" class="back-link">
 ← Back to Tree  </a>

  <a href="/api/root/${nodeId}/understandings${queryString}" class="back-link">
Understandings  </a>



</div>
  `
      : ""
  }

  <div class="container">
    <!-- Header Card -->
    <div class="card">
      <h1>${data.realNode.name}</h1>
      <div style="margin-bottom: 16px;">
        <span class="status-badge ${hasEncodings ? "encoded" : "pending"}">
          ${hasEncodings ? "✓ Encoded" : "○ Pending Compression"}
        </span>
      </div>
      
      <div class="info-grid">
        <div>
          <div class="info-item-label">Understanding Node ID</div>
          <div class="info-item-value mono">${data.understandingNodeId}</div>
        </div>
        <div>
          <div class="info-item-label">Real Node ID</div>
          <div class="info-item-value mono">
            <a href="/api/root/${
              data.realNode.id
            }${queryString}" style="color: #1976d2; text-decoration: none;">${data.realNode.id.slice(
        0,
        8
      )}...</a>
          </div>
        </div>
        <div>
          <div class="info-item-label">Depth from Root</div>
          <div class="info-item-value">${data.structure.depthFromRoot}</div>
        </div>
        <div>
          <div class="info-item-label">Merge Layer</div>
          <div class="info-item-value">${data.structure.mergeLayer}</div>
        </div>
        <div>
          <div class="info-item-label">Children</div>
          <div class="info-item-value">${
            data.structure.children?.length || 0
          }</div>
        </div>
        <div>
          <div class="info-item-label">Created</div>
          <div class="info-item-value">${new Date(
            data.createdAt
          ).toLocaleString()}</div>
        </div>
      </div>
    </div>

    ${
      hasEncodings
        ? `
      <!-- Encodings Card -->
      <div class="card">
        <h2>Encodings</h2>
        ${allStates
          .map(
            (state, idx) => `
          <div class="encoding-section" style="${
            idx > 0 ? "margin-top: 16px;" : ""
          }">
            <div class="encoding-label">
              📝 ${state.perspective} 
              <span style="font-size: 12px; font-weight: 400; color: #666;">
                (Layer ${state.currentLayer}/${data.structure.mergeLayer})
              </span>
            </div>
            <div class="encoding-value">${state.encoding}</div>
            <div style="font-size: 11px; color: #888; margin-top: 8px;">
              Updated: ${new Date(state.updatedAt).toLocaleString()}
            </div>
          </div>
        `
          )
          .join("")}
      </div>

      ${
        notes.length > 0
          ? `
        <!-- Original Notes Card -->
        <div class="card">
          <h2>Original Notes</h2>
          <div style="font-size: 13px; color: #666; margin-bottom: 16px;">
            These notes were compressed into the encoding above
          </div>
          ${notes
            .map(
              (note) => `
            <div class="note-item">
              <div class="note-meta">
                <span class="note-author">@${note.username}</span>
                <span>${new Date(note.createdAt).toLocaleString()}</span>
              </div>
              <div class="note-content">${note.content}</div>
            </div>
          `
            )
            .join("")}
        </div>
      `
          : ""
      }
    `
        : `
      <!-- Notes to be Compressed Card -->
      <div class="card">
        <h2>Notes to be Compressed</h2>
        ${
          notes.length > 0
            ? `
          <div style="font-size: 13px; color: #666; margin-bottom: 16px;">
            ${notes.length} note${
                notes.length === 1 ? "" : "s"
              } waiting to be compressed
          </div>
          ${notes
            .map(
              (note) => `
            <div class="note-item">
              <div class="note-meta">
                <span class="note-author">@${note.username}</span>
                <span>${new Date(note.createdAt).toLocaleString()}</span>
              </div>
              <div class="note-content">${note.content}</div>
            </div>
          `
            )
            .join("")}
        `
            : `
          <div style="color: #757575; font-size: 14px;">
            No notes available for compression
          </div>
        `
        }
      </div>
    `
    }

  


</body>
</html>`);
    } catch (err) {
      console.error("Error fetching UnderstandingNode:", err);
      res.status(500).json({ error: err.message });
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
  </style>
</head>
<body>
  <div class="card">
    <div class="actions">
      <a href="/api/root/${nodeId}${queryString}">← Back to Tree</a>
    </div>

    <h1>Understandings</h1>
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
        placeholder="Perspective (e.g. general, technical)"
        value="general"
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

export default router;
