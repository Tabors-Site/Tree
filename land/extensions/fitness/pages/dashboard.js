/**
 * Fitness Dashboard
 *
 * Exercises with values/goals, weekly stats, modality breakdown,
 * progression alerts. Renders via the generic app dashboard.
 */

import { renderAppDashboard } from "../../html-rendering/html/appDashboard.js";
import { esc, timeAgo } from "../../html-rendering/html/utils.js";
import { page } from "../../html-rendering/html/layout.js";
import { glassCardStyles, glassHeaderStyles, responsiveBase } from "../../html-rendering/html/baseStyles.js";
import { chatBarCss, chatBarHtml, chatBarJs, commandsRefHtml } from "../../html-rendering/html/chatBar.js";

function goalColor(current, goal) {
  if (!goal || goal === 0) return "rgba(255,255,255,0.15)";
  if (current >= goal) return "rgba(72,187,120,0.3)";
  if (current >= goal * 0.7) return "rgba(236,201,75,0.2)";
  return "rgba(255,255,255,0.08)";
}

export function renderFitnessDashboard({ rootId, rootName, state, weekly, profile, token, userId }) {
  const modalities = state?.modalities || [];
  const groups = state?.groups || {};
  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  // If no exercises, use generic dashboard with empty state
  if (Object.keys(groups).length === 0) {
    return renderAppDashboard({
      rootId, rootName, token, userId,
      tags: modalities.map(m => ({ label: m, color: m === "gym" ? "#667eea" : m === "running" ? "#48bb78" : "#ecc94b" })),
      emptyState: { title: "No exercises configured yet", message: "Type a message below to get started." },
      commands: [
        { cmd: "fitness <message>", desc: "Log any workout" },
        { cmd: "fitness workout", desc: "Start guided session" },
        { cmd: "fitness plan", desc: "Build or modify program" },
        { cmd: "be", desc: "Coach walks you through today" },
      ],
      chatBar: { placeholder: "Log a workout, say 'workout' to start, or ask about progress...", endpoint: `/api/v1/root/${rootId}/fitness` },
    });
  }

  // Fitness has a specialized exercise grid layout that doesn't fit the generic card model.
  // Build custom HTML but still use shared styles and chatbar.
  const css = `
    ${glassHeaderStyles}
    ${glassCardStyles}
    ${responsiveBase}

    .fit-layout { max-width: 900px; margin: 0 auto; padding: 1.5rem; }

    .stat-row { display: flex; gap: 10px; flex-wrap: wrap; margin: 8px 0 20px; }
    .stat-chip { background: rgba(255,255,255,0.06); border-radius: 16px; padding: 4px 12px; font-size: 0.8rem; color: rgba(255,255,255,0.5); }
    .stat-chip strong { color: rgba(255,255,255,0.8); }

    .modality-tag { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 0.75rem; margin-left: 6px; }
    .mod-gym { background: rgba(102,126,234,0.15); color: rgba(102,126,234,0.8); }
    .mod-running { background: rgba(72,187,120,0.15); color: rgba(72,187,120,0.8); }
    .mod-home { background: rgba(236,201,75,0.15); color: rgba(236,201,75,0.8); }

    .section-title { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(255,255,255,0.5); margin-bottom: 0.5rem; margin-top: 1.5rem; }

    .group-card { margin-bottom: 16px; padding: 16px; }
    .group-name { font-size: 1rem; font-weight: 600; color: #fff; margin-bottom: 10px; }

    .ex-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 0.9rem; }
    .ex-row:last-child { border-bottom: none; }
    .ex-name { flex: 1; color: rgba(255,255,255,0.8); }
    .ex-weight { color: rgba(255,255,255,0.6); font-size: 0.85rem; min-width: 50px; }
    .ex-sets { display: flex; gap: 4px; }
    .ex-set { min-width: 26px; height: 20px; border-radius: 5px; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; color: rgba(255,255,255,0.7); }
    .ex-meta { display: flex; flex-direction: column; align-items: flex-end; min-width: 65px; }
    .ex-last { font-size: 0.75rem; color: rgba(255,255,255,0.3); }
    .ex-sessions { font-size: 0.7rem; color: rgba(255,255,255,0.2); }
    .ex-progression { font-size: 0.75rem; color: #48bb78; padding: 2px 8px; background: rgba(72,187,120,0.1); border-radius: 10px; }

    .running-stat { display: flex; justify-content: space-between; padding: 6px 0; font-size: 0.85rem; }
    .running-label { color: rgba(255,255,255,0.5); }
    .running-val { color: rgba(255,255,255,0.8); }
  `;

  // Weekly stats
  const weekChips = [];
  if (weekly) {
    if (weekly.sessions) weekChips.push(`<span class="stat-chip"><strong>${weekly.sessions}</strong> sessions</span>`);
    if (weekly.gymSessions) weekChips.push(`<span class="stat-chip"><strong>${weekly.gymSessions}</strong> gym</span>`);
    if (weekly.runs) weekChips.push(`<span class="stat-chip"><strong>${weekly.runs}</strong> run${weekly.runs > 1 ? "s" : ""} (${weekly.runMiles?.toFixed(1) || 0} mi)</span>`);
    if (weekly.homeSessions) weekChips.push(`<span class="stat-chip"><strong>${weekly.homeSessions}</strong> home</span>`);
    if (weekly.totalVolume) weekChips.push(`<span class="stat-chip"><strong>${weekly.totalVolume.toLocaleString()}</strong> lb vol</span>`);
    if (profile?.sessionsPerWeek) weekChips.push(`<span class="stat-chip">${weekly.sessions || 0}/<strong>${profile.sessionsPerWeek}</strong> goal</span>`);
  }

  const modTags = modalities.map(m => {
    const cls = m === "gym" ? "mod-gym" : m === "running" ? "mod-running" : "mod-home";
    return `<span class="modality-tag ${cls}">${m}</span>`;
  }).join("");

  // Build group cards
  let groupsHtml = "";
  for (const [groupName, data] of Object.entries(groups)) {
    const mod = data.modality || "gym";
    const modCls = mod === "gym" ? "mod-gym" : mod === "running" ? "mod-running" : "mod-home";

    const exercisesHtml = data.exercises.map(ex => {
      const vals = ex.values || {};
      const goals = ex.goals || {};

      if (mod === "running") {
        const stats = [];
        if (vals.weeklyMiles != null) stats.push(["Weekly miles", `${vals.weeklyMiles || 0}${goals.weeklyMilesGoal ? "/" + goals.weeklyMilesGoal : ""}`]);
        if (vals.lastDistance) stats.push(["Last run", `${vals.lastDistance} mi`]);
        if (vals.lastPace) {
          const min = Math.floor(vals.lastPace / 60);
          const sec = Math.round(vals.lastPace % 60);
          stats.push(["Last pace", `${min}:${String(sec).padStart(2, "0")}/mi`]);
        }
        if (vals.runsThisWeek != null) stats.push(["Runs this week", vals.runsThisWeek]);
        if (ex.name === "PRs") {
          for (const [k, v] of Object.entries(vals)) {
            if (v && k !== "lastWorked") {
              const min = Math.floor(v / 60);
              const sec = Math.round(v % 60);
              stats.push([k.toUpperCase(), `${min}:${String(sec).padStart(2, "0")}`]);
            }
          }
        }
        if (stats.length === 0) return `<div class="ex-row"><span class="ex-name">${esc(ex.name)}</span><span class="ex-last">no data</span></div>`;
        return stats.map(([label, val]) =>
          `<div class="running-stat"><span class="running-label">${label}</span><span class="running-val">${val}</span></div>`
        ).join("");
      }

      const weight = vals.weight || 0;
      const setKeys = Object.keys(vals).filter(k => /^set\d+$/.test(k)).sort();
      const goalKeys = Object.keys(goals).filter(k => /^set\d+$/.test(k)).sort();

      const setsHtml = setKeys.map((k, i) => {
        const v = vals[k];
        const g = goalKeys[i] ? goals[goalKeys[i]] : null;
        const bg = goalColor(v, g);
        return `<span class="ex-set" style="background:${bg}">${v != null ? v : "-"}</span>`;
      }).join("");

      let allMet = setKeys.length > 0;
      for (let i = 0; i < setKeys.length; i++) {
        const g = goalKeys[i] ? goals[goalKeys[i]] : null;
        if (g && (vals[setKeys[i]] == null || vals[setKeys[i]] < g)) { allMet = false; break; }
      }

      const lastStr = vals.lastWorked ? timeAgo(new Date(vals.lastWorked)) : "";

      return `
        <div class="ex-row">
          <span class="ex-name">${esc(ex.name)}</span>
          ${weight ? `<span class="ex-weight">${weight}${profile?.weightUnit || "lb"}</span>` : ""}
          <div class="ex-sets">${setsHtml || '<span style="color:rgba(255,255,255,0.2);font-size:0.8rem">no sets</span>'}</div>
          ${allMet && setKeys.length > 0 ? '<span class="ex-progression">ready</span>' : ""}
          <div class="ex-meta">
            <span class="ex-last">${lastStr}</span>
            ${ex.historyCount ? `<span class="ex-sessions">${ex.historyCount} sessions</span>` : ""}
          </div>
        </div>`;
    }).join("");

    groupsHtml += `
      <div class="group-card glass-card">
        <div class="group-name">${esc(groupName)} <span class="modality-tag ${modCls}">${mod}</span></div>
        ${exercisesHtml || '<div style="color:rgba(255,255,255,0.35);font-size:0.9rem;font-style:italic;padding:1rem 0">No exercises yet.</div>'}
      </div>`;
  }

  const navHtml = userId
    ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><a href="/api/v1/user/${esc(userId)}/apps?html${token ? "&token=" + esc(token) : ""}" style="font-size:0.85rem;color:rgba(255,255,255,0.4);text-decoration:none;">\u2190 Apps</a><div style="display:flex;gap:16px;"><a href="/api/v1/root/${esc(rootId)}?html${token ? "&token=" + esc(token) : ""}" style="font-size:0.85rem;color:rgba(255,255,255,0.4);text-decoration:none;">Tree</a><a href="/api/v1/user/${esc(userId)}/llm?html${token ? "&token=" + esc(token) : ""}" style="font-size:0.85rem;color:rgba(255,255,255,0.4);text-decoration:none;">LLM</a></div></div>`
    : "";

  const body = `
    <div class="fit-layout">
      ${navHtml}
      <h1 style="font-size:1.5rem;color:#fff;margin-bottom:0.2rem">${esc(rootName || "Fitness")} ${modTags}</h1>
      <div style="color:rgba(255,255,255,0.35);font-size:0.85rem;margin-top:4px">${dateStr}</div>
      ${weekChips.length > 0 ? `<div class="stat-row">${weekChips.join("")}</div>` : ""}
      <div class="section-title">Exercises</div>
      ${groupsHtml}
      ${commandsRefHtml([
        { cmd: "fitness <message>", desc: "Log any workout" },
        { cmd: "fitness workout", desc: "Start guided session" },
        { cmd: "fitness progress", desc: "Review your progress" },
        { cmd: "fitness plan", desc: "Build or modify program" },
        { cmd: "be", desc: "Coach walks you through today" },
      ])}
    </div>`;

  return page({
    title: `${rootName || "Fitness"} . ${dateStr}`,
    css: css + chatBarCss(),
    body: body + chatBarHtml({ placeholder: "Log a workout, say 'workout' to start, or ask about progress..." }),
    js: chatBarJs({ endpoint: `/api/v1/root/${rootId}/fitness`, token }),
  });
}
