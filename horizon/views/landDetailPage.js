import {
  escapeHtml, timeAgo, pageShell, packageCard,
} from "./shared.js";

export function renderLandDetailPage({ land, extensions, comments, stars, flags }) {
  const statusColors = {
    active: "#4ade80", degraded: "#facc15", unreachable: "#f87171", dead: "#666",
  };
  const statusColor = statusColors[land.status] || "#888";

  const extCards = extensions && extensions.length > 0
    ? extensions.map((ext, i) => packageCard(ext, i)).join("")
    : '<div class="empty-state">No published extensions.</div>';

  const body = `
    <div class="land-header" style="animation:fadeInUp 0.5s ease-out both;">
      <h1 style="font-size:28px;font-weight:800;letter-spacing:-0.5px;margin-bottom:4px;">
        ${escapeHtml(land.name || land.domain)}
      </h1>
      <p style="font-size:14px;color:var(--text-secondary);margin-bottom:8px;">
        <a href="${escapeHtml(land.baseUrl)}" style="color:var(--text-secondary);">${escapeHtml(land.domain)}</a>
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusColor};margin-left:8px;vertical-align:middle;"></span>
        <span style="color:${statusColor};font-size:12px;margin-left:4px;">${escapeHtml(land.status)}</span>
      </p>
    </div>

    <!-- Stats -->
    <div class="glass-card" style="animation-delay:0.05s;">
      <div style="display:flex;gap:24px;flex-wrap:wrap;align-items:center;">
        <div>
          <span style="font-size:18px;">&#11088;</span>
          <strong style="color:var(--text-dim);">${stars || 0}</strong>
          <span style="color:var(--text-muted);font-size:12px;">stars across all packages</span>
        </div>
        <div>
          <span style="font-size:18px;">&#9873;</span>
          <strong style="color:var(--text-dim);">${flags || 0}</strong>
          <span style="color:var(--text-muted);font-size:12px;">flags</span>
        </div>
        <div style="margin-left:auto;text-align:right;font-size:12px;color:var(--text-muted);">
          ${land.seedVersion ? `Seed v${escapeHtml(land.seedVersion)}` : ""}
          ${land.metadata?.userCount ? ` . ${land.metadata.userCount} users` : ""}
          ${land.metadata?.treeCount ? ` . ${land.metadata.treeCount} trees` : ""}
          <br/>Registered ${timeAgo(land.registeredAt)} . Last seen ${timeAgo(land.lastSeenAt)}
        </div>
      </div>
    </div>

    <!-- Published Extensions -->
    <div class="glass-card" style="animation-delay:0.1s;">
      <h2>Published Packages (${extensions.length})</h2>
      <div class="card-grid">
        ${extCards}
      </div>
    </div>

    <!-- Comments -->
    <div class="glass-card" style="animation-delay:0.15s;">
      <h2>Comments</h2>
      <div id="comments-list" style="min-height:40px;">
        <p style="color:var(--text-muted);font-size:13px;">Loading comments...</p>
      </div>
      <p style="margin-top:16px;font-size:12px;color:var(--text-muted);">
        Comment from the CLI: <code>treeos ext comment-land ${escapeHtml(land.domain)} "your comment"</code>
      </p>
    </div>
  `;

  const extraStyles = `
    .comment {
      padding: 12px 0;
      border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    .comment:last-child { border-bottom: none; }
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
    .comment-time { margin-left: auto; font-size: 11px; }
    .comment-text {
      font-size: 13px;
      color: var(--text-dim);
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-word;
    }
  `;

  const extraScripts = `
    (async function loadComments() {
      try {
        var res = await fetch("/lands/${encodeURIComponent(land.domain)}/comments?limit=50");
        var data = await res.json();
        var list = document.getElementById("comments-list");
        if (!data.comments || data.comments.length === 0) {
          list.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">No comments yet.</p>';
          return;
        }
        var html = "";
        for (var c of data.comments) {
          var author = c.authorDomain || "unknown";
          var user = c.authorUsername ? c.authorUsername + " @ " + author : author;
          var ms = Date.now() - new Date(c.createdAt).getTime();
          var d = Math.floor(ms/(86400000));
          var ago = d > 30 ? new Date(c.createdAt).toLocaleDateString() : d > 0 ? d+"d ago" : Math.floor(ms/3600000)+"h ago";
          html += '<div class="comment">'
            + '<div class="comment-meta"><strong>' + esc(user) + '</strong><span class="comment-time">' + ago + '</span></div>'
            + '<div class="comment-text">' + esc(c.text) + '</div>'
            + '</div>';
        }
        list.innerHTML = html;
      } catch(e) {
        document.getElementById("comments-list").innerHTML = '<p style="color:var(--text-muted);font-size:13px;">Could not load comments.</p>';
      }
    })();
    function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  `;

  return pageShell({
    title: `${land.name || land.domain} - Canopy Horizon`,
    activePage: "lands",
    extraStyles,
    extraScripts,
  }, body);
}
