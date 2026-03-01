// routesURL/dashboardPartial.js
// Exports CSS, HTML, and JS strings for the session dashboard view
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
    .iframe-container.hidden { display: none; }

    .dashboard-layout {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    /* ── Tree view (main area) ──────────────────────────────────────── */
    .dash-tree-view {
      flex: 1;
      overflow: auto;
      padding: 16px;
      position: relative;
    }
    .dash-tree-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .dash-tree-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-secondary);
    }
    .tree-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      gap: 12px;
    }
    .tree-empty-icon { font-size: 48px; opacity: 0.5; }
    .tree-empty p { font-size: 13px; }

    .tree-node-row {
      display: flex;
      align-items: center;
      padding: 4px 8px;
      border-radius: 6px;
      cursor: default;
      transition: background 0.1s;
      gap: 6px;
    }
    .tree-node-row:hover { background: rgba(255,255,255,0.06); }
    .tree-node-row.highlighted {
      background: rgba(16, 185, 129, 0.12);
      border-left: 2px solid var(--accent);
    }
    .tree-node-name {
      font-size: 13px;
      color: var(--text-secondary);
    }
    .tree-node-row.highlighted .tree-node-name { color: var(--text-primary); font-weight: 500; }
    .tree-node-status {
      font-size: 9px;
      padding: 1px 5px;
      border-radius: 3px;
      background: rgba(255,255,255,0.08);
      color: var(--text-muted);
    }
    .tree-node-badges {
      display: flex;
      gap: 2px;
      margin-left: auto;
    }
    .tree-session-badge {
      font-size: 10px;
      padding: 1px 4px;
      border-radius: 3px;
      background: rgba(16,185,129,0.2);
    }
    .tree-children {
      padding-left: 20px;
      border-left: 1px solid rgba(255,255,255,0.06);
      margin-left: 11px;
    }
    .tree-toggle {
      width: 16px;
      height: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: var(--text-muted);
      font-size: 10px;
      flex-shrink: 0;
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
      align-items: center;
      justify-content: space-between;
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

    /* ── Dashboard toggle button ────────────────────────────────────── */
    .dashboard-toggle-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      z-index: 15;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(var(--glass-rgb), 0.6);
      backdrop-filter: blur(10px);
      border: 1px solid var(--glass-border);
      border-radius: 8px;
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.15s;
    }
    .dashboard-toggle-btn:hover { background: rgba(var(--glass-rgb), 0.85); color: var(--text-primary); }
    .dashboard-toggle-btn.active { background: rgba(16,185,129,0.2); border-color: var(--accent); color: var(--accent); }

    /* ── Mobile adjustments ─────────────────────────────────────────── */
    @media (max-width: 768px) {
      .session-sidebar { display: none; }
      .dashboard-chat-panel { width: 100%; }
      .dashboard-toggle-btn { display: none; }
    }
  `;
}

export function dashboardHTML() {
  return `
    <button class="dashboard-toggle-btn" id="dashboardToggleBtn" title="Session Dashboard">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
        <rect x="3" y="3" width="7" height="9" rx="1"/>
        <rect x="14" y="3" width="7" height="5" rx="1"/>
        <rect x="14" y="12" width="7" height="9" rx="1"/>
        <rect x="3" y="16" width="7" height="5" rx="1"/>
      </svg>
    </button>
    <div class="dashboard-view" id="dashboardView">
      <div class="dashboard-layout">
        <div class="dash-tree-view" id="dashTreeView">
          <div class="tree-empty" id="dashTreeEmpty">
            <div class="tree-empty-icon">🌳</div>
            <p>No tree loaded</p>
            <p style="font-size:12px;opacity:0.7">Track a session or wait for one to start working on a tree</p>
          </div>
          <div id="dashTreeContent" style="display:none">
            <div class="dash-tree-header">
              <span class="dash-tree-title" id="dashTreeTitle">Tree</span>
            </div>
            <div id="dashTreeCanvas"></div>
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
          <span id="dashChatTitle" style="font-size:13px;font-weight:600">AI Chat</span>
          <button class="dash-chat-close" id="dashChatClose">&times;</button>
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
      let dashboardActive = false;
      let dashSessions = [];
      let dashTrackedSessionId = null;
      let dashCurrentRootId = null;
      let dashTreeData = null;

      const dashboardToggleBtn = document.getElementById("dashboardToggleBtn");
      const iframeContainer = document.getElementById("iframeContainer");
      const dashboardView = document.getElementById("dashboardView");
      const dashTreeEmpty = document.getElementById("dashTreeEmpty");
      const dashTreeContent = document.getElementById("dashTreeContent");
      const dashTreeCanvas = document.getElementById("dashTreeCanvas");
      const dashTreeTitle = document.getElementById("dashTreeTitle");
      const dashSessionList = document.getElementById("dashSessionList");
      const dashSessionCount = document.getElementById("dashSessionCount");
      const dashChatPanel = document.getElementById("dashChatPanel");
      const dashChatBody = document.getElementById("dashChatBody");
      const dashChatTitle = document.getElementById("dashChatTitle");

      const DASH_SESSION_ICONS = {
        "websocket-chat": "\\u{1F4AC}",
        "api-tree-chat": "\\u{1F333}",
        "api-tree-place": "\\u{1F4CC}",
        "raw-idea-orchestrate": "\\u{1F4A1}",
        "raw-idea-chat": "\\u{1F4A1}",
        "understanding-orchestrate": "\\u{1F9E0}",
        "scheduled-raw-idea": "\\u{23F0}",
      };

      function dashEscape(str) {
        return String(str || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
      }

      function dashTimeAgo(ts) {
        if (!ts) return "";
        const diff = Date.now() - ts;
        if (diff < 60000) return "just now";
        if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
        return Math.floor(diff / 3600000) + "h ago";
      }

      function dashTruncate(str, len) {
        if (!str) return "";
        return str.length > len ? str.slice(0, len) + "..." : str;
      }

      // ── Toggle ────────────────────────────────────────────────────
      dashboardToggleBtn.addEventListener("click", function() {
        dashboardActive = !dashboardActive;
        dashboardToggleBtn.classList.toggle("active", dashboardActive);
        iframeContainer.classList.toggle("hidden", dashboardActive);
        dashboardView.classList.toggle("active", dashboardActive);
        if (dashboardActive) {
          socket.emit("getDashboardSessions");
        }
      });

      // ── Session list ──────────────────────────────────────────────
      socket.on("dashboardSessions", function(data) {
        if (!data) return;
        dashSessions = data.sessions || [];
        renderDashSessions();

        if (dashTrackedSessionId) {
          var tracked = dashSessions.find(function(s) { return s.sessionId === dashTrackedSessionId; });
          if (!tracked) {
            dashTrackedSessionId = null;
            renderDashSessions();
          } else if (tracked.meta && tracked.meta.rootId && tracked.meta.rootId !== dashCurrentRootId) {
            loadDashTree(tracked.meta.rootId);
          }
        } else {
          // Auto-show tree if any session has one and no tree loaded
          var withTree = dashSessions.filter(function(s) { return s.meta && s.meta.rootId; });
          if (withTree.length > 0 && !dashCurrentRootId) {
            withTree.sort(function(a, b) { return b.lastActivity - a.lastActivity; });
            loadDashTree(withTree[0].meta.rootId);
          }
        }

        updateDashHighlights();
      });

      function renderDashSessions() {
        dashSessionCount.textContent = dashSessions.length;

        if (dashSessions.length === 0) {
          dashSessionList.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:12px">No active sessions</div>';
          return;
        }

        var html = "";
        for (var i = 0; i < dashSessions.length; i++) {
          var s = dashSessions[i];
          var isTracked = s.sessionId === dashTrackedSessionId;
          var icon = DASH_SESSION_ICONS[s.type] || "\\u{1F527}";
          var desc = dashEscape(s.description || s.type);
          var rootLabel = (s.meta && s.meta.rootId) ? s.meta.rootId.slice(0, 8) + "..." : "\\u2014";
          var ago = dashTimeAgo(s.lastActivity);

          html += '<div class="session-card ' + (isTracked ? "tracked" : "") + '" data-sid="' + s.sessionId + '">'
            + '<div class="session-card-header">'
            + '<span class="session-type-icon">' + icon + '</span>'
            + '<span class="session-desc">' + desc + '</span>'
            + '</div>'
            + '<div class="session-meta-info">Tree: ' + rootLabel + ' \\u00B7 ' + ago + '</div>'
            + '<div class="session-actions">'
            + '<button class="session-btn ' + (isTracked ? "active" : "") + '" data-action="track" data-sid="' + s.sessionId + '">'
            + (isTracked ? "\\u{1F4CD} Tracking" : "\\u{1F3AF} Track")
            + '</button>'
            + '<button class="session-btn" data-action="chat" data-sid="' + s.sessionId + '">\\u{1F4AC} Chat</button>'
            + '</div>'
            + '</div>';
        }
        dashSessionList.innerHTML = html;
      }

      // Event delegation for session buttons
      dashSessionList.addEventListener("click", function(e) {
        var btn = e.target.closest("[data-action]");
        if (!btn) return;
        var action = btn.getAttribute("data-action");
        var sid = btn.getAttribute("data-sid");
        if (action === "track") dashTrackSession(sid);
        else if (action === "chat") dashViewChat(sid);
      });

      function dashTrackSession(sessionId) {
        if (dashTrackedSessionId === sessionId) {
          dashTrackedSessionId = null;
        } else {
          dashTrackedSessionId = sessionId;
          var s = dashSessions.find(function(s) { return s.sessionId === sessionId; });
          if (s && s.meta && s.meta.rootId) loadDashTree(s.meta.rootId);
        }
        renderDashSessions();
      }

      // ── Tree loading ──────────────────────────────────────────────
      function loadDashTree(rootId) {
        if (rootId === dashCurrentRootId && dashTreeData) return;
        dashCurrentRootId = rootId;
        dashTreeCanvas.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted)">Loading tree...</div>';
        dashTreeEmpty.style.display = "none";
        dashTreeContent.style.display = "";
        dashTreeTitle.textContent = "Tree: " + rootId.slice(0, 8) + "...";
        socket.emit("getDashboardTree", { rootId: rootId });
      }

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

      function renderDashTree() {
        if (!dashTreeData) {
          dashTreeEmpty.style.display = "";
          dashTreeContent.style.display = "none";
          return;
        }
        dashTreeEmpty.style.display = "none";
        dashTreeContent.style.display = "";
        dashTreeTitle.textContent = dashEscape(dashTreeData.name);
        dashTreeCanvas.innerHTML = renderNodeHTML(dashTreeData);
      }

      function renderNodeHTML(node) {
        var hasChildren = node.children && node.children.length > 0;
        var childrenHTML = "";
        if (hasChildren) {
          childrenHTML = '<div class="tree-children">';
          for (var i = 0; i < node.children.length; i++) {
            childrenHTML += renderNodeHTML(node.children[i]);
          }
          childrenHTML += '</div>';
        }
        return '<div class="tree-node" data-node-id="' + node.id + '">'
          + '<div class="tree-node-row">'
          + '<span class="tree-toggle">' + (hasChildren ? '\\u25B8' : '\\u00B7') + '</span>'
          + '<span class="tree-node-name">' + dashEscape(node.name) + '</span>'
          + '<span class="tree-node-status">' + (node.status || "active") + '</span>'
          + '<div class="tree-node-badges"></div>'
          + '</div>'
          + childrenHTML
          + '</div>';
      }

      // Toggle tree children on click
      dashTreeCanvas.addEventListener("click", function(e) {
        var toggle = e.target.closest(".tree-toggle");
        if (!toggle) return;
        var nodeEl = toggle.closest(".tree-node");
        var children = nodeEl.querySelector(":scope > .tree-children");
        if (children) {
          var collapsed = children.style.display === "none";
          children.style.display = collapsed ? "" : "none";
          toggle.textContent = collapsed ? "\\u25BE" : "\\u25B8";
        }
      });

      // ── Node highlighting ─────────────────────────────────────────
      function updateDashHighlights() {
        var rows = document.querySelectorAll(".tree-node-row.highlighted");
        for (var i = 0; i < rows.length; i++) {
          rows[i].classList.remove("highlighted");
          var badges = rows[i].querySelector(".tree-node-badges");
          if (badges) badges.innerHTML = "";
        }
        for (var j = 0; j < dashSessions.length; j++) {
          var s = dashSessions[j];
          if (!s.meta || !s.meta.nodeId) continue;
          var nodeEl = document.querySelector('[data-node-id="' + s.meta.nodeId + '"] > .tree-node-row');
          if (!nodeEl) continue;
          nodeEl.classList.add("highlighted");
          var badges = nodeEl.querySelector(".tree-node-badges");
          if (badges) {
            badges.innerHTML += '<span class="tree-session-badge">' + (DASH_SESSION_ICONS[s.type] || "\\u{1F527}") + '</span>';
          }
        }
      }

      // ── Tree change live updates ──────────────────────────────────
      socket.on("dashboardTreeChanged", function(data) {
        if (dashCurrentRootId) {
          socket.emit("getDashboardTree", { rootId: dashCurrentRootId });
        }
      });

      // ── Chat panel ────────────────────────────────────────────────
      document.getElementById("dashChatClose").addEventListener("click", function() {
        dashChatPanel.classList.remove("open");
      });

      function dashViewChat(sessionId) {
        dashChatPanel.classList.add("open");
        dashChatBody.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted)">Loading...</div>';
        dashChatTitle.textContent = "AI Chat \\u2014 " + sessionId.slice(0, 8);
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

    })();
  `;
}
