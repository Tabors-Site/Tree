/**
 * KB Dashboard
 *
 * Topics coverage, stale notes, unplaced items, recent updates.
 */

import { page } from "../../html-rendering/html/layout.js";
import { esc, timeAgo } from "../../html-rendering/html/utils.js";
import { glassCardStyles, glassHeaderStyles, responsiveBase } from "../../html-rendering/html/baseStyles.js";
import { chatBarCss, chatBarHtml, chatBarJs, commandsRefHtml } from "../../html-rendering/html/chatBar.js";

export function renderKbDashboard({ rootId, rootName, status, stale, unplaced, token, userId, hasEmbed, hasScout }) {
  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const css = `
    ${glassHeaderStyles}
    ${glassCardStyles}
    ${responsiveBase}

    .kb-layout { max-width: 800px; margin: 0 auto; padding: 1.5rem; }
    .kb-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.2rem; margin-top: 1.5rem; }
    @media (max-width: 700px) { .kb-grid { grid-template-columns: 1fr; } }

    .section-title {
      font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.1em;
      color: rgba(255,255,255,0.5); margin-bottom: 0.5rem; margin-top: 1.5rem;
    }

    .stat-pill {
      display: inline-block; padding: 6px 14px; border-radius: 20px;
      font-size: 0.85rem; margin: 4px 4px 4px 0;
      background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
    }
    .stat-num { font-weight: 700; color: #4ade80; margin-right: 4px; }

    .topic-tag {
      display: inline-block; padding: 4px 10px; border-radius: 6px;
      font-size: 0.8rem; margin: 3px; color: rgba(255,255,255,0.6);
      background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06);
    }
    .topic-count { color: rgba(255,255,255,0.3); font-size: 0.7rem; margin-left: 4px; }

    .stale-item, .unplaced-item {
      padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 0.85rem;
    }
    .stale-item:last-child, .unplaced-item:last-child { border-bottom: none; }
    .stale-name { color: rgba(255,255,255,0.7); font-weight: 600; }
    .stale-age { color: #ecc94b; font-size: 0.8rem; margin-left: 8px; }
    .stale-preview { color: rgba(255,255,255,0.4); font-size: 0.8rem; margin-top: 2px; }

    .recent-item { padding: 6px 0; font-size: 0.85rem; color: rgba(255,255,255,0.5); }

    .empty-state { color: rgba(255,255,255,0.35); font-size: 0.9rem; padding: 1rem 0; font-style: italic; }

    .profile-line { color: rgba(255,255,255,0.35); font-size: 0.8rem; margin-top: 4px; }

    .cap-badge {
      display: inline-block; padding: 2px 8px; border-radius: 10px;
      font-size: 0.7rem; margin-left: 6px;
      background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
      color: rgba(255,255,255,0.4);
    }
    .cap-badge.active { border-color: rgba(72,187,120,0.3); color: rgba(72,187,120,0.7); }

    .stale-branch {
      display: inline-block; padding: 3px 8px; border-radius: 6px;
      font-size: 0.75rem; margin: 2px; color: #ecc94b;
      background: rgba(236,201,75,0.06); border: 1px solid rgba(236,201,75,0.15);
    }
  `;

  const navHtml = userId
    ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <a href="/api/v1/user/${userId}/apps?html${token ? "&token=" + esc(token) : ""}" style="font-size:0.85rem;color:rgba(255,255,255,0.4);text-decoration:none;">← Apps</a>
        <a href="/api/v1/user/${userId}/llm?html${token ? "&token=" + esc(token) : ""}" style="font-size:0.85rem;color:rgba(255,255,255,0.4);text-decoration:none;">LLM</a>
      </div>`
    : "";

  // ── Not initialized state ──
  if (!status) {
    const body = `
      <div class="kb-layout">
        ${navHtml}
        <h1 style="font-size:1.5rem;color:#fff;margin-bottom:0.2rem">${esc(rootName || "Knowledge Base")}</h1>
        <div style="color:rgba(255,255,255,0.35);font-size:0.85rem;margin-top:4px;margin-bottom:24px">${dateStr}</div>
        <div class="glass-card" style="padding:32px;text-align:center">
          <div style="font-size:1.1rem;color:rgba(255,255,255,0.6);margin-bottom:12px">Not initialized yet</div>
          <div style="color:rgba(255,255,255,0.35);font-size:0.9rem;line-height:1.6">
            Tell it something to get started.<br>
            The AI will create the topic structure from what you say.
          </div>
        </div>
        ${commandsRefHtml([
          { cmd: "kb <statement>", desc: "Tell the kb something new" },
          { cmd: "kb <question>", desc: "Ask the kb something" },
        ])}
      </div>
    `;
    return page({
      title: `${esc(rootName || "KB")} . Getting Started`,
      css: css + chatBarCss(),
      body: body + chatBarHtml({ placeholder: "Tell me something to get started..." }),
      js: chatBarJs({ endpoint: `/api/v1/root/${rootId}/kb`, token }),
    });
  }

  // ── Profile info ──
  const profile = status.profile || {};
  const maintainerNames = (profile.maintainers || []).slice(0, 5);
  const profileHtml = `
    <div class="profile-line">
      ${maintainerNames.length > 0 ? `Maintained by ${maintainerNames.map(m => esc(m)).join(", ")}` : ""}
      ${profile.description ? ` . ${esc(profile.description)}` : ""}
    </div>
  `;

  // ── Search capabilities ──
  const capHtml = `
    <span class="cap-badge${hasScout ? " active" : ""}">scout${hasScout ? " ✓" : ""}</span>
    <span class="cap-badge${hasEmbed ? " active" : ""}">semantic${hasEmbed ? " ✓" : ""}</span>
  `;

  // ── Stats ──
  const statsHtml = `
    <div>
      <span class="stat-pill"><span class="stat-num">${status.topicCount || 0}</span> topics</span>
      <span class="stat-pill"><span class="stat-num">${status.noteCount || 0}</span> notes</span>
      ${(status.staleNotes || 0) > 0 ? `<span class="stat-pill" style="border-color:rgba(236,201,75,0.3)"><span class="stat-num" style="color:#ecc94b">${status.staleNotes}</span> stale</span>` : ""}
      ${(status.unplacedCount || 0) > 0 ? `<span class="stat-pill"><span class="stat-num" style="color:#a78bfa">${status.unplacedCount}</span> unplaced</span>` : ""}
      ${capHtml}
    </div>
  `;

  // ── Coverage with note counts ──
  const topicNoteCounts = status.topicNoteCounts || {};
  const coverageHtml = (status.coverage?.length > 0)
    ? status.coverage.map(t => {
        const count = topicNoteCounts[t];
        return `<span class="topic-tag">${esc(t)}${count ? `<span class="topic-count">${count}</span>` : ""}</span>`;
      }).join("")
    : '<div class="empty-state">No topics yet. Tell the kb something to get started.</div>';

  // ── Stale areas summary ──
  const staleAreasHtml = (status.staleBranches?.length > 0)
    ? `<div style="margin-bottom:10px">${status.staleBranches.slice(0, 5).map(b => `<span class="stale-branch">${esc(b)}</span>`).join("")}</div>`
    : "";

  // ── Stale notes ──
  const staleHtml = (stale?.length > 0)
    ? stale.slice(0, 10).map(s => `
        <div class="stale-item">
          <div><span class="stale-name">${esc(s.nodeName)}</span><span class="stale-age">${s.daysStale}d old</span></div>
          <div class="stale-preview">${esc(s.preview)}</div>
        </div>
      `).join("")
    : '<div class="empty-state">No stale notes. Everything is fresh.</div>';

  // ── Unplaced ──
  const unplacedHtml = (unplaced?.length > 0)
    ? unplaced.slice(0, 10).map(u => `
        <div class="unplaced-item">
          <div style="color:rgba(255,255,255,0.6)">${esc(u.content)}</div>
          <div style="color:rgba(255,255,255,0.3);font-size:0.75rem">${timeAgo(u.date)}</div>
        </div>
      `).join("")
    : '<div class="empty-state">Nothing unplaced. Everything has a home.</div>';

  // ── Recent ──
  const recentHtml = (status.recentUpdates?.length > 0)
    ? status.recentUpdates.map(u => `
        <div class="recent-item">${esc(u.name)} <span style="color:rgba(255,255,255,0.3)">${timeAgo(u.date)}</span></div>
      `).join("")
    : '<div class="empty-state">No recent updates.</div>';

  const body = `
    <div class="kb-layout">
      ${navHtml}
      <h1 style="font-size:1.5rem;color:#fff;margin-bottom:0.2rem">${esc(status.name || rootName || "Knowledge Base")}</h1>
      <div style="color:rgba(255,255,255,0.35);font-size:0.85rem;margin-top:4px;margin-bottom:4px">${dateStr}</div>
      ${profileHtml}
      <div style="margin-top:12px">${statsHtml}</div>

      <div class="section-title" style="margin-top:1.5rem">Topics</div>
      <div class="glass-card" style="padding:16px">${coverageHtml}</div>

      <div class="kb-grid">
        <div>
          <div class="glass-card" style="padding:16px">
            <div class="section-title" style="margin-top:0">Stale Notes</div>
            ${staleAreasHtml}
            ${staleHtml}
          </div>
        </div>
        <div>
          <div class="glass-card" style="padding:16px;margin-bottom:12px">
            <div class="section-title" style="margin-top:0">Unplaced</div>
            ${unplacedHtml}
          </div>
          <div class="glass-card" style="padding:16px">
            <div class="section-title" style="margin-top:0">Recent Updates</div>
            ${recentHtml}
          </div>
        </div>
      </div>
      ${commandsRefHtml([
        { cmd: "kb <statement>", desc: "Tell the kb something new" },
        { cmd: "kb <question>", desc: "Ask the kb something" },
        { cmd: "kb status", desc: "Coverage and freshness" },
        { cmd: "kb stale", desc: "Notes needing review" },
        { cmd: "kb unplaced", desc: "Uncategorized items" },
        { cmd: "kb review", desc: "Guided review of stale notes" },
        { cmd: "be", desc: "Start guided review mode" },
      ])}
    </div>
  `;

  return page({
    title: `${esc(status.name || rootName || "KB")} . ${dateStr}`,
    css: css + chatBarCss(),
    body: body + chatBarHtml({ placeholder: "Tell me something or ask a question..." }),
    js: chatBarJs({ endpoint: `/api/v1/root/${rootId}/kb`, token }),
  });
}
