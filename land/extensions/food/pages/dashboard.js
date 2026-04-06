/**
 * Food Dashboard
 *
 * Builds from getDailyPicture() and getHistory() data.
 * The surface: what matters right now rises. What's quiet recedes.
 * No LLM call. The data tells us what to say.
 */

import { renderAppDashboard } from "../../html-rendering/html/appDashboard.js";
import { timeAgo } from "../../html-rendering/html/utils.js";

const MACRO_COLORS = { protein: "#667eea", carbs: "#48bb78", fats: "#ecc94b" };

// ── Surfacing logic ──

function buildSurface(picture, weeklySummaries) {
  const cal = picture?.calories || {};
  const profile = picture?.profile || {};
  const history = (picture?.recentHistory || []).filter(d => (d.type || "daily") === "daily");
  const meals = picture?.recentMeals || [];
  const valueRoles = picture?._valueRoles || [];

  const hour = new Date().getHours();
  const calPct = cal.goal > 0 ? Math.round((cal.today / cal.goal) * 100) : 0;
  const calRemaining = Math.max(0, (cal.goal || 0) - (cal.today || 0));
  const hasMealsToday = meals.length > 0 && meals.some(m => {
    if (!m.date) return false;
    const d = new Date(m.date);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  });

  // Find weak macros (hit rate < 60% this week)
  const weakMacros = [];
  const strongMacros = [];
  for (const role of valueRoles) {
    const m = picture[role];
    if (!m || !m.weeklyHitRate) continue;
    if (m.weeklyHitRate < 0.6 && m.goal > 0) weakMacros.push(m.name || role);
    if (m.weeklyHitRate >= 0.85 && m.goal > 0) strongMacros.push(m.name || role);
  }

  // Streak detection from history
  let streak = 0;
  for (const day of history) {
    const allHit = valueRoles.every(role => {
      const hitKey = `hit${role.charAt(0).toUpperCase() + role.slice(1)}Goal`;
      return day[hitKey] !== false; // true or undefined (no goal) counts
    });
    if (allHit && day.calories > 0) streak++;
    else break;
  }

  // No profile
  if (!profile.calorieGoal && !picture?.protein?.goal) {
    return { text: "Set your goals to start tracking.", tone: "neutral" };
  }

  // First day (no history)
  if (history.length === 0 && !hasMealsToday) {
    return { text: "First day tracking. Log what you eat and the picture builds.", tone: "neutral" };
  }

  // Evening, goals hit
  if (hour >= 17 && calPct >= 90 && calPct <= 110 && weakMacros.length === 0) {
    const streakStr = streak >= 2 ? ` ${streak} days in a row.` : "";
    return { text: `All targets hit today. ${Math.round(cal.today)} of ${Math.round(cal.goal)} calories.${streakStr}`, tone: "good" };
  }

  // Over target
  if (calPct > 115 && cal.goal > 0) {
    const over = Math.round(cal.today - cal.goal);
    return { text: `${over} calories over target today.`, tone: "warn" };
  }

  // Weak macro pattern
  if (weakMacros.length > 0 && history.length >= 3) {
    const names = weakMacros.join(" and ");
    return { text: `${names} has been low this week. Hit rate under 60%.`, tone: "warn" };
  }

  // Morning, no meals
  if (hour < 11 && !hasMealsToday) {
    return { text: "Good morning. What's for breakfast?", tone: "neutral" };
  }

  // Afternoon with room
  if (hour >= 11 && hour < 17 && calRemaining > 400) {
    // Find the most behind macro
    let behindRole = null;
    let behindPct = 100;
    for (const role of valueRoles) {
      const m = picture[role];
      if (!m || !m.goal) continue;
      const pct = m.goal > 0 ? (m.today / m.goal) * 100 : 100;
      if (pct < behindPct) { behindPct = pct; behindRole = m.name || role; }
    }
    if (behindRole && behindPct < 50) {
      const m = picture[valueRoles.find(r => (picture[r]?.name || r) === behindRole)];
      const remaining = m ? Math.round(m.goal - m.today) : 0;
      return { text: `${remaining}g ${behindRole.toLowerCase()} to go. ${Math.round(calRemaining)} calories remaining.`, tone: "neutral" };
    }
    return { text: `${Math.round(calRemaining)} calories remaining today.`, tone: "neutral" };
  }

  // Evening with room
  if (hour >= 17 && calRemaining > 200) {
    return { text: `${Math.round(calRemaining)} calories left for dinner.`, tone: "neutral" };
  }

  // Streak
  if (streak >= 3) {
    return { text: `${streak} days hitting all targets.`, tone: "good" };
  }

  // Default
  if (hasMealsToday) {
    return { text: `${Math.round(cal.today)} calories so far today.`, tone: "neutral" };
  }

  return { text: "Log what you eat. The surface builds.", tone: "neutral" };
}

function surfaceToneColor(tone) {
  if (tone === "good") return "#48bb78";
  if (tone === "warn") return "#ecc94b";
  return "rgba(255,255,255,0.5)";
}

// ── Dashboard renderer ──

export function renderFoodDashboard({ rootId, rootName, picture, weeklySummaries, token, userId, inApp }) {
  const p = picture || {};
  const calories = p.calories || {};
  const profile = p.profile || {};
  const recentMeals = p.recentMeals || [];
  const mealsBySlot = p.mealsBySlot || {};
  const recentHistory = (p.recentHistory || []).filter(d => (d.type || "daily") === "daily");
  const weeks = weeklySummaries || [];

  const calPct = calories.goal > 0 ? Math.round((calories.today / calories.goal) * 100) : 0;
  const calRemaining = Math.max(0, (calories.goal || 0) - (calories.today || 0));

  // ── Surface ──
  const surface = buildSurface(p, weeks);

  // ── Profile subtitle ──
  const profileParts = [];
  if (profile.calorieGoal) profileParts.push(`${profile.calorieGoal} cal target`);
  if (profile.goal) profileParts.push(profile.goal);
  if (profile.restrictions) profileParts.push(profile.restrictions);

  // ── Stats: only show what earned its place ──
  const stats = [];
  const weeklyAvgCals = recentHistory.length > 0
    ? Math.round(recentHistory.reduce((s, h) => s + (h.calories || ((h.protein || 0) * 4 + (h.carbs || 0) * 4 + (h.fats || 0) * 9)), 0) / recentHistory.length)
    : null;
  if (weeklyAvgCals && recentHistory.length >= 3) stats.push({ value: String(weeklyAvgCals), label: "avg cal/day" });
  if (recentHistory.length >= 2) stats.push({ value: String(recentHistory.length), label: "days tracked" });
  const proteinHitRate = p.protein?.weeklyHitRate;
  if (proteinHitRate && proteinHitRate > 0) stats.push({ value: Math.round(proteinHitRate * 100) + "%", label: "protein hit" });

  // ── Macro bars ──
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
    if (m.weeklyHitRate > 0) {
      const hitPct = Math.round(m.weeklyHitRate * 100);
      sub.push(hitPct < 60 ? `hit: ${hitPct}% (low)` : `hit: ${hitPct}%`);
    }
    bars.push({
      label,
      current: m.today || 0,
      goal: m.goal || 0,
      color: MACRO_COLORS[role] || "#a78bfa",
      sub: sub.join(" . "),
      deleteUrl: m.nodeId ? `/api/v1/root/${rootId}/food/metric/${m.nodeId}` : null,
    });
  }

  // ── Cards: ordered by relevancy ──
  const cards = [];

  // Check what kind of day it is
  const hasMealsToday = recentMeals.some(m => {
    if (!m.date) return false;
    return new Date(m.date).toDateString() === new Date().toDateString();
  });

  // Meal slot cards
  const mealSlotCards = [];
  const slotNames = ["breakfast", "lunch", "dinner", "snack"];
  for (const slot of slotNames) {
    const meals = mealsBySlot[slot];
    if (!meals || meals.length === 0) continue;
    mealSlotCards.push({
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

  // Recent log card (only if no slot cards)
  const recentLogCard = mealSlotCards.length === 0 && recentMeals.length > 0
    ? {
        title: "Recent Log",
        items: recentMeals.slice(0, 10).map(m => ({
          text: (m.text || "").slice(0, 120),
          sub: m.date ? timeAgo(new Date(m.date)) : "",
          deleteUrl: m.id ? `/api/v1/root/${rootId}/food/entry/${m.id}` : null,
        })),
        empty: "No meals logged today. Type below to start.",
      }
    : null;

  // History card
  const historyCard = recentHistory.length > 0
    ? {
        title: `Past ${Math.min(recentHistory.length, 7)} Days`,
        items: recentHistory.slice(0, 7).map(h => {
          const dayCals = h.calories || Math.round((h.protein || 0) * 4 + (h.carbs || 0) * 4 + (h.fats || 0) * 9);
          const dayPct = calories.goal > 0 ? Math.round((dayCals / calories.goal) * 100) : 0;
          return {
            text: h.date || "?",
            detail: [`P:${h.protein || 0}g`, `C:${h.carbs || 0}g`, `F:${h.fats || 0}g`],
            sub: `${dayCals} cal (${dayPct}% of goal)`,
            bg: true,
          };
        }),
        empty: "History builds as you log meals each day.",
      }
    : null;

  // Weekly trends card (only surfaces when there's something to say)
  const weeklyCard = weeks.length >= 2
    ? {
        title: "Weekly Trends",
        items: weeks.slice(0, 4).map(w => {
          const parts = [];
          if (w.calories?.avg) parts.push(`${Math.round(w.calories.avg)} cal/day`);
          if (w.averages) {
            const macroStrs = Object.entries(w.averages)
              .filter(([, v]) => v > 0)
              .slice(0, 3)
              .map(([r, v]) => {
                const hit = w.hitRates?.[r];
                const hitStr = hit != null ? ` (${Math.round(hit * 100)}%)` : "";
                return `${r.charAt(0).toUpperCase() + r.slice(1)}:${v}g${hitStr}`;
              });
            if (macroStrs.length > 0) parts.push(macroStrs.join(", "));
          }
          return {
            text: `${w.weekStart || "?"} to ${w.weekEnd || "?"}`,
            sub: parts.join(" . ") || `${w.daysTracked || 0} days tracked`,
            bg: true,
          };
        }),
      }
    : null;

  // ── Relevancy ordering ──
  // Meals logged today? Show them first (confirmation). Otherwise history first (context).
  if (hasMealsToday) {
    // Today is active: meals first, then weekly trends if notable, then history
    cards.push(...mealSlotCards);
    if (recentLogCard) cards.push(recentLogCard);
    if (weeklyCard) cards.push(weeklyCard);
    if (historyCard) cards.push(historyCard);
  } else {
    // Quiet day: history and trends surface, meals recede
    if (weeklyCard) cards.push(weeklyCard);
    if (historyCard) cards.push(historyCard);
    cards.push(...mealSlotCards);
    if (recentLogCard) cards.push(recentLogCard);
  }

  // If nothing at all, push an empty history card
  if (cards.length === 0 && historyCard) {
    cards.push(historyCard);
  }

  // ── Add metric input ──
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

  // ── Surface CSS ──
  const surfaceCss = `
    .surface-text {
      text-align: center; padding: 12px 16px; margin-bottom: 4px;
      font-size: 0.95rem; line-height: 1.5; font-weight: 400;
      letter-spacing: 0.01em;
    }
  `;

  // ── Surface HTML (injected before hero via subtitle slot) ──
  // We pass it as a custom afterBars? No. Better: use the hero.sub field for the surface.
  // The surface IS the hero's subtext. The number is the anchor. The words give it meaning.

  return renderAppDashboard({
    rootId, rootName, token, userId, inApp,
    subtitle: profileParts.join(" . ") || null,
    hero: {
      value: String(Math.round(calories.today || 0)),
      label: `of ${Math.round(calories.goal || 0)} calories (${calPct}%)`,
      sub: surface.text,
      color: calPct >= 90 ? "#48bb78" : calPct >= 60 ? "#ecc94b" : "#fff",
    },
    stats,
    bars,
    afterBars: addMetricHtml,
    extraCss: surfaceCss,
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
