import {
  escapeHtml, timeAgo, pageShell, typeBadge, builtForBadge,
  packageCard, ecosystemStats,
} from "./shared.js";

export function renderExtensionPage({ ext, versions, dependents, ecosystem }) {
  const type = ext.type || "extension";
  const tags = (ext.tags || []).map(t =>
    `<span class="tag">${escapeHtml(t)}</span>`
  ).join("");

  // Version table
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

  // Source code viewer (only for extensions with files)
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

  // npm dependencies
  const npmDeps = ext.npmDependencies || manifest.needs?.npm || [];

  // Install command varies by type
  const installCmd = type === "os"
    ? `treeos os install ${escapeHtml(ext.name)}`
    : type === "bundle"
      ? `treeos bundle install ${escapeHtml(ext.name)}`
      : `treeos ext install ${escapeHtml(ext.name)}`;

  // Bundle: included extensions
  const includes = ext.includes || manifest.includes || [];

  // OS: bundles and standalone
  const osBundles = ext.bundles || manifest.bundles || [];
  const osStandalone = ext.standalone || manifest.standalone || [];
  const osConfig = ext.osConfig || manifest.config || null;
  const osOrchestrators = ext.osOrchestrators || manifest.orchestrators || null;

  // Dependents
  const depsList = dependents || [];

  // Determine breadcrumb and page context
  let activePage = "explore";
  let breadcrumb = ext.name;

  const body = `
    <div class="ext-header">
      <div class="ext-badges" style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
        ${typeBadge(type)}
        ${builtForBadge(ext.builtFor)}
      </div>
      <div class="ext-title">${escapeHtml(ext.name)}</div>
      <div class="ext-subtitle">${escapeHtml(ext.description || "")}</div>
      <div class="ext-meta-row">
        <span>v<strong>${escapeHtml(ext.version)}</strong></span>
        <span>by <a href="/lands/${encodeURIComponent(ext.authorDomain || "")}" style="color:var(--text-dim);text-decoration:none;"><strong>${escapeHtml(ext.authorName || ext.authorDomain || "unknown")}</strong></a></span>
        <span><strong>${ext.downloads || 0}</strong> downloads</span>
        ${ext.fileCount ? `<span><strong>${ext.fileCount}</strong> files</span>` : ""}
        ${ext.totalLines ? `<span><strong>${ext.totalLines.toLocaleString()}</strong> lines</span>` : ""}
        ${ext.totalBytes ? `<span><strong>${(ext.totalBytes / 1024).toFixed(1)}</strong> KB</span>` : ""}
        <span>published ${timeAgo(ext.publishedAt)}</span>
        ${ext.repoUrl ? `<span><a href="${escapeHtml(ext.repoUrl)}" target="_blank" rel="noopener" style="color: var(--accent);">repo</a></span>` : ""}
      </div>
      ${tags ? `<div style="margin-top:10px;">${tags}</div>` : ""}
      <div class="install-cmd">${installCmd}</div>
      <div style="margin-top:12px;display:flex;gap:16px;align-items:center;flex-wrap:wrap;">
        <a href="/extensions/${encodeURIComponent(ext.name)}/changelog" style="color:var(--accent);font-size:13px;text-decoration:none;">View changelog</a>
        ${ext.repoUrl ? `
          <a href="${escapeHtml(ext.repoUrl)}" target="_blank" rel="noopener"
             style="display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:8px;
                    background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);
                    color:var(--text-secondary);font-size:13px;font-weight:600;text-decoration:none;
                    transition:background 0.2s;">
            Source Code
          </a>
        ` : ""}
      </div>
    </div>

    ${ecosystem ? `
    <!-- Ecosystem Stats -->
    <div class="glass-card" style="animation-delay: 0.03s;">
      <h2>Ecosystem</h2>
      ${ecosystemStats(ecosystem)}
    </div>` : ""}

    ${osBundles.length ? `
    <!-- OS Bundles -->
    <div class="glass-card" style="animation-delay: 0.05s;">
      <h2>Bundles</h2>
      <ul class="manifest-list">
        ${osBundles.map(b => `<li><a href="/bundle/${encodeURIComponent(b.split("@")[0])}" style="color:var(--accent);text-decoration:none;font-weight:600;">${escapeHtml(b)}</a></li>`).join("")}
      </ul>
    </div>` : ""}

    ${osStandalone.length ? `
    <!-- OS Standalone Extensions -->
    <div class="glass-card" style="animation-delay: 0.06s;">
      <h2>Standalone Extensions</h2>
      <ul class="manifest-list">
        ${osStandalone.map(s => `<li><a href="/extensions/${encodeURIComponent(s.split("@")[0])}/page" style="color:var(--accent);text-decoration:none;font-weight:600;">${escapeHtml(s)}</a></li>`).join("")}
      </ul>
    </div>` : ""}

    ${osConfig ? `
    <!-- OS Config Defaults -->
    <div class="glass-card" style="animation-delay: 0.07s;">
      <h2>Config Defaults</h2>
      <table class="data-table">
        <thead><tr><th>Key</th><th>Value</th></tr></thead>
        <tbody>
          ${Object.entries(osConfig).map(([k, v]) => `<tr><td><code>${escapeHtml(k)}</code></td><td><code>${escapeHtml(String(v))}</code></td></tr>`).join("")}
        </tbody>
      </table>
    </div>` : ""}

    ${osOrchestrators ? `
    <!-- OS Orchestrators -->
    <div class="glass-card" style="animation-delay: 0.075s;">
      <h2>Orchestrators</h2>
      <table class="data-table">
        <thead><tr><th>Zone</th><th>Orchestrator</th></tr></thead>
        <tbody>
          ${Object.entries(osOrchestrators).map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td><code>${escapeHtml(v)}</code></td></tr>`).join("")}
        </tbody>
      </table>
    </div>` : ""}

    ${includes.length ? `
    <!-- Bundle Members -->
    <div class="glass-card" style="animation-delay: 0.05s;">
      <h2>Included Extensions</h2>
      <ul class="manifest-list">
        ${includes.map(inc => `<li><a href="/extensions/${encodeURIComponent(inc.split("@")[0])}/page" style="color:var(--accent);text-decoration:none;font-weight:600;">${escapeHtml(inc)}</a></li>`).join("")}
      </ul>
    </div>` : ""}

    ${(providesList.length || needsList.length || optionalList.length) ? `
    <!-- Manifest -->
    <div class="glass-card" style="animation-delay: 0.08s;">
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

    ${npmDeps.length ? `
    <!-- npm Dependencies -->
    <div class="glass-card" style="animation-delay: 0.085s;">
      <h2>npm Dependencies</h2>
      <ul class="manifest-list">
        ${npmDeps.map(d => `<li><code>${escapeHtml(d)}</code></li>`).join("")}
      </ul>
    </div>` : ""}

    ${depsList.length ? `
    <!-- Dependents -->
    <div class="glass-card" style="animation-delay: 0.09s;">
      <h2>Dependents</h2>
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px;">${depsList.length} package${depsList.length !== 1 ? "s" : ""} depend on this</p>
      <table class="data-table">
        <thead><tr><th>Package</th><th>Type</th><th>Relationship</th></tr></thead>
        <tbody>
          ${depsList.map(d => `<tr><td><a href="/extensions/${encodeURIComponent(d.name)}/page">${escapeHtml(d.name)} v${escapeHtml(d.version)}</a></td><td>${escapeHtml(d.type || "extension")}</td><td>${escapeHtml(d.relationship || "needs")}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>` : ""}

    ${provides.cli && provides.cli.length ? `
    <!-- CLI Commands -->
    <div class="glass-card" style="animation-delay: 0.1s;">
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
    <div class="glass-card" style="animation-delay: 0.11s;">
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
    <div class="glass-card" style="animation-delay: 0.12s;">
      <h2>Environment Variables</h2>
      <table class="data-table">
        <thead><tr><th>Key</th><th>Required</th><th>Description</th></tr></thead>
        <tbody>
          ${provides.env.map(e =>
            `<tr>
              <td><code>${escapeHtml(e.key)}</code>${e.secret ? ' <span class="tag">secret</span>' : ""}${e.autoGenerate ? ' <span class="tag">auto</span>' : ""}</td>
              <td>${e.required ? "Yes" : "No"}</td>
              <td>${escapeHtml(e.description || "")}${e.default ? ` (default: <code>${escapeHtml(e.default)}</code>)` : ""}</td>
            </tr>`
          ).join("")}
        </tbody>
      </table>
    </div>` : ""}

    ${ext.readme ? `
    <!-- Readme -->
    <div class="glass-card" style="animation-delay: 0.15s;">
      <h2>Readme</h2>
      <div class="readme-content">${escapeHtml(ext.readme)}</div>
    </div>` : ""}

    ${files.length ? `
    <!-- Source Code -->
    <div class="glass-card" style="animation-delay: 0.18s;">
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

    <!-- Reactions -->
    <div class="glass-card" style="animation-delay: 0.21s;">
      <div style="display:flex;align-items:center;gap:20px;">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:18px;">&#11088;</span>
          <span id="star-count" style="font-size:14px;color:var(--text-dim);">0</span>
          <span style="font-size:12px;color:var(--text-muted);">stars</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:18px;">&#9873;</span>
          <span id="flag-count" style="font-size:14px;color:var(--text-dim);">0</span>
          <span style="font-size:12px;color:var(--text-muted);">flags</span>
        </div>
        <div style="margin-left:auto;font-size:12px;color:var(--text-muted);">
          React from the CLI: <code>treeos ext star ${escapeHtml(ext.name)}</code>
        </div>
      </div>
    </div>

    <!-- Comments -->
    <div class="glass-card" style="animation-delay: 0.22s;">
      <h2>Comments</h2>
      <div id="comments-list" style="min-height:40px;">
        <p style="color:var(--text-muted);font-size:13px;">Loading comments...</p>
      </div>
      <p style="margin-top:16px;font-size:12px;color:var(--text-muted);">
        Post comments from the CLI: <code>treeos ext comment ${escapeHtml(ext.name)} "your comment"</code>
        <br/>Max 3 comments per extension. One star and one flag per user.
      </p>
    </div>
  `;

  const extraStyles = `
    .ext-header {
      text-align: left;
      margin: 8px 0 24px 0;
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
    .ext-meta-row strong { color: var(--text-secondary); }

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
    .manifest-list li { padding: 3px 0; }
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

    .version-current { background: rgba(16, 185, 129, 0.06); }

    .file-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 0;
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
    .file-tab:hover { background: rgba(255, 255, 255, 0.08); color: var(--text-secondary); }
    .file-tab.active { background: rgba(0, 0, 0, 0.3); color: var(--accent); border-color: rgba(255, 255, 255, 0.2); }
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
    .file-panel.active { display: block; }
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
    .readme-content {
      font-size: 14px;
      line-height: 1.6;
      color: var(--text-secondary);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .comment {
      padding: 12px 0;
      border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    .comment:last-child { border-bottom: none; }
    .comment-release {
      border-left: 2px solid rgba(74,222,128,0.4);
      padding-left: 12px;
    }
    .comment-meta {
      font-size: 12px;
      color: var(--text-muted);
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .comment-meta strong { color: var(--text-dim); }
    .comment-badge {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 4px;
      font-weight: 600;
    }
    .comment-badge.release {
      background: rgba(74,222,128,0.15);
      color: rgba(74,222,128,0.8);
    }
    .comment-version {
      font-size: 11px;
      color: var(--text-muted);
      font-family: monospace;
    }
    .comment-time {
      margin-left: auto;
      font-size: 11px;
      color: var(--text-muted);
    }
    .comment-text {
      font-size: 13px;
      color: var(--text-dim);
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-word;
    }
    @media (max-width: 640px) {
      .ext-title { font-size: 22px; }
      .manifest-grid { grid-template-columns: 1fr; }
      .file-tabs { gap: 2px; }
      .file-tab { font-size: 11px; padding: 6px 10px; }
    }
  `;

  const extraScripts = `
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

    (async function loadComments() {
      try {
        var res = await fetch("/extensions/${encodeURIComponent(ext.name)}/comments?limit=50");
        var data = await res.json();

        // Update reaction counts
        if (data.stars !== undefined) document.getElementById("star-count").textContent = data.stars;
        if (data.flags !== undefined) document.getElementById("flag-count").textContent = data.flags;

        var list = document.getElementById("comments-list");
        if (!data.comments || data.comments.length === 0) {
          list.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">No comments yet.</p>';
          return;
        }
        var html = "";
        for (var c of data.comments) {
          var isRelease = c.type === "release";
          var badge = isRelease ? '<span class="comment-badge release">release</span>' : '';
          var version = c.extensionVersion ? '<span class="comment-version">v' + c.extensionVersion + '</span>' : '';
          var author = c.authorDomain || "unknown land";
          var user = c.authorUsername ? c.authorUsername + " @ " + author : author;
          var ago = timeAgoJs(c.createdAt);
          html += '<div class="comment' + (isRelease ? ' comment-release' : '') + '">'
            + '<div class="comment-meta">'
            + '<strong>' + escapeJs(user) + '</strong> ' + badge + version
            + '<span class="comment-time">' + ago + '</span>'
            + '</div>'
            + '<div class="comment-text">' + escapeJs(c.text) + '</div>'
            + '</div>';
        }
        if (data.total > data.comments.length) {
          html += '<p style="color:var(--text-muted);font-size:12px;margin-top:8px;">' + (data.total - data.comments.length) + ' more comments</p>';
        }
        list.innerHTML = html;
      } catch (e) {
        document.getElementById("comments-list").innerHTML = '<p style="color:var(--text-muted);font-size:13px;">Could not load comments.</p>';
      }
    })();

    function escapeJs(s) {
      if (!s) return "";
      return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    }
    function timeAgoJs(d) {
      if (!d) return "";
      var ms = Date.now() - new Date(d).getTime();
      var s = Math.floor(ms/1000), m = Math.floor(s/60), h = Math.floor(m/60), dy = Math.floor(h/24);
      if (dy > 30) return new Date(d).toLocaleDateString();
      if (dy > 0) return dy + "d ago";
      if (h > 0) return h + "h ago";
      if (m > 0) return m + "m ago";
      return "just now";
    }
  `;

  return pageShell({
    title: `${ext.name} - Canopy Horizon`,
    activePage,
    breadcrumb,
    extraStyles,
    extraScripts,
  }, body);
}
