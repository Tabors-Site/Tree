/**
 * Land Admin Page ("/land")
 *
 * Admin-only dashboard showing land identity, installed extensions,
 * land stats, and key config values. Extension management (enable/disable)
 * via inline JavaScript fetch calls.
 */

export function renderLandPage({
  landName, domain, seedVersion, landUrl,
  userCount, treeCount, peerCount,
  extensions, disabledExtensions,
  config,
  horizonUrl,
}) {
  const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const extRows = extensions.map(ext => {
    const isDisabled = disabledExtensions.includes(ext.name);
    return `
      <tr id="ext-${esc(ext.name)}">
        <td style="font-family:monospace;color:#4ade80">${esc(ext.name)}</td>
        <td style="color:#888">${esc(ext.version)}</td>
        <td style="color:#666;max-width:300px">${esc(ext.description?.slice(0, 100) || "")}</td>
        <td>
          <span class="status-badge ${isDisabled ? "disabled" : "active"}">${isDisabled ? "Disabled" : "Active"}</span>
        </td>
        <td>
          <button class="btn-sm" onclick="toggleExt('${esc(ext.name)}', ${isDisabled})">${isDisabled ? "Enable" : "Disable"}</button>
        </td>
      </tr>`;
  }).join("");

  const configRows = Object.entries(config)
    .filter(([k]) => !k.startsWith("_"))
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 40)
    .map(([key, val]) => `
      <tr>
        <td style="font-family:monospace;color:#60a5fa">${esc(key)}</td>
        <td style="color:#888">${esc(typeof val === "object" ? JSON.stringify(val) : String(val))}</td>
      </tr>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#0a0a0a">
  <title>${esc(landName)} . Admin</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0a0a0a;
      color: #e5e5e5;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      -webkit-font-smoothing: antialiased;
      padding: 32px;
    }

    .container { max-width: 1000px; margin: 0 auto; }

    .top-nav {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 40px;
    }
    .top-nav h1 { font-size: 28px; font-weight: 700; }
    .top-nav a {
      color: rgba(255,255,255,0.5);
      text-decoration: none;
      font-size: 14px;
    }
    .top-nav a:hover { color: #fff; }

    .section {
      margin-bottom: 48px;
    }
    .section h2 {
      font-size: 20px;
      font-weight: 700;
      color: #fff;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }

    .stats-row {
      display: flex;
      gap: 24px;
      margin-bottom: 32px;
      flex-wrap: wrap;
    }
    .stat-card {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 10px;
      padding: 20px 28px;
      text-align: center;
      min-width: 120px;
    }
    .stat-card .num { font-size: 28px; font-weight: 700; color: #fff; }
    .stat-card .label { font-size: 12px; color: rgba(255,255,255,0.35); text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }

    table {
      width: 100%;
      border-collapse: collapse;
    }
    th {
      text-align: left;
      padding: 8px 12px;
      font-size: 11px;
      color: rgba(255,255,255,0.3);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    td {
      padding: 10px 12px;
      font-size: 14px;
      border-bottom: 1px solid rgba(255,255,255,0.03);
    }

    .status-badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
    }
    .status-badge.active { background: rgba(74,222,128,0.15); color: #4ade80; }
    .status-badge.disabled { background: rgba(248,113,113,0.15); color: #f87171; }

    .btn-sm {
      padding: 5px 14px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid rgba(255,255,255,0.15);
      background: transparent;
      color: #e5e5e5;
      transition: all 0.2s;
    }
    .btn-sm:hover { border-color: rgba(255,255,255,0.3); background: rgba(255,255,255,0.05); }

    .search-row {
      display: flex;
      gap: 10px;
      margin-bottom: 16px;
    }
    .search-row input {
      flex: 1;
      padding: 10px 14px;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.03);
      color: #e5e5e5;
      font-size: 14px;
      outline: none;
    }
    .search-row input:focus { border-color: rgba(255,255,255,0.2); }
    .search-row button {
      padding: 10px 20px;
      border-radius: 8px;
      border: none;
      background: #fff;
      color: #0a0a0a;
      font-weight: 600;
      cursor: pointer;
      font-size: 14px;
    }

    #horizon-results { margin-top: 12px; }
    .horizon-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 0;
      border-bottom: 1px solid rgba(255,255,255,0.03);
    }
    .horizon-item .name { font-family: monospace; color: #60a5fa; }
    .horizon-item .desc { color: #666; font-size: 13px; margin-left: 12px; flex: 1; }

    .toast {
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      z-index: 100;
      transition: opacity 0.3s;
    }
    .toast.ok { background: rgba(74,222,128,0.2); color: #4ade80; border: 1px solid rgba(74,222,128,0.3); }
    .toast.err { background: rgba(248,113,113,0.2); color: #f87171; border: 1px solid rgba(248,113,113,0.3); }

    @media (max-width: 600px) {
      body { padding: 16px; }
      .stats-row { gap: 12px; }
      .stat-card { padding: 14px 18px; min-width: 80px; }
      .stat-card .num { font-size: 20px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="top-nav">
      <h1>${esc(landName)}</h1>
      <div>
        <a href="/">Home</a>
        <span style="color:rgba(255,255,255,0.15);margin:0 8px">.</span>
        <a href="/dashboard">Dashboard</a>
      </div>
    </div>

    <!-- Stats -->
    <div class="stats-row">
      <div class="stat-card"><div class="num">${extensions.length}</div><div class="label">Extensions</div></div>
      <div class="stat-card"><div class="num">${userCount}</div><div class="label">Users</div></div>
      <div class="stat-card"><div class="num">${treeCount}</div><div class="label">Trees</div></div>
      <div class="stat-card"><div class="num">${peerCount}</div><div class="label">Peers</div></div>
      <div class="stat-card"><div class="num">${esc(seedVersion)}</div><div class="label">Seed</div></div>
    </div>

    <!-- Extensions -->
    <div class="section">
      <h2>Extensions (${extensions.length})</h2>
      <table>
        <thead><tr><th>Name</th><th>Version</th><th>Description</th><th>Status</th><th></th></tr></thead>
        <tbody>${extRows}</tbody>
      </table>
    </div>

    <!-- Horizon -->
    <div class="section">
      <h2>Horizon</h2>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <span style="color:rgba(255,255,255,0.3);font-size:0.8rem;">Connected to:</span>
        <code style="color:#60a5fa;font-size:0.8rem;" id="horizonUrlDisplay">${esc(horizonUrl)}</code>
        <button class="btn-sm" onclick="changeHorizon()" style="font-size:0.7rem;padding:3px 8px;">Change</button>
      </div>
      <div class="search-row">
        <input type="text" id="horizon-search" placeholder="Search extensions on the network..." />
        <button onclick="searchHorizon()">Search</button>
      </div>
      <div id="horizon-results"></div>
    </div>

    <!-- Config -->
    <div class="section">
      <h2>Config</h2>
      <table>
        <thead><tr><th>Key</th><th>Value</th></tr></thead>
        <tbody>${configRows}</tbody>
      </table>
    </div>
  </div>

  <script>
    function toast(msg, type) {
      const el = document.createElement("div");
      el.className = "toast " + type;
      el.textContent = msg;
      document.body.appendChild(el);
      setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 300); }, 3000);
    }

    async function changeHorizon() {
      const newUrl = prompt("Horizon URL:", document.getElementById("horizonUrlDisplay").textContent);
      if (!newUrl || !newUrl.startsWith("http")) return;
      try {
        const res = await fetch("/api/v1/land/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ key: "HORIZON_URL", value: newUrl }),
        });
        if (res.ok) {
          document.getElementById("horizonUrlDisplay").textContent = newUrl;
          toast("Horizon URL updated.", "ok");
        } else {
          const data = await res.json();
          toast(data.error?.message || "Failed", "err");
        }
      } catch (err) { toast(err.message, "err"); }
    }

    async function toggleExt(name, isCurrentlyDisabled) {
      const action = isCurrentlyDisabled ? "enable" : "disable";
      try {
        const res = await fetch("/api/v1/land/extensions/" + encodeURIComponent(name) + "/" + action, { method: "POST", credentials: "include" });
        const data = await res.json();
        if (res.ok) {
          toast(name + " " + action + "d. Restart to apply.", "ok");
          setTimeout(() => location.reload(), 1500);
        } else {
          toast((data.error?.message || data.message || "Failed"), "err");
        }
      } catch (err) { toast(err.message, "err"); }
    }

    async function searchHorizon() {
      const q = document.getElementById("horizon-search").value.trim();
      const container = document.getElementById("horizon-results");
      container.innerHTML = '<div style="color:#666;font-size:13px">Searching...</div>';
      try {
        const horizonUrl = ${JSON.stringify(horizonUrl || "https://horizon.treeos.ai")};
        const res = await fetch(horizonUrl + "/extensions" + (q ? "?q=" + encodeURIComponent(q) : ""));
        const raw = await res.json();
        const data = raw.data || raw;
        const exts = data.extensions || data || [];
        if (!Array.isArray(exts) || !exts.length) {
          container.innerHTML = '<div style="color:#666;font-size:13px">No results.</div>';
          return;
        }
        container.innerHTML = exts.slice(0, 20).map(e =>
          '<div class="horizon-item">' +
          '<span class="name">' + (e.name || "?") + '</span>' +
          '<span class="desc">' + ((e.description || "").slice(0, 80)) + '</span>' +
          '<button class="btn-sm" onclick="installExt(\\'' + (e.name || "") + '\\')">Install</button>' +
          '</div>'
        ).join("");
      } catch (err) {
        container.innerHTML = '<div style="color:#f87171;font-size:13px">' + err.message + '</div>';
      }
    }

    async function installExt(name) {
      try {
        const res = await fetch("/api/v1/land/extensions/install", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ name }),
        });
        const data = await res.json();
        if (res.ok) { toast(name + " installed. Restart to activate.", "ok"); }
        else { toast((data.error?.message || "Install failed"), "err"); }
      } catch (err) { toast(err.message, "err"); }
    }
  </script>
</body>
</html>`;
}
