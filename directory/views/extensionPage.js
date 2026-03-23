function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function timeAgo(date) {
  if (!date) return "never";
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return seconds + "s ago";
  if (seconds < 3600) return Math.floor(seconds / 60) + "m ago";
  if (seconds < 86400) return Math.floor(seconds / 3600) + "h ago";
  return Math.floor(seconds / 86400) + "d ago";
}

export function renderExtensionPage({ ext, versions }) {
  const tags = (ext.tags || []).map(t =>
    `<span class="ext-tag">${escapeHtml(t)}</span>`
  ).join("");

  const versionRows = versions.map(v => {
    const isCurrent = v.version === ext.version;
    return `
      <tr class="${isCurrent ? "version-current" : ""}">
        <td>
          ${isCurrent
            ? `<strong>${escapeHtml(v.version)}</strong>`
            : `<a href="/extensions/${encodeURIComponent(ext.name)}/page?v=${encodeURIComponent(v.version)}">${escapeHtml(v.version)}</a>`
          }
        </td>
        <td>${timeAgo(v.publishedAt)}</td>
        <td>${v.downloads || 0}</td>
      </tr>`;
  }).join("");

  const files = ext.files || [];
  const fileTabs = files.map((f, i) => {
    const active = i === 0 ? "active" : "";
    return `<button class="file-tab ${active}" onclick="showFile(${i})" data-idx="${i}">${escapeHtml(f.path)}</button>`;
  }).join("");

  const filePanels = files.map((f, i) => {
    const lines = (f.content || "").split("\n");
    const numbered = lines.map((line, ln) =>
      `<span class="line-num">${ln + 1}</span>${escapeHtml(line)}`
    ).join("\n");
    return `<pre class="file-panel${i === 0 ? " active" : ""}" data-idx="${i}"><code>${numbered}</code></pre>`;
  }).join("");

  // Manifest summary
  const manifest = ext.manifest || {};
  const provides = manifest.provides || {};
  const needs = manifest.needs || {};
  const optional = manifest.optional || {};
  const hooks = provides.hooks || {};
  const providesList = [];
  if (provides.models && Object.keys(provides.models).length) providesList.push(Object.keys(provides.models).length + " models");
  if (provides.routes) providesList.push("routes");
  if (provides.tools) providesList.push("tools");
  if (provides.jobs) providesList.push("jobs");
  if (provides.orchestrator) providesList.push("orchestrator");
  if (provides.cli && provides.cli.length) providesList.push(provides.cli.length + " CLI commands");
  if (provides.energyActions && Object.keys(provides.energyActions).length) providesList.push(Object.keys(provides.energyActions).length + " energy actions");
  if (hooks.fires && hooks.fires.length) providesList.push(hooks.fires.length + " custom hooks");

  const needsList = [];
  if (needs.services && needs.services.length) needsList.push("services: " + needs.services.join(", "));
  if (needs.models && needs.models.length) needsList.push("models: " + needs.models.join(", "));
  if (needs.extensions && needs.extensions.length) needsList.push("extensions: " + needs.extensions.join(", "));

  const optionalList = [];
  if (optional.services && optional.services.length) optionalList.push("services: " + optional.services.join(", "));
  if (optional.extensions && optional.extensions.length) optionalList.push("extensions: " + optional.extensions.join(", "));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <title>${escapeHtml(ext.name)} - Canopy Extensions</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --glass-water-rgb: 115, 111, 230;
      --glass-alpha: 0.28;
      --text-primary: #ffffff;
      --text-secondary: rgba(255, 255, 255, 0.75);
      --text-muted: rgba(255, 255, 255, 0.45);
      --accent: #10b981;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { height: 100%; }

    body {
      font-family: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100%;
      padding: 20px;
      color: var(--text-primary);
      overflow-x: hidden;
      background-attachment: fixed;
    }

    body::before, body::after {
      content: "";
      position: fixed;
      border-radius: 50%;
      opacity: 0.08;
      animation: float 20s infinite ease-in-out;
      pointer-events: none;
    }
    body::before { width: 600px; height: 600px; background: white; top: -300px; right: -200px; animation-delay: -5s; }
    body::after { width: 400px; height: 400px; background: white; bottom: -200px; left: -100px; animation-delay: -10s; }

    @keyframes float {
      0%, 100% { transform: translateY(0) rotate(0deg); }
      50% { transform: translateY(-30px) rotate(5deg); }
    }
    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(30px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .container {
      max-width: 960px;
      margin: 0 auto;
      position: relative;
      z-index: 1;
    }

    .home-btn {
      display: inline-block;
      padding: 8px 18px;
      border-radius: 980px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.28);
      color: var(--text-secondary);
      font-family: inherit;
      font-size: 13px;
      font-weight: 600;
      text-decoration: none;
      transition: background 0.2s ease, color 0.2s ease;
      animation: fadeInUp 0.4s ease-out both;
    }
    .home-btn:hover {
      background: rgba(255, 255, 255, 0.15);
      color: var(--text-primary);
    }

    .glass-card {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      border: 1px solid rgba(255, 255, 255, 0.28);
      border-radius: 20px;
      padding: 24px;
      margin-bottom: 20px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.15);
      animation: fadeInUp 0.6s ease-out both;
    }
    .glass-card h2 {
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 16px;
      letter-spacing: -0.3px;
    }

    .separator {
      display: inline-block;
      width: 3px;
      height: 3px;
      border-radius: 50%;
      background: var(--text-muted);
      margin: 0 8px;
      vertical-align: middle;
    }

    /* Extension header */
    .ext-header {
      text-align: left;
      margin: 24px 0 24px 0;
      animation: fadeInUp 0.5s ease-out both;
    }
    .ext-title {
      font-family: "JetBrains Mono", monospace;
      font-size: 28px;
      font-weight: 800;
      color: var(--accent);
      letter-spacing: -0.5px;
      margin-bottom: 4px;
    }
    .ext-subtitle {
      font-size: 15px;
      color: var(--text-secondary);
      margin-bottom: 12px;
    }
    .ext-meta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      font-size: 13px;
      color: var(--text-muted);
    }
    .ext-meta-row strong {
      color: var(--text-secondary);
    }

    .ext-tag {
      display: inline-block;
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 6px;
      background: rgba(16, 185, 129, 0.12);
      color: rgba(16, 185, 129, 0.9);
      font-weight: 600;
      margin-right: 6px;
    }
    .ext-tags-row {
      margin-top: 10px;
    }

    .install-cmd {
      margin-top: 12px;
      padding: 10px 16px;
      border-radius: 10px;
      background: rgba(0, 0, 0, 0.25);
      font-family: "JetBrains Mono", monospace;
      font-size: 13px;
      color: var(--text-secondary);
      display: inline-block;
    }

    /* Manifest summary */
    .manifest-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }
    .manifest-section h3 {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      margin-bottom: 8px;
    }
    .manifest-list {
      list-style: none;
      font-size: 13px;
      color: var(--text-secondary);
    }
    .manifest-list li {
      padding: 3px 0;
    }
    .manifest-list li::before {
      content: "";
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--accent);
      margin-right: 8px;
      vertical-align: middle;
    }

    /* Version table */
    .data-table { width: 100%; border-collapse: collapse; }
    .data-table th, .data-table td {
      text-align: left;
      padding: 8px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      font-size: 13px;
    }
    .data-table th {
      font-weight: 700;
      color: var(--text-secondary);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .data-table tr:last-child td { border-bottom: none; }
    .data-table a {
      color: var(--accent);
      text-decoration: none;
      font-weight: 600;
    }
    .data-table a:hover { text-decoration: underline; }
    .version-current {
      background: rgba(16, 185, 129, 0.06);
    }

    /* Code viewer */
    .file-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 0;
      padding-bottom: 0;
    }
    .file-tab {
      padding: 8px 16px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-bottom: none;
      border-radius: 10px 10px 0 0;
      background: rgba(255, 255, 255, 0.04);
      color: var(--text-muted);
      font-family: "JetBrains Mono", monospace;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s, color 0.2s;
    }
    .file-tab:hover {
      background: rgba(255, 255, 255, 0.08);
      color: var(--text-secondary);
    }
    .file-tab.active {
      background: rgba(0, 0, 0, 0.3);
      color: var(--accent);
      border-color: rgba(255, 255, 255, 0.2);
    }

    .code-container {
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 0 14px 14px 14px;
      overflow: hidden;
    }

    .file-panel {
      display: none;
      margin: 0;
      padding: 16px;
      overflow-x: auto;
      max-height: 600px;
      overflow-y: auto;
    }
    .file-panel.active {
      display: block;
    }
    .file-panel code {
      font-family: "JetBrains Mono", monospace;
      font-size: 12px;
      line-height: 1.6;
      color: var(--text-secondary);
      white-space: pre;
    }
    .line-num {
      display: inline-block;
      width: 40px;
      text-align: right;
      padding-right: 16px;
      color: rgba(255, 255, 255, 0.2);
      user-select: none;
    }

    /* Readme */
    .readme-content {
      font-size: 14px;
      line-height: 1.6;
      color: var(--text-secondary);
      white-space: pre-wrap;
      word-break: break-word;
    }

    .footer {
      text-align: center;
      margin-top: 32px;
      padding: 16px;
      font-size: 13px;
      color: var(--text-muted);
      animation: fadeInUp 0.6s ease-out both;
      animation-delay: 0.3s;
    }
    .footer a {
      color: var(--text-secondary);
      text-decoration: none;
    }
    .footer a:hover { color: var(--text-primary); }

    @media (max-width: 640px) {
      body { padding: 12px; }
      .glass-card { padding: 16px; border-radius: 16px; }
      .ext-title { font-size: 22px; }
      .manifest-grid { grid-template-columns: 1fr; }
      .file-tabs { gap: 2px; }
      .file-tab { font-size: 11px; padding: 6px 10px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <a href="/" class="home-btn">&larr; Directory</a>

    <div class="ext-header">
      <div class="ext-title">${escapeHtml(ext.name)}</div>
      <div class="ext-subtitle">${escapeHtml(ext.description || "")}</div>
      <div class="ext-meta-row">
        <span>v<strong>${escapeHtml(ext.version)}</strong></span>
        <span>by <strong>${escapeHtml(ext.authorName || ext.authorDomain || "unknown")}</strong></span>
        <span><strong>${ext.downloads || 0}</strong> downloads</span>
        ${ext.fileCount ? `<span><strong>${ext.fileCount}</strong> files</span>` : ""}
        ${ext.totalLines ? `<span><strong>${ext.totalLines.toLocaleString()}</strong> lines</span>` : ""}
        ${ext.totalBytes ? `<span><strong>${(ext.totalBytes / 1024).toFixed(1)}</strong> KB</span>` : ""}
        <span>published ${timeAgo(ext.publishedAt)}</span>
        ${ext.repoUrl ? `<span><a href="${escapeHtml(ext.repoUrl)}" target="_blank" rel="noopener" style="color: var(--accent);">repo</a></span>` : ""}
      </div>
      ${tags ? `<div class="ext-tags-row">${tags}</div>` : ""}
      <div class="install-cmd">treeos ext install ${escapeHtml(ext.name)}</div>
    </div>

    ${(providesList.length || needsList.length || optionalList.length) ? `
    <!-- Manifest -->
    <div class="glass-card" style="animation-delay: 0.05s;">
      <h2>Manifest</h2>
      <div class="manifest-grid">
        ${providesList.length ? `
        <div class="manifest-section">
          <h3>Provides</h3>
          <ul class="manifest-list">
            ${providesList.map(p => `<li>${escapeHtml(p)}</li>`).join("")}
          </ul>
        </div>` : ""}
        ${needsList.length ? `
        <div class="manifest-section">
          <h3>Requires</h3>
          <ul class="manifest-list">
            ${needsList.map(n => `<li>${escapeHtml(n)}</li>`).join("")}
          </ul>
        </div>` : ""}
        ${optionalList.length ? `
        <div class="manifest-section">
          <h3>Optional</h3>
          <ul class="manifest-list">
            ${optionalList.map(o => `<li>${escapeHtml(o)}</li>`).join("")}
          </ul>
        </div>` : ""}
      </div>
      ${ext.checksum ? `<div style="margin-top:12px;font-size:11px;color:var(--text-muted);">SHA256: <code>${escapeHtml(ext.checksum)}</code></div>` : ""}
      ${ext.maintainers && ext.maintainers.length ? `<div style="margin-top:8px;font-size:12px;color:var(--text-muted);">Maintainers: ${ext.maintainers.map(m => `<strong>${escapeHtml(m)}</strong>`).join(", ")}</div>` : ""}
    </div>` : ""}

    ${provides.cli && provides.cli.length ? `
    <!-- CLI Commands -->
    <div class="glass-card" style="animation-delay: 0.08s;">
      <h2>CLI Commands</h2>
      <table class="data-table">
        <thead><tr><th>Command</th><th>Method</th><th>Description</th></tr></thead>
        <tbody>
          ${provides.cli.map(cmd => {
            if (cmd.subcommands) {
              const base = cmd.command.split(" ")[0];
              const rows = [`<tr><td><code>${escapeHtml(base)}</code></td><td>${escapeHtml(cmd.method || "GET")}</td><td>${escapeHtml(cmd.description)}</td></tr>`];
              for (const [action, sub] of Object.entries(cmd.subcommands)) {
                rows.push(`<tr><td><code>${escapeHtml(base)} ${escapeHtml(action)}</code></td><td>${escapeHtml(sub.method || "POST")}</td><td>${escapeHtml(sub.description || "")}</td></tr>`);
              }
              return rows.join("");
            }
            return `<tr><td><code>${escapeHtml(cmd.command)}</code></td><td>${escapeHtml(cmd.method || "GET")}</td><td>${escapeHtml(cmd.description)}</td></tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>` : ""}

    ${(hooks.fires && hooks.fires.length) || (hooks.listens && hooks.listens.length) ? `
    <!-- Hooks -->
    <div class="glass-card" style="animation-delay: 0.085s;">
      <h2>Hooks</h2>
      ${hooks.listens && hooks.listens.length ? `
      <div class="manifest-section">
        <h3>Listens To</h3>
        <ul class="manifest-list">
          ${hooks.listens.map(h => `<li><code>${escapeHtml(h)}</code></li>`).join("")}
        </ul>
      </div>` : ""}
      ${hooks.fires && hooks.fires.length ? `
      <div class="manifest-section" style="margin-top:14px;">
        <h3>Fires</h3>
        <table class="data-table">
          <thead><tr><th>Hook</th><th>Data</th><th>Description</th></tr></thead>
          <tbody>
            ${hooks.fires.map(h =>
              `<tr>
                <td><code>${escapeHtml(h.name || h)}</code></td>
                <td><code>${escapeHtml(h.data || "")}</code></td>
                <td>${escapeHtml(h.description || "")}</td>
              </tr>`
            ).join("")}
          </tbody>
        </table>
      </div>` : ""}
    </div>` : ""}

    ${provides.env && provides.env.length ? `
    <!-- Environment Variables -->
    <div class="glass-card" style="animation-delay: 0.09s;">
      <h2>Environment Variables</h2>
      <table class="data-table">
        <thead><tr><th>Key</th><th>Required</th><th>Description</th></tr></thead>
        <tbody>
          ${provides.env.map(e =>
            `<tr>
              <td><code>${escapeHtml(e.key)}</code>${e.secret ? ' <span class="ext-tag">secret</span>' : ""}${e.autoGenerate ? ' <span class="ext-tag">auto</span>' : ""}</td>
              <td>${e.required ? "Yes" : "No"}</td>
              <td>${escapeHtml(e.description || "")}${e.default ? ` (default: <code>${escapeHtml(e.default)}</code>)` : ""}</td>
            </tr>`
          ).join("")}
        </tbody>
      </table>
    </div>` : ""}

    ${ext.readme ? `
    <!-- Readme -->
    <div class="glass-card" style="animation-delay: 0.1s;">
      <h2>Readme</h2>
      <div class="readme-content">${escapeHtml(ext.readme)}</div>
    </div>` : ""}

    ${files.length ? `
    <!-- Source Code -->
    <div class="glass-card" style="animation-delay: 0.15s;">
      <h2>Source Code</h2>
      <div class="file-tabs">
        ${fileTabs}
      </div>
      <div class="code-container">
        ${filePanels}
      </div>
    </div>` : ""}

    ${versions.length > 1 ? `
    <!-- Versions -->
    <div class="glass-card" style="animation-delay: 0.2s;">
      <h2>Versions</h2>
      <table class="data-table">
        <thead>
          <tr>
            <th>Version</th>
            <th>Published</th>
            <th>Downloads</th>
          </tr>
        </thead>
        <tbody>
          ${versionRows}
        </tbody>
      </table>
    </div>` : ""}

    <div class="footer">
      <a href="/">&larr; Back to Directory</a>
    </div>
  </div>

  <script>
    function showFile(idx) {
      var tabs = document.querySelectorAll(".file-tab");
      var panels = document.querySelectorAll(".file-panel");
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].classList.remove("active");
        panels[i].classList.remove("active");
      }
      tabs[idx].classList.add("active");
      panels[idx].classList.add("active");
    }
  </script>
</body>
</html>`;
}
