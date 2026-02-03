import express from "express";
import urlAuth from "../middleware/urlAuth.js";
import authenticate from "../middleware/authenticate.js";
import { createNewNode, editNodeName } from "../core/treeManagement.js";
import {
  updateParentRelationship,
  deleteNodeBranch,
} from "../core/treeManagement.js";

import { updateScript, executeScript, getScript } from "../core/scripts.js";

import { editStatus, addPrestige } from "../core/statuses.js";
import { updateSchedule } from "../core/schedules.js";

import Node from "../db/models/node.js";

const router = express.Router();

import getNodeName from "./helpers/getNameById.js";

// Allowed query params for HTML mode
const allowedParams = ["token", "html", "error"];

// Utility: keep only allowed query params
function filterQuery(req) {
  return Object.entries(req.query)
    .filter(([key]) => allowedParams.includes(key))
    .map(([key, val]) => (val === "" ? key : `${key}=${val}`))
    .join("&");
}

router.post("/:nodeId/:version/editStatus", authenticate, async (req, res) => {
  try {
    const { nodeId, version } = req.params;
    const userId = req.userId;

    const status = req.body?.status || req.query?.status;
    const ALLOWED_STATUSES = ["active", "completed", "trimmed"];

    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({
        error: "Invalid status. Must be active, completed, or trimmed.",
      });
    }
    const isInherited =
      req.body?.isInherited === "true" ||
      req.body?.isInherited === true ||
      req.query?.isInherited === "true";

    if (!status) {
      return res.status(400).json({ error: "status is required" });
    }

    const result = await editStatus({
      nodeId,
      status,
      version: Number(version),
      isInherited,
      userId,
    });

    // HTML redirect support
    if ("html" in req.query) {
      return res.redirect(
        `/api/${nodeId}/${version}?token=${req.query.token ?? ""}&html`,
      );
    }

    res.json({ success: true, ...result });
  } catch (err) {
    console.error("editStatus error:", err);
    res.status(400).json({ error: err.message });
  }
});

router.post("/:nodeId/:version/prestige", authenticate, async (req, res) => {
  try {
    const { nodeId, version } = req.params;
    const userId = req.userId;

    const nextVersion = Number(version) + 1;

    if (Number.isNaN(nextVersion)) {
      return res.status(400).json({ error: "Invalid version" });
    }

    const result = await addPrestige({
      nodeId,
      userId,
    });

    // HTML redirect support
    if ("html" in req.query) {
      return res.redirect(
        `/api/${nodeId}/${nextVersion}?token=${req.query.token ?? ""}&html`,
      );
    }

    res.json({ success: true, ...result });
  } catch (err) {
    console.error("prestige error:", err);
    res.status(400).json({ error: err.message });
  }
});

router.post("/:nodeId/updateParent", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params; // child
    const userId = req.userId;

    // new parent can come from body OR query
    const newParentId =
      req.body?.newParentId ||
      req.query?.newParentId ||
      req.body?.parentId ||
      req.query?.parentId;

    if (!newParentId) {
      return res.status(400).json({
        error: "newParentId is required",
      });
    }

    const result = await updateParentRelationship(nodeId, newParentId, userId);

    // HTML redirect support
    if ("html" in req.query) {
      return res.redirect(`/api/${nodeId}?token=${req.query.token ?? ""}&html`);
    }

    res.json({
      success: true,
      nodeChild: result.nodeChild,
      nodeNewParent: result.nodeNewParent,
    });
  } catch (err) {
    console.error("updateParent error:", err);
    res.status(400).json({ error: err.message });
  }
});
// -----------------------------------------------------------------------------
// GET /api/:nodeId
// Returns the node + all versions (no notes)
// Supports JSON or ?html mode
// Shows full node data, parent + children clickable
// -----------------------------------------------------------------------------
router.get("/:nodeId", urlAuth, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const node = await Node.findById(nodeId).lean();

    if (!node) return res.status(404).json({ error: "Node not found" });

    // 🔐 Strip sensitive wallet info
    if (Array.isArray(node.versions)) {
      node.versions = node.versions.map((v) => ({
        ...v,
        wallet: v.wallet
          ? {
              publicKey: v.wallet.publicKey ?? null,
            }
          : null,
      }));
    }

    const queryString = filterQuery(req);
    const qs = queryString ? `?${queryString}` : "";

    // ---------------------------------------------------------
    // HTML MODE
    // ---------------------------------------------------------
    if (req.query.html !== undefined) {
      // Versions

      const parentName = node.parent
        ? (await Node.findById(node.parent, "name").lean())?.name
        : null;

      const children = await Node.find({ _id: { $in: node.children } })
        .select("name _id")
        .lean();

      // ---------------------------------------------------------
      // NEW: Root View button
      // ---------------------------------------------------------
      const rootUrl = `/api/root/${nodeId}${qs}`;

      // Replace the HTML return in your /:nodeId route with this:

      return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>${node.name} — Node</title>
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
      max-width: 900px;
      margin: 0 auto;
    }

    /* Back Navigation */
    .back-nav {
      margin-bottom: 20px;
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

    .node-id-container {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
      flex-wrap: wrap;
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

    #copyNodeIdBtn {
      background: none;
      border: none;
      cursor: pointer;
      padding: 6px;
      opacity: 0.6;
      font-size: 18px;
      transition: opacity 0.2s, transform 0.2s;
    }

    #copyNodeIdBtn:hover {
      opacity: 1;
      transform: scale(1.1);
    }

    .meta-row {
      display: flex;
      gap: 24px;
      flex-wrap: wrap;
      padding-top: 12px;
      border-top: 1px solid #e0e0e0;
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
      color: #888;
    }

    .meta-value {
      font-size: 16px;
      font-weight: 600;
      color: #1a1a1a;
    }

    /* Versions Section */
    .versions-section {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .versions-section h2 {
      font-size: 20px;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 16px;
    }

    .versions-list {
      list-style: none;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 10px;
    }

    .versions-list li {
      margin: 0;
    }

    .versions-list a {
      display: block;
      padding: 14px 18px;
      background: #f8f9fa;
      border-radius: 10px;
      color: #667eea;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.2s;
      border: 1px solid transparent;
      text-align: center;
    }

    .versions-list a:hover {
      background: white;
      border-color: #667eea;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.2);
    }

    /* Scripts Section */
    .scripts-section {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .scripts-section h2 {
      font-size: 20px;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 16px;
    }

    .scripts-list {
      list-style: none;
    }

    .scripts-list li {
      margin-bottom: 16px;
      padding: 16px;
      background: #f8f9fa;
      border-radius: 10px;
    }

    .scripts-list li:last-child {
      margin-bottom: 0;
    }

    .scripts-list strong {
      display: block;
      margin-bottom: 8px;
      color: #667eea;
      font-size: 15px;
    }

    .scripts-list pre {
      background: #2d2d2d;
      color: #a9b7c6;
      padding: 14px;
      border-radius: 8px;
      overflow-x: auto;
      font-size: 13px;
      line-height: 1.5;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    }

    .scripts-list em {
      color: #999;
      font-style: normal;
    }

    /* Hierarchy Section */
    .hierarchy-section {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .hierarchy-section h2 {
      font-size: 20px;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 8px;
    }

    .hierarchy-section h3 {
      font-size: 16px;
      font-weight: 600;
      color: #555;
      margin: 24px 0 12px 0;
    }

    .hierarchy-section > p {
      margin-bottom: 16px;
    }

    .hierarchy-section a {
      color: #667eea;
      text-decoration: none;
      font-weight: 600;
      transition: color 0.2s;
    }

    .hierarchy-section a:hover {
      color: #764ba2;
      text-decoration: underline;
    }

    .hierarchy-section em {
      color: #999;
      font-style: normal;
    }

    .children-list {
      list-style: none;
      margin-bottom: 20px;
    }

    .children-list li {
      margin: 0;
    }

    .children-list a {
      display: block;
      padding: 12px 16px;
      background: #f8f9fa;
      border-radius: 10px;
      margin-bottom: 8px;
      transition: all 0.2s;
      border: 1px solid transparent;
    }

    .children-list a:hover {
      background: white;
      border-color: #667eea;
      transform: translateX(4px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
    }

    /* Forms */
    .action-form {
      display: flex;
      gap: 10px;
      align-items: stretch;
      margin-top: 12px;
      flex-wrap: wrap;
    }

    .action-form input[type="text"] {
      flex: 1;
      min-width: 200px;
      padding: 12px 16px;
      font-size: 15px;
      border-radius: 10px;
      border: 1px solid #d0d0d0;
      background: white;
      font-family: inherit;
      transition: all 0.2s;
    }

    .action-form input[type="text"]:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }

    .action-form button {
      padding: 12px 20px;
      font-size: 15px;
      font-weight: 600;
      border-radius: 10px;
      border: none;
      cursor: pointer;
      transition: all 0.2s;
      font-family: inherit;
      white-space: nowrap;
    }

    .primary-button {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
    }

    .primary-button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 25px rgba(102, 126, 234, 0.5);
    }

    .warning-button {
      background: #ff9800;
      color: white;
      box-shadow: 0 4px 15px rgba(255, 152, 0, 0.3);
    }

    .warning-button:hover {
      background: #f57c00;
      transform: translateY(-2px);
      box-shadow: 0 6px 25px rgba(255, 152, 0, 0.4);
    }

    /* Danger Zone */
    .danger-section {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
      border: 2px solid #ffebee;
    }

    .danger-section h3 {
      font-size: 18px;
      font-weight: 700;
      color: #c62828;
      margin-bottom: 16px;
    }

    .danger-button {
      padding: 12px 24px;
      font-size: 15px;
      font-weight: 600;
      border-radius: 10px;
      border: none;
      background: #c62828;
      color: white;
      cursor: pointer;
      transition: all 0.2s;
      font-family: inherit;
      box-shadow: 0 4px 15px rgba(198, 40, 40, 0.3);
    }

    .danger-button:hover {
      background: #b71c1c;
      transform: translateY(-2px);
      box-shadow: 0 6px 25px rgba(198, 40, 40, 0.4);
    }

    /* Responsive Design */
    @media (max-width: 640px) {
      body {
        padding: 16px;
      }

      .header,
      .versions-section,
      .scripts-section,
      .hierarchy-section,
      .danger-section {
        padding: 20px;
      }

      .header h1 {
        font-size: 24px;
      }

      .versions-list {
        grid-template-columns: 1fr;
      }

      .action-form {
        flex-direction: column;
      }

      .action-form input[type="text"] {
        width: 100%;
        min-width: 0;
      }

      .action-form button {
        width: 100%;
      }

      code {
        font-size: 11px;
        max-width: 180px;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .meta-row {
        flex-direction: column;
        gap: 12px;
      }
    }

    @media (min-width: 641px) and (max-width: 1024px) {
      .container {
        max-width: 700px;
      }

      .versions-list {
        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="${rootUrl}" class="back-link">
        ← Back to Tree
      </a>
    </div>

    <!-- Header -->
    <div class="header">
      <h1>${node.name}</h1>
      
      <div class="node-id-container">
        <code id="nodeIdCode">${node._id}</code>
        <button id="copyNodeIdBtn" title="Copy ID">📋</button>
      </div>

      <div class="meta-row">
        <div class="meta-item">
          <div class="meta-label">Type</div>
          <div class="meta-value">${node.type ?? "None"}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Prestige Level</div>
          <div class="meta-value">${node.prestige}</div>
        </div>
      </div>
    </div>

    <!-- Versions Section -->
    <div class="versions-section">
      <h2>Versions</h2>
      <ul class="versions-list">
        ${[...node.versions]
          .reverse()
          .map(
            (_, i, arr) =>
              `<li><a href="/api/${nodeId}/${arr.length - 1 - i}${qs}">

                Version ${arr.length - 1 - i}
              </a></li>`,
          )
          .join("")}
      </ul>
    </div>

    <!-- Scripts Section -->
    <div class="scripts-section">
<a href="/api/${node._id}/scripts/help${qs}">

      <h2>Scripts</h2></a>
      <form
      method="POST"
action="/api/${nodeId}/script/create${qs}"
      style="display:flex;gap:8px;align-items:center;"
    >
      <input
        type="text"
        name="name"
        placeholder="New script name"
        required
        style="
          padding:8px 12px;
          border-radius:8px;
          border:1px solid #d0d0d0;
          font-size:14px;
          min-width:200px;
        "
      />

      <button
        type="submit"
        class="primary-button"
        title="Create script"
        style="padding:8px 14px;font-size:16px;"
      >
        ➕
      </button>
    </form>
      <ul class="scripts-list">
        ${
          node.scripts && node.scripts.length
            ? node.scripts
                .map(
                  (s) => `
                 <a href="/api/${node._id}/script/${s._id}${qs}">

            <li>
              <strong>${s.name}</strong>
              <pre>${s.script}</pre>
            </li></a>`,
                )
                .join("")
            : `<li><em>No scripts defined</em></li>`
        }
      </ul>
    </div>

    <!-- Hierarchy Section -->
    <div class="hierarchy-section">
      <h2>Parent</h2>
      <p>${
        node.parent
          ? `<a href="/api/${node.parent}${qs}">
${parentName}</a>`
          : `<em>None (This is a root node)</em>`
      }</p>

      <h3>Change Parent</h3>
      <form
        method="POST"
  action="/api/${nodeId}/updateParent${qs}"
        class="action-form"
      >
        <input
          type="text"
          name="newParentId"
          placeholder="New parent node ID"
          required
        />
        <button type="submit" class="warning-button">
          Move Node
        </button>
      </form>

      <h2 style="margin-top: 32px;">Children</h2>
      <ul class="children-list">
        ${
          node.children && node.children.length
            ? node.children
                .map((c) => {
                  const child = children.find((child) => child._id === c);
                  const name = child ? child.name : c;
                  return `<li><a href="/api/${c}${qs}">
${name}</a></li>`;
                })
                .join("")
            : `<li><em>No children yet</em></li>`
        }
      </ul>

      <h3>Add Child</h3>
      <form
        method="POST"
action="/api/${nodeId}/createChild${qs}"
        class="action-form"
      >
        <input
          type="text"
          name="name"
          placeholder="Child name"
          required
        />
        <button type="submit" class="primary-button">
          Create Child
        </button>
      </form>
    </div>

    <!-- Danger Zone -->
    <div class="danger-section">
      <h3>⚠️ Danger Zone</h3>
      <form
        method="POST"
action="/api/${nodeId}/delete${qs}"
        onsubmit="return confirm('Delete this node and its branch? This can be revived later.')"
      >
        <button type="submit" class="danger-button">
          Delete Node
        </button>
      </form>
    </div>
  </div>

  <script>
    // Copy ID functionality
    const btn = document.getElementById("copyNodeIdBtn");
    const code = document.getElementById("nodeIdCode");

    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(code.textContent).then(() => {
        btn.textContent = "✔️";
        setTimeout(() => (btn.textContent = "📋"), 900);
      });
    });
  </script>
</body>
</html>
`);
    }

    // ---------------------------------------------------------
    // JSON MODE
    // ---------------------------------------------------------
    res.json({ node });
  } catch (err) {
    console.error("Error fetching node:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// -----------------------------------------------------------------------------
// GET /api/:nodeId/:version
// Returns a single version (includes Notes link)
// Supports JSON or ?html mode
// -----------------------------------------------------------------------------
router.get("/:nodeId/:version", urlAuth, async (req, res) => {
  try {
    const { nodeId, version, parent } = req.params;
    const v = Number(version);

    const node = await Node.findById(nodeId).lean();

    if (!node) return res.status(404).json({ error: "Node not found" });

    // 🔐 Strip sensitive wallet info
    if (Array.isArray(node.versions)) {
      node.versions = node.versions.map((v) => ({
        ...v,
        wallet: v.wallet
          ? {
              publicKey: v.wallet.publicKey ?? null,
            }
          : null,
      }));
    }

    if (isNaN(v) || v < 0 || v >= node.versions.length)
      return res.status(400).json({ error: "Invalid version index" });

    const data = node.versions[v];

    const ALL_STATUSES = ["active", "completed", "trimmed"];
    const STATUS_LABELS = {
      active: "Activate",
      completed: "Complete",
      trimmed: "Trim",
    };

    const showPrestige = v === node.prestige;

    // ----------------------------
    // HTML BROWSER MODE
    // ----------------------------
    if (req.query.html !== undefined) {
      const queryString = filterQuery(req);
      const qs = queryString ? `?${queryString}` : "";

      const backUrl = `/api/${nodeId}${qs}`;
      const backTreeUrl = `/api/root/${nodeId}${qs}`;

      const createdDate = data.dateCreated
        ? new Date(data.dateCreated).toLocaleString()
        : "Unknown";

      const scheduleHtml = data.schedule
        ? new Date(data.schedule).toLocaleString()
        : "None";

      const reeffectTime =
        data.reeffectTime !== undefined ? data.reeffectTime : "<em>None</em>";

      // Replace the HTML return in your /:nodeId/:version route with this:

      return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>${node.name} v${version}</title>
  <style>
    /* =========================================================
   GLOBAL VARIABLES — matches WelcomePage
   ========================================================= */

/* Replace the <style> content in your /:nodeId/:version route with this */

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
  0%,
  100% {
    transform: translateY(0) rotate(0deg);
  }
  50% {
    transform: translateY(-30px) rotate(5deg);
  }
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
   UNIFIED GLASS BUTTON SYSTEM
   ========================================================= */

.glass-btn,
button,
.action-button,
.back-link,
.nav-links a,
.meta-value button,
.contributors-list button,
button[type="submit"],
.status-button,
.primary-button {
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
  font-weight: 500;
  letter-spacing: -0.2px;

  border: 1px solid rgba(255, 255, 255, 0.28);

  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);

  cursor: pointer;

  transition:
    background 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.3s ease;
}

/* Liquid light layer */
.glass-btn::before,
button::before,
.action-button::before,
.back-link::before,
.nav-links a::before,
.meta-value button::before,
.contributors-list button::before,
button[type="submit"]::before,
.status-button::before,
.primary-button::before {
  content: "";
  position: absolute;
  inset: -40%;

  background:
    radial-gradient(
      120% 60% at 0% 0%,
      rgba(255, 255, 255, 0.35),
      transparent 60%
    ),
    linear-gradient(
      120deg,
      transparent 30%,
      rgba(255, 255, 255, 0.25),
      transparent 70%
    );

  opacity: 0;
  transform: translateX(-30%) translateY(-10%);
  transition:
    opacity 0.35s ease,
    transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);

  pointer-events: none;
}

/* Hover motion */
.glass-btn:hover,
button:hover,
.action-button:hover,
.back-link:hover,
.nav-links a:hover,
.meta-value button:hover,
.contributors-list button:hover,
button[type="submit"]:hover,
.status-button:hover,
.primary-button:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-1px);
  animation: waterDrift 2.2s ease-in-out infinite alternate;
}

.glass-btn:hover::before,
button:hover::before,
.action-button:hover::before,
.back-link:hover::before,
.nav-links a:hover::before,
.meta-value button:hover::before,
.contributors-list button:hover::before,
button[type="submit"]:hover::before,
.status-button:hover::before,
.primary-button:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

/* Active press */
.glass-btn:active,
button:active,
.status-button:active,
.primary-button:active {
  background: rgba(var(--glass-water-rgb), 0.45);
  transform: translateY(0);
  animation: none;
}

@keyframes waterDrift {
  0% { transform: translateY(-1px); }
  100% { transform: translateY(1px); }
}

/* Emphasis variants */
.primary-button {
  --glass-alpha: 0.34;
  --glass-alpha-hover: 0.46;
  font-weight: 600;
}

.legacy-btn {
  opacity: 0.85;
}
.legacy-btn:hover {
  opacity: 1;
}

/* =========================================================
   CONTENT CARDS
   ========================================================= */

.header,
.nav-section,
.actions-section {
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 14px;
  padding: 28px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: white;
  margin-bottom: 24px;
}

.meta-card {
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 12px;
  padding: 16px 20px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: white;
}

.header h1 {
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.5px;
  line-height: 1.3;
  margin-bottom: 8px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.header h1 a {
  color: white;
  text-decoration: none;
  transition: opacity 0.2s;
}

.header h1 a:hover {
  opacity: 0.8;
}

.nav-section h2,
.actions-section h3 {
  font-size: 18px;
  font-weight: 600;
  color: white;
  margin-bottom: 16px;
  letter-spacing: -0.3px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

/* =========================================================
   NAV + META
   ========================================================= */

.back-nav {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.version-badge {
  display: inline-block;
  padding: 6px 14px;
  background: rgba(255, 255, 255, 0.25);
  backdrop-filter: blur(10px);
  color: white;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 600;
  margin-top: 8px;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.node-id-container {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(8px);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

code {
  background: transparent;
  padding: 0;
  border-radius: 0;
  font-size: 13px;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  color: white;
  word-break: break-all;
  flex: 1;
}

#copyNodeIdBtn {
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 6px;
  opacity: 0.7;
  font-size: 18px;
  transition: opacity 0.2s;
}

#copyNodeIdBtn:hover {
  opacity: 1;
  transform: scale(1.1);
}

.meta-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.meta-label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: rgba(255, 255, 255, 0.7);
  margin-bottom: 6px;
}

.meta-value {
  font-size: 15px;
  font-weight: 600;
  color: white;
}

.status-badge {
  display: inline-block;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  text-transform: capitalize;
  background: rgba(255, 255, 255, 0.25);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.nav-links {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.nav-links a {
  padding: 14px 18px;
  font-size: 15px;
  text-align: center;
}

/* =========================================================
   ACTIONS & FORMS
   ========================================================= */

.action-form {
  margin-bottom: 24px;
}

.action-form:last-child {
  margin-bottom: 0;
}

.button-group {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

button[type="submit"],
.status-button {
  padding: 12px 20px;
  font-size: 14px;
}

/* =========================================================
   MODAL
   ========================================================= */

#scheduleModal {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

#scheduleModal > div {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(22px);
  -webkit-backdrop-filter: blur(22px);
  padding: 24px;
  border-radius: 14px;
  width: 320px;
  border: 1px solid rgba(255, 255, 255, 0.5);
}

#scheduleModal label {
  display: block;
  margin-bottom: 12px;
  color: #667eea;
  font-weight: 600;
  font-size: 14px;
  letter-spacing: -0.2px;
}

#scheduleModal input {
  width: 100%;
  margin-top: 6px;
  padding: 12px 14px;
  border-radius: 8px;
  border: 2px solid rgba(102, 126, 234, 0.3);
  background: rgba(255, 255, 255, 0.8);
  font-size: 15px;
  font-family: inherit;
  transition: all 0.2s;
}

#scheduleModal input:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

#scheduleModal button {
  padding: 10px 18px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.2s;
  border: none;
}

#scheduleModal button[type="button"] {
  background: #f0f0f0;
  color: #666;
  border: 1px solid #d0d0d0 !important;
  box-shadow: none !important;
}

#scheduleModal button[type="button"]:hover {
  background: #e0e0e0;
}

#scheduleModal button[type="button"]::before {
  display: none;
}

#scheduleModal > div > form > div {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 16px;
}

/* =========================================================
   RESPONSIVE
   ========================================================= */

@media (max-width: 640px) {
  body {
    padding: 16px;
  }

  .container {
    max-width: 100%;
  }

  .header,
  .nav-section,
  .actions-section {
    padding: 20px;
  }

  .header h1 {
    font-size: 24px;
  }

  .back-nav {
    flex-direction: column;
  }

  .back-link {
    width: 100%;
    justify-content: center;
  }

  .meta-grid {
    grid-template-columns: 1fr;
  }

  .nav-links {
    grid-template-columns: 1fr;
  }

  .button-group {
    flex-direction: column;
  }

  button,
  .status-button,
  .primary-button {
    width: 100%;
  }

  code {
    font-size: 11px;
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  #scheduleModal > div {
    width: calc(100% - 40px);
    max-width: 320px;
  }
}

@media (min-width: 641px) and (max-width: 1024px) {
  .container {
    max-width: 700px;
  }
}
     html, body {
        background: #736fe6;
        margin: 0;
        padding: 0;
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
      <a href="${backUrl}" class="back-link">
        View All Versions
      </a>
    </div>

    <!-- Header -->
    <div class="header">
      <h1>
        <a href="${backUrl}">${node.name}</a>
      </h1>
      <span class="version-badge">Version ${version}</span>
      
      <div class="node-id-container">
        <code id="nodeIdCode">${node._id}</code>
        <button id="copyNodeIdBtn" title="Copy ID">📋</button>
      </div>
    </div>
 <!-- Navigation Links -->
    <div class="nav-section">
      <h2>Quick Access</h2>
      <div class="nav-links">
        <a href="/api/${nodeId}/${version}/notes${qs}">Notes</a>
        <a href="/api/${nodeId}/${version}/values${qs}">Values / Goals</a>
        <a href="/api/${nodeId}/${version}/contributions${qs}">Contributions</a>
        <a href="/api/${nodeId}/${version}/transactions${qs}">Transactions</a>
      </div>
    </div>

    <!-- Metadata Grid -->
    <div class="meta-grid">
      <div class="meta-card">
        <div class="meta-label">Status</div>
        <div class="meta-value">
          <span class="status-badge status-${data.status}">${data.status}</span>
        </div>
      </div>

      <div class="meta-card">
        <div class="meta-label">Created</div>
        <div class="meta-value">${createdDate}</div>
      </div>

      <div class="meta-card">
  <div class="meta-label">Schedule</div>
  <div class="meta-value">
    ${scheduleHtml}
    <button id="editScheduleBtn" style="margin-left:8px;">✏️</button>
  </div>
</div>

<div class="meta-card">
  <div class="meta-label">Repeat Hours</div>
  <div class="meta-value">${reeffectTime}</div>
</div>

    </div>

   
    <!-- Actions Section -->
    <div class="actions-section">
      <h3>Change Status</h3>
      <form
        method="POST"
         action="/api/${nodeId}/${version}/editStatus${qs}"

        onsubmit="return confirm('This will apply to all children. Is that ok?')"
        class="action-form"
      >
        <input type="hidden" name="isInherited" value="true" />
        <div class="button-group">
          ${ALL_STATUSES.filter((s) => s !== data.status)
            .map(
              (s) => `
            <button type="submit" name="status" value="${s}" class="status-button">
              ${STATUS_LABELS[s]}
            </button>
          `,
            )
            .join("")}
        </div>
      </form>

      ${
        showPrestige
          ? `
        <h3 style="margin-top: 24px;">Version Control</h3>
        <form
          method="POST"
         action="/api/${nodeId}/${version}/prestige${qs}"

          onsubmit="return confirm('This will complete the current version and create a new prestige level. Continue?')"
          class="action-form"
        >
          <button type="submit" class="primary-button">
            Add New Version
          </button>
        </form>
      `
          : ""
      }
    </div>
  </div>
  <div id="scheduleModal" style="
  display:none;
  position:fixed;
  inset:0;
  background:rgba(0,0,0,0.4);
  align-items:center;
  justify-content:center;
">
  <div style="
    background:white;
    padding:24px;
    border-radius:14px;
    width:320px;
  ">

    <form
      method="POST"
      action="/api/${nodeId}/${version}/editSchedule${qs}"
    >
      <label style="display:block;margin-bottom:8px;">
        TIME
        <input
          type="datetime-local"
          name="newSchedule"
          value="${
            data.schedule
              ? new Date(data.schedule).toISOString().slice(0, 16)
              : ""
          }"
          
          style="width:100%;margin-top:4px;"
        />
      </label>

      <label style="display:block;margin-bottom:12px;">
        REPEAT HOURS
        <input
          type="number"
          name="reeffectTime"
          min="0"
          value="${data.reeffectTime ?? 0}"
          style="width:100%;margin-top:4px;"
        />
      </label>

      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button type="button" id="cancelSchedule">Cancel</button>
        <button type="submit" class="primary-button">Save</button>
      </div>
    </form>
  </div>
</div>

  <script>
    // Copy ID functionality
    const btn = document.getElementById("copyNodeIdBtn");
    const code = document.getElementById("nodeIdCode");

    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(code.textContent).then(() => {
        btn.textContent = "✔️";
        setTimeout(() => (btn.textContent = "📋"), 900);
      });
    });
    const editBtn = document.getElementById("editScheduleBtn");
const modal = document.getElementById("scheduleModal");
const cancelBtn = document.getElementById("cancelSchedule");

if (editBtn) {
  editBtn.onclick = () => {
    modal.style.display = "flex";
  };
}

if (cancelBtn) {
  cancelBtn.onclick = () => {
    modal.style.display = "none";
  };
}

  </script>
  

</body>
</html>
`);
    }

    // ----------------------------
    // JSON MODE
    // ----------------------------
    res.json({
      id: node._id,
      name: node.name,
      version: v,
      data,
    });
  } catch (err) {
    console.error("Error fetching version:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:nodeId/createChild", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params; // parent id
    const { name } = req.body;
    const userId = req.userId;

    if (!name || typeof name !== "string") {
      return res.status(400).json({
        success: false,
        error: "Name is required",
      });
    }

    // Load parent
    const parentNode = await Node.findById(nodeId);
    if (!parentNode) {
      return res.status(404).json({
        success: false,
        error: "Parent node not found",
      });
    }

    // Create child
    const childNode = await createNewNode(
      name,
      null, // schedule
      null, // reeffectTime
      parentNode._id, // parentNodeID
      false, // isRoot
      userId, // userId (from token)
      {}, // values
      {}, // goals
      null, // note
    );

    // HTML redirect support (same pattern)
    if ("html" in req.query) {
      return res.redirect(`/api/${nodeId}?token=${req.query.token ?? ""}&html`);
    }

    res.status(201).json({
      success: true,
      childId: childNode._id,
      child: childNode,
    });
  } catch (err) {
    console.error("createChild error:", err);
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post("/:nodeId/delete", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const userId = req.userId;

    const deletedNode = await deleteNodeBranch(nodeId, userId);

    if ("html" in req.query) {
      return res.redirect(
        `/api/user/${userId}/deleted?token=${req.query.token ?? ""}&html`,
      );
    }

    return res.json({
      success: true,
      deletedNode: deletedNode._id,
    });
  } catch (err) {
    console.error("delete node error:", err);
    return res.status(400).json({ error: err.message });
  }
});

router.post("/:nodeId/:version/editName", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const userId = req.userId;

    const newName = req.body?.name || req.query?.name;

    if (!newName) {
      return res.status(400).json({ error: "newName is required" });
    }

    const result = await editNodeName({
      nodeId,
      newName,
      userId,
    });

    // HTML redirect support
    if ("html" in req.query) {
      return res.redirect(`/api/${nodeId}?token=${req.query.token ?? ""}&html`);
    }

    res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error("editName error:", err);
    res.status(400).json({ error: err.message });
  }
});

router.post(
  "/:nodeId/:version/editSchedule",
  authenticate,
  async (req, res) => {
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

      // ✅ HTML redirect support (same pattern as editStatus)
      if ("html" in req.query) {
        return res.redirect(
          `/api/${nodeId}/${version}?token=${req.query.token ?? ""}&html`,
        );
      }

      res.json({ success: true, ...result });
    } catch (err) {
      console.error("editSchedule error:", err);
      res.status(err.status || 400).json({ error: err.message });
    }
  },
);

router.get("/:nodeId/script/:scriptId", urlAuth, async (req, res) => {
  try {
    const { nodeId, scriptId } = req.params;

    if (!nodeId || !scriptId) {
      return res.status(400).json({
        error: "Missing required fields: nodeId, scriptId",
      });
    }

    const { script, contributions } = await getScript({ nodeId, scriptId });

    // Preserve allowed query params (token, html)
    const qs = filterQuery(req);
    const qsWithQ = qs ? `?${qs}` : "";

    // ---------------------------------------------------------
    // HTML MODE
    // ---------------------------------------------------------
    if ("html" in req.query) {
      const editHistory = contributions.filter((c) => c.type === "edit");
      const executionHistory = contributions.filter(
        (c) => c.type === "execute",
      );

      const editHistoryHtml = editHistory.length
        ? editHistory
            .map(
              (c, i) => `
<li class="history-item">
  <div class="history-header">
    <div class="history-title">
      <span class="edit-number">Edit ${editHistory.length - i}</span>
      ${c.scriptName ? `<span class="script-name">${c.scriptName}</span>` : ""}
      ${i === 0 ? `<span class="current-badge">Current</span>` : ""}
    </div>
    <div class="history-meta">
      <span class="version-badge">v${c.nodeVersion}</span>
      <span class="timestamp">${new Date(c.createdAt).toLocaleString()}</span>
    </div>
  </div>

  ${
    c.contents
      ? `
  <details>
    <summary>
      <span class="summary-icon">▶</span>
      View code
    </summary>
    <pre class="history-code">${c.contents}</pre>
  </details>`
      : `<div class="empty-history-item">Empty script</div>`
  }
</li>
`,
            )
            .join("")
        : `<li class="empty-history">No edit history yet</li>`;

      const executionHistoryHtml = executionHistory.length
        ? executionHistory
            .map(
              (c, i) => `
<li class="history-item ${c.success ? "success" : "failure"}">
  <div class="history-header">
    <div class="history-title">
      <span class="edit-number">Run ${executionHistory.length - i}</span>
      ${c.scriptName ? `<span class="script-name">${c.scriptName}</span>` : ""}
      ${
        c.success
          ? `<span class="current-badge success-badge">Success</span>`
          : `<span class="current-badge failure-badge">Failed</span>`
      }
    </div>
    <div class="history-meta">
      <span class="version-badge">v${c.nodeVersion}</span>
      <span class="timestamp">${new Date(c.createdAt).toLocaleString()}</span>
    </div>
  </div>

  ${
    c.logs && c.logs.length
      ? `
  <details>
    <summary>
      <span class="summary-icon">▶</span>
      View logs (${c.logs.length} ${c.logs.length === 1 ? "entry" : "entries"})
    </summary>
    <pre class="history-code">${c.logs.join("\n")}</pre>
  </details>`
      : ""
  }

  ${
    c.error
      ? `<div class="error-message">
          <div class="error-label">Error:</div>
          <pre class="error-code">${c.error}</pre>
        </div>`
      : ""
  }

  ${
    !c.logs?.length && !c.error
      ? `<div class="empty-history-item">No logs or output</div>`
      : ""
  }
</li>
`,
            )
            .join("")
        : `<li class="empty-history">No executions yet</li>`;

      return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>${script.name} — Script</title>
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

    /* Header */
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

    .header::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 4px;
      background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
    }

    .header h1 {
      font-size: 28px;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 12px;
      word-break: break-word;
    }

    .header h1::before {
      content: '⚡ ';
      font-size: 26px;
    }

    .script-id {
      font-size: 13px;
      color: #888;
      font-family: 'SF Mono', Monaco, monospace;
      background: #f8f9fa;
      padding: 6px 12px;
      border-radius: 6px;
      display: inline-block;
      margin-top: 8px;
    }

    /* Section */
    .section {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 28px;
      margin-bottom: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
      position: relative;
      overflow: hidden;
    }

    .section::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 4px;
      background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
    }

    .section-title {
      font-size: 20px;
      font-weight: 600;
      color: #1a1a1a;
      margin-bottom: 20px;
    }

    /* Code Display */
    .code-container {
      position: relative;
    }

    .code-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .code-label {
      font-size: 14px;
      font-weight: 600;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .btn-copy {
      padding: 6px 12px;
      background: rgba(102, 126, 234, 0.1);
      border: 1px solid rgba(102, 126, 234, 0.2);
      border-radius: 6px;
      color: #667eea;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-copy:hover {
      background: rgba(102, 126, 234, 0.2);
      transform: translateY(-2px);
    }

    pre {
      background: #1e1e1e;
      color: #d4d4d4;
      padding: 20px;
      border-radius: 12px;
      overflow-x: auto;
      font-size: 14px;
      line-height: 1.6;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', Consolas, monospace;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    /* Action Buttons */
    .action-bar {
      display: flex;
      gap: 12px;
      margin-top: 20px;
      flex-wrap: wrap;
    }

    .btn-execute {
      padding: 12px 24px;
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: white;
      border: none;
      border-radius: 10px;
      font-weight: 600;
      font-size: 15px;
      cursor: pointer;
      transition: all 0.2s;
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .btn-execute:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(16, 185, 129, 0.4);
    }

    .btn-execute::before {
      content: '▶';
      font-size: 14px;
    }

    /* Edit Form */
    .edit-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .form-label {
      font-size: 14px;
      font-weight: 600;
      color: #667eea;
    }

    input[type="text"],
    textarea {
      width: 100%;
      padding: 12px;
      border: 1px solid #e9ecef;
      border-radius: 8px;
      font-size: 14px;
      font-family: inherit;
      transition: border-color 0.2s;
      background: white;
    }

    textarea {
      font-family: 'SF Mono', Monaco, 'Cascadia Code', Consolas, monospace;
      resize: vertical;
      min-height: 300px;
    }

    input[type="text"]:focus,
    textarea:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }

    .btn-save {
      padding: 12px 24px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 10px;
      font-weight: 600;
      font-size: 15px;
      cursor: pointer;
      transition: all 0.2s;
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
      align-self: flex-start;
    }

    .btn-save:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
    }

    /* History */
    .history-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .history-item {
      background: #f8f9fa;
      border-radius: 12px;
      padding: 16px;
      border: 1px solid #e9ecef;
      transition: all 0.2s;
    }

    .history-item:hover {
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.1);
      transform: translateX(4px);
    }

    .history-item.success {
      border-left: 4px solid #10b981;
    }

    .history-item.failure {
      border-left: 4px solid #ef4444;
    }

    .history-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      flex-wrap: wrap;
      gap: 12px;
    }

    .history-title {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .edit-number {
      font-weight: 600;
      color: #1a1a1a;
      font-size: 15px;
    }

    .script-name {
      font-size: 13px;
      color: #667eea;
      background: rgba(102, 126, 234, 0.1);
      padding: 4px 10px;
      border-radius: 8px;
      font-weight: 600;
    }

    .current-badge {
      padding: 4px 10px;
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: white;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
    }

    .success-badge {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    }

    .failure-badge {
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
    }

    .history-meta {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .version-badge {
      padding: 4px 10px;
      background: white;
      color: #667eea;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      border: 1px solid #e9ecef;
    }

    .timestamp {
      font-size: 13px;
      color: #888;
    }

    details {
      margin-top: 8px;
    }

    details summary {
      cursor: pointer;
      font-weight: 600;
      color: #667eea;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 0;
      user-select: none;
      transition: color 0.2s;
    }

    details summary:hover {
      color: #764ba2;
    }

    .summary-icon {
      font-size: 10px;
      transition: transform 0.2s;
    }

    details[open] .summary-icon {
      transform: rotate(90deg);
    }

    details summary::-webkit-details-marker {
      display: none;
    }

    .history-code {
      margin-top: 12px;
      font-size: 13px;
    }

    .empty-history {
      text-align: center;
      padding: 40px;
      color: #888;
      font-style: italic;
      background: #f8f9fa;
      border-radius: 12px;
      border: 1px solid #e9ecef;
    }

    .empty-history-item {
      text-align: center;
      padding: 20px;
      color: #888;
      font-style: italic;
      font-size: 14px;
    }

    /* Error Messages */
    .error-message {
      margin-top: 12px;
      padding: 12px;
      background: rgba(239, 68, 68, 0.1);
      border-left: 3px solid #ef4444;
      border-radius: 8px;
    }

    .error-label {
      font-size: 12px;
      font-weight: 600;
      color: #ef4444;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }

    .error-code {
      color: #ef4444;
      background: rgba(0, 0, 0, 0.05);
      padding: 12px;
      border-radius: 6px;
      font-size: 13px;
      margin: 0;
    }

    /* Responsive */
    @media (max-width: 640px) {
      body {
        padding: 16px;
      }

      .header,
      .section {
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

      .action-bar {
        flex-direction: column;
      }

      .btn-execute,
      .btn-save {
        width: 100%;
        justify-content: center;
      }

      .history-header {
        flex-direction: column;
        align-items: flex-start;
      }

      .history-title {
        width: 100%;
      }

      pre {
        font-size: 12px;
        padding: 16px;
      }

      textarea {
        min-height: 200px;
      }
    }

    @media (min-width: 641px) and (max-width: 1024px) {
      .container {
        max-width: 800px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
     <a href="/api/${nodeId}${qsWithQ}" class="back-link">
  ← Back to Node
</a>

<a href="/api/${nodeId}/scripts/help${qsWithQ}" class="back-link">
  📚 Help
</a>

    </div>

    <!-- Header -->
    <div class="header">
      <h1>${script.name}</h1>
      <div class="script-id">ID: ${script.id}</div>
    </div>

    <!-- Current Script -->
    <div class="section">
      <div class="code-container">
        <div class="code-header">
          <div class="code-label">Current Script</div>
          <button class="btn-copy" onclick="copyCode()">📋 Copy</button>
        </div>
        <pre id="scriptCode">${script.script}</pre>
      </div>

      <!-- Execute Button -->
      <div class="action-bar">
        <form
          method="POST"
          action="/api/${nodeId}/script/${script.id}/execute${qsWithQ}"
          onsubmit="return confirm('Execute this script now?')"
          style="margin: 0;"
        >
          <button type="submit" class="btn-execute">Run Script</button>
        </form>
      </div>
    </div>

    <!-- Edit Script -->
    <div class="section">
      <div class="section-title">Edit Script</div>
      <form
        method="POST"
        action="/api/${nodeId}/script/${script.id}/edit${qsWithQ}"
        class="edit-form"
      >
        <div class="form-group">
          <label class="form-label">Script Name</label>
          <input
            type="text"
            name="name"
            value="${script.name}"
            placeholder="Enter script name"
            required
          />
        </div>

        <div class="form-group">
          <label class="form-label">Script Code</label>
          <textarea
            name="script"
            rows="14"
            placeholder="// Enter your script code here"
            required
          >${script.script}</textarea>
        </div>

        <button type="submit" class="btn-save">💾 Save Changes</button>
      </form>
    </div>

    <!-- Execution History -->
    <div class="section">
      <div class="section-title">Execution History</div>
      <ul class="history-list">
        ${executionHistoryHtml}
      </ul>
    </div>

    <!-- Edit History -->
    <div class="section">
      <div class="section-title">Edit History</div>
      <ul class="history-list">
        ${editHistoryHtml}
      </ul>
    </div>
  </div>

  <script>
    function copyCode() {
      const code = document.getElementById('scriptCode').textContent;
      navigator.clipboard.writeText(code).then(() => {
        const btn = document.querySelector('.btn-copy');
        const originalText = btn.textContent;
        btn.textContent = '✓ Copied!';
        setTimeout(() => {
          btn.textContent = originalText;
        }, 2000);
      });
    }
  </script>
</body>
</html>
      `);
    }

    // ---------------------------------------------------------
    // JSON MODE
    // ---------------------------------------------------------
    return res.json({ script, contributions });
  } catch (err) {
    console.error("Error fetching script:", err);

    if (
      err.message === "Node not found" ||
      err.message === "Script not found"
    ) {
      return res.status(404).json({ error: err.message });
    }

    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post(
  "/:nodeId/script/:scriptId/edit",
  authenticate,
  async (req, res) => {
    try {
      const { nodeId, scriptId } = req.params;
      const { name, script } = req.body;
      const userId = req.userId;

      await updateScript({
        nodeId,
        scriptId,
        name,
        script,
        userId,
      });
      const qs = filterQuery(req);

      return res.redirect(`/api/${nodeId}/script/${scriptId}?${qs}`);
    } catch (err) {
      console.error("Error editing script:", err);
      return res.status(500).send("Failed to update script");
    }
  },
);

router.post(
  "/:nodeId/script/:scriptId/execute",
  authenticate,
  async (req, res) => {
    try {
      const { nodeId, scriptId } = req.params;
      const userId = req.userId;

      await executeScript({ nodeId, scriptId, userId });

      const qs = filterQuery(req);
      return res.redirect(`/api/${nodeId}/script/${scriptId}?${qs}`);
    } catch (err) {
      console.error("Error executing script:", err);

      let qs = "";
      try {
        qs = filterQuery(req);
      } catch (e) {
        console.error("filterQuery failed:", e);
      }
      const { nodeId, scriptId } = req.params;

      return res.redirect(
        `/api/${nodeId}/script/${scriptId}?${qs}&error=${encodeURIComponent(
          err.message,
        )}`,
      );
    }
  },
);

router.get("/:nodeId/scripts/help", urlAuth, async (req, res) => {
  try {
    const { nodeId } = req.params;

    const node = await Node.findById(nodeId).lean();
    if (!node) {
      return res.status(404).json({ error: "Node not found" });
    }

    const data = {
      nodeProperties: {
        basic: [
          { property: "node._id", description: "Node ID (UUID)" },
          { property: "node.name", description: "Node name" },
          { property: "node.type", description: "Node type (nullable)" },
          {
            property: "node.prestige",
            description: "Highest version index (current generation)",
          },
        ],
        version: [
          {
            property: "node.versions[i].values",
            description: "Object mapping string keys to numeric values",
            example: '{ "health": 100, "gold": 50 }',
          },
          {
            property: "node.versions[i].goals",
            description: "Object mapping string keys to numeric goals",
            example: '{ "health": 200, "gold": 100 }',
          },
          {
            property: "node.versions[i].schedule",
            description: "Timestamp (ISO string) for scheduled execution",
          },
          {
            property: "node.versions[i].prestige",
            description: "Version number (generation index)",
          },
          {
            property: "node.versions[i].reeffectTime",
            description: "Repeat interval in hours for recurring scripts",
          },
          {
            property: "node.versions[i].status",
            description: 'Status: "active", "completed", or "trimmed"',
          },
          {
            property: "node.versions[i].dateCreated",
            description: "Creation timestamp for this version",
          },
        ],
        other: [
          {
            property: "node.scripts",
            description: "Array of scripts attached to this node",
            example: "[{ name, script }, ...]",
          },
          {
            property: "node.children",
            description: "Array of child node IDs (UUIDs)",
          },
          {
            property: "node.parent",
            description: "Parent node ID (UUID) or null if root",
          },
          {
            property: "node.rootOwner",
            description: "Root owner user ID (UUID) or null",
          },
        ],
      },
      builtInFunctions: [
        {
          name: "getApi()",
          description: "Fetches data from API with GET. Returns a promise.",
        },
        {
          name: "setValueForNode(nodeId, key, value, version)",
          description: "Sets a value in node.versions[version].values[key]",
        },
        {
          name: "setGoalForNode(nodeId, key, goal, version)",
          description: "Sets a goal in node.versions[version].goals[key]",
        },
        {
          name: "editStatusForNode(nodeId, status, version, isInherited)",
          description:
            'Updates status: "active", "completed", "trimmed". Can propagate to children.',
        },
        {
          name: "addPrestigeForNode(nodeId)",
          description: "Prestiges the node by one generation",
        },
        {
          name: "updateScheduleForNode(nodeId, versionIndex, newSchedule, reeffectTime)",
          description: "Sets schedule timestamp and repeat interval (hours)",
        },
      ],
      exampleScript: `// This script tapers a value over time
let waitTime = node.versions[node.prestige].values.waitTime;
const newWaitTime = waitTime * 1.05;

// Create a new version (prestige)
addPrestigeForNode(node._id);

// Schedule the script to run again after waitTime hours
const now = new Date();
const newSchedule = new Date(now.getTime() + waitTime * 3600 * 1000);
updateScheduleForNode(node._id, node.prestige + 1, newSchedule, 0);

// Update the waitTime value in the new version
setValueForNode(node._id, "waitTime", newWaitTime, node.prestige + 1);`,
      importantNote:
        "The node object does not auto-update during script execution. Be careful using it after transactions unless you manually refresh it.",
    };

    // ---------------------------------------------------------
    // HTML MODE
    // ---------------------------------------------------------
    if ("html" in req.query) {
      const qs = filterQuery(req);
      const qsWithQ = qs ? `?${qs}` : "";

      return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Script Help — ${node.name}</title>
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
      max-width: 1100px;
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

    /* Header */
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

    .header::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 4px;
      background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
    }

    .header h1 {
      font-size: 28px;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 8px;
    }

    .header h1::before {
      content: '📚 ';
      font-size: 26px;
    }

    .header-subtitle {
      font-size: 14px;
      color: #888;
    }

    /* Section */
    .section {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 28px;
      margin-bottom: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
      position: relative;
      overflow: hidden;
    }

    .section::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 4px;
      background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
    }

    .section-title {
      font-size: 20px;
      font-weight: 600;
      color: #1a1a1a;
      margin-bottom: 16px;
    }

    .section-description {
      font-size: 14px;
      color: #666;
      line-height: 1.6;
      margin-bottom: 16px;
      padding: 12px;
      background: #f8f9fa;
      border-radius: 8px;
      border-left: 3px solid #667eea;
    }

    /* Tables */
    table {
      width: 100%;
      border-collapse: collapse;
      background: white;
      border-radius: 8px;
      overflow: hidden;
    }

    thead {
      background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
    }

    th {
      padding: 14px 16px;
      text-align: left;
      font-weight: 600;
      color: #667eea;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 2px solid #e9ecef;
    }

    td {
      padding: 14px 16px;
      border-bottom: 1px solid #e9ecef;
      font-size: 14px;
      line-height: 1.6;
      vertical-align: top;
    }

    tbody tr:last-child td {
      border-bottom: none;
    }

    tbody tr {
      transition: background 0.2s;
    }

    tbody tr:hover {
      background: rgba(102, 126, 234, 0.03);
    }

    code {
      background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 13px;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', Consolas, monospace;
      color: #667eea;
      font-weight: 600;
    }

    pre {
      background: #1e1e1e;
      color: #d4d4d4;
      padding: 20px;
      border-radius: 12px;
      overflow-x: auto;
      font-size: 14px;
      line-height: 1.6;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', Consolas, monospace;
      border: 1px solid rgba(255, 255, 255, 0.1);
      margin-top: 12px;
    }

    pre code {
      background: none;
      padding: 0;
      color: inherit;
      font-weight: normal;
    }

    /* Info Box */
    .info-box {
      background: linear-gradient(135deg, rgba(255, 193, 7, 0.1) 0%, rgba(255, 152, 0, 0.1) 100%);
      padding: 16px;
      border-radius: 10px;
      border-left: 4px solid #ffa500;
      margin-bottom: 16px;
    }

    .info-box-title {
      font-weight: 600;
      color: #f57c00;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .info-box-title::before {
      content: '⚠️';
      font-size: 16px;
    }

    .info-box-content {
      font-size: 14px;
      color: #666;
      line-height: 1.6;
    }

    /* Example Box */
    .example-box {
      margin-top: 12px;
    }

    .example-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .example-label {
      font-size: 14px;
      font-weight: 600;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .btn-copy {
      padding: 6px 12px;
      background: rgba(102, 126, 234, 0.1);
      border: 1px solid rgba(102, 126, 234, 0.2);
      border-radius: 6px;
      color: #667eea;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-copy:hover {
      background: rgba(102, 126, 234, 0.2);
      transform: translateY(-2px);
    }

    /* Quick Nav */
    .quick-nav {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
      margin-bottom: 24px;
    }

    .quick-nav-item {
      padding: 12px 16px;
      background: white;
      border: 1px solid #e9ecef;
      border-radius: 8px;
      color: #667eea;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.2s;
      text-align: center;
    }

    .quick-nav-item:hover {
      background: #667eea;
      color: white;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.2);
    }

    /* Responsive */
    @media (max-width: 640px) {
      body {
        padding: 16px;
      }

      .header,
      .section {
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

      table {
        font-size: 13px;
      }

      th, td {
        padding: 10px;
      }

      pre {
        font-size: 12px;
        padding: 16px;
      }

      .quick-nav {
        grid-template-columns: 1fr;
      }
    }

    @media (min-width: 641px) and (max-width: 1024px) {
      .container {
        max-width: 900px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="/api/${nodeId}${qsWithQ}" class="back-link">
  ← Back to Node
</a>
    </div>

    <!-- Header -->
    <div class="header">
      <h1>Script Help</h1>
      <div class="header-subtitle">Learn how to write scripts for your nodes</div>
    </div>

    <!-- Quick Navigation -->
    <div class="section">
      <div class="section-title">Quick Jump</div>
      <div class="quick-nav">
        <a href="#node-data" class="quick-nav-item">Node Data</a>
        <a href="#version-properties" class="quick-nav-item">Version Properties</a>
        <a href="#other-properties" class="quick-nav-item">Other Properties</a>
        <a href="#functions" class="quick-nav-item">Built-in Functions</a>
        <a href="#example" class="quick-nav-item">Example Script</a>
      </div>
    </div>

    <!-- Node Data -->
    <div class="section" id="node-data">
      <div class="section-title">Accessing Node Data</div>
      
      <div class="info-box">
        <div class="info-box-title">Important</div>
        <div class="info-box-content">
          ${data.importantNote}
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Property</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          ${data.nodeProperties.basic
            .map(
              (item) => `
            <tr>
              <td><code>${item.property}</code></td>
              <td>${item.description}</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </div>

    <!-- Version Properties -->
    <div class="section" id="version-properties">
      <div class="section-title">Version Properties</div>
      
      <div class="section-description">
        Access version data using index <code>i</code>. Use <code>0</code> for the first version, 
        or <code>node.prestige</code> for the latest version.
      </div>

      <table>
        <thead>
          <tr>
            <th>Property</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          ${data.nodeProperties.version
            .map(
              (item) => `
            <tr>
              <td><code>${item.property}</code></td>
              <td>${item.description}${
                item.example ? `: <code>${item.example}</code>` : ""
              }</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </div>

    <!-- Other Properties -->
    <div class="section" id="other-properties">
      <div class="section-title">Other Node Properties</div>

      <table>
        <thead>
          <tr>
            <th>Property</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          ${data.nodeProperties.other
            .map(
              (item) => `
            <tr>
              <td><code>${item.property}</code></td>
              <td>${item.description}${
                item.example ? `: <code>${item.example}</code>` : ""
              }</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </div>

    <!-- Built-in Functions -->
    <div class="section" id="functions">
      <div class="section-title">Built-in Functions</div>
      
      <div class="section-description">
        These functions are available globally in all scripts and provide access to node operations.
      </div>

      <table>
        <thead>
          <tr>
            <th style="width: 40%;">Function</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          ${data.builtInFunctions
            .map(
              (fn) => `
            <tr>
              <td><code>${fn.name}</code></td>
              <td>${fn.description}</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </div>

    <!-- Example Script -->
    <div class="section" id="example">
      <div class="section-title">Example Script</div>
      
      <div class="section-description">
        This example demonstrates a script that tapers a value over time by increasing it by 5% 
        each time it runs, then schedules itself to run again.
      </div>

      <div class="example-box">
        <div class="example-header">
          <div class="example-label">Tapering Script</div>
          <button class="btn-copy" onclick="copyExample()">📋 Copy</button>
        </div>
        <pre id="exampleCode">${data.exampleScript}</pre>
      </div>
    </div>
  </div>

  <script>
    function copyExample() {
      const code = document.getElementById('exampleCode').textContent;
      navigator.clipboard.writeText(code).then(() => {
        const btn = document.querySelector('.btn-copy');
        const originalText = btn.textContent;
        btn.textContent = '✓ Copied!';
        setTimeout(() => {
          btn.textContent = originalText;
        }, 2000);
      });
    }

    // Smooth scroll for quick nav
    document.querySelectorAll('.quick-nav-item').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const target = document.querySelector(link.getAttribute('href'));
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  </script>
</body>
</html>
      `);
    }

    // ---------------------------------------------------------
    // JSON MODE
    // ---------------------------------------------------------
    return res.json(data);
  } catch (err) {
    console.error("Error loading script help:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:nodeId/script/create", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { name } = req.body;
    const userId = req.userId;

    if (!name) {
      return res.status(400).send("Script name is required");
    }

    const result = await updateScript({
      nodeId,
      name,
      userId,
    });

    const qs = filterQuery(req);

    return res.redirect(`/api/${nodeId}/script/${result.scriptId}?${qs}`);
  } catch (err) {
    console.error("Create script error:", err);
    return res.status(500).send("Failed to create script");
  }
});

export default router;
