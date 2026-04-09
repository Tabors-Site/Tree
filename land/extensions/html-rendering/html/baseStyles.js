// ─────────────────────────────────────────────────
// Shared CSS building blocks for HTML renderers
//
// Theme: Nightfall
//   Dark slate surface. Sage accent. No glass. No orbs. No gradients.
//   Class names preserved for compatibility (.glass-card, .note-card, etc.)
//   Internals rewritten as solid surfaces with subtle borders.
//
// Import the pieces you need:
//   import { baseStyles, backNavStyles } from ...
//   <style>${baseStyles}${backNavStyles}
//   ... page-specific CSS here ...
//   </style>
// ─────────────────────────────────────────────────

// ─── Core: variables, reset, surface, keyframes, container ───

export const baseStyles = `
:root {
  /* Surfaces */
  --bg:           #0d1117;
  --bg-elevated:  #161b24;
  --bg-hover:     #1c222e;
  --bg-active:    #222837;

  /* Borders */
  --border:        #232a38;
  --border-strong: #2f3849;

  /* Text */
  --text:        #e6e8eb;
  --text-muted:  #9ba1ad;
  --text-dim:    #5d6371;

  /* Accent (alive sage) */
  --accent:        #7dd385;
  --accent-strong: #9ce0a2;
  --accent-bg:     rgba(125, 211, 133, 0.12);
  --accent-border: rgba(125, 211, 133, 0.4);
  --accent-glow:   rgba(125, 211, 133, 0.45);

  /* Semantic */
  --error:   #c97e6a;
  --warning: #d4a574;
  --success: #7dd385;

  /* Backwards-compat aliases for legacy class consumers */
  --glass-water-rgb: 22, 27, 36;
  --glass-alpha:     1;
  --glass-alpha-hover: 1;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}

html, body {
  background: var(--bg);
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif;
  background: var(--bg);
  min-height: 100vh;
  min-height: 100dvh;
  padding: 24px 20px;
  color: var(--text);
  position: relative;
  overflow-x: hidden;
  touch-action: manipulation;
  font-size: 14px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

.container {
  max-width: 880px;
  margin: 0 auto;
  position: relative;
  z-index: 1;
}

::selection { background: var(--accent-bg); color: var(--text); }
`;

// ─── Pill-shaped back navigation buttons ───

export const backNavStyles = `
.back-nav {
  display: flex;
  gap: 10px;
  margin-bottom: 24px;
  flex-wrap: wrap;
  animation: fadeInUp 0.3s ease-out both;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  text-decoration: none;
  border-radius: 8px;
  font-weight: 500;
  font-size: 13px;
  border: 1px solid var(--border);
  transition: background 150ms ease, color 150ms ease, border-color 150ms ease;
}

.back-link:hover {
  background: var(--bg-hover);
  color: var(--text);
  border-color: var(--border-strong);
}
`;

// ─── Header panel (title bar with h1) ───

export const glassHeaderStyles = `
.header {
  background: var(--bg-elevated);
  border-radius: 12px;
  padding: 24px 28px;
  margin-bottom: 20px;
  border: 1px solid var(--border);
  color: var(--text);
  animation: fadeInUp 0.35s ease-out both;
}

.header h1 {
  font-size: 22px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 6px;
  line-height: 1.3;
  letter-spacing: -0.3px;
}

.header h1 a {
  color: var(--text);
  text-decoration: none;
  border-bottom: 1px solid var(--border-strong);
  transition: border-color 150ms ease;
}

.header h1 a:hover {
  border-bottom-color: var(--accent);
}

.message-count {
  display: inline-block;
  padding: 3px 10px;
  background: var(--accent-bg);
  color: var(--accent-strong);
  border-radius: 980px;
  font-size: 12px;
  font-weight: 600;
  margin-left: 10px;
  border: 1px solid var(--accent-border);
}

.header-subtitle {
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 0;
  font-weight: 400;
  line-height: 1.5;
}
`;

// ─── Note/item cards with category color borders ───

export const glassCardStyles = `
.notes-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.note-card {
  --accent-rgb: 155, 161, 173;
  position: relative;
  background: var(--bg-elevated);
  border-radius: 10px;
  padding: 18px 22px;
  border: 1px solid var(--border);
  border-left: 3px solid rgba(var(--accent-rgb), 0.55);
  transition: background 150ms ease, border-color 150ms ease;
  color: var(--text);
}

.note-card:hover {
  background: var(--bg-hover);
  border-color: var(--border-strong);
  border-left-color: rgba(var(--accent-rgb), 0.85);
}

/* ── Color variants (left border identifies the category) ── */
.glass-default  { --accent-rgb: 155, 161, 173; }
.glass-green    { --accent-rgb: 125, 211, 133; }
.glass-red      { --accent-rgb: 201, 126, 106; }
.glass-blue     { --accent-rgb: 122, 146, 184; }
.glass-cyan     { --accent-rgb: 127, 179, 196; }
.glass-gold     { --accent-rgb: 212, 165, 116; }
.glass-purple   { --accent-rgb: 158, 130, 196; }
.glass-pink     { --accent-rgb: 196, 130, 168; }
.glass-orange   { --accent-rgb: 201, 142, 90;  }
.glass-emerald  { --accent-rgb: 130, 200, 145; }
.glass-teal     { --accent-rgb: 116, 168, 173; }
.glass-indigo   { --accent-rgb: 130, 138, 196; }

.note-content {
  margin-bottom: 10px;
  color: var(--text);
  font-size: 14px;
  line-height: 1.6;
}

.note-content:last-child { margin-bottom: 0; }

.note-meta {
  padding-top: 10px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.7;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.note-meta a {
  color: var(--text);
  text-decoration: none;
  font-weight: 500;
  border-bottom: 1px solid var(--border-strong);
  transition: border-color 150ms ease, color 150ms ease;
}

.note-meta a:hover {
  border-bottom-color: var(--accent);
  color: var(--accent-strong);
}

.meta-separator {
  color: var(--text-dim);
}
`;

// ─── Empty state panel ───

export const emptyStateStyles = `
.empty-state {
  background: var(--bg-elevated);
  border-radius: 12px;
  padding: 48px 32px;
  text-align: center;
  border: 1px solid var(--border);
  color: var(--text-muted);
  animation: fadeInUp 0.35s ease-out both;
}

.empty-state-icon {
  font-size: 40px;
  margin-bottom: 12px;
  opacity: 0.5;
}

.empty-state-text {
  font-size: 16px;
  color: var(--text);
  margin-bottom: 6px;
  font-weight: 600;
}

.empty-state-subtext {
  font-size: 13px;
  color: var(--text-muted);
}
`;

// ─── Card panel (reusable container) ───

export const glassCardPanelStyles = `
.glass-card {
  background: var(--bg-elevated);
  border-radius: 12px;
  padding: 24px 28px;
  border: 1px solid var(--border);
  margin-bottom: 16px;
  animation: fadeInUp 0.35s ease-out both;
  position: relative;
  color: var(--text);
}
.glass-card h2 {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 14px;
  letter-spacing: -0.2px;
}
.glass-card h3 {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 10px;
}
`;

// ─── Form inputs and buttons ───

export const glassFormStyles = `
.glass-input {
  padding: 10px 14px;
  font-size: 14px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  font-family: inherit;
  transition: border-color 150ms ease, background 150ms ease;
  width: 100%;
}
.glass-input::placeholder { color: var(--text-dim); }
.glass-input:focus {
  outline: none;
  border-color: var(--accent);
  background: var(--bg-elevated);
}
.glass-select {
  padding: 9px 12px;
  font-size: 14px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  font-family: inherit;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path d='M2 4l4 4 4-4' stroke='%239ba1ad' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 32px;
}
.glass-select option { background: var(--bg-elevated); color: var(--text); }
.glass-btn-save {
  padding: 8px 18px;
  border-radius: 8px;
  border: 1px solid var(--accent-border);
  background: var(--accent-bg);
  color: var(--accent-strong);
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  transition: background 150ms ease, border-color 150ms ease;
}
.glass-btn-save:hover {
  background: rgba(125, 211, 133, 0.2);
  border-color: var(--accent);
}
.glass-btn-danger {
  padding: 8px 18px;
  border-radius: 8px;
  border: 1px solid rgba(201, 126, 106, 0.35);
  background: rgba(201, 126, 106, 0.1);
  color: var(--error);
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  transition: background 150ms ease, border-color 150ms ease;
}
.glass-btn-danger:hover {
  background: rgba(201, 126, 106, 0.18);
  border-color: rgba(201, 126, 106, 0.55);
}
`;

// ─── Stat grid (counts, metrics) ───

export const statGridStyles = `
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}
.stat-item {
  padding: 18px 22px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 10px;
  text-align: left;
  transition: background 150ms ease, border-color 150ms ease;
}
.stat-item:hover {
  background: var(--bg-hover);
  border-color: var(--border-strong);
}
.stat-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.stat-value {
  font-size: 26px;
  font-weight: 600;
  color: var(--text);
  letter-spacing: -0.5px;
}
.stat-sub {
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 4px;
}
`;

// ─── Status message bar ───

export const statusBarStyles = `
.status-bar {
  display: none;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  margin-top: 10px;
  text-align: center;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  color: var(--text-muted);
}
.status-bar.success { color: var(--success); border-color: var(--accent-border); background: var(--accent-bg); }
.status-bar.error   { color: var(--error);   border-color: rgba(201, 126, 106, 0.35); background: rgba(201, 126, 106, 0.1); }
`;

// ─── Responsive breakpoints ───

export const responsiveBase = `
@media (max-width: 640px) {
  body { padding: 16px 14px; }
  .header { padding: 20px 22px; }
  .header h1 { font-size: 20px; }
  .message-count { display: inline-block; margin-left: 8px; }
  .note-card { padding: 16px 18px; }
  .glass-card { padding: 20px 22px; }
  .back-nav { flex-direction: column; }
  .back-link { width: 100%; justify-content: center; }
  .empty-state { padding: 32px 22px; }
  .stat-grid { grid-template-columns: 1fr 1fr; gap: 8px; }
  .stat-item { padding: 14px 16px; }
  .stat-value { font-size: 22px; }
}

@media (min-width: 641px) and (max-width: 1024px) {
  .container { max-width: 740px; }
}
`;
