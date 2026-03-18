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

router.post("/node/:nodeId/:version/editStatus", authenticate, async (req, res) => {
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
        `/api/v1/node/${nodeId}/${version}?token=${req.query.token ?? ""}&html`,
      );
    }

    res.json({ success: true, ...result });
  } catch (err) {
    console.error("editStatus error:", err);
    res.status(400).json({ error: err.message });
  }
});

router.post("/node/:nodeId/:version/prestige", authenticate, async (req, res) => {
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
        `/api/v1/node/${nodeId}/${nextVersion}?token=${req.query.token ?? ""}&html`,
      );
    }

    res.json({ success: true, ...result });
  } catch (err) {
    console.error("prestige error:", err);
    res.status(400).json({ error: err.message });
  }
});

router.post("/node/:nodeId/updateParent", authenticate, async (req, res) => {
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
      return res.redirect(`/api/v1/node/${nodeId}?token=${req.query.token ?? ""}&html`);
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
// GET /api/v1/node/:nodeId
// Returns the node + all versions (no notes)
// Supports JSON or ?html mode
// Shows full node data, parent + children clickable
// -----------------------------------------------------------------------------
router.get("/node/:nodeId", urlAuth, async (req, res) => {
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

    const children = await Node.find({ _id: { $in: node.children } })
      .select("name _id status")
      .lean();
    node.children = children;

    // ---------------------------------------------------------
    // HTML MODE
    // ---------------------------------------------------------
    if (req.query.html !== undefined) {
      const parentName = node.parent
        ? (await Node.findById(node.parent, "name").lean())?.name
        : null;

      // ---------------------------------------------------------
      // NEW: Root View button
      // ---------------------------------------------------------
      const rootUrl = `/api/v1/root/${nodeId}${qs}`;

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
    /* =========================================================
   GLOBAL VARIABLES — matches root route
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

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
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
.versions-list a,
.children-list a,
button[type="submit"],
.primary-button,
.warning-button,
.danger-button {
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
.versions-list a::before,
.children-list a::before,
button[type="submit"]::before,
.primary-button::before,
.warning-button::before,
.danger-button::before {
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
.versions-list a:hover,
.children-list a:hover,
button[type="submit"]:hover,
.primary-button:hover,
.warning-button:hover,
.danger-button:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-2px);
}

.glass-btn:hover::before,
button:hover::before,
.action-button:hover::before,
.back-link:hover::before,
.versions-list a:hover::before,
.children-list a:hover::before,
button[type="submit"]:hover::before,
.primary-button:hover::before,
.warning-button:hover::before,
.danger-button:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

/* Active press */
.glass-btn:active,
button:active,
.primary-button:active,
.warning-button:active,
.danger-button:active {
  background: rgba(var(--glass-water-rgb), 0.45);
  transform: translateY(0);
}

/* Emphasis variants */
.primary-button {
  --glass-water-rgb: 72, 187, 178;
  --glass-alpha: 0.34;
  --glass-alpha-hover: 0.46;
  font-weight: 600;
}

.warning-button {
  --glass-water-rgb: 100, 116, 139;
  font-weight: 600;
}

.danger-button {
  --glass-water-rgb: 198, 40, 40;
  font-weight: 600;
}

/* =========================================================
   CONTENT CARDS - UPDATED TO MATCH ROOT ROUTE
   ========================================================= */

.header,
.hierarchy-section,
.versions-section,
.scripts-section,
.actions-section {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 28px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  margin-bottom: 24px;
  animation: fadeInUp 0.6s ease-out;
  animation-fill-mode: both;
  position: relative;
  overflow: hidden;
}

.header {
  animation-delay: 0.1s;
}

.versions-section {
  animation-delay: 0.15s;
}

.hierarchy-section {
  animation-delay: 0.2s;
}

.scripts-section {
  animation-delay: 0.25s;
}

.actions-section {
  animation-delay: 0.3s;
}

.header::before,
.hierarchy-section::before,
.versions-section::before,
.scripts-section::before,
.actions-section::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.18),
    rgba(255, 255, 255, 0.05)
  );
  pointer-events: none;
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
  color: white;
}

.hierarchy-section h2,
.versions-section h2,
.scripts-section h2,
.actions-section h3 {
  font-size: 18px;
  font-weight: 600;
  color: white;
  margin-bottom: 16px;
  letter-spacing: -0.3px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.hierarchy-section h3 {
  font-size: 16px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  margin: 24px 0 12px 0;
}

/* =========================================================
   NAV + META
   ========================================================= */

.back-nav {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
  animation: fadeInUp 0.5s ease-out;
}

.node-id-container {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.15);
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
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.3);
  cursor: pointer;
  padding: 6px 10px;
  border-radius: 6px;
  opacity: 1;
  font-size: 16px;
  transition: all 0.2s;
  flex-shrink: 0;
}

#copyNodeIdBtn:hover {
  background: rgba(255, 255, 255, 0.3);
  transform: scale(1.1);
}

#copyNodeIdBtn::before {
  display: none;
}

.meta-row {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.2);
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

/* =========================================================
   LISTS
   ========================================================= */

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
  text-align: center;
}

.children-list {
  list-style: none;
  margin-bottom: 20px;
}

.children-list li {
  margin: 0 0 8px 0;
}

.children-list a {
  display: block;
  padding: 12px 16px;
}

.hierarchy-section a {
  color: white;
  text-decoration: none;
  font-weight: 600;
  transition: opacity 0.2s;
}

.hierarchy-section a:hover {
  opacity: 0.8;
}

.hierarchy-section em {
  color: rgba(255, 255, 255, 0.7);
  font-style: normal;
}

.hierarchy-section > p {
  margin-bottom: 16px;
}

/* =========================================================
   SCRIPTS
   ========================================================= */

.scripts-list {
  list-style: none;
}

.scripts-list li {
  margin-bottom: 16px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.scripts-list li:last-child {
  margin-bottom: 0;
}

.scripts-list a {
  color: white;
  text-decoration: none;
  display: block;
}

.scripts-list a:hover {
  opacity: 0.9;
}

.scripts-list strong {
  display: block;
  margin-bottom: 8px;
  color: white;
  font-size: 15px;
}

.scripts-list pre {
  background: rgba(0, 0, 0, 0.3);
  color: #e0e0e0;
  padding: 14px;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.5;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.scripts-list em {
  color: rgba(255, 255, 255, 0.6);
  font-style: normal;
}

.scripts-section h2 a {
  color: white;
  text-decoration: none;
}

.scripts-section h2 a:hover {
  opacity: 0.8;
}

/* =========================================================
   FORMS
   ========================================================= */

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
  padding: 12px 14px;
  font-size: 15px;
  border-radius: 10px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.15);
  color: white;
  font-family: inherit;
  font-weight: 500;
  transition: all 0.2s;
}

.action-form input[type="text"]::placeholder {
  color: rgba(255, 255, 255, 0.5);
}

.action-form input[type="text"]:focus {
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
  body {
    padding: 16px;
  }

  .container {
    max-width: 100%;
  }

  .header,
  .hierarchy-section,
  .versions-section,
  .scripts-section,
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

  .meta-row {
    flex-direction: column;
    gap: 12px;
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
}

@media (min-width: 641px) and (max-width: 1024px) {
  .container {
    max-width: 700px;
  }

  .versions-list {
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
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
              `<li><a href="/api/v1/node/${nodeId}/${arr.length - 1 - i}${qs}">Version ${arr.length - 1 - i}</a></li>`,
          )
          .join("")}
      </ul>
      <form
        method="POST"
        action="/api/v1/node/${nodeId}/${node.prestige}/prestige${qs}"
        onsubmit="return confirm('This will complete the current version and create a new prestige level. Continue?')"
        style="margin-top: 16px;"
      >
        <button type="submit" class="primary-button">
          Add New Version
        </button>
      </form>
    </div>

    <!-- Parent Section -->
    <div class="hierarchy-section">
      <h2>Parent</h2>
      ${
        node.parent
          ? `<a href="/api/v1/node/${node.parent}${qs}" style="display:block;padding:12px 16px;margin-bottom:16px;">${parentName}</a>`
          : `<p style="margin-bottom:16px;"><em>None (This is a root node)</em></p>`
      }

      <h3>Change Parent</h3>
      <form
        method="POST"
        action="/api/v1/node/${nodeId}/updateParent${qs}"
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
    </div>

    <!-- Children Section -->
    <div class="hierarchy-section">
      <h2>Children</h2>
      <ul class="children-list">
        ${
          node.children && node.children.length
            ? node.children
                .map((c) => `<li><a href="/api/v1/node/${c._id}${qs}">${c.name}</a></li>`)
                .join("")
            : `<li><em>No children yet</em></li>`
        }
      </ul>

      <h3>Add Child</h3>
      <form
        method="POST"
        action="/api/v1/node/${nodeId}/createChild${qs}"
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

    <!-- Scripts Section -->
    <div class="scripts-section">
      <h2><a href="/api/v1/node/${node._id}/scripts/help${qs}">Scripts</a></h2>
      <form
        method="POST"
        action="/api/v1/node/${nodeId}/script/create${qs}"
        style="display:flex;gap:8px;align-items:center;margin-bottom:16px;"
      >
        <input
          type="text"
          name="name"
          placeholder="New script name"
          required
          style="
            padding:12px 16px;
            border-radius:10px;
            border:1px solid rgba(255,255,255,0.3);
            background:rgba(255,255,255,0.2);
            color:white;
            font-size:15px;
            min-width:200px;
            flex:1;
          "
        />
        <button
          type="submit"
          class="primary-button"
          title="Create script"
          style="padding:10px 18px;font-size:16px;"
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
            <a href="/api/v1/node/${node._id}/script/${s._id}${qs}">
              <li>
                <strong>${s.name}</strong>
                <pre>${s.script}</pre>
              </li>
            </a>`,
                )
                .join("")
            : `<li><em>No scripts defined</em></li>`
        }
      </ul>
    </div>

    <!-- Delete Section -->
    <div class="actions-section">
      <h3>Delete</h3>
      <form
        method="POST"
        action="/api/v1/node/${nodeId}/delete${qs}"
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
// GET /api/v1/node/:nodeId/:version
// Returns a single version (includes Notes link)
// Supports JSON or ?html mode
// -----------------------------------------------------------------------------
router.get("/node/:nodeId/:version", urlAuth, async (req, res) => {
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

      const backUrl = `/api/v1/node/${nodeId}${qs}`;
      const backTreeUrl = `/api/v1/root/${nodeId}${qs}`;

      const createdDate = data.dateCreated
        ? new Date(data.dateCreated).toLocaleString()
        : "Unknown";

      const scheduleHtml = data.schedule
        ? new Date(data.schedule).toLocaleString()
        : "None";

      const reeffectTime =
        data.reeffectTime !== undefined ? data.reeffectTime : "<em>None</em>";

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
   GLOBAL VARIABLES — matches root route
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

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
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
  font-weight: 600;
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
  transform: translateY(-2px);
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
}

/* Emphasis variants */
.primary-button {
  --glass-water-rgb: 72, 187, 178;
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
   CONTENT CARDS - UPDATED TO MATCH ROOT ROUTE
   ========================================================= */

.header,
.nav-section,
.actions-section {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 28px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  margin-bottom: 24px;
  animation: fadeInUp 0.6s ease-out;
  animation-fill-mode: both;
  position: relative;
  overflow: hidden;
}

.header {
  animation-delay: 0.1s;
}

.nav-section {
  animation-delay: 0.15s;
}

.actions-section {
  animation-delay: 0.2s;
}

.header::before,
.nav-section::before,
.actions-section::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.18),
    rgba(255, 255, 255, 0.05)
  );
  pointer-events: none;
}

.meta-card {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 12px;
  padding: 16px 20px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: white;
  animation: fadeInUp 0.6s ease-out;
  animation-fill-mode: both;
  position: relative;
  overflow: hidden;
}

.meta-card::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.18),
    rgba(255, 255, 255, 0.05)
  );
  pointer-events: none;
}

/* Stagger meta-card animations */
.meta-card:nth-child(1) { animation-delay: 0.2s; }
.meta-card:nth-child(2) { animation-delay: 0.25s; }

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
  animation: fadeInUp 0.5s ease-out;
}

.version-badge {
  display: inline-block;
  padding: 6px 14px;
  background: rgba(16, 185, 129, 0.25);
  backdrop-filter: blur(10px);
  color: white;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 600;
  margin-top: 8px;
  border: 1px solid rgba(16, 185, 129, 0.4);
  position: relative;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
}

/* Version badge colors matching status */
.version-badge.version-status-active {
  background: rgba(16, 185, 129, 0.25);
  border: 1px solid rgba(16, 185, 129, 0.4);
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
}

.version-badge.version-status-completed {
  background: rgba(139, 92, 246, 0.25);
  border: 1px solid rgba(139, 92, 246, 0.4);
  box-shadow: 0 4px 12px rgba(139, 92, 246, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
}

.version-badge.version-status-trimmed {
  background: rgba(220, 38, 38, 0.25);
  border: 1px solid rgba(220, 38, 38, 0.4);
  box-shadow: 0 4px 12px rgba(220, 38, 38, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
}

.version-badge::after {
  content: "";
  position: absolute;
  inset: 0;

  background: linear-gradient(
    100deg,
    transparent 40%,
    rgba(255, 255, 255, 0.5),
    transparent 60%
  );

  opacity: 0;
  transform: translateX(-100%);
  transition: transform 0.8s ease, opacity 0.3s ease;

  animation: openAppHoverShimmerClone 1.6s ease forwards;
  animation-delay: 0.5s;

  pointer-events: none;
}

@keyframes openAppHoverShimmerClone {
  0% {
    opacity: 0;
    transform: translateX(-100%);
  }

  100% {
    opacity: 1;
    transform: translateX(100%);
  }
}

.created-date {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
  margin-top: 10px;
  font-weight: 500;
}

.node-id-container {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  width: 100%;
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
  min-width: 0;
  overflow-wrap: break-word;
}

#copyNodeIdBtn {
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.3);
  cursor: pointer;
  padding: 6px 10px;
  border-radius: 6px;
  opacity: 1;
  font-size: 16px;
  transition: all 0.2s;
  flex-shrink: 0;
}

#copyNodeIdBtn:hover {
  background: rgba(255, 255, 255, 0.3);
  transform: scale(1.1);
}

#copyNodeIdBtn::before {
  display: none;
}

.meta-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
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
  word-break: break-word;
  overflow-wrap: break-word;
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

/* Official status colors with glass effect - UPDATED COLORS */
.status-badge.status-active {
  background: rgba(16, 185, 129, 0.35);
  border: 1px solid rgba(16, 185, 129, 0.5);
  backdrop-filter: blur(10px);
  box-shadow: 0 0 12px rgba(16, 185, 129, 0.2);
}

.status-badge.status-completed {
  background: rgba(139, 92, 246, 0.35);
  border: 1px solid rgba(139, 92, 246, 0.5);
  backdrop-filter: blur(10px);
  box-shadow: 0 0 12px rgba(139, 92, 246, 0.2);
}

.status-badge.status-trimmed {
  background: rgba(220, 38, 38, 0.35);
  border: 1px solid rgba(220, 38, 38, 0.5);
  backdrop-filter: blur(10px);
  box-shadow: 0 0 12px rgba(220, 38, 38, 0.2);
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
   STATUS CARD WITH BUTTONS - UPDATED COLORS
   ========================================================= */

.status-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 12px;
}

.status-controls button {
  padding: 8px 16px;
  font-size: 13px;
  position: relative;
}

/* Faint glass colors for status buttons - UPDATED */
.status-controls button[value="active"] {
  --glass-water-rgb: 16, 185, 129; /* green */
  --glass-alpha: 0.15;
  --glass-alpha-hover: 0.25;
}

.status-controls button[value="completed"] {
  --glass-water-rgb: 139, 92, 246; /* purple */
  --glass-alpha: 0.15;
  --glass-alpha-hover: 0.25;
}

.status-controls button[value="trimmed"] {
  --glass-water-rgb: 220, 38, 38; /* red */
  --glass-alpha: 0.15;
  --glass-alpha-hover: 0.25;
}

/* =========================================================
   SCHEDULE CARD
   ========================================================= */

.schedule-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.schedule-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
}

.schedule-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.schedule-text .meta-value {
  word-break: break-word;
  overflow-wrap: break-word;
}

.repeat-text {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
  margin-top: 6px;
}

#editScheduleBtn {
  flex-shrink: 0;
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
  backdrop-filter: blur(8px);
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

#scheduleModal > div {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  padding: 28px;
  border-radius: 16px;
  width: 320px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  position: relative;
  overflow: hidden;
}

#scheduleModal > div::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.18),
    rgba(255, 255, 255, 0.05)
  );
  pointer-events: none;
}

#scheduleModal label {
  display: block;
  margin-bottom: 12px;
  color: white;
  font-weight: 600;
  font-size: 14px;
  letter-spacing: -0.2px;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  position: relative;
}

#scheduleModal input {
  width: 100%;
  margin-top: 6px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.15);
  font-size: 15px;
  font-family: inherit;
  font-weight: 500;
  transition: all 0.2s;
  color: white;
  position: relative;
}

#scheduleModal input::placeholder {
  color: rgba(255, 255, 255, 0.5);
}

#scheduleModal input:focus {
  outline: none;
  border-color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.25);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.15);
  transform: translateY(-2px);
}

#scheduleModal button {
  padding: 10px 18px;
  border-radius: 980px;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.2s;
  border: 1px solid rgba(255, 255, 255, 0.28);
  position: relative;
}

#scheduleModal button[type="button"] {
  background: rgba(255, 255, 255, 0.15);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.28) !important;
  box-shadow: none !important;
}

#scheduleModal button[type="button"]:hover {
  background: rgba(255, 255, 255, 0.25);
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
    gap: 12px;
  }

  .meta-card {
    padding: 14px 16px;
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

  .status-controls {
    flex-direction: column;
    align-items: stretch;
  }

  .status-controls button {
    width: 100%;
  }

  code {
    font-size: 12px;
    word-break: break-all;
  }

  .schedule-row {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }

  #editScheduleBtn {
    width: 100%;
    justify-content: center;
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

  .meta-grid {
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
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
      <span class="version-badge version-status-${data.status}">Version ${version}</span>
      
      <div class="created-date">Created: ${createdDate}</div>

      <div class="node-id-container">
        <code id="nodeIdCode">${node._id}</code>
        <button id="copyNodeIdBtn" title="Copy ID">📋</button>
      </div>
    </div>

    <!-- Navigation Links -->
    <div class="nav-section">
      <h2>Quick Access</h2>
      <div class="nav-links">
        <a href="/api/v1/node/${nodeId}/${version}/notes${qs}">Notes</a>
        <a href="/api/v1/node/${nodeId}/${version}/values${qs}">Values / Goals</a>
        <a href="/api/v1/node/${nodeId}/${version}/contributions${qs}">Contributions</a>
        <a href="/api/v1/node/${nodeId}/${version}/transactions${qs}">Transactions</a>
      </div>
    </div>

    <!-- Metadata Grid -->
    <div class="meta-grid">
      <!-- Status Card with Controls -->
      <div class="meta-card">
        <div class="meta-label">Status</div>
        <div class="meta-value">
          <span class="status-badge status-${data.status}">${data.status}</span>
        </div>
        <form
          method="POST"
          action="/api/v1/node/${nodeId}/${version}/editStatus${qs}"
          onsubmit="return confirm('This will apply to all children. Is that ok?')"
          class="status-controls"
        >
          <input type="hidden" name="isInherited" value="true" />
          ${ALL_STATUSES.filter((s) => s !== data.status)
            .map(
              (s) => `
            <button type="submit" name="status" value="${s}" class="status-button">
              ${STATUS_LABELS[s]}
            </button>
          `,
            )
            .join("")}
        </form>
      </div>

      <!-- Schedule + Repeat Hours Card -->
      <div class="meta-card">
        <div class="meta-label">Schedule</div>
        <div class="schedule-info">
          <div class="schedule-row">
            <div class="schedule-text">
              <div class="meta-value">${scheduleHtml}</div>
              <div class="repeat-text">Repeat: ${reeffectTime} hours</div>
            </div>
            <button id="editScheduleBtn" style="padding:8px 12px;">✏️</button>
          </div>
        </div>
      </div>
    </div>

    ${
      showPrestige
        ? `
    <!-- Version Control Section -->
    <div class="actions-section">
      <h3>Version Control</h3>
      <form
        method="POST"
        action="/api/v1/node/${nodeId}/${version}/prestige${qs}"
        onsubmit="return confirm('This will complete the current version and create a new prestige level. Continue?')"
        class="action-form"
      >
        <button type="submit" class="primary-button">
          Add New Version
        </button>
      </form>
    </div>
    `
        : ""
    }
  </div>

  <!-- Schedule Modal -->
  <div id="scheduleModal">
    <div>
      <form
        method="POST"
        action="/api/v1/node/${nodeId}/${version}/editSchedule${qs}"
      >
        <label>
          TIME
          <input
            type="datetime-local"
            name="newSchedule"
            value="${
              data.schedule
                ? new Date(data.schedule).toISOString().slice(0, 16)
                : ""
            }"
          />
        </label>

        <label>
          REPEAT HOURS
          <input
            type="number"
            name="reeffectTime"
            min="0"
            value="${data.reeffectTime ?? 0}"
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

    // Schedule modal
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
router.post("/node/:nodeId/createChild", authenticate, async (req, res) => {
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
      return res.redirect(`/api/v1/node/${nodeId}?token=${req.query.token ?? ""}&html`);
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

router.post("/node/:nodeId/delete", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const userId = req.userId;

    const deletedNode = await deleteNodeBranch(nodeId, userId);

    if ("html" in req.query) {
      return res.redirect(
        `/api/v1/user/${userId}/deleted?token=${req.query.token ?? ""}&html`,
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

router.post("/node/:nodeId/:version/editName", authenticate, async (req, res) => {
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
      return res.redirect(`/api/v1/node/${nodeId}?token=${req.query.token ?? ""}&html`);
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
  "/node/:nodeId/:version/editSchedule",
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
          `/api/v1/node/${nodeId}/${version}?token=${req.query.token ?? ""}&html`,
        );
      }

      res.json({ success: true, ...result });
    } catch (err) {
      console.error("editSchedule error:", err);
      res.status(err.status || 400).json({ error: err.message });
    }
  },
);

router.get("/node/:nodeId/script/:scriptId", urlAuth, async (req, res) => {
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
  max-width: 1000px;
  margin: 0 auto;
  position: relative;
  z-index: 1;
}

/* =========================================================
   UNIFIED GLASS BUTTON SYSTEM
   ========================================================= */

.glass-btn,
button,
.back-link,
.btn-copy,
.btn-execute,
.btn-save {
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
.back-link::before,
.btn-copy::before,
.btn-execute::before,
.btn-save::before {
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
.back-link:hover,
.btn-copy:hover,
.btn-execute:hover,
.btn-save:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-1px);
  animation: waterDrift 2.2s ease-in-out infinite alternate;
}

.glass-btn:hover::before,
button:hover::before,
.back-link:hover::before,
.btn-copy:hover::before,
.btn-execute:hover::before,
.btn-save:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

/* Active press */
.glass-btn:active,
button:active,
.btn-copy:active,
.btn-execute:active,
.btn-save:active {
  background: rgba(var(--glass-water-rgb), 0.45);
  transform: translateY(0);
  animation: none;
}

@keyframes waterDrift {
  0% { transform: translateY(-1px); }
  100% { transform: translateY(1px); }
}

/* Button variants */
.btn-execute {
  --glass-water-rgb: 16, 185, 129;
  font-weight: 600;
}

.btn-save {
  --glass-alpha: 0.34;
  --glass-alpha-hover: 0.46;
  font-weight: 600;
}

.btn-copy {
  padding: 6px 12px;
  font-size: 13px;
}

/* =========================================================
   CONTENT CARDS
   ========================================================= */

.header,
.section {
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 14px;
  padding: 28px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: white;
  margin-bottom: 24px;
}

.header h1 {
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.5px;
  line-height: 1.3;
  margin-bottom: 12px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  color: white;
  word-break: break-word;
}

.header h1::before {
  content: '⚡ ';
  font-size: 26px;
}

.script-id {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
  font-family: 'SF Mono', Monaco, monospace;
  background: rgba(255, 255, 255, 0.1);
  padding: 6px 12px;
  border-radius: 6px;
  display: inline-block;
  margin-top: 8px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  color: white;
  margin-bottom: 20px;
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
}

/* =========================================================
   CODE DISPLAY
   ========================================================= */

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
  color: rgba(255, 255, 255, 0.7);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

pre {
  background: rgba(0, 0, 0, 0.3);
  color: #e0e0e0;
  padding: 20px;
  border-radius: 12px;
  overflow-x: auto;
  font-size: 14px;
  line-height: 1.6;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', Consolas, monospace;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

/* =========================================================
   ACTION BUTTONS
   ========================================================= */

.action-bar {
  display: flex;
  gap: 12px;
  margin-top: 20px;
  flex-wrap: wrap;
}

.btn-execute::before {
  content: '▶ ';
  font-size: 14px;
}

/* =========================================================
   FORMS
   ========================================================= */

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
  color: white;
}

input[type="text"],
textarea {
  width: 100%;
  padding: 12px 16px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 10px;
  font-size: 15px;
  font-family: inherit;
  transition: all 0.2s;
  background: rgba(255, 255, 255, 0.2);
  color: white;
}

input[type="text"]::placeholder,
textarea::placeholder {
  color: rgba(255, 255, 255, 0.6);
}

textarea {
  font-family: 'SF Mono', Monaco, 'Cascadia Code', Consolas, monospace;
  resize: vertical;
  min-height: 300px;
}

input[type="text"]:focus,
textarea:focus {
  outline: none;
  border-color: rgba(255, 255, 255, 0.5);
  background: rgba(255, 255, 255, 0.25);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.1);
}

/* =========================================================
   HISTORY
   ========================================================= */

.history-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.history-item {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 16px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  transition: all 0.2s;
}

.history-item:hover {
  background: rgba(255, 255, 255, 0.15);
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
  color: white;
  font-size: 15px;
}

.script-name {
  font-size: 13px;
  color: white;
  background: rgba(255, 255, 255, 0.2);
  padding: 4px 10px;
  border-radius: 8px;
  font-weight: 600;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.current-badge {
  padding: 4px 10px;
  background: rgba(16, 185, 129, 0.9);
  color: white;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}

.success-badge {
  background: rgba(16, 185, 129, 0.9);
}

.failure-badge {
  background: rgba(239, 68, 68, 0.9);
}

.history-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.version-badge {
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.2);
  color: white;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.timestamp {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
}

details {
  margin-top: 8px;
}

details summary {
  cursor: pointer;
  font-weight: 600;
  color: white;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  user-select: none;
  transition: opacity 0.2s;
}

details summary:hover {
  opacity: 0.8;
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
  color: rgba(255, 255, 255, 0.7);
  font-style: italic;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.empty-history-item {
  text-align: center;
  padding: 20px;
  color: rgba(255, 255, 255, 0.7);
  font-style: italic;
  font-size: 14px;
}

/* =========================================================
   ERROR MESSAGES
   ========================================================= */

.error-message {
  margin-top: 12px;
  padding: 12px;
  background: rgba(239, 68, 68, 0.2);
  border-left: 3px solid #ef4444;
  border-radius: 8px;
}

.error-label {
  font-size: 12px;
  font-weight: 600;
  color: #ff6b6b;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.error-code {
  color: #ffcccb;
  background: rgba(0, 0, 0, 0.2);
  padding: 12px;
  border-radius: 6px;
  font-size: 13px;
  margin: 0;
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
    width: 100%;
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
      <a href="/api/v1/node/${nodeId}${qsWithQ}" class="back-link">
        ← Back to Node
      </a>
      <a href="/api/v1/node/${nodeId}/scripts/help${qsWithQ}" class="back-link">
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
          action="/api/v1/node/${nodeId}/script/${script.id}/execute${qsWithQ}"
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
        action="/api/v1/node/${nodeId}/script/${script.id}/edit${qsWithQ}"
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
  "/node/:nodeId/script/:scriptId/edit",
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

      return res.redirect(`/api/v1/node/${nodeId}/script/${scriptId}?${qs}`);
    } catch (err) {
      console.error("Error editing script:", err);
      return res.status(500).send("Failed to update script");
    }
  },
);

router.post(
  "/node/:nodeId/script/:scriptId/execute",
  authenticate,
  async (req, res) => {
    try {
      const { nodeId, scriptId } = req.params;
      const userId = req.userId;

      await executeScript({ nodeId, scriptId, userId });

      const qs = filterQuery(req);
      return res.redirect(`/api/v1/node/${nodeId}/script/${scriptId}?${qs}`);
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
        `/api/v1/node/${nodeId}/script/${scriptId}?${qs}&error=${encodeURIComponent(
          err.message,
        )}`,
      );
    }
  },
);

router.get("/node/:nodeId/scripts/help", urlAuth, async (req, res) => {
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
  max-width: 1100px;
  margin: 0 auto;
  position: relative;
  z-index: 1;
}

/* =========================================================
   UNIFIED GLASS BUTTON SYSTEM
   ========================================================= */

.glass-btn,
button,
.back-link,
.quick-nav-item,
.btn-copy {
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
.back-link::before,
.quick-nav-item::before,
.btn-copy::before {
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
.back-link:hover,
.quick-nav-item:hover,
.btn-copy:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-1px);
  animation: waterDrift 2.2s ease-in-out infinite alternate;
}

.glass-btn:hover::before,
button:hover::before,
.back-link:hover::before,
.quick-nav-item:hover::before,
.btn-copy:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

/* Active press */
.glass-btn:active,
button:active,
.btn-copy:active,
.quick-nav-item:active {
  background: rgba(var(--glass-water-rgb), 0.45);
  transform: translateY(0);
  animation: none;
}

@keyframes waterDrift {
  0% { transform: translateY(-1px); }
  100% { transform: translateY(1px); }
}

/* Button variants */
.btn-copy {
  padding: 6px 12px;
  font-size: 13px;
}

/* =========================================================
   CONTENT CARDS
   ========================================================= */

.header,
.section {
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 14px;
  padding: 28px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: white;
  margin-bottom: 24px;
}

.header h1 {
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.5px;
  line-height: 1.3;
  margin-bottom: 8px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  color: white;
}

.header h1::before {
  content: '📚 ';
  font-size: 26px;
}

.header-subtitle {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.8);
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  color: white;
  margin-bottom: 16px;
  letter-spacing: -0.3px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.section-description {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.9);
  line-height: 1.6;
  margin-bottom: 16px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  border-left: 3px solid rgba(255, 255, 255, 0.5);
}

/* =========================================================
   NAV
   ========================================================= */

.back-nav {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

/* =========================================================
   QUICK NAV
   ========================================================= */

.quick-nav {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}

.quick-nav-item {
  padding: 12px 16px;
  text-align: center;
}

/* =========================================================
   TABLES
   ========================================================= */

table {
  width: 100%;
  border-collapse: collapse;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

thead {
  background: rgba(255, 255, 255, 0.15);
}

th {
  padding: 14px 16px;
  text-align: left;
  font-weight: 600;
  color: white;
  font-size: 14px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 2px solid rgba(255, 255, 255, 0.2);
}

td {
  padding: 14px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 14px;
  line-height: 1.6;
  vertical-align: top;
  color: rgba(255, 255, 255, 0.95);
}

tbody tr:last-child td {
  border-bottom: none;
}

tbody tr {
  transition: background 0.2s;
}

tbody tr:hover {
  background: rgba(255, 255, 255, 0.05);
}

code {
  background: rgba(255, 255, 255, 0.2);
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 13px;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', Consolas, monospace;
  color: white;
  font-weight: 600;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

pre {
  background: rgba(0, 0, 0, 0.3);
  color: #e0e0e0;
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
  border: none;
}

/* =========================================================
   INFO BOX
   ========================================================= */

.info-box {
  background: rgba(255, 193, 7, 0.2);
  padding: 16px;
  border-radius: 10px;
  border-left: 4px solid #ffa500;
  margin-bottom: 16px;
}

.info-box-title {
  font-weight: 600;
  color: #ffd700;
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
  color: rgba(255, 255, 255, 0.9);
  line-height: 1.6;
}

/* =========================================================
   EXAMPLE BOX
   ========================================================= */

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
  color: rgba(255, 255, 255, 0.7);
  text-transform: uppercase;
  letter-spacing: 0.5px;
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
    width: 100%;
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
      <a href="/api/v1/node/${nodeId}${qsWithQ}" class="back-link">
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

router.post("/node/:nodeId/script/create", authenticate, async (req, res) => {
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

    return res.redirect(`/api/v1/node/${nodeId}/script/${result.scriptId}?${qs}`);
  } catch (err) {
    console.error("Create script error:", err);
    return res.status(500).send("Failed to create script");
  }
});

export default router;
