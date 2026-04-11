import { page } from "../../html-rendering/html/layout.js";
import {
  baseStyles,
  backNavStyles,
  glassHeaderStyles,
  glassCardStyles,
  glassCardPanelStyles,
  statGridStyles,
  responsiveBase,
} from "../../html-rendering/html/baseStyles.js";
import { escapeHtml } from "../../html-rendering/html/utils.js";

export function renderMemoryPage({ username, memories, reminders, qs }) {
  // Color story:
  //   Memories  -> glass-blue   (cool, reflective. Looking back through water.)
  //   Reminders -> glass-orange (warm, active. A flag in the field.)
  // Section panels stay default purple so they read as part of the surface.

  const css = `
    ${baseStyles}
    ${backNavStyles}
    ${glassHeaderStyles}
    ${glassCardStyles}
    ${glassCardPanelStyles}
    ${statGridStyles}
    ${responsiveBase}

    /* Tighter note layout for memory entries (shorter than full notes) */
    .memory-list { display: flex; flex-direction: column; gap: 12px; }
    .memory-list .note-card { padding: 18px 22px; }
    .memory-list .note-content {
      font-size: 14px;
      line-height: 1.6;
      margin-bottom: 0;
    }
    .memory-list .note-date {
      font-size: 11px;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.6);
      letter-spacing: 0.3px;
      text-transform: uppercase;
      margin-bottom: 6px;
    }

    .empty-row {
      padding: 24px;
      text-align: center;
      color: rgba(255, 255, 255, 0.45);
      font-size: 14px;
      font-style: italic;
    }

    .glass-card h2 {
      display: flex;
      align-items: baseline;
      gap: 10px;
    }
    .glass-card h2 .count {
      font-size: 13px;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.55);
      letter-spacing: 0;
    }
    .glass-card .panel-sub {
      font-size: 13px;
      color: rgba(255, 255, 255, 0.6);
      margin-top: -8px;
      margin-bottom: 18px;
      line-height: 1.5;
    }
  `;

  function renderNotes(notes, colorClass) {
    if (!notes || notes.length === 0) {
      return '<div class="empty-row">Nothing yet.</div>';
    }
    return `<div class="memory-list">${notes.map(n => {
      const time = n.createdAt
        ? new Date(n.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
        : "";
      return `<div class="note-card ${colorClass}">
        ${time ? `<div class="note-date">${escapeHtml(time)}</div>` : ""}
        <div class="note-content">${escapeHtml(n.content || "").replace(/\n/g, "<br>")}</div>
      </div>`;
    }).join("")}</div>`;
  }

  const body = `
    <div class="container" style="max-width: 760px;">
      <div class="back-nav">
        <a href="/dashboard${qs}" class="back-link" onclick="event.preventDefault();try{window.top.location.href='/dashboard${qs}'}catch(e){window.location.href='/dashboard${qs}'}">Home</a>
      </div>

      <div class="header">
        <h1>Home Memory</h1>
        <div class="header-subtitle">${escapeHtml(username || "User")} . What the lobby remembers.</div>
      </div>

      <div class="stat-grid" style="margin-bottom: 24px;">
        <div class="stat-item">
          <div class="stat-label">Memories</div>
          <div class="stat-value">${memories?.length || 0}</div>
          <div class="stat-sub">sessions remembered</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Reminders</div>
          <div class="stat-value">${reminders?.length || 0}</div>
          <div class="stat-sub">explicitly held</div>
        </div>
      </div>

      <div class="glass-card" style="animation-delay: 0.15s">
        <h2>Memories <span class="count">${memories?.length || 0}</span></h2>
        <div class="panel-sub">One sentence per home session. What you talked about.</div>
        ${renderNotes(memories, "glass-blue")}
      </div>

      <div class="glass-card" style="animation-delay: 0.25s">
        <h2>Reminders <span class="count">${reminders?.length || 0}</span></h2>
        <div class="panel-sub">Things you explicitly asked the lobby to remember.</div>
        ${renderNotes(reminders, "glass-orange")}
      </div>
    </div>
  `;

  return page({ title: `${username || "User"} . Home Memory`, css, body, js: "" });
}
