/**
 * Fitness Dashboard
 *
 * Dynamically generated from the tree. Shows modalities, exercise groups,
 * values/goals per exercise, weekly stats, progression alerts.
 */

import { page } from "../../html-rendering/html/layout.js";
import { esc, timeAgo } from "../../html-rendering/html/utils.js";
import { glassCardStyles, glassHeaderStyles, responsiveBase } from "../../html-rendering/html/baseStyles.js";
import { chatBarCss, chatBarHtml, chatBarJs } from "../../html-rendering/html/chatBar.js";

function progressColor(current, goal) {
  if (!goal) return "#718096";
  const pct = (current / goal) * 100;
  if (pct >= 100) return "#48bb78";
  if (pct >= 60) return "#ecc94b";
  return "#718096";
}

export function renderFitnessDashboard({ rootId, rootName, state, weekly, profile, token }) {
  const modalities = state?.modalities || [];
  const groups = state?.groups || {};

  const css = `
    ${glassHeaderStyles}
    ${glassCardStyles}
    ${responsiveBase}

    .fit-layout { max-width: 900px; margin: 0 auto; padding: 1.5rem; }

    .stat-row { display: flex; gap: 1rem; flex-wrap: wrap; margin: 1rem 0 1.5rem; }
    .stat-pill {
      background: rgba(255,255,255,0.08);
      border-radius: 20px;
      padding: 0.4rem 1rem;
      font-size: 0.85rem;
      color: rgba(255,255,255,0.8);
    }
    .stat-pill strong { color: #fff; }

    .section-title {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: rgba(255,255,255,0.5);
      margin-bottom: 0.5rem;
      margin-top: 1.5rem;
    }

    .modality-tag {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 0.75rem;
      margin-left: 8px;
    }
    .mod-gym { background: rgba(102,126,234,0.15); color: rgba(102,126,234,0.8); }
    .mod-running { background: rgba(72,187,120,0.15); color: rgba(72,187,120,0.8); }
    .mod-home { background: rgba(236,201,75,0.15); color: rgba(236,201,75,0.8); }

    .group-card { margin-bottom: 1.2rem; }
    .group-name { font-size: 1rem; font-weight: 600; color: #fff; margin-bottom: 8px; }

    .exercise-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 0;
      font-size: 0.9rem;
      border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    .exercise-row:last-child { border-bottom: none; }

    .ex-name { flex: 1; color: rgba(255,255,255,0.8); }
    .ex-values { color: rgba(255,255,255,0.5); font-size: 0.85rem; }
    .ex-last { color: rgba(255,255,255,0.3); font-size: 0.8rem; width: 70px; text-align: right; }

    .ex-sets {
      display: flex;
      gap: 4px;
    }
    .ex-set {
      width: 28px;
      height: 18px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.7rem;
      color: rgba(255,255,255,0.7);
    }

    .progression-alert {
      background: rgba(72,187,120,0.08);
      border: 1px solid rgba(72,187,120,0.2);
      border-radius: 8px;
      padding: 8px 12px;
      font-size: 0.85rem;
      color: rgba(72,187,120,0.8);
      margin-top: 4px;
    }

    .empty-state {
      color: rgba(255,255,255,0.35);
      font-size: 0.9rem;
      padding: 1rem 0;
      font-style: italic;
    }
  `;

  // Weekly stats
  const weekHtml = weekly ? `
    <div class="stat-row">
      <span class="stat-pill"><strong>${weekly.sessions}</strong> sessions this week</span>
      ${weekly.gymSessions ? `<span class="stat-pill"><strong>${weekly.gymSessions}</strong> gym</span>` : ""}
      ${weekly.runs ? `<span class="stat-pill"><strong>${weekly.runs}</strong> run${weekly.runs > 1 ? "s" : ""} (${weekly.runMiles.toFixed(1)} mi)</span>` : ""}
      ${weekly.homeSessions ? `<span class="stat-pill"><strong>${weekly.homeSessions}</strong> home</span>` : ""}
      ${weekly.totalVolume ? `<span class="stat-pill"><strong>${weekly.totalVolume.toLocaleString()}</strong> lb volume</span>` : ""}
      ${profile?.sessionsPerWeek ? `<span class="stat-pill">${weekly.sessions}/<strong>${profile.sessionsPerWeek}</strong> goal</span>` : ""}
    </div>
  ` : "";

  // Modality tags
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

      // Build display based on modality
      let valDisplay = "";
      if (mod === "gym" || mod === "weight-reps") {
        const weight = vals.weight || 0;
        const sets = Object.keys(vals).filter(k => k.startsWith("set")).sort().map(k => vals[k]).filter(v => v != null);
        const goalSets = Object.keys(goals).filter(k => k.startsWith("set")).sort().map(k => goals[k]).filter(v => v != null);
        valDisplay = `${weight}${profile?.weightUnit || "lb"} ${sets.join("/")}`;

        const setsHtml = sets.map((s, i) => {
          const g = goalSets[i] || 0;
          const color = g && s >= g ? "rgba(72,187,120,0.3)" : "rgba(255,255,255,0.08)";
          return `<span class="ex-set" style="background:${color}">${s}</span>`;
        }).join("");

        return `
          <div class="exercise-row">
            <span class="ex-name">${esc(ex.name)}</span>
            <span class="ex-values">${weight}${profile?.weightUnit || "lb"}</span>
            <div class="ex-sets">${setsHtml}</div>
            <span class="ex-last">${vals.lastWorked ? timeAgo(new Date(vals.lastWorked)) : ""}</span>
          </div>
        `;
      } else if (mod === "running") {
        return `
          <div class="exercise-row">
            <span class="ex-name">${esc(ex.name)}</span>
            <span class="ex-values">${JSON.stringify(vals).slice(0, 60)}</span>
            <span class="ex-last">${vals.lastRun ? timeAgo(new Date(vals.lastRun)) : ""}</span>
          </div>
        `;
      } else {
        const sets = Object.keys(vals).filter(k => k.startsWith("set")).sort().map(k => vals[k]).filter(v => v != null);
        return `
          <div class="exercise-row">
            <span class="ex-name">${esc(ex.name)}</span>
            <span class="ex-values">${sets.length > 0 ? sets.join("/") : (vals.duration ? vals.duration + "s" : "")}</span>
            <span class="ex-last">${vals.lastWorked ? timeAgo(new Date(vals.lastWorked)) : ""}</span>
          </div>
        `;
      }
    }).join("");

    groupsHtml += `
      <div class="group-card glass-card">
        <div class="group-name">${esc(groupName)} <span class="modality-tag ${modCls}">${mod}</span></div>
        ${exercisesHtml || '<div class="empty-state">No exercises yet.</div>'}
      </div>
    `;
  }

  if (!groupsHtml) {
    groupsHtml = '<div class="empty-state">No exercises configured yet. Type a message below to get started.</div>';
  }

  const body = `
    <div class="fit-layout">
      <h1 style="font-size: 1.5rem; color: #fff; margin-bottom: 0.2rem;">
        ${esc(rootName || "Fitness")} ${modTags}
      </h1>
      ${weekHtml}
      <div class="section-title">Exercises</div>
      ${groupsHtml}
    </div>
  `;

  return page({
    title: `${rootName || "Fitness"} Dashboard`,
    css: css + chatBarCss(),
    body: body + chatBarHtml({ placeholder: "Log a workout, say 'workout' to start, or ask about progress..." }),
    js: chatBarJs({ endpoint: `/api/v1/root/${rootId}/fitness`, token }),
  });
}
