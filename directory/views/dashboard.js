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

function statusColor(status) {
  switch (status) {
    case "active": return "#10b981";
    case "degraded": return "#f59e0b";
    case "unreachable": return "#ef4444";
    case "dead": return "#6b7280";
    default: return "#9ca3af";
  }
}

export function renderDashboard({ lands, trees, stats }) {
  const landCards = lands && lands.length > 0
    ? lands.map((land, i) => {
        const color = statusColor(land.status);
        return `
          <div class="land-card" style="animation-delay: ${0.1 + i * 0.04}s;">
            <div class="land-card-header">
              <div class="land-name">${escapeHtml(land.name || "Unnamed Land")}</div>
              <div class="land-status">
                <span class="status-dot" style="background: ${color};"></span>
                ${escapeHtml(land.status || "unknown")}
              </div>
            </div>
            <div class="land-domain"><code>${escapeHtml(land.domain)}</code></div>
            <div class="land-meta">
              Protocol v${land.protocolVersion || "?"}
              <span class="separator"></span>
              Last seen ${timeAgo(land.lastSeenAt)}
              ${land.siteUrl ? `<span class="separator"></span><a href="${escapeHtml(land.siteUrl)}" class="land-site-link" target="_blank" rel="noopener">Visit Site</a>` : ""}
            </div>
          </div>
        `;
      }).join("")
    : '<div class="empty-state">No lands registered yet.</div>';

  const treeRows = trees && trees.length > 0
    ? trees.map((tree) => `
        <tr>
          <td>${escapeHtml(tree.name || "Untitled")}</td>
          <td>${escapeHtml(tree.ownerUsername || "unknown")}</td>
          <td><code>${escapeHtml(tree.landDomain || "")}</code></td>
        </tr>
      `).join("")
    : '<tr><td colspan="3" class="empty-state">No public trees indexed yet.</td></tr>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <title>Canopy Directory</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --glass-water-rgb: 115, 111, 230;
      --glass-alpha: 0.28;
      --glass-alpha-hover: 0.38;
      --text-primary: #ffffff;
      --text-secondary: rgba(255, 255, 255, 0.75);
      --text-muted: rgba(255, 255, 255, 0.45);
      --accent: #10b981;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      color: var(--text-primary);
      overflow-x: hidden;
    }

    body::before, body::after {
      content: "";
      position: absolute;
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

    .page-header {
      text-align: center;
      margin-bottom: 32px;
      animation: fadeInUp 0.5s ease-out both;
    }
    .page-header h1 {
      font-size: 32px;
      font-weight: 800;
      letter-spacing: -0.5px;
      margin-bottom: 6px;
    }
    .page-header p {
      font-size: 15px;
      color: var(--text-secondary);
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

    /* Stats */
    .stats-row {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      justify-content: center;
      margin-bottom: 8px;
    }
    .stat-chip {
      padding: 10px 20px;
      border-radius: 980px;
      background: rgba(255, 255, 255, 0.08);
      font-size: 14px;
      font-weight: 600;
    }
    .stat-chip .num {
      color: var(--accent);
      margin-right: 4px;
      font-size: 18px;
    }

    /* Land cards */
    .land-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 14px;
    }
    .land-card {
      padding: 16px;
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.06);
      animation: fadeInUp 0.5s ease-out both;
      transition: background 0.2s ease;
    }
    .land-card:hover {
      background: rgba(255, 255, 255, 0.1);
    }
    .land-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }
    .land-name {
      font-size: 16px;
      font-weight: 700;
    }
    .land-status {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .status-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: 4px;
      vertical-align: middle;
    }
    .land-domain {
      margin-bottom: 6px;
    }
    .land-domain code {
      font-family: "JetBrains Mono", monospace;
      font-size: 13px;
      padding: 2px 8px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 6px;
    }
    .land-meta {
      font-size: 12px;
      color: var(--text-muted);
    }
    .land-site-link {
      color: var(--accent);
      text-decoration: none;
      font-weight: 600;
    }
    .land-site-link:hover { text-decoration: underline; }

    .separator {
      display: inline-block;
      width: 3px;
      height: 3px;
      border-radius: 50%;
      background: var(--text-muted);
      margin: 0 8px;
      vertical-align: middle;
    }

    /* Search */
    .search-row {
      display: flex;
      gap: 10px;
      margin-bottom: 16px;
    }
    .search-row input {
      flex: 1;
      padding: 10px 16px;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.28);
      background: rgba(var(--glass-water-rgb), 0.2);
      backdrop-filter: blur(12px);
      color: var(--text-primary);
      font-family: inherit;
      font-size: 14px;
      outline: none;
    }
    .search-row input::placeholder { color: var(--text-muted); }
    .search-row input:focus { border-color: var(--accent); }
    .search-row button {
      padding: 10px 20px;
      border-radius: 980px;
      background: var(--accent);
      color: white;
      border: 1px solid rgba(255, 255, 255, 0.3);
      font-family: inherit;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s ease;
    }
    .search-row button:hover { background: #0ea572; }

    /* Table */
    .data-table { width: 100%; border-collapse: collapse; }
    .data-table th, .data-table td {
      text-align: left;
      padding: 10px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      font-size: 14px;
    }
    .data-table th {
      font-weight: 700;
      color: var(--text-secondary);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .data-table tr:last-child td { border-bottom: none; }
    .data-table code {
      font-family: "JetBrains Mono", monospace;
      font-size: 12px;
      padding: 2px 6px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 4px;
    }

    .empty-state {
      text-align: center;
      padding: 32px 16px;
      color: var(--text-muted);
      font-size: 14px;
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
    .footer-cta {
      display: inline-block;
      padding: 10px 24px;
      border-radius: 980px;
      background: var(--accent);
      color: white !important;
      font-weight: 600;
      font-size: 14px;
      border: 1px solid rgba(255, 255, 255, 0.3);
      transition: background 0.2s ease;
    }
    .footer-cta:hover { background: #0ea572; }

    @media (max-width: 640px) {
      body { padding: 12px; }
      .glass-card { padding: 16px; border-radius: 16px; }
      .page-header h1 { font-size: 24px; }
      .land-grid { grid-template-columns: 1fr; }
      .search-row { flex-direction: column; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="page-header">
      <h1>Canopy Directory</h1>
      <p>The phonebook for the TreeOS network</p>
    </div>

    <!-- Stats -->
    <div class="glass-card" style="animation-delay: 0.05s;">
      <div class="stats-row">
        <div class="stat-chip"><span class="num">${stats.landCount}</span> lands</div>
        <div class="stat-chip"><span class="num">${stats.treeCount}</span> public trees</div>
        <div class="stat-chip"><span class="num">${stats.activeLands}</span> active</div>
      </div>
    </div>

    <!-- Lands -->
    <div class="glass-card" style="animation-delay: 0.1s;">
      <h2>Registered Lands</h2>
      <div class="search-row">
        <input type="text" id="land-search" placeholder="Search lands..." onkeydown="if(event.key==='Enter')searchLands()" />
        <button onclick="searchLands()">Search</button>
      </div>
      <div id="land-grid" class="land-grid">
        ${landCards}
      </div>
    </div>

    <!-- Public Trees -->
    <div class="glass-card" style="animation-delay: 0.15s;">
      <h2>Public Trees</h2>
      <div class="search-row">
        <input type="text" id="tree-search" placeholder="Search public trees..." onkeydown="if(event.key==='Enter')searchTrees()" />
        <button onclick="searchTrees()">Search</button>
      </div>
      <div style="overflow-x: auto;">
        <table class="data-table" id="tree-table">
          <thead>
            <tr>
              <th>Tree</th>
              <th>Owner</th>
              <th>Land</th>
            </tr>
          </thead>
          <tbody id="tree-body">
            ${treeRows}
          </tbody>
        </table>
      </div>
    </div>

    <div class="footer">
      <a href="https://treeos.ai/about/land" class="footer-cta">What is a Land? Start your own.</a>
      <br><br>
      Canopy Directory Service
      <span class="separator"></span>
      <a href="/directory/health">API Health</a>
    </div>
  </div>

  <script>
    function escapeHtml(str) {
      if (!str) return "";
      var div = document.createElement("div");
      div.textContent = str;
      return div.innerHTML;
    }

    function timeAgo(date) {
      if (!date) return "never";
      var seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
      if (seconds < 60) return seconds + "s ago";
      if (seconds < 3600) return Math.floor(seconds / 60) + "m ago";
      if (seconds < 86400) return Math.floor(seconds / 3600) + "h ago";
      return Math.floor(seconds / 86400) + "d ago";
    }

    function statusColor(s) {
      if (s === "active") return "#10b981";
      if (s === "degraded") return "#f59e0b";
      if (s === "unreachable") return "#ef4444";
      return "#6b7280";
    }

    async function searchLands() {
      var q = document.getElementById("land-search").value.trim();
      try {
        var res = await fetch("/directory/lands?q=" + encodeURIComponent(q) + "&limit=50");
        var data = await res.json();
        var grid = document.getElementById("land-grid");

        if (!data.lands || data.lands.length === 0) {
          grid.innerHTML = '<div class="empty-state">No lands found.</div>';
          return;
        }

        grid.innerHTML = data.lands.map(function(land) {
          var color = statusColor(land.status);
          return '<div class="land-card">' +
            '<div class="land-card-header">' +
              '<div class="land-name">' + escapeHtml(land.name || "Unnamed Land") + '</div>' +
              '<div class="land-status"><span class="status-dot" style="background:' + color + '"></span>' + escapeHtml(land.status || "unknown") + '</div>' +
            '</div>' +
            '<div class="land-domain"><code>' + escapeHtml(land.domain) + '</code></div>' +
            '<div class="land-meta">Protocol v' + (land.protocolVersion || "?") +
              '<span class="separator"></span>Last seen ' + timeAgo(land.lastSeenAt) +
              (land.siteUrl ? '<span class="separator"></span><a href="' + escapeHtml(land.siteUrl) + '" class="land-site-link" target="_blank" rel="noopener">Visit Site</a>' : '') + '</div>' +
          '</div>';
        }).join("");
      } catch (err) {
        console.error("Search failed:", err);
      }
    }

    async function searchTrees() {
      var q = document.getElementById("tree-search").value.trim();
      try {
        var res = await fetch("/directory/search/trees?q=" + encodeURIComponent(q) + "&limit=50");
        var data = await res.json();
        var tbody = document.getElementById("tree-body");

        if (!data.trees || data.trees.length === 0) {
          tbody.innerHTML = '<tr><td colspan="3" class="empty-state">No trees found.</td></tr>';
          return;
        }

        tbody.innerHTML = data.trees.map(function(tree) {
          return '<tr>' +
            '<td>' + escapeHtml(tree.name || "Untitled") + '</td>' +
            '<td>' + escapeHtml(tree.ownerUsername || "unknown") + '</td>' +
            '<td><code>' + escapeHtml(tree.landDomain || "") + '</code></td>' +
          '</tr>';
        }).join("");
      } catch (err) {
        console.error("Search failed:", err);
      }
    }
  </script>
</body>
</html>`;
}
