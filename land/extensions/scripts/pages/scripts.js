/* ------------------------------------------------------------------ */
/* renderScriptDetail + renderScriptHelp                               */
/* ------------------------------------------------------------------ */

import { page } from "../../html-rendering/html/layout.js";

/* ================================================================== */
/* 1. renderScriptDetail                                               */
/* ================================================================== */

/* ── page-specific CSS for script detail ── */

const scriptDetailCss = `
.container { max-width: 1000px; }

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
  .container {
    max-width: 100%;
  }

  .header,
  .section {
    padding: 20px;
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
`;

export function renderScriptDetail({
  nodeId,
  script,
  contributions,
  qsWithQ,
}) {
  const editHistory = contributions.filter((c) => c.type === "edit");
  const executionHistory = contributions.filter((c) => c.type === "execute");

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

  const body = `
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
`;

  const jsCode = `
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
`;

  return page({
    title: `${script.name} — Script`,
    css: scriptDetailCss,
    body,
    js: jsCode,
  });
}

/* ================================================================== */
/* 2. renderScriptHelp                                                 */
/* ================================================================== */

/* ── page-specific CSS for script help ── */

const scriptHelpCss = `
.container { max-width: 1100px; }

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
  .container {
    max-width: 100%;
  }

  .header,
  .section {
    padding: 20px;
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
`;

export function renderScriptHelp({ nodeId, nodeName, data, qsWithQ }) {
  const body = `
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
        or <code>0</code> for the latest version.
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
`;

  const jsCode = `
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
`;

  return page({
    title: `Script Help — ${nodeName}`,
    css: scriptHelpCss,
    body,
    js: jsCode,
  });
}
