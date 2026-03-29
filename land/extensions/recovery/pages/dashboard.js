/**
 * Recovery Dashboard
 *
 * Substance tracking with streaks, cravings, mood, energy,
 * patterns, milestones, recent history. Everything from getStatus.
 */

import { page } from "../../html-rendering/html/layout.js";
import { esc, timeAgo } from "../../html-rendering/html/utils.js";
import { glassCardStyles, glassHeaderStyles, responsiveBase } from "../../html-rendering/html/baseStyles.js";
import { chatBarCss, chatBarHtml, chatBarJs, commandsRefHtml } from "../../html-rendering/html/chatBar.js";

export function renderRecoveryDashboard({ rootId, rootName, status, milestones, patterns, history, token, userId }) {
  const substances = status?.substances || {};
  const feelings = status?.feelings || {};
  const streaks = status?.streaks || {};
  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

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
      padding: 16px; margin-bottom: 12px; border-radius: 12px;
      background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
    }
    .sub-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .sub-name { font-size: 1rem; font-weight: 600; color: #fff; }
    .sub-badge { font-size: 0.75rem; padding: 2px 10px; border-radius: 10px; }
    .sub-on { background: rgba(72,187,120,0.12); color: #48bb78; border: 1px solid rgba(72,187,120,0.25); }
    .sub-off { background: rgba(236,201,75,0.12); color: #ecc94b; border: 1px solid rgba(236,201,75,0.25); }

    .sub-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .sub-stat { text-align: center; padding: 8px; border-radius: 8px; background: rgba(255,255,255,0.03); }
    .sub-stat-val { font-size: 1.1rem; font-weight: 600; color: #fff; }
    .sub-stat-label { font-size: 0.7rem; color: rgba(255,255,255,0.35); margin-top: 2px; }

    .streak-bar { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0; }
    .streak-pill {
      background: rgba(72,187,120,0.12); border: 1px solid rgba(72,187,120,0.25);
      border-radius: 20px; padding: 6px 16px; font-size: 0.85rem; color: #48bb78;
    }

    .feeling-card { padding: 12px 16px; }
    .feeling-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    .feeling-row:last-child { border-bottom: none; }
    .feeling-name { color: rgba(255,255,255,0.7); font-size: 0.9rem; }
    .feeling-val { display: flex; align-items: center; gap: 8px; }
    .feeling-num { color: #fff; font-weight: 600; font-size: 0.9rem; }
    .feeling-bar { width: 60px; height: 5px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden; }
    .feeling-fill { height: 100%; border-radius: 3px; }
    .feeling-weekly { font-size: 0.75rem; color: rgba(255,255,255,0.3); }

    .pattern-item {
      padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.04);
      font-size: 0.85rem; color: rgba(255,255,255,0.6); line-height: 1.5;
    }
    .pattern-item:last-child { border-bottom: none; }

    .milestone-item { padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
    .milestone-item:last-child { border-bottom: none; }
    .milestone-text { color: #48bb78; font-size: 0.9rem; }
    .milestone-date { color: rgba(255,255,255,0.25); font-size: 0.75rem; }

    .history-day {
      padding: 10px 12px; border-radius: 8px; margin-bottom: 6px;
      background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.04);
    }
    .history-day-date { font-size: 0.85rem; color: rgba(255,255,255,0.6); margin-bottom: 4px; }
    .history-day-detail { font-size: 0.8rem; color: rgba(255,255,255,0.4); line-height: 1.5; }

    .empty-state { color: rgba(255,255,255,0.35); font-size: 0.9rem; padding: 1rem 0; font-style: italic; }
  `;

  // Substance cards
  const subNames = Object.keys(substances);
  const substancesHtml = subNames.length > 0
    ? subNames.map(name => {
        const sub = substances[name];
        const streak = streaks[name] || {};
        return `
          <div class="substance-card">
            <div class="sub-header">
              <span class="sub-name">${esc(name)}</span>
              <span class="sub-badge ${sub.onTarget ? "sub-on" : "sub-off"}">${sub.onTarget ? "on target" : "over target"}</span>
            </div>
            <div class="sub-stats">
              <div class="sub-stat">
                <div class="sub-stat-val">${sub.today || 0}</div>
                <div class="sub-stat-label">today</div>
              </div>
              <div class="sub-stat">
                <div class="sub-stat-val">${sub.target || 0}</div>
                <div class="sub-stat-label">target</div>
              </div>
              <div class="sub-stat">
                <div class="sub-stat-val" style="color:#48bb78">${streak.current || 0}</div>
                <div class="sub-stat-label">day streak</div>
              </div>
              <div class="sub-stat">
                <div class="sub-stat-val">${streak.longest || 0}</div>
                <div class="sub-stat-label">best streak</div>
              </div>
            </div>
            ${streak.totalSlips ? `<div style="font-size:0.75rem;color:rgba(255,255,255,0.25);margin-top:8px;text-align:center">${streak.totalSlips} slip${streak.totalSlips > 1 ? "s" : ""} total${streak.lastSlip ? " . last: " + esc(streak.lastSlip) : ""}</div>` : ""}
          </div>`;
      }).join("")
    : '<div class="empty-state">No substances tracked yet. Check in below to start.</div>';

  // Streak pills
  const streakNames = Object.keys(streaks);
  const streaksHtml = streakNames
    .filter(n => streaks[n].current > 0)
    .map(name => `<span class="streak-pill">${esc(name)}: ${streaks[name].current} days</span>`)
    .join("");

  // Feelings
  const feelingsHtml = [];
  if (feelings.mood) {
    const pct = Math.min(100, (feelings.mood.today || 0) * 10);
    feelingsHtml.push(`
      <div class="feeling-row">
        <span class="feeling-name">Mood</span>
        <div class="feeling-val">
          <span class="feeling-num">${feelings.mood.today || "?"}/10</span>
          <div class="feeling-bar"><div class="feeling-fill" style="width:${pct}%;background:${pct >= 60 ? "#48bb78" : pct >= 30 ? "#ecc94b" : "#ef4444"}"></div></div>
          <span class="feeling-weekly">avg: ${feelings.mood.weeklyAvg || "?"}</span>
        </div>
      </div>`);
  }
  if (feelings.energy) {
    const pct = Math.min(100, (feelings.energy.today || 0) * 10);
    feelingsHtml.push(`
      <div class="feeling-row">
        <span class="feeling-name">Energy</span>
        <div class="feeling-val">
          <span class="feeling-num">${feelings.energy.today || "?"}/10</span>
          <div class="feeling-bar"><div class="feeling-fill" style="width:${pct}%;background:${pct >= 60 ? "#667eea" : pct >= 30 ? "#ecc94b" : "#ef4444"}"></div></div>
          <span class="feeling-weekly">avg: ${feelings.energy.weeklyAvg || "?"}</span>
        </div>
      </div>`);
  }
  if (feelings.cravings) {
    const pct = Math.min(100, (feelings.cravings.intensity || 0) * 10);
    feelingsHtml.push(`
      <div class="feeling-row">
        <span class="feeling-name">Cravings</span>
        <div class="feeling-val">
          <span class="feeling-num">${feelings.cravings.intensity || 0}/10</span>
          <div class="feeling-bar"><div class="feeling-fill" style="width:${pct}%;background:${pct <= 30 ? "#48bb78" : pct <= 60 ? "#ecc94b" : "#ef4444"}"></div></div>
          <span class="feeling-weekly">${feelings.cravings.resistRate ? Math.round(feelings.cravings.resistRate * 100) + "% resisted" : ""}</span>
        </div>
      </div>`);
  }

  // Patterns
  const patternsHtml = patterns?.length > 0
    ? patterns.slice(0, 5).map(p => `<div class="pattern-item">${esc(typeof p === "string" ? p : p.pattern || p.text || JSON.stringify(p))}</div>`).join("")
    : '<div class="empty-state">Patterns appear as the AI detects correlations.</div>';

  // Milestones
  const milestonesHtml = milestones?.length > 0
    ? milestones.slice(0, 8).map(m => `
        <div class="milestone-item">
          <div class="milestone-text">${esc(typeof m === "string" ? m : m.text || m.name || "Milestone")}</div>
          ${m.date ? `<div class="milestone-date">${timeAgo(new Date(m.date))}</div>` : ""}
        </div>`).join("")
    : '<div class="empty-state">Milestones appear as you progress.</div>';

  // History
  const historyHtml = history?.length > 0
    ? history.slice(0, 7).map(h => `
        <div class="history-day">
          <div class="history-day-date">${esc(h.date || "?")}</div>
          <div class="history-day-detail">${esc(typeof h === "string" ? h : h.summary || JSON.stringify(h).slice(0, 120))}</div>
        </div>`).join("")
    : "";

  const body = `
    <div class="rec-layout">
      ${userId ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><a href="/api/v1/user/${userId}/apps?html${token ? "&token=" + esc(token) : ""}" style="font-size:0.85rem;color:rgba(255,255,255,0.4);text-decoration:none;">← Apps</a><a href="/api/v1/user/${userId}/llm?html${token ? "&token=" + esc(token) : ""}" style="font-size:0.85rem;color:rgba(255,255,255,0.4);text-decoration:none;">LLM</a></div>` : ""}
      <h1 style="font-size:1.5rem;color:#fff;margin-bottom:0.2rem">${esc(rootName || "Recovery")}</h1>
      <div style="color:rgba(255,255,255,0.35);font-size:0.85rem;margin-top:4px">${dateStr}</div>
      ${streaksHtml ? `<div class="streak-bar">${streaksHtml}</div>` : ""}

      ${feelingsHtml.length > 0 ? `
        <div class="glass-card feeling-card">
          <div class="section-title" style="margin-top:0">How You Feel</div>
          ${feelingsHtml.join("")}
        </div>
      ` : ""}

      <div class="section-title">Tracking</div>
      ${substancesHtml}

      <div class="rec-grid">
        <div class="glass-card" style="padding:16px">
          <div class="section-title" style="margin-top:0">Patterns</div>
          ${patternsHtml}
        </div>
        <div class="glass-card" style="padding:16px">
          <div class="section-title" style="margin-top:0">Milestones</div>
          ${milestonesHtml}
        </div>
      </div>

      ${historyHtml ? `
        <div class="section-title">Recent Days</div>
        ${historyHtml}
      ` : ""}

      ${commandsRefHtml([
        { cmd: "recovery <message>", desc: "Daily check-in" },
        { cmd: "recovery reflect", desc: "Pattern analysis" },
        { cmd: "recovery plan", desc: "Taper schedule" },
        { cmd: "be", desc: "Check in now" },
      ])}
    </div>`;

  return page({
    title: `${rootName || "Recovery"} . ${dateStr}`,
    css: css + chatBarCss(),
    body: body + chatBarHtml({ placeholder: "Check in. How are you doing today?" }),
    js: chatBarJs({ endpoint: `/api/v1/root/${rootId}/recovery`, token }),
  });
}
