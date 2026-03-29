/**
 * Food Dashboard
 *
 * Today's macros, goals, recent meals, daily history, weekly averages,
 * hit rates, profile. Fully dynamic from getDailyPicture().
 */

import { page } from "../../html-rendering/html/layout.js";
import { esc, timeAgo } from "../../html-rendering/html/utils.js";
import { glassCardStyles, glassHeaderStyles, responsiveBase } from "../../html-rendering/html/baseStyles.js";
import { chatBarCss, chatBarHtml, chatBarJs, commandsRefHtml } from "../../html-rendering/html/chatBar.js";

function pctColor(pct) {
  if (pct >= 90) return "#48bb78";
  if (pct >= 60) return "#ecc94b";
  return "#718096";
}

function macroBar(label, today, goal, color, weeklyAvg, hitRate) {
  const pct = goal > 0 ? Math.min(Math.round((today / goal) * 100), 100) : 0;
  const remaining = Math.max(0, goal - today);
  return `
    <div style="margin-bottom: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px;">
        <span style="font-size: 0.9rem; color: rgba(255,255,255,0.8); font-weight: 500;">${label}</span>
        <span style="font-size: 0.85rem; color: rgba(255,255,255,0.5);">${Math.round(today)}/${goal}g <span style="color:${pctColor(pct)}">(${pct}%)</span></span>
      </div>
      <div style="height: 10px; background: rgba(255,255,255,0.08); border-radius: 5px; overflow: hidden; margin-bottom: 4px;">
        <div style="width: ${pct}%; height: 100%; background: ${color}; border-radius: 5px; transition: width 0.3s;"></div>
      </div>
      <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: rgba(255,255,255,0.3);">
        <span>${remaining > 0 ? Math.round(remaining) + "g remaining" : "Goal reached"}</span>
        <span>${weeklyAvg ? "avg: " + Math.round(weeklyAvg) + "g" : ""}${hitRate ? " . hit: " + Math.round(hitRate * 100) + "%" : ""}</span>
      </div>
    </div>
  `;
}

export function renderFoodDashboard({ rootId, rootName, picture, token, userId }) {
  const p = picture || {};
  const protein = p.protein || {};
  const carbs = p.carbs || {};
  const fats = p.fats || {};
  const calories = p.calories || {};
  const profile = p.profile || {};
  const recentMeals = p.recentMeals || [];
  const mealsBySlot = p.mealsBySlot || {};
  const recentHistory = p.recentHistory || [];

  const calPct = calories.goal > 0 ? Math.round((calories.today / calories.goal) * 100) : 0;
  const calRemaining = Math.max(0, (calories.goal || 0) - (calories.today || 0));
  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const timeStr = today.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  // Profile summary
  const profileParts = [];
  if (profile.calorieGoal) profileParts.push(`${profile.calorieGoal} cal target`);
  if (profile.goal) profileParts.push(profile.goal);
  if (profile.restrictions) profileParts.push(profile.restrictions);
  const profileStr = profileParts.join(" . ");

  const css = `
    ${glassHeaderStyles}
    ${glassCardStyles}
    ${responsiveBase}

    .food-layout { max-width: 800px; margin: 0 auto; padding: 1.5rem; }
    .food-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.2rem; margin-top: 1.5rem; }
    @media (max-width: 700px) { .food-grid { grid-template-columns: 1fr; } }

    .section-title {
      font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.1em;
      color: rgba(255,255,255,0.5); margin-bottom: 0.5rem;
    }

    .cal-hero { text-align: center; padding: 28px 0 20px; }
    .cal-number { font-size: 2.5rem; font-weight: 700; color: #fff; line-height: 1; }
    .cal-label { font-size: 0.85rem; color: rgba(255,255,255,0.4); margin-top: 4px; }
    .cal-remaining { font-size: 0.9rem; color: rgba(255,255,255,0.5); margin-top: 8px; }

    .meal-item {
      padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 0.85rem;
    }
    .meal-item:last-child { border-bottom: none; }
    .meal-text { color: rgba(255,255,255,0.7); margin-bottom: 2px; }
    .meal-time { color: rgba(255,255,255,0.3); font-size: 0.75rem; }

    .history-day {
      padding: 10px 12px; border-radius: 8px; margin-bottom: 6px;
      background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.04);
      transition: background 0.15s;
      cursor: default;
    }
    .history-day:hover { background: rgba(255,255,255,0.06); }
    .history-day-date { font-size: 0.85rem; color: rgba(255,255,255,0.6); margin-bottom: 4px; }
    .history-day-macros { display: flex; gap: 12px; font-size: 0.8rem; }
    .history-day-macros span { color: rgba(255,255,255,0.4); }
    .history-day-cal { font-size: 0.75rem; color: rgba(255,255,255,0.3); margin-top: 2px; }

    .stat-row { display: flex; gap: 10px; flex-wrap: wrap; margin: 8px 0 16px; }
    .stat-chip {
      background: rgba(255,255,255,0.06); border-radius: 16px;
      padding: 4px 12px; font-size: 0.8rem; color: rgba(255,255,255,0.5);
    }
    .stat-chip strong { color: rgba(255,255,255,0.8); }

    .empty-state { color: rgba(255,255,255,0.35); font-size: 0.9rem; padding: 1rem 0; font-style: italic; }
  `;

  // Weekly averages
  const weeklyAvgCals = recentHistory.length > 0
    ? Math.round(recentHistory.reduce((s, h) => s + ((h.protein || 0) * 4 + (h.carbs || 0) * 4 + (h.fats || 0) * 9), 0) / recentHistory.length)
    : null;

  const body = `
    <div class="food-layout">
      ${userId ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><a href="/api/v1/user/${userId}/apps?html${token ? "&token=" + esc(token) : ""}" style="font-size:0.85rem;color:rgba(255,255,255,0.4);text-decoration:none;">← Apps</a><a href="/api/v1/user/${userId}/llm?html${token ? "&token=" + esc(token) : ""}" style="font-size:0.85rem;color:rgba(255,255,255,0.4);text-decoration:none;">LLM</a></div>` : ""}
      <h1 style="font-size: 1.5rem; color: #fff; margin-bottom: 0;">${esc(rootName || "Food")}</h1>
      <div style="color: rgba(255,255,255,0.35); font-size: 0.85rem; margin-top: 4px;">${dateStr} . ${timeStr}</div>
      ${profileStr ? `<div style="color: rgba(255,255,255,0.3); font-size: 0.8rem; margin-top: 2px;">${esc(profileStr)}</div>` : ""}

      <div class="cal-hero">
        <div class="cal-number" style="color: ${pctColor(calPct)};">${Math.round(calories.today || 0)}</div>
        <div class="cal-label">of ${Math.round(calories.goal || 0)} calories (${calPct}%)</div>
        ${calRemaining > 0 ? `<div class="cal-remaining">${Math.round(calRemaining)} calories remaining</div>` : `<div class="cal-remaining" style="color:#48bb78;">Goal reached</div>`}
      </div>

      <div class="glass-card" style="padding: 20px;">
        ${macroBar("Protein", protein.today || 0, protein.goal || 0, "#667eea", protein.weeklyAvg, protein.weeklyHitRate)}
        ${macroBar("Carbs", carbs.today || 0, carbs.goal || 0, "#48bb78", carbs.weeklyAvg, carbs.weeklyHitRate)}
        ${macroBar("Fats", fats.today || 0, fats.goal || 0, "#ecc94b", fats.weeklyAvg, fats.weeklyHitRate)}
      </div>

      ${weeklyAvgCals || recentHistory.length > 0 ? `
      <div class="stat-row">
        ${weeklyAvgCals ? `<span class="stat-chip"><strong>${weeklyAvgCals}</strong> avg cal/day</span>` : ""}
        ${recentHistory.length > 0 ? `<span class="stat-chip"><strong>${recentHistory.length}</strong> days tracked</span>` : ""}
        ${protein.weeklyHitRate ? `<span class="stat-chip">protein hit <strong>${Math.round(protein.weeklyHitRate * 100)}%</strong></span>` : ""}
      </div>
      ` : ""}

      ${Object.keys(mealsBySlot).length > 0 ? `
      <div class="section-title">Today</div>
      <div class="food-grid">
        ${["breakfast", "lunch", "dinner", "snack"].map(slot => {
          const meals = mealsBySlot[slot];
          if (!meals || meals.length === 0) return "";
          const label = slot.charAt(0).toUpperCase() + slot.slice(1);
          return `
            <div class="glass-card" style="padding:14px">
              <div class="section-title" style="margin-top:0">${label}</div>
              ${meals.map(m => {
                const t = m.date ? new Date(m.date).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";
                return `<div class="meal-item"><div class="meal-text">${esc((m.text || "").slice(0, 120))}</div><div class="meal-time">${t}</div></div>`;
              }).join("")}
            </div>`;
        }).join("")}
      </div>
      ` : ""}

      <div class="food-grid">
        <div class="glass-card" style="padding: 16px;">
          <div class="section-title">Recent Log</div>
          ${recentMeals.length > 0 ? recentMeals.slice(0, 10).map(m => {
            const mealDate = m.date ? new Date(m.date) : null;
            const mealTime = mealDate ? mealDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";
            return `
            <div class="meal-item">
              <div class="meal-text">${esc((m.text || "").slice(0, 120))}</div>
              <div class="meal-time">${mealTime}${mealDate ? " . " + timeAgo(mealDate) : ""}</div>
            </div>
          `;}).join("") : '<div class="empty-state">No meals logged today. Type below to start.</div>'}
        </div>

        <div class="glass-card" style="padding: 16px;">
          <div class="section-title">Past 7 Days</div>
          ${recentHistory.length > 0 ? recentHistory.slice(0, 7).map(h => {
            const dayCals = Math.round((h.protein || 0) * 4 + (h.carbs || 0) * 4 + (h.fats || 0) * 9);
            const dayPct = calories.goal > 0 ? Math.round((dayCals / calories.goal) * 100) : 0;
            return `
            <div class="history-day">
              <div class="history-day-date">${esc(h.date || "?")}</div>
              <div class="history-day-macros">
                <span>P: <strong style="color:rgba(102,126,234,0.8)">${h.protein || 0}g</strong></span>
                <span>C: <strong style="color:rgba(72,187,120,0.8)">${h.carbs || 0}g</strong></span>
                <span>F: <strong style="color:rgba(236,201,75,0.8)">${h.fats || 0}g</strong></span>
              </div>
              <div class="history-day-cal">${dayCals} cal (${dayPct}% of goal)</div>
            </div>
          `;}).join("") : '<div class="empty-state">History builds as you log meals each day.</div>'}
        </div>
      </div>

      ${commandsRefHtml([
        { cmd: "food <message>", desc: "Log what you ate" },
        { cmd: "food daily", desc: "Today's macro summary" },
        { cmd: "food week", desc: "Weekly averages" },
        { cmd: "be", desc: "Start logging meals" },
      ])}
    </div>
  `;

  return page({
    title: `${rootName || "Food"} . ${dateStr}`,
    css: css + chatBarCss(),
    body: body + chatBarHtml({ placeholder: "What did you eat? Or ask about your macros..." }),
    js: chatBarJs({ endpoint: `/api/v1/root/${rootId}/food`, token }),
  });
}
