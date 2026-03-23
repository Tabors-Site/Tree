// routesURL/sessionManagerPartial.js
// Exports CSS, HTML, and JS strings for the session manager view
// embedded inside app.js viewport panel.

export function dashboardCSS() {
  return `
    /* ── Dashboard view ─────────────────────────────────────────────── */
    .dashboard-view {
      display: none;
      width: 100%;
      height: 100%;
      flex-direction: column;
      overflow: hidden;
    }
    .dashboard-view.active { display: flex; }
    .dashboard-view.disconnected { position: relative; pointer-events: none; }
    .dashboard-view.disconnected::after {
      content: "Disconnected";
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.5);
      color: var(--text-muted);
      font-size: 14px;
      font-weight: 500;
      letter-spacing: 0.5px;
      z-index: 100;
    }
    .iframe-container.hidden { display: none; }

    .dashboard-layout {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    /* ── Main area ───────────────────────────────────────────────────── */
    .dash-tree-view {
      flex: 1;
      display: flex;
      flex-direction: column;
      padding: 16px;
      position: relative;
      min-height: 0;
      overflow: hidden;
    }
    #dashForestView {
      flex: 1;
      overflow: auto;
      min-height: 0;
    }
    #dashTreeContent {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    #dashTreeCanvas {
      flex: 1;
      min-height: 0;
    }
    .dash-tree-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .dash-tree-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-secondary);
    }
    .dash-back-btn {
      padding: 4px 10px;
      border-radius: 6px;
      border: 1px solid rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.06);
      color: var(--text-secondary);
      font-size: 11px;
      cursor: pointer;
      transition: all 0.15s;
      white-space: nowrap;
    }
    .dash-back-btn:hover { background: rgba(255,255,255,0.15); color: var(--text-primary); }

    .dash-close-btn {
      margin-left: auto;
      width: 28px; height: 28px;
      display: flex; align-items: center; justify-content: center;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.06);
      color: var(--text-muted);
      font-size: 16px; line-height: 1;
      cursor: pointer;
      transition: all 0.15s;
      flex-shrink: 0;
    }
    .dash-close-btn:hover { background: rgba(255,255,255,0.15); color: var(--text-primary); }
    .dash-close-btn:active { transform: scale(0.93); }

    /* ── Raw idea processing strip ──────────────────────────────────── */
    .raw-idea-space {
      margin-bottom: 14px;
      flex-shrink: 0;
    }
    .raw-idea-label {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-bottom: 6px;
      letter-spacing: 0.5px;
    }
    .raw-idea-list {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding-bottom: 4px;
    }
    .raw-idea-card {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-radius: 8px;
      background: rgba(251,191,36,0.1);
      border: 1px solid rgba(251,191,36,0.2);
      flex-shrink: 0;
      cursor: pointer;
      transition: all 0.15s;
      max-width: 200px;
    }
    .raw-idea-card:hover { background: rgba(251,191,36,0.18); }
    .raw-idea-pulse {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: rgba(251,191,36,0.8);
      flex-shrink: 0;
      animation: rawPulse 1.5s ease-in-out infinite;
    }
    @keyframes rawPulse {
      0%, 100% { opacity: 0.4; transform: scale(0.9); }
      50% { opacity: 1; transform: scale(1.1); }
    }
    .raw-idea-desc {
      font-size: 11px;
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ── Forest view (grid of root trees) ──────────────────────────── */
    .dash-forest {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
      gap: 12px;
      padding: 4px 0;
    }
    .dash-root-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 16px 10px 12px;
      border-radius: 10px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.08);
      cursor: pointer;
      transition: all 0.15s;
      position: relative;
      text-align: center;
    }
    .dash-root-card:hover { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.15); }
    .dash-root-card.has-sessions { border-color: rgba(16,185,129,0.3); }
    .dash-root-icon {
      font-size: 28px;
      line-height: 1;
    }
    .dash-root-name {
      font-size: 12px;
      font-weight: 500;
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 100%;
    }
    .dash-root-info {
      font-size: 9px;
      color: var(--text-muted);
    }
    .dash-root-badge {
      position: absolute;
      top: 6px;
      right: 6px;
      background: var(--accent);
      color: #000;
      font-size: 9px;
      font-weight: 700;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .dash-forest-empty {
      grid-column: 1 / -1;
      text-align: center;
      padding: 40px 16px;
      color: var(--text-muted);
      font-size: 13px;
    }
    .dash-forest-empty-icon { font-size: 40px; opacity: 0.4; margin-bottom: 8px; }

    /* ── Visual tree (SVG) ───────────────────────────────────────────── */
    .vtree-container {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: auto;
    }
    .vtree-svg {
      width: 100%;
      height: 100%;
      max-width: 100%;
      max-height: 100%;
    }
    .vtree-node { cursor: pointer; }
    .vtree-node:hover circle.vtree-main { filter: brightness(1.4); }
    .vtree-highlight-ring.active {
      stroke: var(--accent) !important;
      stroke-width: 2.5;
      filter: drop-shadow(0 0 8px rgba(16,185,129,0.6));
    }
    .vtree-tooltip {
      position: absolute;
      background: rgba(0,0,0,0.88);
      color: #fff;
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 11px;
      pointer-events: none;
      z-index: 40;
      max-width: 220px;
      white-space: nowrap;
      display: none;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    }
    .vtree-tooltip.visible { display: block; }
    .vtree-tooltip-name { font-weight: 600; }
    .vtree-tooltip-status { opacity: 0.65; margin-left: 6px; font-size: 10px; }
    .vtree-badge-dot {
      stroke: none;
      filter: drop-shadow(0 0 3px rgba(16,185,129,0.5));
    }

    /* ── Session sidebar ────────────────────────────────────────────── */
    .session-sidebar {
      width: 280px;
      flex-shrink: 0;
      border-left: 1px solid var(--glass-border-light);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .session-sidebar-header {
      padding: 12px 16px;
      border-bottom: 1px solid var(--glass-border-light);
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    .session-sidebar-header h3 {
      font-size: 14px;
      font-weight: 600;
    }
    .session-count-badge {
      background: rgba(255,255,255,0.15);
      padding: 2px 8px;
      border-radius: 100px;
      font-size: 11px;
      font-weight: 600;
    }
    .session-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }

    /* ── Session cards ──────────────────────────────────────────────── */
    .session-card {
      padding: 10px 12px;
      border-radius: 8px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.08);
      margin-bottom: 6px;
      transition: all 0.15s;
      cursor: pointer;
    }
    .session-card:hover { background: rgba(255,255,255,0.1); }
    .session-card.tracked {
      border-color: var(--accent);
      background: rgba(16, 185, 129, 0.1);
    }
    .session-card-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }
    .session-type-icon { font-size: 16px; }
    .session-desc {
      font-size: 12px;
      font-weight: 500;
      color: var(--text-secondary);
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .session-stop-btn {
      background: none;
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #ef4444;
      font-size: 10px;
      font-weight: 600;
      line-height: 1;
      cursor: pointer;
      padding: 3px 8px;
      border-radius: 4px;
      transition: all 0.15s;
      flex-shrink: 0;
      opacity: 0;
    }
    .session-card:hover .session-stop-btn { opacity: 1; }
    .session-stop-btn:hover {
      color: #fff;
      background: rgba(239, 68, 68, 0.4);
    }
    .session-meta-info {
      font-size: 10px;
      color: var(--text-muted);
      margin-bottom: 6px;
    }
    .session-actions {
      display: flex;
      gap: 4px;
    }
    .session-btn {
      padding: 3px 8px;
      border-radius: 4px;
      border: 1px solid rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.06);
      color: var(--text-secondary);
      font-size: 10px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .session-btn:hover { background: rgba(255,255,255,0.15); color: var(--text-primary); }
    .session-btn.active { background: rgba(16,185,129,0.2); border-color: var(--accent); color: var(--accent); }

    /* ── Chat slide-out panel ───────────────────────────────────────── */
    .dashboard-chat-panel {
      position: absolute;
      top: 0;
      right: 0;
      width: 360px;
      height: 100%;
      background: rgba(var(--glass-rgb), 0.95);
      backdrop-filter: blur(var(--glass-blur));
      border-left: 1px solid var(--glass-border);
      transform: translateX(100%);
      transition: transform 0.25s ease;
      z-index: 30;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .dashboard-chat-panel.open { transform: translateX(0); }
    .dash-chat-header {
      padding: 12px 16px;
      border-bottom: 1px solid var(--glass-border-light);
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      flex-shrink: 0;
    }
    .dash-chat-close {
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 4px;
      font-size: 18px;
    }
    .dash-chat-close:hover { color: var(--text-primary); }
    .dash-chat-kill {
      color: #ef4444;
      font-size: 11px;
      font-weight: 600;
    }
    .dash-chat-kill:hover { color: #f87171 !important; }
    .dash-chat-body {
      flex: 1;
      overflow-y: auto;
      padding: 12px 16px;
    }
    .chat-message-item {
      margin-bottom: 12px;
      padding: 8px 10px;
      border-radius: 8px;
      background: rgba(255,255,255,0.05);
      font-size: 12px;
      color: var(--text-secondary);
      line-height: 1.5;
    }
    .chat-message-role {
      font-size: 10px;
      font-weight: 600;
      color: var(--text-muted);
      margin-bottom: 4px;
      text-transform: uppercase;
    }

    /* (dashboard toggle buttons are now in app.js chat panel) */

    /* ── Mobile sessions overlay ────────────────────────────────────── */
    .mobile-sessions-pill {
      display: none;
      z-index: 25;
      align-items: center;
      align-self: flex-start;
      flex-shrink: 0;
      gap: 5px;
      padding: 4px 10px;
      margin-bottom: 8px;
      border-radius: 20px;
      background: rgba(var(--glass-rgb), 0.8);
      backdrop-filter: blur(10px);
      border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      transition: all 0.15s;
    }
    .mobile-sessions-pill:hover { background: rgba(var(--glass-rgb), 0.95); }
    .mobile-sessions-pill.has-activity { border-color: rgba(16,185,129,0.4); }
    .mobile-sessions-pill .pill-count {
      background: var(--accent);
      color: #000;
      font-size: 9px;
      font-weight: 700;
      min-width: 16px;
      height: 16px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 3px;
    }
    .mobile-sessions-pill .pill-label {
      font-size: 11px;
    }
    .mobile-sessions-overlay {
      display: none;
      position: absolute;
      top: 52px;
      right: 8px;
      left: 8px;
      max-height: 70%;
      background: rgba(var(--glass-rgb), 0.95);
      backdrop-filter: blur(var(--glass-blur));
      border: 1px solid var(--glass-border);
      border-radius: 12px;
      z-index: 35;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    }
    .mobile-sessions-overlay.open { display: flex; }
    .mobile-overlay-header {
      padding: 10px 14px;
      border-bottom: 1px solid var(--glass-border-light);
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    .mobile-overlay-header h3 { font-size: 13px; font-weight: 600; margin: 0; }
    .mobile-overlay-close {
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 18px;
      padding: 0 2px;
      line-height: 1;
    }
    .mobile-overlay-close:hover { color: var(--text-primary); }
    .mobile-overlay-body {
      flex: 1;
      overflow-y: auto;
      padding: 8px 10px 12px;
    }
    .mobile-sessions-scrim {
      display: none;
      position: absolute;
      inset: 0;
      z-index: 34;
      background: rgba(0,0,0,0.3);
    }
    .mobile-sessions-scrim.open { display: block; }

    /* ── Mobile adjustments ─────────────────────────────────────────── */
    @media (max-width: 768px) {
      .dashboard-layout { flex-direction: column; }
      .session-sidebar { display: none; }
      .dashboard-chat-panel { width: 100%; }
      .mobile-sessions-pill { display: flex; }
      .dash-forest { grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 8px; }
    }
  `;
}

export function dashboardHTML() {
  return `
    <div class="dashboard-view" id="dashboardView">
      <div class="dashboard-layout">
        <div class="dash-tree-view" id="dashTreeView">

          <!-- Mobile sessions (inline row, not floating) -->
          <button class="mobile-sessions-pill" id="mobileSessionsPill">
            <span class="pill-label">Sessions</span>
            <span class="pill-count" id="mobileSessionsPillCount">0</span>
          </button>
          <div class="mobile-sessions-scrim" id="mobileSessionsScrim"></div>
          <div class="mobile-sessions-overlay" id="mobileSessionsOverlay">
            <div class="mobile-overlay-header">
              <h3>Sessions <span class="session-count-badge" id="dashSessionCountMobile">0</span></h3>
              <button class="mobile-overlay-close" id="mobileSessionsClose">&times;</button>
            </div>
            <div class="mobile-overlay-body" id="mobileSessionsList"></div>
          </div>

          <!-- Raw ideas being processed (visible when any exist) -->
          <div class="raw-idea-space" id="rawIdeaSpace" style="display:none">
            <div class="raw-idea-label">Processing</div>
            <div class="raw-idea-list" id="rawIdeaList"></div>
          </div>

          <!-- Forest view — all root trees (default) -->
          <div id="dashForestView">
            <div class="dash-tree-header">
              <span class="dash-tree-title">Your Trees</span>
              <button class="dash-close-btn" id="dashCloseBtn1" title="Close dashboard">&times;</button>
            </div>
            <div class="dash-forest" id="dashForestGrid"></div>
          </div>

          <!-- Single tree view (shown when a root is selected) -->
          <div id="dashTreeContent" style="display:none">
            <div class="dash-tree-header">
              <button class="dash-back-btn" id="dashBackBtn">&larr; All Trees</button>
              <span class="dash-tree-title" id="dashTreeTitle">Tree</span>
              <button class="dash-close-btn" id="dashCloseBtn2" title="Close dashboard">&times;</button>
            </div>
            <div id="dashTreeCanvas"></div>
          </div>

          <div class="vtree-tooltip" id="vtreeTooltip">
            <span class="vtree-tooltip-name" id="vtreeTooltipName"></span>
            <span class="vtree-tooltip-status" id="vtreeTooltipStatus"></span>
          </div>
        </div>
        <div class="session-sidebar" id="sessionSidebar">
          <div class="session-sidebar-header">
            <h3>Sessions</h3>
            <span class="session-count-badge" id="dashSessionCount">0</span>
          </div>
          <div class="session-list" id="dashSessionList"></div>
        </div>
      </div>
      <div class="dashboard-chat-panel" id="dashChatPanel">
        <div class="dash-chat-header">
          <span id="dashChatTitle" style="font-size:13px;font-weight:600">Messages</span>
          <div class="dash-chat-controls" style="display:flex;gap:6px;align-items:center;margin-top:8px">
            <button class="dash-chat-close" id="dashChatClose" title="Back">&larr;</button>
            <button class="dash-chat-close" id="dashChatRefresh" title="Refresh">&#x21BB;</button>
            <button class="dash-chat-close dash-chat-kill" id="dashChatKill" title="Kill session">Kill</button>
          </div>
        </div>
        <div class="dash-chat-body" id="dashChatBody"></div>
      </div>
    </div>
  `;
}

export function dashboardJS() {
  return `
    // ══════════════════════════════════════════════════════════════════
    // SESSION DASHBOARD
    // ══════════════════════════════════════════════════════════════════

    (function() {
      var dashboardActive = false;
      var dashMode = "forest";       // "forest" or "tree"
      var dashSessions = [];
      var dashRoots = [];
      var dashTrackedSessionId = null;
      var dashTrackedNavRootId = null;  // last rootId we auto-navigated to for tracked session
      var dashCurrentRootId = null;
      var dashTreeData = null;
      var dashSelfSessionId = null;
      var dashActiveNavigatorId = null;

      var desktopDashboardBtn = document.getElementById("desktopDashboardBtn");
      var iframeContainer = document.getElementById("iframeContainer");
      var dashboardView = document.getElementById("dashboardView");
      var dashForestView = document.getElementById("dashForestView");
      var dashForestGrid = document.getElementById("dashForestGrid");
      var dashTreeContent = document.getElementById("dashTreeContent");
      var dashTreeCanvas = document.getElementById("dashTreeCanvas");
      var dashTreeTitle = document.getElementById("dashTreeTitle");
      var dashBackBtn = document.getElementById("dashBackBtn");
      var rawIdeaSpace = document.getElementById("rawIdeaSpace");
      var rawIdeaList = document.getElementById("rawIdeaList");
      var dashSessionList = document.getElementById("dashSessionList");
      var dashSessionCount = document.getElementById("dashSessionCount");
      var dashChatPanel = document.getElementById("dashChatPanel");
      var dashChatBody = document.getElementById("dashChatBody");
      var dashChatTitle = document.getElementById("dashChatTitle");
      var vtreeTooltip = document.getElementById("vtreeTooltip");
      var vtreeTooltipName = document.getElementById("vtreeTooltipName");
      var vtreeTooltipStatus = document.getElementById("vtreeTooltipStatus");
      var dashTreeView = document.getElementById("dashTreeView");
      var mobileSessionsPill = document.getElementById("mobileSessionsPill");
      var mobileSessionsPillCount = document.getElementById("mobileSessionsPillCount");
      var mobileSessionsOverlay = document.getElementById("mobileSessionsOverlay");
      var mobileSessionsScrim = document.getElementById("mobileSessionsScrim");
      var mobileSessionsClose = document.getElementById("mobileSessionsClose");
      var mobileSessionsList = document.getElementById("mobileSessionsList");
      var dashSessionCountMobile = document.getElementById("dashSessionCountMobile");
      var mobileDashboardBtn = document.getElementById("mobileDashboardBtn");

      // ── Disconnected state ──────────────────────────────────────
      socket.on("disconnect", function() {
        if (dashboardView) dashboardView.classList.add("disconnected");
      });
      socket.on("connect", function() {
        if (dashboardView) dashboardView.classList.remove("disconnected");
      });

      var DASH_SESSION_ICONS = {
        "websocket-chat": "\\u{1F4AC}",
        "api-tree-chat": "\\u{1F333}",
        "api-tree-place": "\\u{1F4CC}",
        "raw-idea-orchestrate": "\\u{1F4A1}",
        "raw-idea-chat": "\\u{1F4A1}",
        "understanding-orchestrate": "\\u{1F9E0}",
        "scheduled-raw-idea": "\\u{23F0}"
      };

      function dashEscape(str) {
        return String(str || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
      }
      function dashTimeAgo(ts) {
        if (!ts) return "";
        var diff = Date.now() - ts;
        if (diff < 60000) return "just now";
        if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
        return Math.floor(diff / 3600000) + "h ago";
      }
      function dashTruncate(str, len) {
        if (!str) return "";
        return str.length > len ? str.slice(0, len) + "..." : str;
      }

      // ── Toggle ────────────────────────────────────────────────────
      function toggleDashboard() {
        dashboardActive = !dashboardActive;
        if (desktopDashboardBtn) desktopDashboardBtn.classList.toggle("active", dashboardActive);
        if (mobileDashboardBtn) mobileDashboardBtn.classList.toggle("active", dashboardActive);
        iframeContainer.classList.toggle("hidden", dashboardActive);
        dashboardView.classList.toggle("active", dashboardActive);
        if (dashboardActive) {
          socket.emit("getDashboardSessions");
          socket.emit("getDashboardRoots");
        }
      }

      if (desktopDashboardBtn) desktopDashboardBtn.addEventListener("click", toggleDashboard);
      if (mobileDashboardBtn) mobileDashboardBtn.addEventListener("click", function(e) {
        e.stopPropagation();
        toggleDashboard();
      });

      // Close buttons inside the dashboard view
      var dashCloseBtn1 = document.getElementById("dashCloseBtn1");
      var dashCloseBtn2 = document.getElementById("dashCloseBtn2");
      if (dashCloseBtn1) dashCloseBtn1.addEventListener("click", function() { if (dashboardActive) toggleDashboard(); });
      if (dashCloseBtn2) dashCloseBtn2.addEventListener("click", function() { if (dashboardActive) toggleDashboard(); });

      // Expose closeDashboard so app.js goHome() can dismiss it
      if (window.TreeApp) {
        window.TreeApp.closeDashboard = function() {
          if (dashboardActive) toggleDashboard();
        };
      }

      // ── Mode switching ──────────────────────────────────────────
      function enterTreeMode(rootId) {
        dashMode = "tree";
        dashCurrentRootId = rootId;
        dashTreeData = null;
        dashForestView.style.display = "none";
        dashTreeContent.style.display = "";
        dashTreeCanvas.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted)">Loading tree...</div>';
        dashTreeTitle.textContent = "Loading...";
        socket.emit("getDashboardTree", { rootId: rootId });
        renderDashSessions();
      }

      function exitTreeMode() {
        dashMode = "forest";
        dashCurrentRootId = null;
        dashTreeData = null;
        dashForestView.style.display = "";
        dashTreeContent.style.display = "none";
        renderForest();
        renderDashSessions();
      }

      dashBackBtn.addEventListener("click", exitTreeMode);

      // ── Roots (forest) ──────────────────────────────────────────
      socket.on("dashboardRoots", function(data) {
        if (!data) return;
        dashRoots = data.roots || [];
        if (dashMode === "forest") renderForest();
      });

      function renderForest() {
        if (dashRoots.length === 0) {
          dashForestGrid.innerHTML = '<div class="dash-forest-empty">'
            + '<div class="dash-forest-empty-icon">\\u{1F331}</div>'
            + '<p>No trees yet</p></div>';
          return;
        }

        var html = "";
        for (var i = 0; i < dashRoots.length; i++) {
          var r = dashRoots[i];
          // Count sessions on this root
          var count = 0;
          for (var j = 0; j < dashSessions.length; j++) {
            if (dashSessions[j].meta && dashSessions[j].meta.rootId === r.id) count++;
          }
          var sizeLabel = r.childCount === 0 ? "seedling" : r.childCount <= 3 ? "sapling" : r.childCount <= 10 ? "growing" : "mature";
          var treeIcon = r.childCount === 0 ? "\\u{1F331}" : r.childCount <= 3 ? "\\u{1F33F}" : r.childCount <= 10 ? "\\u{1F333}" : "\\u{1F332}";

          html += '<div class="dash-root-card' + (count > 0 ? " has-sessions" : "") + '" data-root-id="' + r.id + '">'
            + (count > 0 ? '<span class="dash-root-badge">' + count + '</span>' : '')
            + '<div class="dash-root-icon">' + treeIcon + '</div>'
            + '<div class="dash-root-name">' + dashEscape(r.name) + '</div>'
            + '<div class="dash-root-info">' + sizeLabel + '</div>'
            + '</div>';
        }
        dashForestGrid.innerHTML = html;
      }

      // Click root card → enter tree mode
      dashForestGrid.addEventListener("click", function(e) {
        var card = e.target.closest("[data-root-id]");
        if (!card) return;
        enterTreeMode(card.getAttribute("data-root-id"));
      });

      // ── Raw ideas ───────────────────────────────────────────────
      function renderRawIdeas() {
        var rawSessions = [];
        for (var i = 0; i < dashSessions.length; i++) {
          var s = dashSessions[i];
          var isRaw = s.type === "raw-idea-orchestrate" || s.type === "raw-idea-chat" || s.type === "scheduled-raw-idea";
          var noTree = !s.meta || !s.meta.rootId;
          if (isRaw && noTree) rawSessions.push(s);
        }

        if (rawSessions.length === 0) {
          rawIdeaSpace.style.display = "none";
          return;
        }
        rawIdeaSpace.style.display = "";

        var html = "";
        for (var i = 0; i < rawSessions.length; i++) {
          var s = rawSessions[i];
          var desc = dashEscape(s.description || "Raw idea");
          html += '<div class="raw-idea-card" data-raw-sid="' + s.sessionId + '">'
            + '<span class="raw-idea-pulse"></span>'
            + '<span class="raw-idea-desc">' + desc + '</span>'
            + '</div>';
        }
        rawIdeaList.innerHTML = html;
      }

      // Click raw idea → track it (auto-follow when it gets placed)
      rawIdeaList.addEventListener("click", function(e) {
        var card = e.target.closest("[data-raw-sid]");
        if (!card) return;
        var sid = card.getAttribute("data-raw-sid");
        dashTrackedSessionId = sid;
        renderDashSessions();
      });

      // ── Sessions ────────────────────────────────────────────────
      socket.on("dashboardSessions", function(data) {
        if (!data) return;
        dashSessions = data.sessions || [];
        if (data.selfSessionId) dashSelfSessionId = data.selfSessionId;
        dashActiveNavigatorId = data.activeNavigatorId || null;

        // Sync tracked session with server navigator state
        if (dashTrackedSessionId !== dashActiveNavigatorId) {
          dashTrackedSessionId = dashActiveNavigatorId;
          if (!dashTrackedSessionId) dashTrackedNavRootId = null;
        }

        renderRawIdeas();
        renderDashSessions();

        // Auto-follow tracked session — only navigate when rootId first appears or changes
        if (dashTrackedSessionId) {
          var tracked = null;
          for (var i = 0; i < dashSessions.length; i++) {
            if (dashSessions[i].sessionId === dashTrackedSessionId) { tracked = dashSessions[i]; break; }
          }
          if (!tracked) {
            dashTrackedSessionId = null;
            dashTrackedNavRootId = null;
            renderDashSessions();
          } else if (tracked.meta && tracked.meta.rootId && tracked.meta.rootId !== dashTrackedNavRootId) {
            // Session got a NEW rootId — close dashboard; server handles navigation via emitNavigate
            dashTrackedNavRootId = tracked.meta.rootId;
            if (dashboardActive) toggleDashboard();
          }
        }

        // Update forest badges if in forest mode
        if (dashMode === "forest") renderForest();
        // Update tree highlights if in tree mode
        if (dashMode === "tree") updateDashHighlights();
      });

      function renderDashSessions() {
        // Filter sessions based on mode
        var filtered;
        if (dashMode === "tree" && dashCurrentRootId) {
          filtered = [];
          for (var i = 0; i < dashSessions.length; i++) {
            if (dashSessions[i].meta && dashSessions[i].meta.rootId === dashCurrentRootId) {
              filtered.push(dashSessions[i]);
            }
          }
        } else {
          filtered = dashSessions;
        }

        dashSessionCount.textContent = filtered.length;

        if (filtered.length === 0) {
          var emptyMsg = dashMode === "tree"
            ? "No sessions on this tree"
            : "No active sessions";
          dashSessionList.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:12px">' + emptyMsg + '</div>';
          syncMobileSessions("", 0);
          return;
        }

        var html = "";
        for (var i = 0; i < filtered.length; i++) {
          var s = filtered[i];
          var isTracked = s.sessionId === dashTrackedSessionId;
          var icon = DASH_SESSION_ICONS[s.type] || "\\u{1F527}";
          var desc = dashEscape(s.description || s.type);
          var hasRoot = s.meta && s.meta.rootId;
          var ago = dashTimeAgo(s.lastActivity);

          // Resolve location label: tree name or "Home"
          var locationLabel;
          if (hasRoot) {
            var rootName = null;
            for (var k = 0; k < dashRoots.length; k++) {
              if (dashRoots[k].id === s.meta.rootId) { rootName = dashRoots[k].name; break; }
            }
            locationLabel = "Tree: " + dashEscape(rootName || s.meta.rootId.slice(0, 8));
          } else {
            locationLabel = "Home";
          }

          // Follow button logic: follow sets navigator, detach clears it
          var trackBtn = "";
          if (isTracked) {
            trackBtn = '<button class="session-btn active" data-action="track" data-sid="' + s.sessionId + '">\\u{1F4CD} Detach</button>';
          } else {
            trackBtn = '<button class="session-btn" data-action="track" data-sid="' + s.sessionId + '">\\u{1F3AF} Follow</button>';
          }

          html += '<div class="session-card ' + (isTracked ? "tracked" : "") + '" data-sid="' + s.sessionId + '"'
            + (hasRoot ? ' data-root="' + s.meta.rootId + '"' : '') + '>'
            + '<div class="session-card-header">'
            + '<span class="session-type-icon">' + icon + '</span>'
            + '<span class="session-desc">' + desc + '</span>'
            + '<button class="session-stop-btn" data-action="stop" data-sid="' + s.sessionId + '" title="Kill session">Kill</button>'
            + '</div>'
            + '<div class="session-meta-info">' + locationLabel + ' \\u00B7 ' + ago + '</div>'
            + '<div class="session-actions">'
            + trackBtn
            + '<button class="session-btn" data-action="chat" data-sid="' + s.sessionId + '">\\u{1F4AC} Messages</button>'
            + '</div>'
            + '</div>';
        }
        dashSessionList.innerHTML = html;
        syncMobileSessions(html, filtered.length);
      }

      function syncMobileSessions(html, count) {
        var n = count !== undefined ? count : dashSessions.length;
        if (mobileSessionsList) mobileSessionsList.innerHTML = html || dashSessionList.innerHTML;
        if (mobileSessionsPillCount) mobileSessionsPillCount.textContent = n;
        if (dashSessionCountMobile) dashSessionCountMobile.textContent = n;
        if (mobileSessionsPill) mobileSessionsPill.classList.toggle("has-activity", n > 1);
      }

      // Event delegation for session cards + buttons
      function handleSessionClick(e) {
        // Button actions first
        var btn = e.target.closest("[data-action]");
        if (btn) {
          e.stopPropagation();
          var action = btn.getAttribute("data-action");
          var sid = btn.getAttribute("data-sid");
          if (action === "track") toggleTrack(sid);
          else if (action === "chat") dashViewChat(sid);
          else if (action === "stop") stopSession(sid);
          return;
        }
        // Click on card body → navigate to session's tree
        var card = e.target.closest("[data-sid]");
        if (!card) return;
        var rootId = card.getAttribute("data-root");
        if (rootId) {
          enterTreeMode(rootId);
        }
      }

      dashSessionList.addEventListener("click", handleSessionClick);

      function toggleTrack(sessionId) {
        if (dashTrackedSessionId === sessionId) {
          dashTrackedSessionId = null;
          dashTrackedNavRootId = null;
          socket.emit("detachNavigator");
        } else {
          dashTrackedSessionId = sessionId;
          dashTrackedNavRootId = null;
          socket.emit("attachNavigator", { sessionId: sessionId });
          var s = null;
          for (var i = 0; i < dashSessions.length; i++) {
            if (dashSessions[i].sessionId === sessionId) { s = dashSessions[i]; break; }
          }
          if (s && s.meta && s.meta.rootId) {
            // Close dashboard; server handles navigation via emitNavigate
            dashTrackedNavRootId = s.meta.rootId;
            if (dashboardActive) toggleDashboard();
          }
          // If no rootId (Home), stay on dashboard
        }
        renderDashSessions();
      }

      function stopSession(sessionId) {
        if (!confirm("Stop this session?")) return;
        // If stopping the tracked session, detach first
        if (dashTrackedSessionId === sessionId) {
          dashTrackedSessionId = null;
          dashTrackedNavRootId = null;
          socket.emit("detachNavigator");
        }
        socket.emit("stopSession", { sessionId: sessionId });
      }

      // ── Tree loading ──────────────────────────────────────────────
      socket.on("dashboardTreeData", function(data) {
        if (!data || data.rootId !== dashCurrentRootId) return;
        if (data.error) {
          dashTreeCanvas.innerHTML = '<div style="color:var(--error);padding:16px">' + dashEscape(data.error) + '</div>';
          return;
        }
        dashTreeData = data.tree;
        renderDashTree();
        updateDashHighlights();
      });

      // ── Visual tree helpers ───────────────────────────────────────
      function vtreeCount(node) {
        var c = 1;
        if (node.children) for (var i = 0; i < node.children.length; i++) c += vtreeCount(node.children[i]);
        return c;
      }
      function vtreeMaxDepth(node, d) {
        d = d || 0;
        if (!node.children || !node.children.length) return d;
        var mx = d;
        for (var i = 0; i < node.children.length; i++) {
          var cd = vtreeMaxDepth(node.children[i], d + 1);
          if (cd > mx) mx = cd;
        }
        return mx;
      }
      function vtreeWidth(node) {
        if (!node.children || !node.children.length) return 1;
        var w = 0;
        for (var i = 0; i < node.children.length; i++) w += vtreeWidth(node.children[i]);
        return w;
      }

      function buildVisualTree(treeData) {
        var total = vtreeCount(treeData);
        var maxD = vtreeMaxDepth(treeData);

        var nodeR, fontSize, branchBase;
        if (total <= 5) { nodeR = 22; fontSize = 11; branchBase = 6; }
        else if (total <= 15) { nodeR = 15; fontSize = 10; branchBase = 4.5; }
        else if (total <= 40) { nodeR = 11; fontSize = 9; branchBase = 3; }
        else { nodeR = 7; fontSize = 0; branchBase = 2; }

        var hSpace = total <= 5 ? 100 : total <= 15 ? 65 : total <= 40 ? 45 : 30;
        var vSpace = total <= 5 ? 110 : total <= 15 ? 80 : total <= 40 ? 58 : 44;

        var nodes = [];
        function place(node, depth, xL, xR, pid) {
          var x = (xL + xR) / 2;
          var isLeaf = !node.children || !node.children.length;
          nodes.push({ id: node.id, name: node.name, status: node.status || "active", prestige: 0 || 0, x: x, depth: depth, pid: pid, isLeaf: isLeaf });
          if (!isLeaf) {
            var tw = vtreeWidth(node);
            var cur = xL;
            for (var i = 0; i < node.children.length; i++) {
              var cw = vtreeWidth(node.children[i]);
              var cR = cur + (xR - xL) * (cw / tw);
              place(node.children[i], depth + 1, cur, cR, node.id);
              cur = cR;
            }
          }
        }
        var treeW = vtreeWidth(treeData);
        place(treeData, 0, 0, treeW, null);

        var pad = nodeR * 3 + 15;
        var trunkH = total <= 5 ? 40 : 25;
        var svgW = treeW * hSpace + pad * 2;
        var svgH = (maxD + 1) * vSpace + pad * 2 + trunkH;

        for (var i = 0; i < nodes.length; i++) {
          nodes[i].sx = nodes[i].x * hSpace + pad;
          nodes[i].sy = pad + (maxD - nodes[i].depth) * vSpace;
        }

        var rootN = nodes[0];
        var groundY = rootN.sy + trunkH + 8;

        var s = '<svg class="vtree-svg" viewBox="0 0 ' + svgW + ' ' + svgH + '" preserveAspectRatio="xMidYMid meet">';
        s += '<ellipse cx="' + (svgW / 2) + '" cy="' + groundY + '" rx="' + Math.min(svgW * 0.35, 120) + '" ry="6" fill="rgba(139,90,43,0.12)"/>';
        s += '<line x1="' + rootN.sx + '" y1="' + rootN.sy + '" x2="' + rootN.sx + '" y2="' + (rootN.sy + trunkH) + '"'
          + ' stroke="rgba(139,90,43,0.55)" stroke-width="' + (branchBase * 1.8) + '" stroke-linecap="round"/>';

        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i];
          if (n.pid === null) continue;
          var par = null;
          for (var j = 0; j < nodes.length; j++) { if (nodes[j].id === n.pid) { par = nodes[j]; break; } }
          if (!par) continue;
          var bw = Math.max(1, branchBase - n.depth * 0.6);
          var cpY = (par.sy + n.sy) / 2;
          s += '<path class="vtree-branch" d="M' + par.sx + ',' + par.sy + ' C' + par.sx + ',' + cpY + ' ' + n.sx + ',' + cpY + ' ' + n.sx + ',' + n.sy + '"'
            + ' fill="none" stroke="rgba(139,90,43,0.3)" stroke-width="' + bw + '" stroke-linecap="round"/>';
        }

        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i];
          var fill;
          if (n.status === "trimmed") fill = "rgba(120,120,120,0.45)";
          else if (n.status === "completed") fill = "rgba(234,179,8,0.65)";
          else if (n.isLeaf) fill = "rgba(34,197,94,0.75)";
          else fill = "rgba(16,185,129,0.55)";
          var r = (n.pid === null) ? nodeR * 1.2 : nodeR;

          s += '<g class="vtree-node" data-node-id="' + n.id + '" data-name="' + dashEscape(n.name) + '" data-status="' + n.status + '" data-prestige="' + n.prestige + '">';
          s += '<circle class="vtree-highlight-ring" cx="' + n.sx + '" cy="' + n.sy + '" r="' + (r + 5) + '" fill="none" stroke="transparent" stroke-width="2"/>';
          s += '<circle class="vtree-main" cx="' + n.sx + '" cy="' + n.sy + '" r="' + r + '" fill="' + fill + '" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>';
          if (fontSize > 0) {
            var lbl = n.name.length > 14 ? n.name.slice(0, 12) + ".." : n.name;
            s += '<text x="' + n.sx + '" y="' + (n.sy - r - 6) + '" text-anchor="middle" fill="var(--text-secondary)" font-size="' + fontSize + '" style="pointer-events:none">' + dashEscape(lbl) + '</text>';
          }
          s += '</g>';
        }

        s += '</svg>';
        return s;
      }

      function renderDashTree() {
        if (!dashTreeData) return;
        dashTreeTitle.textContent = dashEscape(dashTreeData.name);
        dashTreeCanvas.innerHTML = '<div class="vtree-container">' + buildVisualTree(dashTreeData) + '</div>';
      }

      // ── Tooltip ─────────────────────────────────────────────────────
      dashTreeCanvas.addEventListener("mouseover", function(e) {
        var g = e.target.closest(".vtree-node");
        if (!g) return;
        vtreeTooltipName.textContent = g.getAttribute("data-name");
        vtreeTooltipStatus.textContent = g.getAttribute("data-status");
        vtreeTooltip.classList.add("visible");
      });
      dashTreeCanvas.addEventListener("mousemove", function(e) {
        if (!vtreeTooltip.classList.contains("visible")) return;
        var rect = dashTreeView.getBoundingClientRect();
        vtreeTooltip.style.left = (e.clientX - rect.left + 14) + "px";
        vtreeTooltip.style.top = (e.clientY - rect.top - 32) + "px";
      });
      dashTreeCanvas.addEventListener("mouseout", function(e) {
        if (e.target.closest(".vtree-node")) vtreeTooltip.classList.remove("visible");
      });

      // ── Click tree node → navigate iframe ──────────────────────────
      dashTreeCanvas.addEventListener("click", function(e) {
        var g = e.target.closest(".vtree-node");
        if (!g) return;
        var nodeId = g.getAttribute("data-node-id");
        var prestige = g.getAttribute("data-prestige") || "0";
        if (!nodeId) return;
        // Switch back to iframe and navigate to this node
        if (dashboardActive) toggleDashboard();
        if (window.TreeApp && window.TreeApp.navigate) {
          window.TreeApp.navigate("/api/v1/node/" + nodeId + "/" + prestige + "?html");
        }
      });

      // ── Node highlighting (SVG) ────────────────────────────────────
      function updateDashHighlights() {
        var rings = document.querySelectorAll(".vtree-highlight-ring.active");
        for (var i = 0; i < rings.length; i++) rings[i].classList.remove("active");
        var dots = document.querySelectorAll(".vtree-badge-dot");
        for (var i = 0; i < dots.length; i++) dots[i].remove();

        for (var j = 0; j < dashSessions.length; j++) {
          var s = dashSessions[j];
          if (!s.meta || !s.meta.nodeId) continue;
          var g = document.querySelector('.vtree-node[data-node-id="' + s.meta.nodeId + '"]');
          if (!g) continue;
          var ring = g.querySelector(".vtree-highlight-ring");
          if (ring) ring.classList.add("active");
          var main = g.querySelector(".vtree-main");
          if (main) {
            var cx = parseFloat(main.getAttribute("cx"));
            var cy = parseFloat(main.getAttribute("cy"));
            var r = parseFloat(main.getAttribute("r"));
            var badge = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            badge.setAttribute("class", "vtree-badge-dot");
            badge.setAttribute("cx", String(cx + r + 4));
            badge.setAttribute("cy", String(cy - r + 2));
            badge.setAttribute("r", "4");
            badge.setAttribute("fill", "rgba(16,185,129,0.9)");
            g.appendChild(badge);
          }
        }
      }

      // ── Tree change live updates ──────────────────────────────────
      socket.on("dashboardTreeChanged", function(data) {
        if (dashCurrentRootId) {
          socket.emit("getDashboardTree", { rootId: dashCurrentRootId });
        }
      });

      // ── Messages panel ─────────────────────────────────────────────
      var dashChatCurrentSid = null;

      document.getElementById("dashChatClose").addEventListener("click", function() {
        dashChatPanel.classList.remove("open");
        dashChatCurrentSid = null;
      });

      document.getElementById("dashChatRefresh").addEventListener("click", function() {
        if (!dashChatCurrentSid) return;
        dashChatBody.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted)">Loading...</div>';
        socket.emit("getDashboardChats", { sessionId: dashChatCurrentSid });
      });

      document.getElementById("dashChatKill").addEventListener("click", function() {
        if (!dashChatCurrentSid) return;
        stopSession(dashChatCurrentSid);
        dashChatPanel.classList.remove("open");
        dashChatCurrentSid = null;
      });

      function dashViewChat(sessionId) {
        dashChatCurrentSid = sessionId;
        dashChatPanel.classList.add("open");
        dashChatBody.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted)">Loading...</div>';
        dashChatTitle.textContent = "Messages \\u2014 " + sessionId.slice(0, 8);
        socket.emit("getDashboardChats", { sessionId: sessionId });
      }

      socket.on("dashboardChats", function(data) {
        if (!data) return;
        if (data.error) {
          dashChatBody.innerHTML = '<div style="color:var(--error)">Error loading chats</div>';
          return;
        }
        var chats = data.chats;
        if (!chats || chats.length === 0) {
          dashChatBody.innerHTML = '<div style="color:var(--text-muted);padding:16px;text-align:center">No chat records for this session</div>';
          return;
        }
        var html = "";
        for (var i = 0; i < chats.length; i++) {
          var c = chats[i];
          var source = (c.startMessage && c.startMessage.source) || "user";
          var path = (c.aiContext && c.aiContext.path) || "?";
          var userMsg = dashEscape(dashTruncate((c.startMessage && c.startMessage.content) || "", 300));
          var aiMsg = (c.endMessage && c.endMessage.content)
            ? '<div style="margin-top:6px;border-top:1px solid rgba(255,255,255,0.06);padding-top:6px">' + dashEscape(dashTruncate(c.endMessage.content, 500)) + '</div>'
            : '';
          html += '<div class="chat-message-item">'
            + '<div class="chat-message-role">' + dashEscape(source) + ' \\u2192 ' + dashEscape(path) + '</div>'
            + '<div>' + userMsg + '</div>'
            + aiMsg
            + '</div>';
        }
        dashChatBody.innerHTML = html;
      });

      // ── Mobile sessions ──────────────────────────────────────────
      function closeMobileOverlay() {
        if (mobileSessionsOverlay) mobileSessionsOverlay.classList.remove("open");
        if (mobileSessionsScrim) mobileSessionsScrim.classList.remove("open");
      }
      function openMobileOverlay() {
        if (mobileSessionsOverlay) mobileSessionsOverlay.classList.add("open");
        if (mobileSessionsScrim) mobileSessionsScrim.classList.add("open");
      }

      if (mobileSessionsPill) {
        mobileSessionsPill.addEventListener("click", function() {
          var isOpen = mobileSessionsOverlay && mobileSessionsOverlay.classList.contains("open");
          if (isOpen) closeMobileOverlay();
          else openMobileOverlay();
        });
      }
      if (mobileSessionsClose) {
        mobileSessionsClose.addEventListener("click", closeMobileOverlay);
      }
      if (mobileSessionsScrim) {
        mobileSessionsScrim.addEventListener("click", closeMobileOverlay);
      }
      if (mobileSessionsList) {
        mobileSessionsList.addEventListener("click", function(e) {
          var btn = e.target.closest("[data-action]");
          if (btn) {
            var action = btn.getAttribute("data-action");
            var sid = btn.getAttribute("data-sid");
            if (action === "track") toggleTrack(sid);
            else if (action === "chat") dashViewChat(sid);
            else if (action === "stop") { stopSession(sid); }
            closeMobileOverlay();
            return;
          }
          var card = e.target.closest("[data-sid]");
          if (card) {
            var rootId = card.getAttribute("data-root");
            if (rootId) enterTreeMode(rootId);
            closeMobileOverlay();
          }
        });
      }

    })();
  `;
}
