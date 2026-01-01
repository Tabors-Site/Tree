import express from "express";
import urlAuth from "../middleware/urlAuth.js";
import authenticate from "../middleware/authenticate.js";
import { createNewNode, editNodeName } from "../core/treeManagement.js";
import {
  updateParentRelationship,
  deleteNodeBranch,
} from "../core/treeManagement.js";

import { editStatus, addPrestige } from "../core/statuses.js";
import { updateSchedule } from "../core/schedules.js";

import Node from "../db/models/node.js";

const router = express.Router();

import getNodeName from "./helpers/getNameById.js";

// Allowed query params for HTML mode
const allowedParams = ["token", "html"];

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
        `/api/${nodeId}/${version}?token=${req.query.token ?? ""}&html`
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
        `/api/${nodeId}/${nextVersion}?token=${req.query.token ?? ""}&html`
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
      const host = `https://${req.get("host")}`;

      // Versions
      const versionHtml = `
  <ul>
    ${[...node.versions]
      .reverse()
      .map(
        (_, i, arr) =>
          `<li><a href="${host}/api/${nodeId}/${arr.length - 1 - i}${qs}">
            Version ${arr.length - 1 - i}
          </a></li>`
      )
      .join("")}
  </ul>
`;

      // Scripts
      const scriptsHtml =
        node.scripts && node.scripts.length
          ? node.scripts
              .map(
                (s) => `
          <li>
            <strong>${s.name}</strong>
            <pre>${s.script}</pre>
          </li>`
              )
              .join("")
          : `<li><em>No scripts</em></li>`;

      const parentName = node.parent
        ? (await Node.findById(node.parent, "name").lean())?.name
        : null;
      // Parent link
      const parentHtml = node.parent
        ? `<a href="${host}/api/${node.parent}${qs}">${parentName}</a>`
        : `<em>None</em>`;

      const children = await Node.find({ _id: { $in: node.children } })
        .select("name _id")
        .lean();

      const childrenHtml =
        node.children && node.children.length
          ? node.children
              .map((c) => {
                const child = children.find((child) => child._id === c);
                const name = child ? child.name : c; // fallback to raw ID if missing

                return `<li><a href="${host}/api/${c}${qs}">${name}</a></li>`;
              })
              .join("")
          : `<li><em>No children</em></li>`;

      // ---------------------------------------------------------
      // NEW: Root View button
      // ---------------------------------------------------------
      const rootUrl = `${host}/api/root/${nodeId}${qs}`;

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
              `<li><a href="${host}/api/${nodeId}/${arr.length - 1 - i}${qs}">
                Version ${arr.length - 1 - i}
              </a></li>`
          )
          .join("")}
      </ul>
    </div>

    <!-- Scripts Section -->
    <div class="scripts-section">
      <h2>Scripts</h2>
      <ul class="scripts-list">
        ${
          node.scripts && node.scripts.length
            ? node.scripts
                .map(
                  (s) => `
            <li>
              <strong>${s.name}</strong>
              <pre>${s.script}</pre>
            </li>`
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
          ? `<a href="${host}/api/${node.parent}${qs}">${parentName}</a>`
          : `<em>None (This is a root node)</em>`
      }</p>

      <h3>Change Parent</h3>
      <form
        method="POST"
        action="${host}/api/${nodeId}/updateParent${qs}"
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
                  return `<li><a href="${host}/api/${c}${qs}">${name}</a></li>`;
                })
                .join("")
            : `<li><em>No children yet</em></li>`
        }
      </ul>

      <h3>Add Child</h3>
      <form
        method="POST"
        action="${host}/api/${nodeId}/createChild${qs}"
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
        action="${host}/api/${nodeId}/delete${qs}"
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

    const statusButtonsHtml = ALL_STATUSES.filter((s) => s !== data.status)
      .map(
        (s) => `
      <button
        type="submit"
        name="status"
        value="${s}"
        style="padding:8px 12px;margin-right:6px;"
      >
        ${STATUS_LABELS[s]}
      </button>
    `
      )
      .join("");

    const showPrestige = v === node.prestige;

    // ----------------------------
    // HTML BROWSER MODE
    // ----------------------------
    if (req.query.html !== undefined) {
      const queryString = filterQuery(req);
      const qs = queryString ? `?${queryString}` : "";

      const backUrl = `${req.protocol}://${req.get("host")}/api/${nodeId}${qs}`;
      const backTreeUrl = `${req.protocol}://${req.get(
        "host"
      )}/api/root/${nodeId}${qs}`;
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

    .version-badge {
      display: inline-block;
      padding: 6px 14px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 600;
      margin-top: 8px;
    }

    .node-id-container {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 12px;
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

    /* Metadata Cards */
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }

    .meta-card {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 12px;
      padding: 16px 20px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
    }

    .meta-label {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #888;
      margin-bottom: 6px;
    }

    .meta-value {
      font-size: 15px;
      font-weight: 600;
      color: #1a1a1a;
    }

    .status-badge {
      display: inline-block;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      text-transform: capitalize;
    }

    .status-active {
      background: #e3f2fd;
      color: #1976d2;
    }

    .status-completed {
      background: #e8f5e9;
      color: #388e3c;
    }

    .status-trimmed {
      background: #fff3e0;
      color: #f57c00;
    }

    /* Navigation Links */
    .nav-section {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .nav-section h2 {
      font-size: 18px;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 16px;
    }

    .nav-links {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
    }

    .nav-links a {
      display: block;
      padding: 14px 18px;
      background: #f8f9fa;
      border-radius: 10px;
      color: #667eea;
      text-decoration: none;
      font-weight: 600;
      font-size: 15px;
      transition: all 0.2s;
      border: 1px solid transparent;
      text-align: center;
    }

    .nav-links a:hover {
      background: white;
      border-color: #667eea;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.2);
    }

    /* Actions Section */
    .actions-section {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .actions-section h3 {
      font-size: 16px;
      font-weight: 600;
      color: #1a1a1a;
      margin-bottom: 16px;
    }

    .action-form {
      margin-bottom: 24px;
    }

    .action-form:last-child {
      margin-bottom: 0;
    }

    .button-group {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    button[type="submit"] {
      padding: 12px 20px;
      border: none;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      font-family: inherit;
    }

    .status-button {
      background: white;
      color: #667eea;
      border: 2px solid #667eea !important;
    }

    .status-button:hover {
      background: #667eea;
      color: white;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
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

    /* Responsive Design */
    @media (max-width: 640px) {
      body {
        padding: 16px;
      }

      .header,
      .nav-section,
      .actions-section {
        padding: 20px;
      }

      .header h1 {
        font-size: 24px;
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

      .back-nav {
        flex-direction: column;
      }

      .back-link {
        justify-content: center;
      }
    }

    @media (min-width: 641px) and (max-width: 1024px) {
      .container {
        max-width: 700px;
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

    <!-- Actions Section -->
    <div class="actions-section">
      <h3>Change Status</h3>
      <form
        method="POST"
        action="https://${req.get(
          "host"
        )}/api/${nodeId}/${version}/editStatus${qs}"
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
          `
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
          action="https://${req.get(
            "host"
          )}/api/${nodeId}/${version}/prestige${qs}"
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
      null // note
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
        `/api/user/${userId}/deleted?token=${req.query.token ?? ""}&html`
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
          `/api/${nodeId}/${version}?token=${req.query.token ?? ""}&html`
        );
      }

      res.json({ success: true, ...result });
    } catch (err) {
      console.error("editSchedule error:", err);
      res.status(err.status || 400).json({ error: err.message });
    }
  }
);

export default router;
