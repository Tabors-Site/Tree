import { page } from "../../html-rendering/html/layout.js";
import { esc } from "../../html-rendering/html/utils.js";

export function renderNotifications({ userId, notifications, total, username, token }) {
  const tokenQS = token ? `?token=${encodeURIComponent(token)}&html` : `?html`;

    const items = notifications
      .map((n) => {
        const icon = n.type === "dream-thought" ? "\uD83D\uDCAD" : "\uD83D\uDCCB";
        const typeLabel = n.type === "dream-thought" ? "Thought" : "Summary";
        const colorClass =
          n.type === "dream-thought" ? "glass-purple" : "glass-indigo";
        const date = new Date(n.createdAt).toLocaleString();

        return `
      <li class="note-card ${colorClass}">
        <div class="note-content">
          <div class="contribution-action">
            <span style="font-size:20px;margin-right:6px">${icon}</span>
            ${esc(n.title)}
            <span class="badge badge-type">${typeLabel}</span>
          </div>
          <div style="margin-top:10px;font-size:14px;color:rgba(255,255,255,0.9);line-height:1.6;white-space:pre-wrap">${esc(n.content)}</div>
        </div>
        <div class="note-meta">
          ${date}
        </div>
      </li>`;
      })
      .join("");

  const css = `
.header-subtitle {
  margin-bottom: 16px;
}


/* ── Badges ─────────────────────────────────────── */

.badge {
  display: inline-flex; align-items: center;
  padding: 3px 10px; border-radius: 980px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.3px;
  border: 1px solid rgba(255,255,255,0.2);
}

.badge-type {
  background: rgba(255,255,255,0.15);
  color: rgba(255,255,255,0.8);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-size: 10px;
  margin-left: 8px;
}

/* ── Responsive ─────────────────────────────────── */
`;

  const body = `
  <div class="container">
    <div class="back-nav">
      <a href="/api/v1/user/${userId}${tokenQS}" class="back-link">\u2190 Back to Profile</a>
    </div>

    <div class="header">
      <h1>
        Notifications for
        <a href="/api/v1/user/${userId}${tokenQS}">@${esc(username)}</a>
        ${notifications.length > 0 ? `<span class="message-count">${total}</span>` : ""}
      </h1>
      <div class="header-subtitle">Dream summaries and thoughts from your trees</div>
    </div>

    ${
      items.length
        ? `<ul class="notes-list">${items}</ul>`
        : `
    <div class="empty-state">
      <div class="empty-state-icon">\uD83D\uDD14</div>
      <div class="empty-state-text">No notifications yet</div>
      <div class="empty-state-subtext">Dreams will generate summaries and thoughts automatically</div>
    </div>`
    }
  </div>`;

  return page({
    title: `${esc(username)} - Notifications`,
    css,
    body,
  });
}
