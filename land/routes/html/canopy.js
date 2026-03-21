/* ------------------------------------------------- */
/* HTML renderers for Canopy admin pages              */
/* ------------------------------------------------- */

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function truncate(str, len = 24) {
  if (!str) return "";
  return str.length > len ? str.slice(0, len) + "..." : str;
}

function statusColor(status) {
  switch (status) {
    case "active":
      return "#10b981";
    case "degraded":
      return "#f59e0b";
    case "unreachable":
      return "#ef4444";
    case "dead":
      return "#6b7280";
    case "blocked":
      return "#111827";
    default:
      return "#9ca3af";
  }
}

function timeAgo(date) {
  if (!date) return "never";
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return seconds + "s ago";
  if (seconds < 3600) return Math.floor(seconds / 60) + "m ago";
  if (seconds < 86400) return Math.floor(seconds / 3600) + "h ago";
  return Math.floor(seconds / 86400) + "d ago";
}

// ─────────────────────────────────────────────────────────────────────────
// Shared CSS
// ─────────────────────────────────────────────────────────────────────────

const sharedStyles = `
:root {
  --glass-water-rgb: 115, 111, 230;
  --glass-alpha: 0.28;
  --glass-alpha-hover: 0.38;
  --text-primary: #ffffff;
  --text-secondary: rgba(255, 255, 255, 0.75);
  --text-muted: rgba(255, 255, 255, 0.45);
  --accent: #10b981;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}

body {
  font-family: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI",
    "Roboto", "Oxygen", "Ubuntu", "Cantarell", sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
  min-height: 100dvh;
  padding: 20px;
  color: var(--text-primary);
  position: relative;
  overflow-x: hidden;
  touch-action: manipulation;
}

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
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50% { transform: translateY(-30px) rotate(5deg); }
}

@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(30px); }
  to { opacity: 1; transform: translateY(0); }
}

.container {
  max-width: 900px;
  margin: 0 auto;
  position: relative;
  z-index: 1;
}

/* =========================================================
   GLASS CARD
   ========================================================= */

.glass-card {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 20px;
  padding: 24px;
  margin-bottom: 20px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.15);
  animation: fadeInUp 0.6s ease-out both;
}

.glass-card h2 {
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 16px;
  letter-spacing: -0.3px;
}

.glass-card h3 {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 12px;
  color: var(--text-secondary);
}

/* =========================================================
   PAGE HEADER
   ========================================================= */

.page-header {
  text-align: center;
  margin-bottom: 32px;
  animation: fadeInUp 0.5s ease-out both;
}

.page-header h1 {
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.5px;
  margin-bottom: 6px;
}

.page-header p {
  font-size: 14px;
  color: var(--text-secondary);
}

/* =========================================================
   NAV LINKS
   ========================================================= */

.nav-links {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-bottom: 24px;
  flex-wrap: wrap;
  animation: fadeInUp 0.5s ease-out both;
  animation-delay: 0.05s;
}

.nav-links a {
  color: var(--text-primary);
  text-decoration: none;
  padding: 8px 18px;
  border-radius: 980px;
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.28);
  font-size: 14px;
  font-weight: 600;
  transition: background 0.3s ease, transform 0.3s ease;
}

.nav-links a:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-2px);
}

.nav-links a.active {
  background: var(--accent);
  border-color: var(--accent);
}

/* =========================================================
   GLASS BUTTONS
   ========================================================= */

.glass-btn,
button {
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
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.2px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  cursor: pointer;
  transition: background 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.3s ease;
}

button:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-2px);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
}

button:active {
  transform: translateY(0);
}

button.accent-btn {
  background: var(--accent);
  border-color: rgba(255, 255, 255, 0.3);
}

button.accent-btn:hover {
  background: #0ea572;
}

button.danger-btn {
  background: rgba(239, 68, 68, 0.6);
  border-color: rgba(239, 68, 68, 0.4);
}

button.danger-btn:hover {
  background: rgba(239, 68, 68, 0.8);
}

button.warn-btn {
  background: rgba(245, 158, 11, 0.6);
  border-color: rgba(245, 158, 11, 0.4);
}

button.warn-btn:hover {
  background: rgba(245, 158, 11, 0.8);
}

button.small-btn {
  padding: 6px 14px;
  font-size: 12px;
}

/* =========================================================
   TABLES
   ========================================================= */

.data-table {
  width: 100%;
  border-collapse: collapse;
}

.data-table th,
.data-table td {
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

.data-table td {
  color: var(--text-primary);
}

.data-table tr:last-child td {
  border-bottom: none;
}

.data-table code {
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  padding: 2px 6px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
}

.status-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 6px;
  vertical-align: middle;
}

/* =========================================================
   FORMS
   ========================================================= */

.form-row {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.form-row input[type="text"],
.form-row input[type="url"],
.form-row select {
  flex: 1;
  min-width: 200px;
  padding: 10px 16px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  background: rgba(var(--glass-water-rgb), 0.2);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s ease;
}

.form-row input::placeholder {
  color: var(--text-muted);
}

.form-row input:focus,
.form-row select:focus {
  border-color: var(--accent);
}

.form-row select option {
  background: #3b3572;
  color: white;
}

/* =========================================================
   IDENTITY CARD
   ========================================================= */

.identity-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}

.identity-item {
  padding: 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
}

.identity-item .label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  margin-bottom: 4px;
}

.identity-item .value {
  font-family: "JetBrains Mono", monospace;
  font-size: 13px;
  word-break: break-all;
}

/* =========================================================
   STATS ROW
   ========================================================= */

.stats-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.stat-chip {
  padding: 8px 16px;
  border-radius: 980px;
  background: rgba(255, 255, 255, 0.08);
  font-size: 13px;
  font-weight: 600;
}

.stat-chip .num {
  color: var(--accent);
  margin-right: 4px;
}

/* =========================================================
   EMPTY STATE
   ========================================================= */

.empty-state {
  text-align: center;
  padding: 32px 16px;
  color: var(--text-muted);
  font-size: 14px;
}

/* =========================================================
   TOAST
   ========================================================= */

.toast-container {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.toast {
  padding: 12px 20px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 600;
  backdrop-filter: blur(22px);
  -webkit-backdrop-filter: blur(22px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  animation: fadeInUp 0.3s ease-out;
  transition: opacity 0.3s ease;
}

.toast.success {
  background: rgba(16, 185, 129, 0.85);
  color: white;
}

.toast.error {
  background: rgba(239, 68, 68, 0.85);
  color: white;
}

/* =========================================================
   ACTION CELL
   ========================================================= */

.action-cell {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

/* =========================================================
   RESPONSIVE
   ========================================================= */

@media (max-width: 640px) {
  body { padding: 12px; }
  .glass-card { padding: 16px; border-radius: 16px; }
  .page-header h1 { font-size: 22px; }
  .identity-grid { grid-template-columns: 1fr; }
  .data-table th, .data-table td { padding: 8px 6px; font-size: 13px; }
  .form-row { flex-direction: column; }
  .form-row input[type="text"],
  .form-row input[type="url"],
  .form-row select { min-width: 100%; }
  .action-cell { flex-direction: column; }
}
`;

// ─────────────────────────────────────────────────────────────────────────
// Shared JS helpers
// ─────────────────────────────────────────────────────────────────────────

const sharedScripts = `
function showToast(message, type) {
  var container = document.getElementById("toast-container");
  var toast = document.createElement("div");
  toast.className = "toast " + type;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(function () {
    toast.style.opacity = "0";
    setTimeout(function () { toast.remove(); }, 300);
  }, 3000);
}

async function canopyFetch(url, options) {
  options = options || {};
  options.credentials = "include";
  options.headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
  try {
    var res = await fetch(url, options);
    var data = await res.json();
    if (!res.ok || !data.success) {
      showToast(data.error || "Request failed", "error");
      return null;
    }
    return data;
  } catch (err) {
    showToast(err.message || "Network error", "error");
    return null;
  }
}
`;

// ─────────────────────────────────────────────────────────────────────────
// 1. renderCanopyAdmin
// ─────────────────────────────────────────────────────────────────────────

export function renderCanopyAdmin({ land, peers, pendingEvents, failedEvents }) {
  const landName = escapeHtml(land?.name || "Unknown Land");
  const landDomain = escapeHtml(land?.domain || "");
  const landId = escapeHtml(land?.landId || "");
  const protocolVersion = escapeHtml(land?.protocolVersion || "");
  const publicKey = escapeHtml(truncate(land?.publicKey || "", 32));

  const peerRows =
    peers && peers.length > 0
      ? peers
          .map((p) => {
            const domain = escapeHtml(p.domain || "");
            const name = escapeHtml(p.name || "");
            const status = p.status || "unknown";
            const color = statusColor(status);
            const lastSeen = timeAgo(p.lastSeenAt);
            const isBlocked = status === "blocked";

            return `
              <tr>
                <td><code>${domain}</code></td>
                <td>${name || '<span style="color: var(--text-muted);">unnamed</span>'}</td>
                <td>
                  <span class="status-dot" style="background: ${color};"></span>
                  ${status}
                </td>
                <td style="color: var(--text-secondary);">${lastSeen}</td>
                <td>
                  <div class="action-cell">
                    ${
                      isBlocked
                        ? `<button class="small-btn accent-btn" onclick="unblockPeer('${domain}')">Unblock</button>`
                        : `<button class="small-btn warn-btn" onclick="blockPeer('${domain}')">Block</button>`
                    }
                    <button class="small-btn danger-btn" onclick="removePeer('${domain}')">Remove</button>
                  </div>
                </td>
              </tr>
            `;
          })
          .join("")
      : `<tr><td colspan="5" class="empty-state">No peers connected yet. Add one below to start federating.</td></tr>`;

  const failedEventRows =
    failedEvents && failedEvents.length > 0
      ? failedEvents
          .map((evt) => {
            const evtId = escapeHtml(evt._id || "");
            const evtType = escapeHtml(evt.eventType || evt.type || "unknown");
            const evtDomain = escapeHtml(evt.targetDomain || evt.domain || "");
            const evtTime = timeAgo(evt.createdAt || evt.lastAttemptAt);
            return `
              <tr>
                <td><code>${truncate(evtId, 12)}</code></td>
                <td>${evtType}</td>
                <td>${evtDomain}</td>
                <td style="color: var(--text-secondary);">${evtTime}</td>
                <td>
                  <button class="small-btn accent-btn" onclick="retryEvent('${evtId}')">Retry</button>
                </td>
              </tr>
            `;
          })
          .join("")
      : `<tr><td colspan="5" class="empty-state">No failed events. All clear.</td></tr>`;

  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="theme-color" content="#667eea">
    <title>Canopy Admin</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
    <style>${sharedStyles}</style>
  </head>
  <body>
    <div id="toast-container" class="toast-container"></div>

    <div class="container">
      <div class="page-header">
        <h1>Canopy Admin</h1>
        <p>Federation management for your land</p>
      </div>

      <div class="nav-links">
        ${navLinks("/canopy/admin")}
      </div>

      <!-- Identity Card -->
      <div class="glass-card" style="animation-delay: 0.1s;">
        <h2>This Land</h2>
        <div class="identity-grid">
          <div class="identity-item">
            <div class="label">Name</div>
            <div class="value">${landName}</div>
          </div>
          <div class="identity-item">
            <div class="label">Domain</div>
            <div class="value">${landDomain}</div>
          </div>
          <div class="identity-item">
            <div class="label">Land ID</div>
            <div class="value">${truncate(landId, 16)}</div>
          </div>
          <div class="identity-item">
            <div class="label">Protocol</div>
            <div class="value">${protocolVersion}</div>
          </div>
          <div class="identity-item">
            <div class="label">Public Key</div>
            <div class="value">${publicKey}</div>
          </div>
        </div>
      </div>

      <!-- Stats + Actions -->
      <div class="glass-card" style="animation-delay: 0.15s;">
        <div class="stats-row">
          <div class="stat-chip"><span class="num">${peers ? peers.length : 0}</span> peers</div>
          <div class="stat-chip"><span class="num">${pendingEvents || 0}</span> pending events</div>
          <div class="stat-chip"><span class="num">${failedEvents ? failedEvents.length : 0}</span> failed events</div>
        </div>
        <button class="accent-btn" onclick="runHeartbeat()">Run Heartbeat</button>
      </div>

      <!-- Peer List -->
      <div class="glass-card" style="animation-delay: 0.2s;">
        <h2>Peers</h2>
        <div style="overflow-x: auto;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Domain</th>
                <th>Name</th>
                <th>Status</th>
                <th>Last Seen</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${peerRows}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Add Peer -->
      <div class="glass-card" style="animation-delay: 0.25s;">
        <h2>Add Peer</h2>
        <div class="form-row">
          <input type="url" id="peer-url" placeholder="https://other.land.example.com" />
          <button class="accent-btn" onclick="addPeer()">Add Peer</button>
        </div>
      </div>

      <!-- Failed Events -->
      <div class="glass-card" style="animation-delay: 0.3s;">
        <h2>Failed Events</h2>
        <div style="overflow-x: auto;">
          <table class="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Type</th>
                <th>Target</th>
                <th>When</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="failed-events-body">
              ${failedEventRows}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <script>
      ${sharedScripts}

      async function addPeer() {
        var urlInput = document.getElementById("peer-url");
        var url = urlInput.value.trim();
        if (!url) { showToast("Please enter a URL", "error"); return; }
        var data = await canopyFetch("/canopy/admin/peer/add", {
          method: "POST",
          body: JSON.stringify({ url: url })
        });
        if (data) {
          showToast("Peer added successfully", "success");
          setTimeout(function () { location.reload(); }, 800);
        }
      }

      async function removePeer(domain) {
        if (!confirm("Remove peer " + domain + "?")) return;
        var data = await canopyFetch("/canopy/admin/peer/" + encodeURIComponent(domain), {
          method: "DELETE"
        });
        if (data) {
          showToast("Peer removed", "success");
          setTimeout(function () { location.reload(); }, 800);
        }
      }

      async function blockPeer(domain) {
        var data = await canopyFetch("/canopy/admin/peer/" + encodeURIComponent(domain) + "/block", {
          method: "POST"
        });
        if (data) {
          showToast("Peer blocked", "success");
          setTimeout(function () { location.reload(); }, 800);
        }
      }

      async function unblockPeer(domain) {
        var data = await canopyFetch("/canopy/admin/peer/" + encodeURIComponent(domain) + "/unblock", {
          method: "POST"
        });
        if (data) {
          showToast("Peer unblocked", "success");
          setTimeout(function () { location.reload(); }, 800);
        }
      }

      async function runHeartbeat() {
        showToast("Running heartbeat...", "success");
        var data = await canopyFetch("/canopy/admin/heartbeat", { method: "POST" });
        if (data) {
          showToast("Heartbeat complete", "success");
          setTimeout(function () { location.reload(); }, 800);
        }
      }

      async function retryEvent(eventId) {
        var data = await canopyFetch("/canopy/admin/events/" + encodeURIComponent(eventId) + "/retry", {
          method: "POST"
        });
        if (data) {
          showToast("Event retried", "success");
          setTimeout(function () { location.reload(); }, 800);
        }
      }
    </script>
  </body>
  </html>
  `;
}

// ─────────────────────────────────────────────────────────────────────────
// NAV HELPER
// ─────────────────────────────────────────────────────────────────────────

function navLinks(activePage) {
  const pages = [
    { href: "/canopy/admin", label: "Dashboard" },
    { href: "/canopy/admin/invites", label: "Invites" },
    { href: "/canopy/admin/directory", label: "Directory" },
  ];
  return pages
    .map(
      (p) =>
        `<a href="${p.href}" class="${p.href === activePage ? "active" : ""}">${p.label}</a>`
    )
    .join("\n");
}

// ─────────────────────────────────────────────────────────────────────────
// 2. renderCanopyInvites
// ─────────────────────────────────────────────────────────────────────────

export function renderCanopyInvites({ invites, remoteUsers, localTrees }) {
  // Build a map of remote user IDs to display info
  const remoteMap = {};
  if (remoteUsers && remoteUsers.length > 0) {
    remoteUsers.forEach((ru) => {
      remoteMap[ru._id] = ru;
    });
  }

  const incomingRows =
    invites && invites.length > 0
      ? invites
          .map((inv) => {
            const remote = remoteMap[inv.userInviting] || {};
            const canopyId = remote.username
              ? escapeHtml(remote.username + "@" + remote.homeLandDomain)
              : escapeHtml(inv.userInviting || "unknown");
            const treeName = escapeHtml(inv.rootName || inv.rootId || "unknown tree");
            const status = escapeHtml(inv.status || "pending");

            return `
              <tr>
                <td><code>${canopyId}</code></td>
                <td>${treeName}</td>
                <td>${status}</td>
              </tr>
            `;
          })
          .join("")
      : `<tr><td colspan="3" class="empty-state">No incoming invites.</td></tr>`;

  const treeOptions =
    localTrees && localTrees.length > 0
      ? localTrees
          .map(
            (t) =>
              `<option value="${escapeHtml(t._id)}">${escapeHtml(t.name || "Untitled")}</option>`
          )
          .join("")
      : `<option value="" disabled>No trees available</option>`;

  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="theme-color" content="#667eea">
    <title>Canopy Invites</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
    <style>${sharedStyles}</style>
  </head>
  <body>
    <div id="toast-container" class="toast-container"></div>

    <div class="container">
      <div class="page-header">
        <h1>Canopy Invites</h1>
        <p>Cross land collaboration invitations</p>
      </div>

      <div class="nav-links">
        ${navLinks("/canopy/admin/invites")}
      </div>

      <!-- Incoming Invites -->
      <div class="glass-card" style="animation-delay: 0.1s;">
        <h2>Incoming Invites</h2>
        <div style="overflow-x: auto;">
          <table class="data-table">
            <thead>
              <tr>
                <th>From</th>
                <th>Tree</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${incomingRows}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Send Invite -->
      <div class="glass-card" style="animation-delay: 0.2s;">
        <h2>Invite Remote User</h2>
        <p style="color: var(--text-secondary); font-size: 13px; margin-bottom: 16px;">
          Enter a canopy ID (username@domain) and select a tree to invite them to.
        </p>
        <div class="form-row">
          <input type="text" id="canopy-id" placeholder="username@other.land.com" />
          <select id="root-select">
            <option value="" disabled selected>Select a tree</option>
            ${treeOptions}
          </select>
          <button class="accent-btn" onclick="sendInvite()">Send Invite</button>
        </div>
      </div>
    </div>

    <script>
      ${sharedScripts}

      async function sendInvite() {
        var canopyId = document.getElementById("canopy-id").value.trim();
        var rootId = document.getElementById("root-select").value;

        if (!canopyId) { showToast("Please enter a canopy ID", "error"); return; }
        if (!rootId) { showToast("Please select a tree", "error"); return; }

        var data = await canopyFetch("/canopy/admin/invite-remote", {
          method: "POST",
          body: JSON.stringify({ canopyId: canopyId, rootId: rootId })
        });
        if (data) {
          showToast("Invite sent to " + canopyId, "success");
          document.getElementById("canopy-id").value = "";
          setTimeout(function () { location.reload(); }, 800);
        }
      }
    </script>
  </body>
  </html>
  `;
}

// ─────────────────────────────────────────────────────────────────────────
// 3. renderCanopyDirectory
// ─────────────────────────────────────────────────────────────────────────

export function renderCanopyDirectory({ hasDirectory }) {
  const noDirectoryMessage = !hasDirectory
    ? '<div class="glass-card" style="animation-delay: 0.1s;">' +
      '<div class="empty-state">' +
      '<p>No directory service configured.</p>' +
      '<p style="margin-top: 8px; font-size: 13px;">Set the <code>DIRECTORY_URL</code> environment variable to connect to a directory and discover other lands.</p>' +
      '</div></div>'
    : "";

  const searchSection = hasDirectory
    ? '<div class="glass-card" style="animation-delay: 0.1s;">' +
      '<div class="tab-bar">' +
      '<button class="active" id="tab-lands" onclick="switchTab(\'lands\')">Lands</button>' +
      '<button id="tab-trees" onclick="switchTab(\'trees\')">Public Trees</button>' +
      '</div>' +
      '<div class="form-row">' +
      '<input type="text" id="search-query" placeholder="Search lands or trees..." onkeydown="if(event.key===\'Enter\')doSearch()" />' +
      '<button class="accent-btn" onclick="doSearch()">Search</button>' +
      '</div>' +
      '<div id="search-results" class="search-results">' +
      '<div class="empty-state">Enter a search term or leave blank to browse all.</div>' +
      '</div></div>'
    : "";

  const extraStyles = `
    .search-results { margin-top: 16px; }
    .result-card {
      padding: 14px; border-radius: 12px; background: rgba(255, 255, 255, 0.06);
      margin-bottom: 10px; display: flex; justify-content: space-between;
      align-items: center; flex-wrap: wrap; gap: 10px;
    }
    .result-info { flex: 1; min-width: 200px; }
    .result-info .result-name { font-size: 15px; font-weight: 700; margin-bottom: 2px; }
    .result-info .result-detail { font-size: 13px; color: var(--text-secondary); }
    .result-info .result-detail code {
      font-family: "JetBrains Mono", monospace; font-size: 12px;
      padding: 2px 6px; background: rgba(255, 255, 255, 0.1); border-radius: 4px;
    }
    .tab-bar {
      display: flex; gap: 0; margin-bottom: 16px; border-radius: 12px;
      overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.2);
    }
    .tab-bar button {
      flex: 1; border-radius: 0; border: none; padding: 12px 16px;
      background: rgba(var(--glass-water-rgb), 0.15); box-shadow: none; font-size: 14px;
    }
    .tab-bar button:hover { background: rgba(var(--glass-water-rgb), 0.25); transform: none; }
    .tab-bar button.active { background: var(--accent); }
    .loading { text-align: center; padding: 20px; color: var(--text-muted); font-size: 14px; }
  `;

  const directoryScript = `
      var currentTab = "lands";

      function switchTab(tab) {
        currentTab = tab;
        document.getElementById("tab-lands").className = tab === "lands" ? "active" : "";
        document.getElementById("tab-trees").className = tab === "trees" ? "active" : "";
        document.getElementById("search-results").innerHTML =
          '<div class="empty-state">Enter a search term or leave blank to browse all.</div>';
      }

      async function doSearch() {
        var query = document.getElementById("search-query").value.trim();
        var resultsDiv = document.getElementById("search-results");
        resultsDiv.innerHTML = '<div class="loading">Searching...</div>';

        var endpoint = currentTab === "lands"
          ? "/canopy/admin/directory/lands"
          : "/canopy/admin/directory/trees";

        var data = await canopyFetch(endpoint + "?q=" + encodeURIComponent(query));

        if (!data) {
          resultsDiv.innerHTML = '<div class="empty-state">Search failed.</div>';
          return;
        }

        if (currentTab === "lands") {
          renderLandResults(data.lands || []);
        } else {
          renderTreeResults(data.trees || []);
        }
      }

      function renderLandResults(lands) {
        var div = document.getElementById("search-results");
        if (lands.length === 0) {
          div.innerHTML = '<div class="empty-state">No lands found.</div>';
          return;
        }

        div.innerHTML = lands.map(function (land) {
          return '<div class="result-card">' +
            '<div class="result-info">' +
              '<div class="result-name">' + escapeHtml(land.name || "Unnamed Land") + '</div>' +
              '<div class="result-detail"><code>' + escapeHtml(land.domain || "") + '</code></div>' +
              '<div class="result-detail">Protocol v' + (land.protocolVersion || "?") +
                ' . ' + (land.status || "unknown") + '</div>' +
            '</div>' +
            '<button class="small-btn accent-btn" onclick="discoverPeer(\\'' + escapeHtml(land.domain) + '\\')">Add as Peer</button>' +
          '</div>';
        }).join("");
      }

      function renderTreeResults(trees) {
        var div = document.getElementById("search-results");
        if (trees.length === 0) {
          div.innerHTML = '<div class="empty-state">No public trees found.</div>';
          return;
        }

        div.innerHTML = trees.map(function (tree) {
          return '<div class="result-card">' +
            '<div class="result-info">' +
              '<div class="result-name">' + escapeHtml(tree.name || "Untitled") + '</div>' +
              '<div class="result-detail">by ' + escapeHtml(tree.ownerUsername || "unknown") +
                ' on <code>' + escapeHtml(tree.landDomain || "") + '</code></div>' +
            '</div>' +
          '</div>';
        }).join("");
      }

      async function discoverPeer(domain) {
        var data = await canopyFetch("/canopy/admin/peer/discover", {
          method: "POST",
          body: JSON.stringify({ domain: domain })
        });
        if (data) {
          showToast("Peered with " + domain, "success");
        }
      }

      function escapeHtml(str) {
        if (!str) return "";
        var div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
      }
  `;

  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="theme-color" content="#667eea">
    <title>Canopy Directory</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
    <style>${sharedStyles}${extraStyles}</style>
  </head>
  <body>
    <div id="toast-container" class="toast-container"></div>

    <div class="container">
      <div class="page-header">
        <h1>Directory</h1>
        <p>Discover lands and public trees across the network</p>
      </div>

      <div class="nav-links">
        ${navLinks("/canopy/admin/directory")}
      </div>

      ${noDirectoryMessage}
      ${searchSection}
    </div>

    <script>
      ${sharedScripts}
      ${hasDirectory ? directoryScript : ""}
    </script>
  </body>
  </html>
  `;
}
