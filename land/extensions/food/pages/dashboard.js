/**
 * Food Dashboard
 *
 * Today's macros, goals, recent meals, daily history.
 */

import { page } from "../../html-rendering/html/layout.js";
import { esc, timeAgo } from "../../html-rendering/html/utils.js";
import { glassCardStyles, glassHeaderStyles, responsiveBase } from "../../html-rendering/html/baseStyles.js";
import { chatBarCss, chatBarHtml, chatBarJs } from "../../html-rendering/html/chatBar.js";

function pctColor(pct) {
  if (pct >= 90) return "#48bb78";
  if (pct >= 60) return "#ecc94b";
  return "#718096";
}

function macroBar(label, today, goal, color) {
  const pct = goal > 0 ? Math.min(Math.round((today / goal) * 100), 100) : 0;
  return `
    <div style="margin-bottom: 12px;">
      <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 4px;">
        <span style="color: rgba(255,255,255,0.7);">${label}</span>
        <span style="color: rgba(255,255,255,0.5);">${Math.round(today)}/${goal}g (${pct}%)</span>
      </div>
      <div style="height: 8px; background: rgba(255,255,255,0.08); border-radius: 4px; overflow: hidden;">
        <div style="width: ${pct}%; height: 100%; background: ${color}; border-radius: 4px;"></div>
      </div>
    </div>
  `;
}

export function renderFoodDashboard({ rootId, rootName, picture, token }) {
  const p = picture || {};
  const protein = p.protein || {};
  const carbs = p.carbs || {};
  const fats = p.fats || {};
  const calories = p.calories || {};
  const profile = p.profile || {};
  const recentMeals = p.recentMeals || [];
  const recentHistory = p.recentHistory || [];

  const calPct = calories.goal > 0 ? Math.round((calories.today / calories.goal) * 100) : 0;

  const css = `
    ${glassHeaderStyles}
    ${glassCardStyles}
    ${responsiveBase}

    .food-layout { max-width: 800px; margin: 0 auto; padding: 1.5rem; }
    .food-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.2rem; margin-top: 1.5rem; }
    @media (max-width: 700px) { .food-grid { grid-template-columns: 1fr; } }

    .section-title {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: rgba(255,255,255,0.5);
      margin-bottom: 0.5rem;
    }

    .cal-ring {
      text-align: center;
      padding: 24px 0 16px;
    }
    .cal-number { font-size: 2.2rem; font-weight: 700; color: #fff; }
    .cal-label { font-size: 0.85rem; color: rgba(255,255,255,0.4); }

    .meal-item {
      padding: 8px 0;
      border-bottom: 1px solid rgba(255,255,255,0.04);
      font-size: 0.85rem;
    }
    .meal-item:last-child { border-bottom: none; }
    .meal-text { color: rgba(255,255,255,0.7); }
    .meal-time { color: rgba(255,255,255,0.3); font-size: 0.8rem; }

    .history-row {
      display: flex;
      justify-content: space-between;
      padding: 6px 0;
      font-size: 0.85rem;
      border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    .history-row:last-child { border-bottom: none; }

    .empty-state {
      color: rgba(255,255,255,0.35);
      font-size: 0.9rem;
      padding: 1rem 0;
      font-style: italic;
    }
  `;

  const body = `
    <div class="food-layout">
      <h1 style="font-size: 1.5rem; color: #fff; margin-bottom: 0;">${esc(rootName || "Food")}</h1>
      ${profile.goal ? `<p style="color: rgba(255,255,255,0.4); font-size: 0.85rem; margin-top: 4px;">${esc(profile.goal)}</p>` : ""}

      <div class="cal-ring">
        <div class="cal-number" style="color: ${pctColor(calPct)};">${Math.round(calories.today || 0)}</div>
        <div class="cal-label">of ${Math.round(calories.goal || 0)} calories (${calPct}%)</div>
      </div>

      <div class="glass-card" style="padding: 20px;">
        ${macroBar("Protein", protein.today || 0, protein.goal || 0, "#667eea")}
        ${macroBar("Carbs", carbs.today || 0, carbs.goal || 0, "#48bb78")}
        ${macroBar("Fats", fats.today || 0, fats.goal || 0, "#ecc94b")}
      </div>

      <div class="food-grid">
        <div class="glass-card" style="padding: 16px;">
          <div class="section-title">Recent Meals</div>
          ${recentMeals.length > 0 ? recentMeals.slice(0, 8).map(m => `
            <div class="meal-item">
              <div class="meal-text">${esc((m.text || "").slice(0, 100))}</div>
              <div class="meal-time">${m.date ? timeAgo(new Date(m.date)) : ""}</div>
            </div>
          `).join("") : '<div class="empty-state">No meals logged today.</div>'}
        </div>

        <div class="glass-card" style="padding: 16px;">
          <div class="section-title">Recent Days</div>
          ${recentHistory.length > 0 ? recentHistory.slice(0, 7).map(h => `
            <div class="history-row">
              <span style="color: rgba(255,255,255,0.6);">${esc(h.date || "?")}</span>
              <span style="color: rgba(255,255,255,0.4);">P:${h.protein || 0} C:${h.carbs || 0} F:${h.fats || 0}</span>
            </div>
          `).join("") : '<div class="empty-state">No history yet.</div>'}
        </div>
      </div>
    </div>
  `;

  return page({
    title: `${rootName || "Food"} Dashboard`,
    css: css + chatBarCss(),
    body: body + chatBarHtml({ placeholder: "What did you eat? Or ask about your macros..." }),
    js: chatBarJs({ endpoint: `/api/v1/root/${rootId}/food`, token }),
  });
}
