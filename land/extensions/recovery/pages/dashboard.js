/**
 * Recovery Dashboard
 *
 * Substances, streaks, feelings, patterns, milestones, history.
 * Renders via the generic app dashboard.
 */

import { renderAppDashboard } from "../../html-rendering/html/appDashboard.js";
import { timeAgo } from "../../html-rendering/html/utils.js";

export function renderRecoveryDashboard({ rootId, rootName, status, milestones, patterns, history, token, userId }) {
  const substances = status?.substances || {};
  const feelings = status?.feelings || {};
  const streaks = status?.streaks || {};

  // Stats
  const stats = [];
  for (const [name, streak] of Object.entries(streaks)) {
    if (streak.current > 0) stats.push({ value: `${streak.current}d`, label: name });
  }

  // Bars for feelings (mood, energy, cravings all as 0-10 bars)
  const bars = [];
  if (feelings.mood) {
    bars.push({
      label: "Mood", current: feelings.mood.today || 0, goal: 10,
      color: "#48bb78", unit: "/10",
      sub: feelings.mood.weeklyAvg ? `avg: ${feelings.mood.weeklyAvg}` : "",
    });
  }
  if (feelings.energy) {
    bars.push({
      label: "Energy", current: feelings.energy.today || 0, goal: 10,
      color: "#667eea", unit: "/10",
      sub: feelings.energy.weeklyAvg ? `avg: ${feelings.energy.weeklyAvg}` : "",
    });
  }
  if (feelings.cravings) {
    bars.push({
      label: "Cravings", current: feelings.cravings.intensity || 0, goal: 10,
      color: "#ef4444", unit: "/10",
      sub: feelings.cravings.resistRate ? `${Math.round(feelings.cravings.resistRate * 100)}% resisted` : "",
    });
  }

  // Cards
  const cards = [];

  // Substance tracking cards
  const subNames = Object.keys(substances);
  if (subNames.length > 0) {
    cards.push({
      title: "Tracking",
      items: subNames.map(name => {
        const sub = substances[name];
        const streak = streaks[name] || {};
        const badge = sub.onTarget ? "on target" : "over target";
        return {
          text: `${name}: ${sub.today || 0} today (target: ${sub.target || 0}) ${badge}`,
          sub: streak.current ? `${streak.current}d streak (best: ${streak.longest || 0}d)` : null,
        };
      }),
      empty: "No substances tracked yet. Check in below to start.",
    });
  }

  // Patterns
  cards.push({
    title: "Patterns",
    items: (patterns || []).slice(0, 5).map(p => ({
      text: typeof p === "string" ? p : p.pattern || p.text || JSON.stringify(p),
    })),
    empty: "Patterns appear as the AI detects correlations.",
  });

  // Milestones
  cards.push({
    title: "Milestones",
    items: (milestones || []).slice(0, 8).map(m => ({
      text: typeof m === "string" ? m : m.text || m.name || "Milestone",
      sub: m.date ? timeAgo(new Date(m.date)) : null,
    })),
    empty: "Milestones appear as you progress.",
  });

  // History
  if (history?.length > 0) {
    cards.push({
      title: "Recent Days",
      items: history.slice(0, 7).map(h => ({
        text: h.date || "?",
        sub: typeof h === "string" ? h : h.summary || JSON.stringify(h).slice(0, 120),
        bg: true,
      })),
    });
  }

  return renderAppDashboard({
    rootId, rootName, token, userId,
    stats: stats.length > 0 ? stats : null,
    bars: bars.length > 0 ? bars : null,
    cards,
    emptyState: !status ? { title: "Not initialized yet", message: "Check in below to get started." } : null,
    commands: [
      { cmd: "recovery <message>", desc: "Daily check-in" },
      { cmd: "recovery reflect", desc: "Pattern analysis" },
      { cmd: "recovery plan", desc: "Taper schedule" },
      { cmd: "be", desc: "Check in now" },
    ],
    chatBar: { placeholder: "Check in. How are you doing today?", endpoint: `/api/v1/root/${rootId}/recovery` },
  });
}
