/**
 * Food Dashboard
 *
 * Builds from getDailyPicture() data. Renders via the generic app dashboard.
 * Custom macros (user-created value nodes) appear automatically.
 */

import { renderAppDashboard } from "../../html-rendering/html/appDashboard.js";
import { timeAgo } from "../../html-rendering/html/utils.js";

const MACRO_COLORS = { protein: "#667eea", carbs: "#48bb78", fats: "#ecc94b" };

export function renderFoodDashboard({ rootId, rootName, picture, token, userId }) {
  const p = picture || {};
  const calories = p.calories || {};
  const profile = p.profile || {};
  const recentMeals = p.recentMeals || [];
  const mealsBySlot = p.mealsBySlot || {};
  const recentHistory = p.recentHistory || [];

  const calPct = calories.goal > 0 ? Math.round((calories.today / calories.goal) * 100) : 0;
  const calRemaining = Math.max(0, (calories.goal || 0) - (calories.today || 0));

  // Profile subtitle
  const profileParts = [];
  if (profile.calorieGoal) profileParts.push(`${profile.calorieGoal} cal target`);
  if (profile.goal) profileParts.push(profile.goal);
  if (profile.restrictions) profileParts.push(profile.restrictions);

  // Weekly stats
  const stats = [];
  const weeklyAvgCals = recentHistory.length > 0
    ? Math.round(recentHistory.reduce((s, h) => s + ((h.protein || 0) * 4 + (h.carbs || 0) * 4 + (h.fats || 0) * 9), 0) / recentHistory.length)
    : null;
  if (weeklyAvgCals) stats.push({ value: String(weeklyAvgCals), label: "avg cal/day" });
  if (recentHistory.length > 0) stats.push({ value: String(recentHistory.length), label: "days tracked" });
  const proteinHitRate = p.protein?.weeklyHitRate;
  if (proteinHitRate) stats.push({ value: Math.round(proteinHitRate * 100) + "%", label: "protein hit" });

  // Macro bars: core first, then any user-created value nodes
  const bars = [];
  const coreOrder = ["protein", "carbs", "fats"];
  const valueRoles = p._valueRoles || coreOrder;
  const ordered = [...coreOrder.filter(r => valueRoles.includes(r)), ...valueRoles.filter(r => !coreOrder.includes(r))];

  for (const role of ordered) {
    const m = p[role];
    if (!m) continue;
    const label = m.name || role.charAt(0).toUpperCase() + role.slice(1);
    const sub = [];
    if (m.weeklyAvg) sub.push("avg: " + Math.round(m.weeklyAvg) + "g");
    if (m.weeklyHitRate) sub.push("hit: " + Math.round(m.weeklyHitRate * 100) + "%");
    bars.push({
      label,
      current: m.today || 0,
      goal: m.goal || 0,
      color: MACRO_COLORS[role] || "#a78bfa",
      sub: sub.join(" . "),
      deleteUrl: m.nodeId ? `/api/v1/root/${rootId}/food/metric/${m.nodeId}` : null,
    });
  }

  // Cards
  const cards = [];

  // Today's meals by slot
  const slotNames = ["breakfast", "lunch", "dinner", "snack"];
  for (const slot of slotNames) {
    const meals = mealsBySlot[slot];
    if (!meals || meals.length === 0) continue;
    cards.push({
      title: slot.charAt(0).toUpperCase() + slot.slice(1),
      items: meals.map(m => {
        const delId = m.logNoteId || m.id;
        return {
          text: (m.text || "").slice(0, 120),
          sub: m.date ? new Date(m.date).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "",
          deleteUrl: delId ? `/api/v1/root/${rootId}/food/entry/${delId}` : null,
        };
      }),
    });
  }

  // Recent log: only show if no slot cards (avoid duplicate entries with double-delete risk)
  const hasSlotCards = cards.length > 0;
  if (!hasSlotCards && recentMeals.length > 0) {
    cards.push({
      title: "Recent Log",
      items: recentMeals.slice(0, 10).map(m => ({
        text: (m.text || "").slice(0, 120),
        sub: m.date ? timeAgo(new Date(m.date)) : "",
        deleteUrl: m.id ? `/api/v1/root/${rootId}/food/entry/${m.id}` : null,
      })),
      empty: "No meals logged today. Type below to start.",
    });
  }

  cards.push({
    title: "Past 7 Days",
    items: recentHistory.slice(0, 7).map(h => {
      const dayCals = Math.round((h.protein || 0) * 4 + (h.carbs || 0) * 4 + (h.fats || 0) * 9);
      const dayPct = calories.goal > 0 ? Math.round((dayCals / calories.goal) * 100) : 0;
      return {
        text: h.date || "?",
        detail: [`P:${h.protein || 0}g`, `C:${h.carbs || 0}g`, `F:${h.fats || 0}g`],
        sub: `${dayCals} cal (${dayPct}% of goal)`,
        bg: true,
      };
    }),
    empty: "History builds as you log meals each day.",
  });

  const addMetricHtml = bars.length === 0 ? "" : `
    <div style="display:flex;gap:8px;margin-top:8px;align-items:center">
      <input id="newMetricName" type="text" placeholder="Add metric (sugar, fiber, sodium...)"
        style="flex:1;padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.05);color:#fff;font-size:0.85rem;outline:none" />
      <input id="newMetricGoal" type="number" placeholder="Goal (g)"
        style="width:80px;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.05);color:#fff;font-size:0.85rem;outline:none" />
      <button onclick="addMetric()" style="padding:8px 14px;border-radius:8px;border:none;background:rgba(72,187,120,0.15);color:#4ade80;font-size:0.85rem;cursor:pointer">+</button>
    </div>`;

  const addMetricJs = `
    async function addMetric() {
      const name = document.getElementById('newMetricName').value.trim();
      if (!name) return;
      const goal = document.getElementById('newMetricGoal').value || 0;
      const url = '/api/v1/root/${rootId}/food/metric${token ? "?token=" + token : ""}';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, goal: Number(goal) })
      });
      if (res.ok) location.reload();
    }
    document.getElementById('newMetricName')?.addEventListener('keydown', e => { if (e.key === 'Enter') addMetric(); });
  `;

  return renderAppDashboard({
    rootId, rootName, token, userId,
    subtitle: profileParts.join(" . ") || null,
    hero: {
      value: String(Math.round(calories.today || 0)),
      label: `of ${Math.round(calories.goal || 0)} calories (${calPct}%)`,
      sub: calRemaining > 0 ? `${Math.round(calRemaining)} calories remaining` : "Goal reached",
      color: calPct >= 90 ? "#48bb78" : calPct >= 60 ? "#ecc94b" : "#fff",
    },
    stats,
    bars,
    afterBars: addMetricHtml,
    extraJs: addMetricJs,
    cards,
    commands: [
      { cmd: "food <message>", desc: "Log what you ate" },
      { cmd: "food daily", desc: "Today's macro summary" },
      { cmd: "food week", desc: "Weekly averages" },
      { cmd: "be", desc: "Start logging meals" },
    ],
    chatBar: { placeholder: "What did you eat? Or ask about your macros...", endpoint: `/api/v1/root/${rootId}/food` },
  });
}
