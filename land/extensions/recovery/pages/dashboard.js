/**
 * Recovery Dashboard
 *
 * Substance tracking, streaks, cravings, mood, milestones.
 */

import { page } from "../../html-rendering/html/layout.js";
import { esc } from "../../html-rendering/html/utils.js";
import { glassCardStyles, glassHeaderStyles, responsiveBase } from "../../html-rendering/html/baseStyles.js";
import { chatBarCss, chatBarHtml, chatBarJs } from "../../html-rendering/html/chatBar.js";

export function renderRecoveryDashboard({ rootId, rootName, status, milestones, token }) {
  const substances = status?.substances || {};
  const feelings = status?.feelings || {};
  const streaks = status?.streaks || {};

  const css = `
    ${glassHeaderStyles}
    ${glassCardStyles}
    ${responsiveBase}

    .rec-layout { max-width: 800px; margin: 0 auto; padding: 1.5rem; }
    .rec-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.2rem; margin-top: 1.5rem; }
    @media (max-width: 700px) { .rec-grid { grid-template-columns: 1fr; } }

    .section-title {
      font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.1em;
      color: rgba(255,255,255,0.5); margin-bottom: 0.5rem; margin-top: 1.5rem;
    }

    .substance-card {
      padding: 16px; margin-bottom: 12px; border-radius: 10px;
      background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
    }
    .sub-name { font-size: 1rem; font-weight: 600; color: #fff; margin-bottom: 8px; }
    .sub-row { display: flex; justify-content: space-between; font-size: 0.85rem; padding: 3px 0; }
    .sub-label { color: rgba(255,255,255,0.5); }
    .sub-on { color: #48bb78; }
    .sub-off { color: #ecc94b; }

    .streak-pill {
      display: inline-block; background: rgba(72,187,120,0.12);
      border: 1px solid rgba(72,187,120,0.25); border-radius: 20px;
      padding: 6px 16px; font-size: 0.9rem; color: #48bb78; margin: 4px 4px 4px 0;
    }

    .feeling-row {
      display: flex; justify-content: space-between; padding: 6px 0;
      border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 0.85rem;
    }
    .feeling-row:last-child { border-bottom: none; }

    .milestone-item { padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
    .milestone-item:last-child { border-bottom: none; }
    .milestone-name { color: #48bb78; font-size: 0.9rem; }

    .empty-state { color: rgba(255,255,255,0.35); font-size: 0.9rem; padding: 1rem 0; font-style: italic; }
  `;

  const subNames = Object.keys(substances);
  const substancesHtml = subNames.length > 0
    ? subNames.map(name => {
        const sub = substances[name];
        return `
          <div class="substance-card">
            <div class="sub-name">${esc(name)}</div>
            <div class="sub-row"><span class="sub-label">Today</span><span class="${sub.onTarget ? "sub-on" : "sub-off"}">${sub.today || 0}</span></div>
            <div class="sub-row"><span class="sub-label">Target</span><span style="color:rgba(255,255,255,0.8)">${sub.target || 0}</span></div>
            ${sub.streak != null ? `<div class="sub-row"><span class="sub-label">Streak</span><span class="sub-on">${sub.streak} days</span></div>` : ""}
          </div>`;
      }).join("")
    : '<div class="empty-state">No substances tracked yet. Check in below.</div>';

  const feelNames = Object.keys(feelings);
  const feelingsHtml = feelNames.length > 0
    ? feelNames.map(name => `
        <div class="feeling-row">
          <span style="color:rgba(255,255,255,0.7)">${esc(name)}</span>
          <span style="color:rgba(255,255,255,0.5)">${feelings[name]?.today != null ? feelings[name].today : "?"}/10</span>
        </div>`).join("")
    : '<div class="empty-state">No feelings logged today.</div>';

  const milestonesHtml = milestones?.length > 0
    ? milestones.slice(0, 10).map(m => `
        <div class="milestone-item">
          <div class="milestone-name">${esc(typeof m === "string" ? m : m.name || "Milestone")}</div>
        </div>`).join("")
    : '<div class="empty-state">Milestones appear as you progress.</div>';

  const streakNames = Object.keys(streaks);
  const streaksHtml = streakNames.map(name => `<span class="streak-pill">${esc(name)}: ${streaks[name]} days</span>`).join("");

  const body = `
    <div class="rec-layout">
      <h1 style="font-size:1.5rem;color:#fff;margin-bottom:0.5rem">${esc(rootName || "Recovery")}</h1>
      ${streaksHtml ? `<div style="margin-bottom:1rem">${streaksHtml}</div>` : ""}
      <div class="rec-grid">
        <div>
          <div class="section-title">Tracking</div>
          ${substancesHtml}
        </div>
        <div>
          <div class="glass-card" style="padding:16px;margin-bottom:12px">
            <div class="section-title" style="margin-top:0">How You Feel</div>
            ${feelingsHtml}
          </div>
          <div class="glass-card" style="padding:16px">
            <div class="section-title" style="margin-top:0">Milestones</div>
            ${milestonesHtml}
          </div>
        </div>
      </div>
    </div>`;

  return page({
    title: `${rootName || "Recovery"} Dashboard`,
    css: css + chatBarCss(),
    body: body + chatBarHtml({ placeholder: "Check in. How are you doing today?" }),
    js: chatBarJs({ endpoint: `/api/v1/root/${rootId}/recovery`, token }),
  });
}
