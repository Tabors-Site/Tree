/**
 * Apps Page
 *
 * Launchpad for the proficiency stack. Four app cards.
 * Active apps link to their dashboard. Inactive apps show an input to start.
 */

import { page } from "../../html-rendering/html/layout.js";
import { esc } from "../../html-rendering/html/utils.js";
import { glassCardStyles, glassHeaderStyles, responsiveBase } from "../../html-rendering/html/baseStyles.js";
import { resolveSlots } from "../slots.js";

// Legacy export for backward compat. Extensions should use registerSlot("apps-grid", ...) instead.
const APPS = [];
export { APPS };

export function renderAppsPage({ userId, username, rootMap, qs }) {
  const tokenParam = qs?.token ? `&token=${esc(qs.token)}` : "";
  const tokenField = qs?.token ? `<input type="hidden" name="token" value="${esc(qs.token)}" />` : "";

  const css = `
    ${glassHeaderStyles}
    ${glassCardStyles}
    ${responsiveBase}

    .apps-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1.5rem;
      max-width: 900px;
      margin: 2rem auto;
    }
    @media (max-width: 700px) { .apps-grid { grid-template-columns: 1fr; } }

    .app-card {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 14px;
      padding: 24px;
      transition: border-color 0.2s;
    }
    .app-card:hover { border-color: rgba(255,255,255,0.15); }

    .app-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
    .app-emoji { font-size: 2rem; }
    .app-name { font-size: 1.2rem; font-weight: 600; color: #fff; }

    .app-desc {
      font-size: 0.85rem;
      color: rgba(255,255,255,0.5);
      line-height: 1.7;
      margin-bottom: 16px;
    }

    .app-active {
      display: inline-block;
      padding: 8px 20px;
      background: rgba(72, 187, 120, 0.15);
      border: 1px solid rgba(72, 187, 120, 0.3);
      border-radius: 8px;
      color: #48bb78;
      font-size: 0.9rem;
      text-decoration: none;
      font-weight: 500;
    }
    .app-active:hover { background: rgba(72, 187, 120, 0.25); }

    .app-form { display: flex; flex-direction: column; gap: 10px; }
    .app-input {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px;
      padding: 10px 14px;
      color: #fff;
      font-size: 0.9rem;
      font-family: inherit;
      outline: none;
    }
    .app-input:focus { border-color: rgba(102, 126, 234, 0.4); }
    .app-input::placeholder { color: rgba(255,255,255,0.25); }

    .app-start {
      padding: 10px 20px;
      background: rgba(102, 126, 234, 0.2);
      border: 1px solid rgba(102, 126, 234, 0.3);
      border-radius: 8px;
      color: rgba(255,255,255,0.8);
      font-size: 0.9rem;
      cursor: pointer;
      font-family: inherit;
      align-self: flex-start;
    }
    .app-start:hover { background: rgba(102, 126, 234, 0.3); }

    .page-header {
      text-align: center;
      padding: 48px 20px 0;
    }
    .page-title { font-size: 1.6rem; color: #fff; margin-bottom: 8px; }
    .page-subtitle { color: rgba(255,255,255,0.45); font-size: 0.95rem; }
  `;

  // Extensions register app cards via the "apps-grid" slot.
  // Each card receives { userId, rootMap, tokenParam, tokenField, esc } context.
  const cards = resolveSlots("apps-grid", { userId, rootMap, tokenParam, tokenField, esc });

  const body = `
    <div style="max-width: 960px; margin: 0 auto; padding: 12px 20px 0; display: flex; justify-content: space-between; align-items: center;">
      <a href="/chat" target="_top" style="font-size:0.85rem;color:rgba(255,255,255,0.4);text-decoration:none;">← Chat</a>
      <div style="display:flex;gap:16px;">
        <a href="/dashboard" target="_top" style="font-size:0.85rem;color:rgba(255,255,255,0.4);text-decoration:none;">Advanced</a>
        <a href="/api/v1/user/${userId}/llm?html${tokenParam}" style="font-size:0.85rem;color:rgba(255,255,255,0.4);text-decoration:none;">LLM</a>
      </div>
    </div>
    <div class="page-header">
      <div class="page-title">Apps</div>
      <div class="page-subtitle">${esc(username || "")}'s proficiency stack</div>
    </div>
    <div style="max-width: 960px; margin: 0 auto; padding: 0 20px 60px;">
      <div class="apps-grid">
        ${cards}
      </div>
    </div>
  `;

  return page({ title: "Apps", css, body });
}
