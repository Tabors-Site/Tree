/**
 * Study Dashboard
 *
 * Active topics with mastery, queue with actions, completed topics,
 * knowledge gaps with promote/delete, study history, profile.
 */

import { page } from "../../html-rendering/html/layout.js";
import { esc, timeAgo } from "../../html-rendering/html/utils.js";
import { glassCardStyles, glassHeaderStyles, responsiveBase } from "../../html-rendering/html/baseStyles.js";
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

export function renderStudyDashboard({ rootId, rootName, queue, activeTopics, gaps, progress, profile, completed, history, token, userId, inApp }) {
  const completedCount = completed?.length || progress?.completed?.allTime || 0;
  const queueCount = queue?.length || 0;
  const dailyGoal = profile?.dailyStudyMinutes || 0;
  const learningStyle = profile?.learningStyle || null;
  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  let totalMastery = 0, totalSubtopics = 0;
  for (const topic of (activeTopics || [])) {
    for (const s of (topic.subtopics || [])) {
      totalMastery += s.mastery || 0;
      totalSubtopics++;
    }
  }
  const avgMastery = totalSubtopics > 0 ? Math.round(totalMastery / totalSubtopics) : 0;

  const css = `
    ${glassHeaderStyles}
    ${glassCardStyles}
    ${responsiveBase}

    .study-container { max-width: 1000px; margin: 0 auto; padding: 1.5rem; }
    .study-layout { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-top: 1.5rem; }
    @media (max-width: 900px) { .study-layout { grid-template-columns: 1fr; } }

    .stat-row { display: flex; gap: 10px; flex-wrap: wrap; margin: 8px 0 16px; }
    .stat-chip { background: rgba(255,255,255,0.06); border-radius: 16px; padding: 4px 12px; font-size: 0.8rem; color: rgba(255,255,255,0.5); }
    .stat-chip strong { color: rgba(255,255,255,0.8); }

    .section-title { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(255,255,255,0.5); margin-bottom: 0.5rem; }

    .topic-card { margin-bottom: 1rem; padding: 16px; }
    .topic-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .topic-name { font-size: 1.05rem; color: #fff; font-weight: 600; }
    .topic-pct { font-size: 0.85rem; font-weight: 500; }
    .topic-bar { height: 4px; background: rgba(255,255,255,0.08); border-radius: 2px; overflow: hidden; margin-bottom: 12px; }
    .topic-bar-fill { height: 100%; border-radius: 2px; transition: width 0.3s; }

    .subtopic { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
    .subtopic:last-child { border-bottom: none; }
    .subtopic-name { flex: 1; color: rgba(255,255,255,0.8); font-size: 0.9rem; }
    .subtopic-bar { width: 100px; height: 6px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden; }
    .subtopic-fill { height: 100%; border-radius: 3px; }
    .subtopic-pct { width: 35px; text-align: right; font-size: 0.8rem; color: rgba(255,255,255,0.5); }
    .subtopic-meta { display: flex; flex-direction: column; align-items: flex-end; min-width: 70px; }
    .subtopic-label { font-size: 0.7rem; color: rgba(255,255,255,0.3); }
    .subtopic-last { font-size: 0.7rem; color: rgba(255,255,255,0.2); }

    .queue-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 0.9rem; }
    .queue-item:last-child { border-bottom: none; }
    .queue-name { color: #fff; }
    .queue-meta { color: rgba(255,255,255,0.35); font-size: 0.8rem; display: flex; gap: 6px; align-items: center; }
    .queue-url { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: rgba(102,126,234,0.4); }

    .gap-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
    .gap-item:last-child { border-bottom: none; }
    .gap-name { color: #ecc94b; font-size: 0.9rem; }
    .gap-context { color: rgba(255,255,255,0.3); font-size: 0.75rem; }

    .completed-item { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 0.85rem; }
    .completed-item:last-child { border-bottom: none; }
    .completed-name { color: rgba(72,187,120,0.8); }
    .completed-date { color: rgba(255,255,255,0.25); font-size: 0.75rem; }

    .history-item { padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 0.8rem; color: rgba(255,255,255,0.4); }
    .history-item:last-child { border-bottom: none; }

    .action-btn { background: none; border: none; cursor: pointer; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; color: rgba(255,255,255,0.3); }
    .action-btn:hover { color: rgba(255,255,255,0.7); background: rgba(255,255,255,0.06); }
    .action-btn.danger:hover { color: #ef4444; }
    .action-btn.activate:hover { color: #4ade80; }
    .action-row { display: flex; gap: 4px; align-items: center; }

    .rename-input { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); border-radius: 4px; color: #fff; font-size: 0.9rem; padding: 2px 6px; outline: none; width: 100%; }
    .rename-input:focus { border-color: #4ade80; }

    .iframe-container { border-radius: 12px; overflow: hidden; background: rgba(255,255,255,0.03); min-height: 350px; }
    .iframe-container iframe { width: 100%; height: 450px; border: none; }
    .iframe-placeholder { display: flex; align-items: center; justify-content: center; min-height: 350px; color: rgba(255,255,255,0.25); font-size: 0.85rem; }

    .empty-state { color: rgba(255,255,255,0.35); font-size: 0.9rem; padding: 1rem 0; font-style: italic; }
  `;

  // ── Queue ──
  const queueHtml = queue.length > 0
    ? queue.map(q => {
      const nameDisplay = q.url
        ? `<span class="queue-name" style="color:rgba(102,126,234,0.9);cursor:pointer" onclick="loadResource('${esc(q.url)}')">${esc(q.name.length > 60 ? q.name.slice(0, 60) + "..." : q.name)}</span>`
        : `<span class="queue-name">${esc(q.name)}</span>`;
      return `
        <div class="queue-item" data-id="${esc(q.id)}">
          <div style="flex:1;display:flex;align-items:center;gap:6px">
            ${nameDisplay}
            ${!q.url ? `<button class="action-btn" onclick="renameItem('${esc(q.id)}', this)" title="Rename">\u270e</button>` : ""}
          </div>
          <div class="action-row">
            <span class="queue-meta">${q.added ? timeAgo(q.added) : ""}${q.url ? ' <span class="queue-url"></span>' : ""}</span>
            <button class="action-btn activate" onclick="activateItem('${esc(q.id)}')" title="Start studying">\u25b6</button>
            <button class="action-btn danger" onclick="deleteItem('${esc(q.id)}')" title="Delete">\u00d7</button>
          </div>
        </div>`;
    }).join("")
    : '<div class="empty-state">Queue empty. Use needlearn to add topics.</div>';

  // ── Active topics ──
  const activeHtml = (activeTopics || []).length > 0
    ? activeTopics.map(topic => {
        const subsHtml = (topic.subtopics || []).map(s => `
          <div class="subtopic">
            <span class="subtopic-name">${esc(s.name)}</span>
            <div class="subtopic-bar">
              <div class="subtopic-fill" style="width:${s.mastery}%;background:${masteryColor(s.mastery)}"></div>
            </div>
            <span class="subtopic-pct">${s.mastery}%</span>
            <div class="subtopic-meta">
              <span class="subtopic-label">${masteryLabel(s.mastery)}</span>
              ${s.lastStudied ? `<span class="subtopic-last">${timeAgo(new Date(s.lastStudied))}</span>` : ""}
              ${s.attempts ? `<span class="subtopic-last">${s.attempts} attempt${s.attempts > 1 ? "s" : ""}</span>` : ""}
            </div>
          </div>
        `).join("");

        const topicColor = masteryColor(topic.completion);

        return `
          <div class="topic-card glass-card" data-id="${esc(topic.id)}">
            <div class="topic-header">
              <div style="display:flex;align-items:center;gap:6px">
                <span class="topic-name">${esc(topic.name)}</span>
                <button class="action-btn" onclick="renameItem('${esc(topic.id)}', this)" title="Rename">\u270e</button>
              </div>
              <div class="action-row">
                <span class="topic-pct" style="color:${topicColor}">${topic.completion}%</span>
                <button class="action-btn" onclick="dequeueItem('${esc(topic.id)}')" title="Back to queue">\u23f8</button>
              </div>
            </div>
            <div class="topic-bar"><div class="topic-bar-fill" style="width:${topic.completion}%;background:${topicColor}"></div></div>
            ${subsHtml || '<div class="empty-state" style="padding:0.5rem 0">No subtopics yet. Start a study session to decompose this topic.</div>'}
          </div>
        `;
      }).join("")
    : '<div class="empty-state">No active topics. Pick one from the queue to start studying.</div>';

  // ── Gaps ──
  const gapsHtml = (gaps || []).length > 0
    ? gaps.map(g => `
      <div class="gap-item" data-id="${esc(g.id)}">
        <div>
          <span class="gap-name">${esc(g.name)}</span>
          <div class="gap-context">found studying ${esc(g.detectedDuring || "unknown")}${g.detectedAt ? " . " + timeAgo(new Date(g.detectedAt)) : ""}</div>
        </div>
        <div class="action-row">
          <button class="action-btn activate" onclick="queueGap('${esc(g.name)}')" title="Add to queue">\u25b6</button>
          <button class="action-btn danger" onclick="deleteItem('${esc(g.id)}')" title="Delete">\u00d7</button>
        </div>
      </div>
    `).join("")
    : '<div class="empty-state">No gaps detected yet.</div>';

  // ── Completed ──
  const completedHtml = (completed || []).length > 0
    ? completed.slice(0, 10).map(c => `
      <div class="completed-item">
        <span class="completed-name">${esc(c.name)}</span>
        <span class="completed-date">${c.completedAt ? timeAgo(new Date(c.completedAt)) : ""}</span>
      </div>
    `).join("")
    : '<div class="empty-state">No topics completed yet.</div>';

  // ── History ──
  const historyHtml = (history || []).length > 0
    ? history.slice(0, 15).map(h => `
      <div class="history-item">${esc(h.text)}${h.date ? ` <span style="color:rgba(255,255,255,0.2)">${timeAgo(new Date(h.date))}</span>` : ""}</div>
    `).join("")
    : '<div class="empty-state">No activity yet.</div>';

  // ── Profile ──
  const profileParts = [];
  if (learningStyle) profileParts.push(learningStyle.replace("-", " "));
  if (dailyGoal) profileParts.push(`${dailyGoal} min/day`);

  const body = `
    <div class="study-container">
      ${userId ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><a href="/api/v1/user/${userId}/apps?html${token ? "&token=" + esc(token) : ""}" style="font-size:0.85rem;color:rgba(255,255,255,0.4);text-decoration:none;">\u2190 Apps</a><div style="display:flex;gap:16px;"><a href="/api/v1/root/${rootId}?html${token ? "&token=" + esc(token) : ""}" style="font-size:0.85rem;color:rgba(255,255,255,0.4);text-decoration:none;">Tree</a><a href="/api/v1/node/${rootId}/metadata?html${token ? "&token=" + esc(token) : ""}" style="font-size:0.85rem;color:rgba(255,255,255,0.4);text-decoration:none;">Metadata</a><a href="/api/v1/user/${userId}/llm?html${token ? "&token=" + esc(token) : ""}" style="font-size:0.85rem;color:rgba(255,255,255,0.4);text-decoration:none;">LLM</a></div></div>` : ""}
      <h1 style="font-size:1.5rem;color:#fff;margin-bottom:0.2rem">${esc(rootName || "Study")}</h1>
      <div style="color:rgba(255,255,255,0.35);font-size:0.85rem;margin-top:4px">${dateStr}${profileParts.length > 0 ? " . " + esc(profileParts.join(" . ")) : ""}</div>

      <div class="stat-row">
        ${completedCount ? `<span class="stat-chip"><strong>${completedCount}</strong> completed</span>` : ""}
        <span class="stat-chip"><strong>${queueCount}</strong> queued</span>
        ${(activeTopics || []).length > 0 ? `<span class="stat-chip"><strong>${activeTopics.length}</strong> active</span>` : ""}
        ${totalSubtopics > 0 ? `<span class="stat-chip">avg mastery <strong>${avgMastery}%</strong></span>` : ""}
        ${(gaps || []).length > 0 ? `<span class="stat-chip" style="color:#ecc94b"><strong>${gaps.length}</strong> gap${gaps.length > 1 ? "s" : ""}</span>` : ""}
      </div>

      <div class="study-layout">
        <div>
          <div class="section-title">Active Topics</div>
          ${activeHtml}

          <div class="glass-card" style="padding:14px">
            <div class="section-title" style="margin-top:0">Queue (${queue.length})</div>
            ${queueHtml}
          </div>

          ${(gaps || []).length > 0 ? `
          <div class="glass-card" style="padding:14px;margin-top:1rem">
            <div class="section-title" style="margin-top:0">Knowledge Gaps</div>
            ${gapsHtml}
          </div>
          ` : ""}
        </div>

        <div>
          ${queue.some(q => q.url) ? `
          <div class="glass-card" style="padding:14px;margin-bottom:1rem">
            <div class="section-title" style="margin-top:0">Resources</div>
            <div class="iframe-container" id="resource-frame">
              <div class="iframe-placeholder">Click a URL in the queue to preview.</div>
            </div>
          </div>` : ""}

          ${(completed || []).length > 0 ? `
          <div class="glass-card" style="padding:14px;margin-bottom:1rem">
            <div class="section-title" style="margin-top:0">Completed (${completed.length})</div>
            ${completedHtml}
          </div>
          ` : ""}

          <div class="glass-card" style="padding:14px">
            <div class="section-title" style="margin-top:0">Activity</div>
            ${historyHtml}
          </div>
        </div>
      </div>

      ${commandsRefHtml([
        { cmd: "needlearn <topic>", desc: "Add to study queue" },
        { cmd: "study", desc: "Start or continue studying" },
        { cmd: "study switch <topic>", desc: "Activate a queue item" },
        { cmd: "study stop <topic>", desc: "Deactivate, back to queue" },
        { cmd: "study remove <topic>", desc: "Delete from queue" },
        { cmd: "study progress", desc: "Review mastery and gaps" },
        { cmd: "study plan", desc: "Build or modify curriculum" },
        { cmd: "be", desc: "AI picks next lesson and teaches" },
      ])}
    </div>
  `;

  const js = `
    function loadResource(url) {
      var container = document.getElementById('resource-frame');
      if (container) container.innerHTML = '<iframe src="' + url + '" sandbox="allow-same-origin allow-scripts"></iframe>';
    }

    async function studyFetch(url, method, body) {
      var opts = { method: method || 'POST', credentials: 'include' };
      if (body) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
      return fetch(url, opts);
    }

    async function activateItem(id) {
      var res = await studyFetch('/api/v1/root/${rootId}/study/activate/' + id, 'POST');
      if (res.ok) location.reload();
    }

    async function dequeueItem(id) {
      var res = await studyFetch('/api/v1/root/${rootId}/study/dequeue/' + id, 'POST');
      if (res.ok) location.reload();
    }

    async function deleteItem(id) {
      var el = document.querySelector('[data-id="' + id + '"]');
      if (el) el.style.opacity = '0.3';
      var res = await studyFetch('/api/v1/root/${rootId}/study/item/' + id, 'DELETE');
      if (res.ok) location.reload();
      else if (el) el.style.opacity = '1';
    }

    async function queueGap(name) {
      var res = await studyFetch('/api/v1/root/${rootId}/study/queue', 'POST', { topic: name });
      if (res.ok) location.reload();
    }

    function renameItem(id, btn) {
      var nameEl = btn.previousElementSibling;
      var oldName = nameEl.textContent;
      var input = document.createElement('input');
      input.className = 'rename-input';
      input.value = oldName;
      nameEl.style.display = 'none';
      btn.style.display = 'none';
      nameEl.parentElement.insertBefore(input, nameEl);
      input.focus();
      input.select();

      async function save() {
        var newName = input.value.trim();
        if (!newName || newName === oldName) {
          input.remove(); nameEl.style.display = ''; btn.style.display = ''; return;
        }
        var res = await studyFetch('/api/v1/root/${rootId}/study/rename/' + id, 'POST', { name: newName });
        if (res.ok) nameEl.textContent = newName;
        input.remove(); nameEl.style.display = ''; btn.style.display = '';
      }

      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
        if (e.key === 'Escape') { input.remove(); nameEl.style.display = ''; btn.style.display = ''; }
      });
      input.addEventListener('blur', save);
    }
  `;

  return page({
    title: `${rootName || "Study"} . ${dateStr}`,
    css: css + (!inApp ? chatBarCss() : ""),
    body: body + (!inApp ? chatBarHtml({ placeholder: "What do you want to learn? Or say 'study' to start a session..." }) : ""),
    js: js + (!inApp ? chatBarJs({ endpoint: `/api/v1/root/${rootId}/study`, token, rootId }) : ""),
  });
}
