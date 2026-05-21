import { page } from "../../html-rendering/html/layout.js";
import { baseStyles, glassHeaderStyles, responsiveBase } from "../../html-rendering/html/baseStyles.js";
import { escapeHtml } from "../../html-rendering/html/utils.js";

export function renderCodebookPage({ rootId, rootName, entries, qs }) {
  const css = `
    ${baseStyles}
    ${glassHeaderStyles}
    ${responsiveBase}

    .node-card {
      margin-bottom: 24px;
      padding: 20px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      animation: fadeInUp 0.4s ease-out both;
    }
    .node-name {
      font-size: 15px;
      font-weight: 600;
      color: rgba(255,255,255,0.6);
      margin-bottom: 4px;
    }
    .node-path {
      font-size: 11px;
      color: rgba(255,255,255,0.3);
      margin-bottom: 14px;
    }
    .node-stats {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }
    .node-stat {
      font-size: 11px;
      color: rgba(255,255,255,0.4);
      padding: 4px 10px;
      background: rgba(255,255,255,0.04);
      border-radius: 6px;
    }
    .node-stat strong { color: rgba(255,255,255,0.4); }

    .dict-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 6px;
    }
    .dict-entry {
      display: flex;
      gap: 12px;
      padding: 8px 12px;
      background: rgba(255,255,255,0.03);
      border-radius: 6px;
      border-left: 3px solid rgba(102, 126, 234, 0.3);
      font-size: 13px;
      line-height: 1.5;
    }
    .dict-term {
      color: rgba(102, 126, 234, 0.9);
      font-weight: 600;
      white-space: nowrap;
      flex-shrink: 0;
      min-width: 80px;
    }
    .dict-def {
      color: rgba(255,255,255,0.35);
    }

    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: rgba(255,255,255,0.3);
      font-size: 14px;
      line-height: 1.8;
    }

    .back-nav { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
    .back-link {
      display: inline-flex; align-items: center; gap: 6px; padding: 10px 20px;
      background: rgba(var(--glass-water-rgb), var(--glass-alpha)); backdrop-filter: blur(22px);
      color: rgba(255,255,255,0.6); text-decoration: none; border-radius: 980px;
      font-weight: 600; font-size: 14px; border: 1px solid rgba(255,255,255,0.12);
    }
    .back-link:hover { background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover)); }

    .stats-row {
      display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 24px;
    }
    .stat {
      padding: 8px 16px;
      background: rgba(255,255,255,0.04);
      border-radius: 8px;
      font-size: 13px;
      color: rgba(255,255,255,0.5);
      border: 1px solid rgba(255,255,255,0.06);
    }
    .stat strong { color: rgba(255,255,255,0.5); }
  `;

  const totalEntries = entries.reduce((sum, e) => sum + Object.keys(e.dictionary).length, 0);

  let content;
  if (entries.length === 0) {
    content = `<div class="empty-state">
      No codebook entries yet.<br>
      They build after enough conversations at individual nodes.
    </div>`;
  } else {
    content = entries.map((entry, i) => {
      const dictEntries = Object.entries(entry.dictionary);
      const lastDate = entry.lastCompressed ? new Date(entry.lastCompressed).toLocaleDateString() : "never";
      return `<div class="node-card" style="animation-delay: ${i * 0.08}s">
        <div class="node-name">${escapeHtml(entry.nodeName)}</div>
        ${entry.path ? `<div class="node-path">${escapeHtml(entry.path)}</div>` : ''}
        <div class="node-stats">
          <div class="node-stat"><strong>${dictEntries.length}</strong> terms</div>
          <div class="node-stat">Pending: <strong>${entry.notesSinceCompression || 0}</strong></div>
          <div class="node-stat">Last compressed: <strong>${lastDate}</strong></div>
        </div>
        <div class="dict-grid">
          ${dictEntries.map(([term, def]) => `<div class="dict-entry">
            <div class="dict-term">${escapeHtml(term)}</div>
            <div class="dict-def">${escapeHtml(String(def))}</div>
          </div>`).join('')}
        </div>
      </div>`;
    }).join('');
  }

  const body = `
    <div class="container" style="max-width: 700px;">
      <div class="back-nav">
        <a href="/api/v1/root/${escapeHtml(rootId)}${qs}" class="back-link">Back to ${escapeHtml(rootName || 'Tree')}</a>
      </div>

      <div class="header">
        <h1>Codebook</h1>
        <div class="header-subtitle">${escapeHtml(rootName || 'Tree')} . Compressed language built from conversation.</div>
      </div>

      <div class="stats-row">
        <div class="stat">Nodes: <strong>${entries.length}</strong></div>
        <div class="stat">Total terms: <strong>${totalEntries}</strong></div>
      </div>

      ${content}
    </div>
  `;

  return page({ title: `${rootName || 'Tree'} . Codebook`, css, body, js: '' });
}
