/* ------------------------------------------------------------------ */
/* renderNodeDetail -- Node detail page with hierarchy, scripts, etc.  */
/* ------------------------------------------------------------------ */

import { page } from "../layout.js";

/* ── page-specific CSS ── */

const css = `

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
  .versions-list {
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  }
}
`;

/* ── client-side JS ── */

const jsCode = `
    // Copy ID functionality
    const btn = document.getElementById("copyNodeIdBtn");
    const code = document.getElementById("nodeIdCode");

    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(code.textContent).then(() => {
        btn.textContent = "✔️";
        setTimeout(() => (btn.textContent = "📋"), 900);
      });
    });
`;

/* ================================================================== */
/* renderNodeDetail                                                    */
/* ================================================================== */

export function renderNodeDetail({ node, nodeId, qs, parentName, rootUrl, isPublicAccess }) {
  const _nodeScripts = (node.metadata instanceof Map ? node.metadata?.get("scripts") : node.metadata?.scripts)?.list || [];

  const body = `
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="${rootUrl}" class="back-link">
        ← Back to Tree
      </a>
      <a href="/api/v1/node/${nodeId}/chats${qs}" class="back-link">
        AI Chats
      </a>
    </div>

    <!-- Header -->
    <div class="header">
      <h1
        id="nodeNameDisplay"
        ${!isPublicAccess ? `style="cursor:pointer;" title="Click to rename" onclick="document.getElementById('nodeNameDisplay').style.display='none';document.getElementById('renameForm').style.display='flex';"` : ""}
      >${node.name}</h1>
      ${!isPublicAccess ? `<form
        id="renameForm"
        method="POST"
        action="/api/v1/node/${nodeId}/${0}/editName${qs}"
        style="display:none;align-items:center;gap:8px;margin-bottom:12px;"
      >
        <input
          type="text"
          name="name"
          value="${node.name.replace(/"/g, '&quot;')}"
          required
          style="flex:1;font-size:20px;font-weight:700;padding:8px 12px;border-radius:12px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.1);color:white;"
        />
        <button type="submit" class="primary-button" style="padding:8px 16px;">Save</button>
        <button
          type="button"
          class="warning-button"
          style="padding:8px 16px;"
          onclick="document.getElementById('renameForm').style.display='none';document.getElementById('nodeNameDisplay').style.display='';"
        >Cancel</button>
      </form>` : ""}

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
          <div class="meta-label">Status</div>
          <div class="meta-value">${node.status || "active"}</div>
        </div>
      </div>
    </div>

    ${!isPublicAccess ? `<!-- Edit Type -->
    <div class="hierarchy-section">
      <h2>Node Type</h2>
      <form
        method="POST"
        action="/api/v1/node/${nodeId}/editType${qs}"
        class="action-form"
      >
        <select name="type" style="flex:1;padding:10px 14px;border-radius:12px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.1);color:white;font-size:14px;">
          <option value="" ${!node.type ? "selected" : ""}>None</option>
          <option value="goal" ${node.type === "goal" ? "selected" : ""}>goal</option>
          <option value="plan" ${node.type === "plan" ? "selected" : ""}>plan</option>
          <option value="task" ${node.type === "task" ? "selected" : ""}>task</option>
          <option value="knowledge" ${node.type === "knowledge" ? "selected" : ""}>knowledge</option>
          <option value="resource" ${node.type === "resource" ? "selected" : ""}>resource</option>
          <option value="identity" ${node.type === "identity" ? "selected" : ""}>identity</option>
        </select>
        <input
          type="text"
          name="customType"
          placeholder="or custom type..."
          style="flex:1;"
        />
        <button type="submit" class="primary-button">Set Type</button>
      </form>
    </div>` : ""}

    <!-- AI Tools Config -->
    ${!isPublicAccess ? (() => {
      const meta = node.metadata instanceof Map ? Object.fromEntries(node.metadata) : (node.metadata || {});
      const tools = meta.tools || {};
      const allowed = (tools.allowed || []).join(", ");
      const blocked = (tools.blocked || []).join(", ");
      return `<div class="hierarchy-section">
        <h2>AI Tools</h2>
        <p style="color:rgba(255,255,255,0.5);font-size:0.85rem;margin-bottom:12px;">
          Control what the AI can do at this node. Inherits up the tree.
          <a href="/api/v1/node/${nodeId}/command-center?html" style="color:rgba(74,222,128,0.9);text-decoration:none;margin-left:8px;font-weight:600;">Command Center</a>
        </p>
        ${allowed ? `<div style="margin-bottom:8px;"><span style="color:rgba(16,185,129,0.9);font-size:0.85rem;">Added: ${allowed}</span></div>` : ""}
        ${blocked ? `<div style="margin-bottom:8px;"><span style="color:rgba(239,68,68,0.9);font-size:0.85rem;">Blocked: ${blocked}</span></div>` : ""}
        <form method="POST" action="/api/v1/node/${nodeId}/tools${qs}">
          <div style="margin-bottom:8px;">
            <label style="display:block;font-size:0.8rem;color:rgba(255,255,255,0.6);margin-bottom:4px;">Allow tools (comma-separated)</label>
            <input type="text" name="allowedRaw" value="${allowed}" placeholder="execute-shell, web-search" style="width:100%;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:white;font-size:0.9rem;" />
          </div>
          <div style="margin-bottom:8px;">
            <label style="display:block;font-size:0.8rem;color:rgba(255,255,255,0.6);margin-bottom:4px;">Block tools (comma-separated)</label>
            <input type="text" name="blockedRaw" value="${blocked}" placeholder="delete-node-branch" style="width:100%;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:white;font-size:0.9rem;" />
          </div>
          <button type="submit" class="primary-button" style="padding:8px 16px;">Save</button>
        </form>
      </div>`;
    })() : ""}

    <!-- Versions Section (prestige extension) -->
    ${(() => {
      const meta = node.metadata instanceof Map ? Object.fromEntries(node.metadata) : (node.metadata || {});
      const prestige = meta.prestige || { current: 0, history: [] };
      const history = prestige.history || [];
      return `<div class="versions-section">
        <h2>Versions</h2>
        <ul class="versions-list">
          ${[...Array(prestige.current + 1)].map((_, i) =>
            `<li><a href="/api/v1/node/${nodeId}/${i}${qs}">Version ${i}${i === prestige.current ? " (current)" : ""}</a></li>`
          ).reverse().join("")}
        </ul>
        ${!isPublicAccess ? `<form
          method="POST"
          action="/api/v1/node/${nodeId}/prestige${qs}"
          onsubmit="return confirm('This will complete the current version and create a new prestige level. Continue?')"
          style="margin-top: 16px;">
          <button type="submit" class="primary-button">Add New Version</button>
        </form>` : ""}
      </div>`;
    })()}

    <!-- Parent Section -->
    <div class="hierarchy-section">
      <h2>Parent</h2>
      ${
        node.parent
          ? `<a href="/api/v1/node/${node.parent}${qs}" style="display:block;padding:12px 16px;margin-bottom:16px;">${parentName}</a>`
          : `<p style="margin-bottom:16px;"><em>None (This is a root node)</em></p>`
      }

      ${!isPublicAccess ? `<h3>Change Parent</h3>
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
      </form>` : ""}
    </div>

    <!-- Children Section -->
    <div class="hierarchy-section">
      <h2>Children</h2>
      <ul class="children-list">
        ${
          node.children && node.children.length
            ? node.children
                .map(
                  (c) =>
                    `<li><a href="/api/v1/node/${c._id}${qs}">${c.name}</a></li>`,
                )
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
          _nodeScripts.length
            ? _nodeScripts
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

    ${!isPublicAccess ? `<!-- Delete Section -->
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
    </div>` : ""}
  </div>
`;

  return page({
    title: `${node.name} — Node`,
    css,
    body,
    js: jsCode,
  });
}
