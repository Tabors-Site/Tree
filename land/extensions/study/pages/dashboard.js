/**
 * Study Dashboard
 *
 * Dynamically generated from the tree. Zero hardcoded topics.
 * Reads queue, active topics, mastery, gaps, and renders it all.
 */

import { page } from "../../html-rendering/html/layout.js";
import { esc, timeAgo } from "../../html-rendering/html/utils.js";
import { baseStyles, glassCardStyles, glassHeaderStyles, responsiveBase } from "../../html-rendering/html/baseStyles.js";
import { chatBarCss, chatBarHtml, chatBarJs, commandsRefHtml } from "../../html-rendering/html/chatBar.js";

function masteryColor(pct) {
  if (pct >= 80) return "#48bb78";
  if (pct >= 30) return "#ecc94b";
  return "#718096";
}

function masteryLabel(pct) {
  if (pct >= 80) return "mastered";
  if (pct >= 60) return "solid";
  if (pct >= 30) return "learning";
  if (pct > 0) return "introduced";
  return "not started";
}

export function renderStudyDashboard({ rootId, rootName, queue, activeTopics, gaps, progress, profile, qs, token, userId }) {
  const streakDays = progress?.streak?.days || 0;
  const dailyGoal = profile?.dailyStudyMinutes || 0;
  const completedCount = progress?.completed?.allTime || 0;
  const queueCount = progress?.queue?.count || 0;

  const css = `
    ${glassHeaderStyles}
    ${glassCardStyles}
    ${responsiveBase}

    .study-layout { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-top: 1.5rem; }
    @media (max-width: 900px) { .study-layout { grid-template-columns: 1fr; } }

    .study-left { display: flex; flex-direction: column; gap: 1.2rem; }
    .study-right { display: flex; flex-direction: column; gap: 1.2rem; }

    .stat-row { display: flex; gap: 1rem; flex-wrap: wrap; margin: 1rem 0; }
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
    }

    .queue-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.6rem 0.8rem;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      font-size: 0.9rem;
    }
    .queue-item:last-child { border-bottom: none; }
    .queue-item .name { color: #fff; }
    .queue-item .meta { color: rgba(255,255,255,0.4); font-size: 0.8rem; }

    .topic-card { margin-bottom: 1rem; }
    .topic-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.6rem;
    }
    .topic-name { font-size: 1.1rem; color: #fff; font-weight: 600; }
    .topic-pct { font-size: 0.85rem; color: rgba(255,255,255,0.6); }

    .subtopic {
      display: flex;
      align-items: center;
      gap: 0.8rem;
      padding: 0.4rem 0;
      font-size: 0.9rem;
    }
    .subtopic-name { flex: 1; color: rgba(255,255,255,0.85); }
    .subtopic-bar {
      width: 120px;
      height: 6px;
      background: rgba(255,255,255,0.1);
      border-radius: 3px;
      overflow: hidden;
    }
    .subtopic-fill { height: 100%; border-radius: 3px; transition: width 0.3s; }
    .subtopic-pct { width: 40px; text-align: right; font-size: 0.8rem; color: rgba(255,255,255,0.5); }
    .subtopic-label { font-size: 0.75rem; color: rgba(255,255,255,0.35); width: 70px; }

    .gap-item {
      padding: 0.5rem 0;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      font-size: 0.9rem;
    }
    .gap-item:last-child { border-bottom: none; }
    .gap-name { color: #ecc94b; }
    .gap-context { color: rgba(255,255,255,0.4); font-size: 0.8rem; }

    .iframe-container {
      border-radius: 12px;
      overflow: hidden;
      background: rgba(255,255,255,0.04);
      min-height: 400px;
    }
    .iframe-container iframe {
      width: 100%;
      height: 500px;
      border: none;
    }
    .iframe-placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 400px;
      color: rgba(255,255,255,0.3);
      font-size: 0.9rem;
    }

    .empty-state {
      color: rgba(255,255,255,0.35);
      font-size: 0.9rem;
      padding: 1rem 0;
      font-style: italic;
    }
  `;

  // Build queue HTML
  const queueHtml = queue.length > 0
    ? queue.map(q => `
      <div class="queue-item">
        <span class="name">${esc(q.name)}</span>
        <span class="meta">${q.url ? "URL" : "topic"}${q.added ? " . " + timeAgo(q.added) : ""}</span>
      </div>
    `).join("")
    : '<div class="empty-state">Queue empty. Use needlearn to add topics.</div>';

  // Build active topics HTML
  const activeHtml = activeTopics.length > 0
    ? activeTopics.map(topic => {
        const subsHtml = topic.subtopics.map(s => `
          <div class="subtopic">
            <span class="subtopic-name">${esc(s.name)}</span>
            <div class="subtopic-bar">
              <div class="subtopic-fill" style="width: ${s.mastery}%; background: ${masteryColor(s.mastery)};"></div>
            </div>
            <span class="subtopic-pct">${s.mastery}%</span>
            <span class="subtopic-label">${masteryLabel(s.mastery)}</span>
          </div>
        `).join("");

        return `
          <div class="topic-card glass-card">
            <div class="topic-header">
              <span class="topic-name">${esc(topic.name)}</span>
              <span class="topic-pct">${topic.completion}% complete</span>
            </div>
            ${subsHtml}
          </div>
        `;
      }).join("")
    : '<div class="empty-state">No active topics. Pick one from the queue to start studying.</div>';

  // Build gaps HTML
  const gapsHtml = gaps.length > 0
    ? gaps.map(g => `
      <div class="gap-item">
        <span class="gap-name">${esc(g.name)}</span>
        <div class="gap-context">found while studying ${esc(g.detectedDuring || "unknown")}</div>
      </div>
    `).join("")
    : '<div class="empty-state">No gaps detected yet.</div>';

  const body = `
    <div class="container" style="max-width: 1200px; margin: 0 auto; padding: 1.5rem;">
      ${userId ? `<a href="/api/v1/user/${userId}/apps?html${token ? "&token=" + esc(token) : ""}" style="display:inline-block;margin-bottom:12px;font-size:0.85rem;color:rgba(255,255,255,0.4);text-decoration:none;">← Apps</a>` : ""}
      <h1 style="font-size: 1.5rem; color: #fff; margin-bottom: 0.2rem;">${esc(rootName || "Study")}</h1>

      <div class="stat-row">
        <span class="stat-pill"><strong>${streakDays}</strong> day streak</span>
        <span class="stat-pill"><strong>${completedCount}</strong> completed</span>
        <span class="stat-pill"><strong>${queueCount}</strong> queued</span>
        ${dailyGoal ? `<span class="stat-pill"><strong>${dailyGoal}</strong> min/day goal</span>` : ""}
        ${gaps.length > 0 ? `<span class="stat-pill" style="color: #ecc94b;"><strong>${gaps.length}</strong> gap${gaps.length > 1 ? "s" : ""}</span>` : ""}
      </div>

      <div class="study-layout">
        <div class="study-left">
          <div>
            <div class="section-title">Active Topics</div>
            ${activeHtml}
          </div>

          <div class="glass-card">
            <div class="section-title">Queue (${queue.length})</div>
            ${queueHtml}
          </div>

          ${gaps.length > 0 ? `
          <div class="glass-card">
            <div class="section-title">Knowledge Gaps</div>
            ${gapsHtml}
          </div>
          ` : ""}
        </div>

        <div class="study-right">
          <div class="glass-card">
            <div class="section-title">Resources</div>
            <div class="iframe-container" id="resource-frame">
              <div class="iframe-placeholder">Click a resource link to load it here.</div>
            </div>
          </div>
        </div>
      </div>
      ${commandsRefHtml([
        { cmd: "needlearn <topic>", desc: "Add to study queue" },
        { cmd: "study", desc: "Start or continue studying" },
        { cmd: "study progress", desc: "Review mastery and gaps" },
        { cmd: "study plan", desc: "Build or modify curriculum" },
        { cmd: "be", desc: "AI picks next lesson and teaches" },
      ])}
    </div>
  `;

  const js = `
    function loadResource(url) {
      const container = document.getElementById('resource-frame');
      container.innerHTML = '<iframe src="' + url + '" sandbox="allow-same-origin allow-scripts"></iframe>';
    }
  `;

  return page({
    title: `${rootName || "Study"} Dashboard`,
    css: css + chatBarCss(),
    body: body + chatBarHtml({ placeholder: "Ask about your studies..." }),
    js: js + chatBarJs({ endpoint: `/api/v1/root/${rootId}/study`, token }),
  });
}
