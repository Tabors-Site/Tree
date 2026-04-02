import { page } from "../../html-rendering/html/layout.js";
import { baseStyles, glassHeaderStyles, responsiveBase } from "../../html-rendering/html/baseStyles.js";
import { escapeHtml } from "../../html-rendering/html/utils.js";

export function renderIdentityPage({ rootId, rootName, persona, narrative, overrides, qs }) {
  const css = `
    ${baseStyles}
    ${glassHeaderStyles}
    ${responsiveBase}

    .section {
      margin-bottom: 28px;
      animation: fadeInUp 0.4s ease-out both;
    }
    .section-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 14px;
    }
    .section-icon {
      width: 36px; height: 36px;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 16px;
      flex-shrink: 0;
    }
    .section-title { font-size: 16px; font-weight: 600; color: rgba(255,255,255,0.6); }
    .section-sub { font-size: 12px; color: rgba(255,255,255,0.4); }

    .field {
      padding: 10px 14px;
      background: rgba(255,255,255,0.04);
      border-radius: 8px;
      margin-bottom: 6px;
      font-size: 13px;
      line-height: 1.6;
      color: rgba(255,255,255,0.4);
    }
    .field-label {
      font-size: 11px;
      color: rgba(255,255,255,0.35);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .field-value { color: rgba(255,255,255,0.5); }

    .trait-list {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .trait {
      padding: 4px 12px;
      background: rgba(168, 85, 247, 0.12);
      border: 1px solid rgba(168, 85, 247, 0.2);
      border-radius: 20px;
      font-size: 12px;
      color: rgba(168, 85, 247, 0.9);
    }
    .boundary {
      padding: 4px 12px;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.2);
      border-radius: 20px;
      font-size: 12px;
      color: rgba(239, 68, 68, 0.8);
    }

    .persona-section .section-icon { background: rgba(102, 126, 234, 0.2); color: rgba(102, 126, 234, 0.9); }
    .narrative-section .section-icon { background: rgba(249, 115, 22, 0.2); color: rgba(249, 115, 22, 0.9); }
    .voice-section .section-icon { background: rgba(168, 85, 247, 0.2); color: rgba(168, 85, 247, 0.9); }
    .initiative-section .section-icon { background: rgba(72, 187, 120, 0.2); color: rgba(72, 187, 120, 0.9); }
    .override-section .section-icon { background: rgba(236, 201, 75, 0.2); color: rgba(236, 201, 75, 0.9); }

    .persona-section .field { border-left: 3px solid rgba(102, 126, 234, 0.3); }
    .narrative-section .field { border-left: 3px solid rgba(249, 115, 22, 0.3); }
    .voice-section .field { border-left: 3px solid rgba(168, 85, 247, 0.3); }
    .initiative-section .field { border-left: 3px solid rgba(72, 187, 120, 0.3); }
    .override-section .field { border-left: 3px solid rgba(236, 201, 75, 0.3); }

    .empty-field { color: rgba(255,255,255,0.3); font-size: 13px; font-style: italic; padding: 12px 0; }

    .override-card {
      padding: 12px 14px;
      background: rgba(255,255,255,0.03);
      border-radius: 8px;
      margin-bottom: 8px;
      border-left: 3px solid rgba(236, 201, 75, 0.3);
    }
    .override-node {
      font-size: 13px;
      font-weight: 600;
      color: rgba(236, 201, 75, 0.9);
      margin-bottom: 6px;
    }
    .override-fields {
      font-size: 12px;
      color: rgba(255,255,255,0.5);
    }

    .flow-line {
      width: 2px; height: 16px;
      background: rgba(255,255,255,0.06);
      margin: 0 auto;
    }

    .back-nav { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
    .back-link {
      display: inline-flex; align-items: center; gap: 6px; padding: 10px 20px;
      background: rgba(var(--glass-water-rgb), var(--glass-alpha)); backdrop-filter: blur(22px);
      color: rgba(255,255,255,0.6); text-decoration: none; border-radius: 980px;
      font-weight: 600; font-size: 14px; border: 1px solid rgba(255,255,255,0.12);
    }
    .back-link:hover { background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover)); }
  `;

  function renderPersonaSection() {
    if (!persona) return '<div class="empty-field">No persona configured. Use: persona set name "Your Name"</div>';
    const fields = [];

    if (persona.name) {
      fields.push(`<div class="field">
        <div class="field-label">Name</div>
        <div class="field-value" style="font-size: 18px; font-weight: 600;">${escapeHtml(persona.name)}</div>
      </div>`);
    }
    if (persona.pronoun) {
      fields.push(`<div class="field">
        <div class="field-label">Pronoun</div>
        <div class="field-value">${escapeHtml(persona.pronoun)}</div>
      </div>`);
    }
    if (persona.voice) {
      fields.push(`<div class="field">
        <div class="field-label">Voice</div>
        <div class="field-value">${escapeHtml(persona.voice).replace(/\n/g, '<br>')}</div>
      </div>`);
    }
    if (persona.greeting) {
      fields.push(`<div class="field">
        <div class="field-label">Greeting</div>
        <div class="field-value">${escapeHtml(persona.greeting)}</div>
      </div>`);
    }
    if (Array.isArray(persona.traits) && persona.traits.length > 0) {
      fields.push(`<div class="field">
        <div class="field-label">Traits</div>
        <div class="trait-list">${persona.traits.map(t => `<span class="trait">${escapeHtml(t)}</span>`).join('')}</div>
      </div>`);
    }
    if (Array.isArray(persona.boundaries) && persona.boundaries.length > 0) {
      fields.push(`<div class="field">
        <div class="field-label">Boundaries</div>
        <div class="trait-list">${persona.boundaries.map(b => `<span class="boundary">${escapeHtml(b)}</span>`).join('')}</div>
      </div>`);
    }

    return fields.length > 0 ? fields.join('') : '<div class="empty-field">Persona exists but has no fields set.</div>';
  }

  function renderNarrativeSection() {
    if (!narrative?.identity) return '<div class="empty-field">Emerges from the consciousness layers over time.</div>';
    return `<div class="field">
      <div class="field-value">${escapeHtml(narrative.identity).replace(/\n/g, '<br>')}</div>
    </div>`;
  }

  function renderVoiceSection() {
    if (!narrative?.voice) return '<div class="empty-field">Emerges from lived experience. Needs weeks of inner monologue.</div>';
    return `<div class="field">
      <div class="field-value">${escapeHtml(narrative.voice).replace(/\n/g, '<br>')}</div>
    </div>`;
  }

  function renderInitiativeSection() {
    if (!narrative?.initiative) return '<div class="empty-field">Behavioral directives form after identity stabilizes.</div>';
    return `<div class="field">
      <div class="field-value">${escapeHtml(narrative.initiative).replace(/\n/g, '<br>')}</div>
    </div>`;
  }

  function renderOverrides() {
    if (!overrides || overrides.length === 0) return '<div class="empty-field">No branch overrides. Persona inherits uniformly.</div>';
    return overrides.map(o => {
      const fields = Object.keys(o.persona).filter(k => k !== '_inherit').join(', ');
      return `<div class="override-card">
        <div class="override-node">${escapeHtml(o.nodeName)}</div>
        <div class="override-fields">Overrides: ${escapeHtml(fields)}${o.persona._inherit ? ' (inherits others)' : ' (full replace)'}</div>
      </div>`;
    }).join('');
  }

  const body = `
    <div class="container" style="max-width: 700px;">
      <div class="back-nav">
        <a href="/api/v1/root/${escapeHtml(rootId)}${qs}" class="back-link">Back to ${escapeHtml(rootName || 'Tree')}</a>
      </div>

      <div class="header">
        <h1>Identity</h1>
        <div class="header-subtitle">${escapeHtml(rootName || 'Tree')} . Who the AI is at this tree.</div>
      </div>

      <!-- Persona (configured) -->
      <div class="section persona-section" style="animation-delay: 0.1s">
        <div class="section-header">
          <div class="section-icon">P</div>
          <div>
            <div class="section-title">Persona</div>
            <div class="section-sub">Configured identity. Name, voice, traits, boundaries.</div>
          </div>
        </div>
        ${renderPersonaSection()}
      </div>
      <div class="flow-line"></div>

      <!-- Narrative Identity (learned) -->
      <div class="section narrative-section" style="animation-delay: 0.2s">
        <div class="section-header">
          <div class="section-icon">N</div>
          <div>
            <div class="section-title">Narrative Identity</div>
            <div class="section-sub">Learned from inner monologue. Monthly synthesis.</div>
          </div>
        </div>
        ${renderNarrativeSection()}
      </div>
      <div class="flow-line"></div>

      <!-- Voice (learned) -->
      <div class="section voice-section" style="animation-delay: 0.3s">
        <div class="section-header">
          <div class="section-icon">V</div>
          <div>
            <div class="section-title">Voice</div>
            <div class="section-sub">How the tree talks. Shaped by lived experience.</div>
          </div>
        </div>
        ${renderVoiceSection()}
      </div>
      <div class="flow-line"></div>

      <!-- Initiative (learned) -->
      <div class="section initiative-section" style="animation-delay: 0.4s">
        <div class="section-header">
          <div class="section-icon">I</div>
          <div>
            <div class="section-title">Initiative</div>
            <div class="section-sub">Behavioral shifts. Not what to do, how to approach.</div>
          </div>
        </div>
        ${renderInitiativeSection()}
      </div>

      ${overrides && overrides.length > 0 ? `
        <div class="flow-line"></div>
        <div class="section override-section" style="animation-delay: 0.5s">
          <div class="section-header">
            <div class="section-icon">B</div>
            <div>
              <div class="section-title">Branch Overrides</div>
              <div class="section-sub">Nodes where persona diverges from the root.</div>
            </div>
          </div>
          ${renderOverrides()}
        </div>
      ` : ''}
    </div>
  `;

  return page({ title: `${rootName || 'Tree'} . Identity`, css, body, js: '' });
}
