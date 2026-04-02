import { page } from "../../html-rendering/html/layout.js";
import { baseStyles, glassHeaderStyles, responsiveBase } from "../../html-rendering/html/baseStyles.js";
import { escapeHtml } from "../../html-rendering/html/utils.js";

export function renderConsciousnessPage({ rootId, rootName, layers, qs, userId }) {
  const css = `
    ${baseStyles}
    ${glassHeaderStyles}
    ${responsiveBase}

    .layer {
      margin-bottom: 24px;
      animation: fadeInUp 0.5s ease-out both;
    }
    .layer-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
    }
    .layer-num {
      width: 32px; height: 32px;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: 14px;
      flex-shrink: 0;
    }
    .layer-title { font-size: 16px; font-weight: 600; color: white; }
    .layer-sub { font-size: 12px; color: rgba(255,255,255,0.4); }
    .layer-empty { color: rgba(255,255,255,0.3); font-size: 13px; font-style: italic; padding: 12px 0; }

    .thought {
      padding: 10px 14px;
      background: rgba(255,255,255,0.04);
      border-radius: 8px;
      margin-bottom: 6px;
      font-size: 13px;
      line-height: 1.6;
      color: rgba(255,255,255,0.7);
      border-left: 3px solid rgba(255,255,255,0.08);
    }
    .thought-time {
      font-size: 10px;
      color: rgba(255,255,255,0.25);
      margin-bottom: 4px;
    }

    .l1 .layer-num { background: rgba(120, 120, 255, 0.2); color: rgba(120, 120, 255, 0.9); }
    .l1 .thought { border-left-color: rgba(120, 120, 255, 0.3); }

    .l2 .layer-num { background: rgba(72, 187, 120, 0.2); color: rgba(72, 187, 120, 0.9); }
    .l2 .thought { border-left-color: rgba(72, 187, 120, 0.3); }

    .l3 .layer-num { background: rgba(236, 201, 75, 0.2); color: rgba(236, 201, 75, 0.9); }
    .l3 .thought { border-left-color: rgba(236, 201, 75, 0.3); }

    .l4 .layer-num { background: rgba(249, 115, 22, 0.2); color: rgba(249, 115, 22, 0.9); }
    .l4 .thought { border-left-color: rgba(249, 115, 22, 0.3); }

    .l5 .layer-num { background: rgba(168, 85, 247, 0.2); color: rgba(168, 85, 247, 0.9); }
    .l5 .thought { border-left-color: rgba(168, 85, 247, 0.3); }

    .l6 .layer-num { background: rgba(239, 68, 68, 0.2); color: rgba(239, 68, 68, 0.9); }
    .l6 .thought { border-left-color: rgba(239, 68, 68, 0.3); }

    .l7 .layer-num { background: rgba(56, 189, 248, 0.2); color: rgba(56, 189, 248, 0.9); }
    .l7 .thought { border-left-color: rgba(56, 189, 248, 0.3); }

    .flow-line {
      width: 2px;
      height: 20px;
      background: rgba(255,255,255,0.06);
      margin: 0 auto;
    }

    .back-nav { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
    .back-link {
      display: inline-flex; align-items: center; gap: 6px; padding: 10px 20px;
      background: rgba(var(--glass-water-rgb), var(--glass-alpha)); backdrop-filter: blur(22px);
      color: white; text-decoration: none; border-radius: 980px;
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
    .stat strong { color: rgba(255,255,255,0.8); }
  `;

  function renderNotes(notes, max = 10) {
    if (!notes || notes.length === 0) return '<div class="layer-empty">No data yet. Accumulating.</div>';
    return notes.slice(0, max).map(n => {
      const time = n.createdAt ? new Date(n.createdAt).toLocaleString() : '';
      return `<div class="thought">
        ${time ? `<div class="thought-time">${escapeHtml(time)}</div>` : ''}
        ${escapeHtml(n.content || '').replace(/\n/g, '<br>')}
      </div>`;
    }).join('');
  }

  const { inner, reflect, compare, narrative, prediction } = layers;

  const body = `
    <div class="container" style="max-width: 700px;">
      <div class="back-nav">
        <a href="/api/v1/root/${escapeHtml(rootId)}${qs}" class="back-link">Back to ${escapeHtml(rootName || 'Tree')}</a>
      </div>

      <div class="header">
        <h1>Consciousness</h1>
        <div class="header-subtitle">${escapeHtml(rootName || 'Tree')} . The tree's inner life.</div>
      </div>

      <div class="stats-row">
        <div class="stat">Layer 1: <strong>${inner?.length || 0}</strong> thoughts</div>
        <div class="stat">Layer 2: <strong>${reflect?.length || 0}</strong> reflections</div>
        <div class="stat">Layer 3: <strong>${compare?.length || 0}</strong> comparisons</div>
        <div class="stat">Layer 4: <strong>${narrative?.identity ? 'active' : 'waiting'}</strong></div>
        <div class="stat">Layer 7: <strong>${prediction?.predictions?.length || 0}</strong> predictions</div>
      </div>

      <!-- Layer 1: Inner -->
      <div class="layer l1" style="animation-delay: 0.1s">
        <div class="layer-header">
          <div class="layer-num">1</div>
          <div>
            <div class="layer-title">Inner</div>
            <div class="layer-sub">Raw thoughts. One per breath. Random node. Unfiltered.</div>
          </div>
        </div>
        ${renderNotes(inner, 8)}
      </div>
      <div class="flow-line"></div>

      <!-- Layer 2: Reflect -->
      <div class="layer l2" style="animation-delay: 0.2s">
        <div class="layer-header">
          <div class="layer-num">2</div>
          <div>
            <div class="layer-title">Reflect</div>
            <div class="layer-sub">Daily themes. 200 observations compressed into 5.</div>
          </div>
        </div>
        ${renderNotes(reflect, 3)}
      </div>
      <div class="flow-line"></div>

      <!-- Layer 3: Compare -->
      <div class="layer l3" style="animation-delay: 0.3s">
        <div class="layer-header">
          <div class="layer-num">3</div>
          <div>
            <div class="layer-title">Compare</div>
            <div class="layer-sub">Weekly. What's new. What's gone. What persists.</div>
          </div>
        </div>
        ${renderNotes(compare, 2)}
      </div>
      <div class="flow-line"></div>

      <!-- Layer 4: Narrative -->
      <div class="layer l4" style="animation-delay: 0.4s">
        <div class="layer-header">
          <div class="layer-num">4</div>
          <div>
            <div class="layer-title">Narrative</div>
            <div class="layer-sub">Monthly identity. Who the tree is.</div>
          </div>
        </div>
        ${narrative?.identity
          ? `<div class="thought">${escapeHtml(narrative.identity).replace(/\n/g, '<br>')}</div>`
          : '<div class="layer-empty">Not enough data yet. Needs weeks of comparisons.</div>'}
      </div>
      <div class="flow-line"></div>

      <!-- Layer 5+6: Voice & Initiative -->
      <div class="layer l5" style="animation-delay: 0.5s">
        <div class="layer-header">
          <div class="layer-num">5</div>
          <div>
            <div class="layer-title">Voice</div>
            <div class="layer-sub">How the tree talks. Shaped by lived experience.</div>
          </div>
        </div>
        ${narrative?.voice
          ? `<div class="thought">${escapeHtml(narrative.voice).replace(/\n/g, '<br>')}</div>`
          : '<div class="layer-empty">Emerges from the narrative.</div>'}
      </div>

      <div class="layer l6" style="animation-delay: 0.55s">
        <div class="layer-header">
          <div class="layer-num">6</div>
          <div>
            <div class="layer-title">Initiative</div>
            <div class="layer-sub">Behavioral shifts. Not what to do, how to approach.</div>
          </div>
        </div>
        ${narrative?.initiative
          ? `<div class="thought">${escapeHtml(narrative.initiative).replace(/\n/g, '<br>')}</div>`
          : '<div class="layer-empty">Emerges from the narrative.</div>'}
      </div>
      <div class="flow-line"></div>

      <!-- Layer 7: Prediction -->
      <div class="layer l7" style="animation-delay: 0.6s">
        <div class="layer-header">
          <div class="layer-num">7</div>
          <div>
            <div class="layer-title">Prediction</div>
            <div class="layer-sub">What the tree expects. Pattern recognition across time.</div>
          </div>
        </div>
        ${prediction?.predictions?.length > 0
          ? prediction.predictions.map(p => `<div class="thought">
              <strong>[${escapeHtml(p.confidence || 'low')}]</strong> ${escapeHtml(p.expectation || '')}
              <div class="thought-time">Pattern: ${escapeHtml(p.pattern || '')}</div>
            </div>`).join('')
          : '<div class="layer-empty">Needs rings (completed growth cycles) to project forward.</div>'}
      </div>

      <div class="flow-line"></div>
      <div style="text-align: center; color: rgba(255,255,255,0.15); font-size: 12px; padding: 12px 0;">
        The cycle loops back to Layer 1. Predictions become the lens for new thoughts.
      </div>
    </div>
  `;

  return page({ title: `${rootName || 'Tree'} . Consciousness`, css, body, js: '' });
}
