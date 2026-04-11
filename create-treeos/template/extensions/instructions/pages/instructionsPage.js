/**
 * Instructions page. Shows all user-level instructions grouped by scope
 * (global + per-extension) with remove buttons.
 */

import { page } from "../../html-rendering/html/layout.js";
import { esc, timeAgo } from "../../html-rendering/html/utils.js";
import { glassCardStyles, responsiveBase } from "../../html-rendering/html/baseStyles.js";

export function renderInstructionsPage({ userId, username, instructions, token, inApp }) {
  const tokenParam = token ? `&token=${esc(token)}` : "";
  const queryString = `?html${tokenParam}`;

  const css = `
    ${glassCardStyles}
    ${responsiveBase}

    .inst-container { max-width: 700px; margin: 0 auto; padding: 12px 20px 60px; }

    .page-header { text-align: center; padding: 32px 20px 12px; }
    .page-title { font-size: 1.4rem; color: #e6e8eb; margin-bottom: 6px; }
    .page-subtitle { color: #9ba1ad; font-size: 0.85rem; }

    .section-title { font-size: 1rem; font-weight: 600; color: #c4c8d0; margin: 24px 0 10px; }

    .inst-card {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 10px;
      padding: 12px 16px;
      margin-bottom: 8px;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }
    .inst-card:hover { border-color: rgba(255,255,255,0.12); }

    .inst-text { color: #e6e8eb; font-size: 0.9rem; line-height: 1.5; flex: 1; }
    .inst-meta { color: #666; font-size: 0.7rem; margin-top: 4px; }

    .inst-remove {
      background: none;
      border: 1px solid rgba(200,100,100,0.25);
      color: rgba(200,100,100,0.7);
      border-radius: 6px;
      padding: 4px 10px;
      font-size: 0.75rem;
      cursor: pointer;
      flex-shrink: 0;
      font-family: inherit;
    }
    .inst-remove:hover { background: rgba(200,100,100,0.1); color: #c97e6a; border-color: rgba(200,100,100,0.4); }

    .inst-empty { color: #666; font-size: 0.85rem; padding: 16px 0; }

    .inst-badge {
      display: inline-block;
      padding: 2px 8px;
      background: rgba(123,160,116,0.12);
      border: 1px solid rgba(123,160,116,0.25);
      color: #7ba074;
      border-radius: 4px;
      font-size: 0.7rem;
      font-weight: 500;
      margin-right: 6px;
    }

    .back-link {
      display: inline-block;
      color: #9ba1ad;
      text-decoration: none;
      font-size: 0.85rem;
      margin-bottom: 8px;
    }
    .back-link:hover { color: #e6e8eb; }

    .status-msg {
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 0.85rem;
      margin-bottom: 12px;
      display: none;
    }
    .status-msg.success { display: block; background: rgba(123,160,116,0.12); border: 1px solid rgba(123,160,116,0.25); color: #7ba074; }
    .status-msg.error { display: block; background: rgba(200,100,100,0.12); border: 1px solid rgba(200,100,100,0.25); color: #c97e6a; }
  `;

  const global = Array.isArray(instructions?.global) ? instructions.global : [];
  const byExtension = (instructions?.byExtension && typeof instructions.byExtension === "object")
    ? instructions.byExtension : {};
  const extKeys = Object.keys(byExtension).filter(k => Array.isArray(byExtension[k]) && byExtension[k].length > 0);
  const hasAny = global.length > 0 || extKeys.length > 0;

  function renderList(items) {
    if (!items || items.length === 0) return `<div class="inst-empty">None.</div>`;
    return items.map(i => `
      <div class="inst-card" data-id="${esc(i.id)}">
        <div>
          <div class="inst-text">${esc(i.text)}</div>
          <div class="inst-meta">${i.addedAt ? timeAgo(new Date(i.addedAt)) : ""}</div>
        </div>
        <button class="inst-remove" onclick="removeInstruction('${esc(i.id)}')">remove</button>
      </div>
    `).join("");
  }

  const body = `
    <div class="inst-container">
      ${!inApp ? `<a class="back-link" href="/api/v1/user/${userId}/profile${queryString}">&larr; Profile</a>` : ""}
      <div class="page-header">
        <div class="page-title">Instructions</div>
        <div class="page-subtitle">${esc(username || "")}'s personal AI customization</div>
      </div>

      <div id="statusMsg" class="status-msg"></div>

      ${!hasAny ? `
        <div class="inst-empty" style="text-align:center;padding:32px 0;">
          No personal instructions yet. Just tell the AI something like "remember to always weigh me in kg"
          or "I'm vegetarian" and it will save it automatically.
        </div>
      ` : ""}

      ${global.length > 0 ? `
        <div class="section-title"><span class="inst-badge">global</span> Everywhere</div>
        ${renderList(global)}
      ` : ""}

      ${extKeys.map(ext => `
        <div class="section-title"><span class="inst-badge">${esc(ext)}</span> ${esc(ext.charAt(0).toUpperCase() + ext.slice(1))} only</div>
        ${renderList(byExtension[ext])}
      `).join("")}
    </div>
  `;

  const js = `
    async function removeInstruction(id) {
      if (!confirm("Remove this instruction?")) return;
      try {
        const res = await fetch("/api/v1/user/${userId}/instructions/" + id, {
          method: "DELETE",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        });
        const data = await res.json();
        if (data.status === "ok") {
          const card = document.querySelector('[data-id="' + id + '"]');
          if (card) card.remove();
          showStatus("Removed.", "success");
        } else {
          showStatus((data.error && data.error.message) || "Failed to remove.", "error");
        }
      } catch (err) {
        showStatus("Network error: " + err.message, "error");
      }
    }

    function showStatus(msg, type) {
      var el = document.getElementById("statusMsg");
      el.textContent = msg;
      el.className = "status-msg " + type;
      setTimeout(function() { el.className = "status-msg"; }, 3000);
    }
  `;

  return page({ title: "Instructions", css, body, js });
}
