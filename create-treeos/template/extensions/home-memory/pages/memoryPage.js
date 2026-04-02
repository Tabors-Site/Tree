import { page } from "../../html-rendering/html/layout.js";
import { baseStyles, glassHeaderStyles, responsiveBase } from "../../html-rendering/html/baseStyles.js";
import { escapeHtml } from "../../html-rendering/html/utils.js";

export function renderMemoryPage({ username, memories, reminders, qs }) {
  const css = `
    ${baseStyles}
    ${glassHeaderStyles}
    ${responsiveBase}

    .section {
      margin-bottom: 28px;
      animation: fadeInUp 0.4s ease-out both;
    }
    .section-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 14px;
    }
    .section-icon {
      width: 36px; height: 36px;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 16px;
      flex-shrink: 0;
    }
    .section-title { font-size: 16px; font-weight: 600; color: rgba(255,255,255,0.6); }
    .section-sub { font-size: 12px; color: rgba(255,255,255,0.3); }

    .memory {
      padding: 10px 14px;
      background: rgba(255,255,255,0.04);
      border-radius: 8px;
      margin-bottom: 6px;
      font-size: 13px;
      line-height: 1.6;
      color: rgba(255,255,255,0.4);
      border-left: 3px solid rgba(255,255,255,0.08);
    }
    .memory-time {
      font-size: 10px;
      color: rgba(255,255,255,0.2);
      margin-bottom: 4px;
    }

    .memories-section .section-icon { background: rgba(102, 126, 234, 0.2); color: rgba(102, 126, 234, 0.9); }
    .memories-section .memory { border-left-color: rgba(102, 126, 234, 0.3); }

    .reminders-section .section-icon { background: rgba(249, 115, 22, 0.2); color: rgba(249, 115, 22, 0.9); }
    .reminders-section .memory { border-left-color: rgba(249, 115, 22, 0.3); }

    .empty-state {
      color: rgba(255,255,255,0.25);
      font-size: 13px;
      font-style: italic;
      padding: 12px 0;
    }

    .back-nav { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
    .back-link {
      display: inline-flex; align-items: center; gap: 6px; padding: 10px 20px;
      background: rgba(var(--glass-water-rgb), var(--glass-alpha)); backdrop-filter: blur(22px);
      color: rgba(255,255,255,0.6); text-decoration: none; border-radius: 980px;
      font-weight: 600; font-size: 14px; border: 1px solid rgba(255,255,255,0.12);
    }
    .back-link:hover { background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover)); }

    .stats-row {
      display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 24px;
    }
    .stat {
      padding: 8px 16px;
      background: rgba(255,255,255,0.04);
      border-radius: 8px;
      font-size: 13px;
      color: rgba(255,255,255,0.35);
      border: 1px solid rgba(255,255,255,0.06);
    }
    .stat strong { color: rgba(255,255,255,0.5); }
  `;

  function renderNotes(notes) {
    if (!notes || notes.length === 0) return '<div class="empty-state">Nothing yet.</div>';
    return notes.map(n => {
      const time = n.createdAt ? new Date(n.createdAt).toLocaleDateString() : '';
      return `<div class="memory">
        ${time ? `<div class="memory-time">${escapeHtml(time)}</div>` : ''}
        ${escapeHtml(n.content || '').replace(/\n/g, '<br>')}
      </div>`;
    }).join('');
  }

  const body = `
    <div class="container" style="max-width: 700px;">
      <div class="back-nav">
        <a href="/dashboard${qs}" class="back-link">Home</a>
      </div>

      <div class="header">
        <h1>Home Memory</h1>
        <div class="header-subtitle">${escapeHtml(username || 'User')} . What the lobby remembers.</div>
      </div>

      <div class="stats-row">
        <div class="stat">Memories: <strong>${memories?.length || 0}</strong></div>
        <div class="stat">Reminders: <strong>${reminders?.length || 0}</strong></div>
      </div>

      <div class="section memories-section" style="animation-delay: 0.1s">
        <div class="section-header">
          <div class="section-icon">M</div>
          <div>
            <div class="section-title">Memories</div>
            <div class="section-sub">One sentence per home session. What you talked about.</div>
          </div>
        </div>
        ${renderNotes(memories)}
      </div>

      <div class="section reminders-section" style="animation-delay: 0.2s">
        <div class="section-header">
          <div class="section-icon">R</div>
          <div>
            <div class="section-title">Reminders</div>
            <div class="section-sub">Things you explicitly asked the lobby to remember.</div>
          </div>
        </div>
        ${renderNotes(reminders)}
      </div>
    </div>
  `;

  return page({ title: `${username || 'User'} . Home Memory`, css, body, js: '' });
}
