// Dashboard stylesheet, inlined as a template literal so it ships in
// the same response as the HTML. Avoids a separate fetch and the
// CORS-with-token complications that would come with a /governance/
// dashboard.css route in the iframe.
//
// All styles are scoped under .gov-dashboard or .gov-* class
// prefixes so they don't leak into the dashboard chrome that loads
// the iframe.

const CSS = `
body {
  margin: 0;
  background: #0a0a0d;
  color: #e8e8ea;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 1.5;
}
body.gov-in-app { padding: 0; }
#gov-main { padding: 16px 20px; }
code { font-family: "SF Mono", "Monaco", "Consolas", monospace; font-size: 11px; background: rgba(255,255,255,0.06); padding: 1px 4px; border-radius: 2px; color: #a0a0aa; }
pre { white-space: pre-wrap; word-break: break-word; }
h1, h2, h3, h4, h5 { margin: 0; font-weight: 600; }
h5 { color: rgba(255,255,255,0.55); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin: 8px 0 4px; }

.gov-dashboard-header { margin-bottom: 18px; padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.06); }
.gov-dashboard-header h1 { font-size: 18px; margin-bottom: 4px; }
.gov-meta { color: rgba(255,255,255,0.5); font-size: 11px; }

.gov-empty-state { padding: 32px 20px; text-align: center; }
.gov-empty-state h2 { font-size: 16px; margin-bottom: 6px; }
.gov-empty-state p { color: rgba(255,255,255,0.6); max-width: 640px; margin: 8px auto; }
.gov-empty-note { color: rgba(255,255,255,0.4); font-style: italic; font-size: 12px; padding: 6px 0; }
.gov-warning { background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); color: #fbbf24; padding: 8px 12px; border-radius: 4px; margin-bottom: 12px; font-size: 12px; }

/* Ruler card — the unit of composition. CSS variable --gov-depth
   carries the depth from the inline style attribute; cards indent
   proportionally and get a left border showing the tree edge. */
.gov-ruler-card {
  --indent: calc(var(--gov-depth, 0) * 18px);
  margin: 8px 0 8px var(--indent);
  background: rgba(255,255,255,0.025);
  border: 1px solid rgba(255,255,255,0.08);
  border-left: 3px solid rgba(99, 102, 241, 0.4);
  border-radius: 4px;
  padding: 10px 12px;
}
.gov-ruler-card[data-depth="0"] { border-left-color: rgba(34, 211, 238, 0.6); background: rgba(34, 211, 238, 0.03); }
.gov-ruler-card[data-depth="1"] { border-left-color: rgba(99, 102, 241, 0.5); }
.gov-ruler-card[data-depth="2"] { border-left-color: rgba(139, 92, 246, 0.4); }
.gov-ruler-card[data-depth="3"] { border-left-color: rgba(168, 85, 247, 0.4); }

.gov-ruler-card[open] { background: rgba(255,255,255,0.035); }
.gov-ruler-summary { cursor: pointer; list-style: none; outline: none; }
.gov-ruler-summary::-webkit-details-marker { display: none; }
.gov-ruler-summary::before { content: "▸ "; color: rgba(255,255,255,0.4); }
.gov-ruler-card[open] > .gov-ruler-summary::before { content: "▾ "; }

.gov-position-header { display: flex; flex-direction: column; gap: 2px; }
.gov-position-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.gov-position-name { font-weight: 600; font-size: 14px; color: #f0f0f3; }
.gov-position-id { font-size: 11px; color: rgba(255,255,255,0.45); }
.gov-position-meta { color: rgba(255,255,255,0.4); font-size: 11px; display: flex; gap: 12px; flex-wrap: wrap; }
.gov-position-meta .gov-meta { color: rgba(255,255,255,0.4); }

.gov-ruler-body { padding: 12px 4px 4px; }

/* Pills (lifecycle + status indicators) */
.gov-pill { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px; }
.gov-pill-idle { background: rgba(120,120,130,0.2); color: rgba(255,255,255,0.5); }
.gov-pill-plan { background: rgba(59, 130, 246, 0.2); color: #60a5fa; }
.gov-pill-contracts { background: rgba(139, 92, 246, 0.2); color: #c084fc; }
.gov-pill-dispatch { background: rgba(34, 197, 94, 0.2); color: #4ade80; }
.gov-pill-running { background: rgba(251, 146, 60, 0.2); color: #fb923c; }
.gov-pill-completed { background: rgba(34, 197, 94, 0.15); color: rgba(34,197,94,0.75); }
.gov-pill-failed { background: rgba(239, 68, 68, 0.2); color: #f87171; }
.gov-pill-cancelled { background: rgba(120,120,130,0.2); color: rgba(255,255,255,0.45); }
.gov-pill-paused { background: rgba(245, 158, 11, 0.2); color: #fbbf24; }
.gov-pill-superseded { background: rgba(120,120,130,0.15); color: rgba(255,255,255,0.4); text-decoration: line-through; }
.gov-pill-active { background: rgba(34, 211, 238, 0.18); color: #22d3ee; }
.gov-pill-blocking { background: rgba(239, 68, 68, 0.25); color: #fca5a5; }
.gov-pill-inheritance { background: rgba(139, 92, 246, 0.15); color: #c4b5fd; }
.gov-pill-pending { background: rgba(120,120,130,0.15); color: rgba(255,255,255,0.4); }
.gov-pill-blocked { background: rgba(239, 68, 68, 0.18); color: #fca5a5; }
.gov-pill-done { background: rgba(34, 197, 94, 0.15); color: rgba(34,197,94,0.75); }

/* Tags (kind / worker type / etc.) */
.gov-tag { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 500; background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.7); margin-right: 4px; }
.gov-tag-build { background: rgba(99,102,241,0.18); color: #a5b4fc; }
.gov-tag-refine { background: rgba(168,85,247,0.18); color: #d8b4fe; }
.gov-tag-review { background: rgba(245,158,11,0.18); color: #fcd34d; }
.gov-tag-integrate { background: rgba(34,211,238,0.18); color: #67e8f9; }
.gov-tag-branch { background: rgba(139,92,246,0.18); color: #c4b5fd; }
.gov-tag-kind { background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.7); }
.gov-tag-missing-contract { background: rgba(239,68,68,0.18); color: #fca5a5; }
.gov-tag-contract-ambiguity { background: rgba(245,158,11,0.18); color: #fcd34d; }
.gov-tag-contract-conflict { background: rgba(239,68,68,0.25); color: #fca5a5; }
.gov-tag-discovered-dependency { background: rgba(34,211,238,0.18); color: #67e8f9; }
.gov-tag-discovered-need { background: rgba(120,120,130,0.2); color: rgba(255,255,255,0.55); }

/* Sections within a Ruler card */
.gov-section { margin: 10px 0; padding: 8px 10px; background: rgba(0,0,0,0.15); border-radius: 4px; }
.gov-section-empty { background: rgba(0,0,0,0.08); }
.gov-section-pass2 { background: rgba(0,0,0,0.08); border: 1px dashed rgba(255,255,255,0.08); }
.gov-section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: rgba(255,255,255,0.55); margin-bottom: 6px; display: flex; align-items: center; gap: 8px; }

.gov-toplevel-pass2 { margin-bottom: 16px; }

/* Emission cards (plans, contracts, runs) */
.gov-plan-card, .gov-contracts-card, .gov-runs-card { margin: 6px 0; padding: 6px 8px; background: rgba(255,255,255,0.02); border-radius: 3px; border: 1px solid rgba(255,255,255,0.05); }
.gov-plan-active, .gov-contracts-active, .gov-runs-active { border-color: rgba(34,211,238,0.25); }
.gov-plan-card summary, .gov-contracts-card summary, .gov-runs-card summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.gov-plan-card summary::-webkit-details-marker, .gov-contracts-card summary::-webkit-details-marker, .gov-runs-card summary::-webkit-details-marker { display: none; }
.gov-plan-card summary::before, .gov-contracts-card summary::before, .gov-runs-card summary::before { content: "▸"; color: rgba(255,255,255,0.4); }
.gov-plan-card[open] summary::before, .gov-contracts-card[open] summary::before, .gov-runs-card[open] summary::before { content: "▾"; }
.gov-emission-slug { font-weight: 600; color: #e8e8ea; font-size: 12px; }
.gov-emission-ordinal { font-family: "SF Mono", monospace; font-size: 10px; color: rgba(255,255,255,0.45); }
.gov-emission-body { margin-top: 8px; padding: 8px 4px; border-top: 1px solid rgba(255,255,255,0.04); }
.gov-reasoning p { margin: 2px 0; color: rgba(255,255,255,0.75); white-space: pre-wrap; }
.gov-steps ol { margin: 4px 0; padding-left: 20px; }
.gov-step { margin: 4px 0; }
.gov-step-leaf { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
.gov-step-branch { color: rgba(255,255,255,0.8); }
.gov-step-num { font-family: "SF Mono", monospace; font-size: 10px; color: rgba(255,255,255,0.4); }
.gov-sub-branches { margin: 4px 0 4px 12px; padding-left: 12px; border-left: 1px dashed rgba(255,255,255,0.1); }
.gov-sub-branch { margin: 3px 0; color: rgba(255,255,255,0.75); }

/* Contract entries */
.gov-contract-item { margin: 4px 0; padding: 6px 8px; background: rgba(255,255,255,0.02); border-radius: 3px; }
.gov-contract-header { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.gov-contract-name { color: #c084fc; font-size: 12px; }
.gov-contract-details { background: rgba(0,0,0,0.25); padding: 4px 6px; margin: 4px 0; font-size: 10px; color: rgba(255,255,255,0.7); border-radius: 2px; max-height: 200px; overflow: auto; }
.gov-rationale { font-size: 11px; color: rgba(255,255,255,0.6); margin-top: 3px; }
.gov-inheritance-note { font-style: italic; color: rgba(196,181,253,0.85); padding: 4px 0; }

/* Workers */
.gov-workers-bucket { margin: 6px 0; }
.gov-workers-collapsed { opacity: 0.65; }
.gov-worker-item { margin: 4px 0; padding: 5px 8px; background: rgba(255,255,255,0.02); border-radius: 3px; border-left: 2px solid rgba(255,255,255,0.1); }
.gov-worker-running { border-left-color: #fb923c; }
.gov-worker-failed { border-left-color: #f87171; }
.gov-worker-done { border-left-color: rgba(34,197,94,0.5); }
.gov-worker-header { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.gov-worker-spec { margin-top: 3px; color: rgba(255,255,255,0.75); font-size: 12px; }
.gov-worker-meta { margin-top: 2px; color: rgba(255,255,255,0.4); font-size: 10px; display: flex; gap: 8px; }
.gov-error { color: #fca5a5; font-size: 11px; margin-top: 3px; background: rgba(239,68,68,0.08); padding: 3px 6px; border-radius: 2px; }

/* Flags */
.gov-flag-counts { margin-bottom: 6px; display: flex; flex-wrap: wrap; gap: 4px; }
.gov-flag-recent { margin-top: 6px; }
.gov-flag-item { margin: 4px 0; padding: 6px 8px; background: rgba(239, 68, 68, 0.04); border-left: 2px solid rgba(239,68,68,0.4); border-radius: 2px; }
.gov-flag-header { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.gov-flag-choice { font-size: 11px; color: rgba(255,255,255,0.7); margin-top: 3px; }
.gov-flag-proposed { font-size: 11px; color: rgba(196,181,253,0.85); margin-top: 2px; }
.gov-flags-all { margin-top: 8px; padding: 6px; background: rgba(0,0,0,0.15); border-radius: 3px; }
.gov-flags-all summary { cursor: pointer; font-size: 11px; color: rgba(255,255,255,0.55); }

/* Superseded ledger entries */
.gov-superseded-list { margin-top: 6px; opacity: 0.55; }
.gov-superseded-item { padding: 2px 6px; font-size: 11px; display: flex; gap: 8px; align-items: center; }

/* Prior run history (collapsed by default below the active record) */
.gov-runs-prior { margin-top: 6px; padding: 4px 6px; background: rgba(0,0,0,0.15); border-radius: 3px; }
.gov-runs-prior summary { cursor: pointer; font-size: 11px; color: rgba(255,255,255,0.55); padding: 2px 4px; }
.gov-runs-prior summary::-webkit-details-marker { display: none; }
.gov-runs-prior summary::before { content: "▸"; color: rgba(255,255,255,0.4); margin-right: 4px; }
.gov-runs-prior[open] summary::before { content: "▾"; }

/* "In force at this scope" — inherited + local contracts effective
   here. Collapsed by default. Shown only when there are inherited
   contracts (otherwise the active emission already covers everything). */
.gov-contracts-inforce { margin-top: 8px; padding: 6px 8px; background: rgba(139, 92, 246, 0.05); border: 1px solid rgba(139, 92, 246, 0.15); border-radius: 3px; }
.gov-contracts-inforce summary { cursor: pointer; padding: 2px 4px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.gov-contracts-inforce summary::-webkit-details-marker { display: none; }
.gov-contracts-inforce summary::before { content: "▸"; color: rgba(196,181,253,0.6); margin-right: 4px; }
.gov-contracts-inforce[open] summary::before { content: "▾"; }
.gov-section-subtitle { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: rgba(196,181,253,0.85); }
.gov-contracts-inforce-list { margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(139, 92, 246, 0.1); }
.gov-contract-origin { font-size: 10px; color: rgba(196,181,253,0.7); }

/* ─────────────────────────────────────────────────────────────────
   TOP-LEVEL SUMMARY STRIP — totals across the whole rulership.
   Sits below the header, above the minimap. Rectangular tile row.
   ───────────────────────────────────────────────────────────────── */
.gov-summary-strip {
  display: flex;
  gap: 8px;
  margin: 12px 0 16px;
  flex-wrap: wrap;
}
.gov-summary-tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 10px 14px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px;
  min-width: 100px;
}
.gov-summary-num { font-size: 22px; font-weight: 700; color: #f0f0f3; line-height: 1.1; }
.gov-summary-num-sub { font-size: 11px; color: #fca5a5; font-weight: 500; }
.gov-summary-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: rgba(255,255,255,0.5); margin-top: 4px; }
.gov-summary-tile-running { background: rgba(251,146,60,0.08); border-color: rgba(251,146,60,0.3); }
.gov-summary-tile-running .gov-summary-num { color: #fb923c; }
.gov-summary-tile-done { background: rgba(34,197,94,0.06); border-color: rgba(34,197,94,0.25); }
.gov-summary-tile-done .gov-summary-num { color: rgba(34,197,94,0.85); }
.gov-summary-tile-failed { background: rgba(239,68,68,0.08); border-color: rgba(239,68,68,0.3); }
.gov-summary-tile-failed .gov-summary-num { color: #f87171; }
.gov-summary-tile-flags { background: rgba(245,158,11,0.06); border-color: rgba(245,158,11,0.25); }
.gov-summary-tile-flags .gov-summary-num { color: #fbbf24; }
.gov-summary-tile-warn { animation: govPulseWarn 2.4s ease-in-out infinite; }

/* ─────────────────────────────────────────────────────────────────
   RULERSHIP MINIMAP — horizontal SVG showing every Ruler with
   parent→child edges, colored by lifecycle state. Click jumps to
   the corresponding card via #ruler-{id} anchor.
   ───────────────────────────────────────────────────────────────── */
.gov-minimap-wrap {
  background: rgba(0,0,0,0.25);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 6px;
  padding: 10px 14px 12px;
  margin-bottom: 16px;
}
.gov-minimap-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: rgba(255,255,255,0.55); margin-bottom: 8px; }
.gov-minimap {
  display: block;
  width: 100%;
  height: auto;
  max-height: 280px;
}
.gov-minimap-node circle {
  fill: rgba(120,120,130,0.3);
  stroke: rgba(255,255,255,0.4);
  stroke-width: 1.5;
  transition: stroke 0.18s, fill 0.18s, r 0.18s;
}
.gov-minimap-node:hover circle { stroke: #fff; r: 13; }
.gov-minimap-node text.gov-minimap-emoji { font-size: 11px; pointer-events: none; }
.gov-minimap-node[data-state="idle"] circle { fill: rgba(120,120,130,0.3); stroke: rgba(255,255,255,0.4); }
.gov-minimap-node[data-state="plan"] circle { fill: rgba(59,130,246,0.4); stroke: #60a5fa; }
.gov-minimap-node[data-state="contracts"] circle { fill: rgba(139,92,246,0.4); stroke: #c084fc; }
.gov-minimap-node[data-state="dispatch"] circle { fill: rgba(34,197,94,0.4); stroke: #4ade80; }
.gov-minimap-node[data-state="running"] circle { fill: rgba(251,146,60,0.5); stroke: #fb923c; animation: govPulse 1.6s ease-in-out infinite; }
.gov-minimap-node[data-state="completed"] circle { fill: rgba(34,197,94,0.3); stroke: rgba(34,197,94,0.75); }
.gov-minimap-node[data-state="failed"] circle { fill: rgba(239,68,68,0.4); stroke: #f87171; }
.gov-minimap-legend {
  display: flex;
  gap: 12px;
  margin-top: 6px;
  font-size: 10px;
  flex-wrap: wrap;
}
.gov-minimap-legend span { display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px 1px 4px; border-radius: 10px; color: rgba(255,255,255,0.55); }
.gov-minimap-legend span::before { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
.gov-minimap-legend span[data-state="idle"]::before { background: rgba(120,120,130,0.6); }
.gov-minimap-legend span[data-state="plan"]::before { background: #60a5fa; }
.gov-minimap-legend span[data-state="contracts"]::before { background: #c084fc; }
.gov-minimap-legend span[data-state="dispatch"]::before { background: #4ade80; }
.gov-minimap-legend span[data-state="running"]::before { background: #fb923c; }
.gov-minimap-legend span[data-state="completed"]::before { background: rgba(34,197,94,0.75); }
.gov-minimap-legend span[data-state="failed"]::before { background: #f87171; }

/* ─────────────────────────────────────────────────────────────────
   LIFECYCLE PROGRESS BAR — 5 segments showing plan → contracts →
   dispatch → run → done. Filled segments are bright; pending are
   dim; the active segment pulses.
   ───────────────────────────────────────────────────────────────── */
.gov-lifecycle-bar {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 3px;
  margin-top: 8px;
  margin-bottom: 4px;
}
.gov-lc-seg {
  position: relative;
  height: 18px;
  border-radius: 3px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.06);
  overflow: hidden;
}
.gov-lc-seg-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: rgba(255,255,255,0.45);
  font-weight: 600;
}
.gov-lc-seg-filled.gov-lc-seg-plan      { background: rgba(59,130,246,0.55); border-color: rgba(96,165,250,0.7); }
.gov-lc-seg-filled.gov-lc-seg-contracts { background: rgba(139,92,246,0.55); border-color: rgba(192,132,252,0.7); }
.gov-lc-seg-filled.gov-lc-seg-dispatch  { background: rgba(34,197,94,0.45); border-color: rgba(74,222,128,0.7); }
.gov-lc-seg-filled.gov-lc-seg-run       { background: rgba(251,146,60,0.55); border-color: rgba(251,146,60,0.8); }
.gov-lc-seg-filled.gov-lc-seg-done      { background: rgba(34,197,94,0.6); border-color: rgba(74,222,128,0.85); }
.gov-lc-seg-filled .gov-lc-seg-label    { color: rgba(255,255,255,0.95); }
.gov-lc-seg-active { animation: govPulse 1.6s ease-in-out infinite; }
.gov-lc-seg-failed { background: rgba(239,68,68,0.5); border-color: #f87171; }
.gov-lc-seg-failed .gov-lc-seg-label { color: #fca5a5; }

/* ─────────────────────────────────────────────────────────────────
   COLLAPSED-STATE CHIPS — compact status row shown on the card
   summary so the operator scans the tree without expanding.
   ───────────────────────────────────────────────────────────────── */
.gov-collapsed-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 6px;
}
.gov-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 12px;
  font-size: 11px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.75);
  white-space: nowrap;
}
.gov-chip-plan      { background: rgba(59,130,246,0.10); border-color: rgba(96,165,250,0.25); color: #93c5fd; }
.gov-chip-contracts { background: rgba(139,92,246,0.10); border-color: rgba(192,132,252,0.25); color: #c4b5fd; }
.gov-chip-workers   { background: rgba(251,146,60,0.08); border-color: rgba(251,146,60,0.25); }
.gov-chip-flags     { background: rgba(245,158,11,0.08); border-color: rgba(245,158,11,0.25); color: #fbbf24; }
.gov-chip-num-running { color: #fb923c; font-weight: 600; }
.gov-chip-num-done    { color: rgba(34,197,94,0.85); font-weight: 500; }
.gov-chip-num-failed  { color: #f87171; font-weight: 600; }
.gov-chip-pulse { animation: govPulse 1.8s ease-in-out infinite; }
.gov-chip-pulse-warn { animation: govPulseWarn 2s ease-in-out infinite; border-color: rgba(239,68,68,0.5); }

/* ─────────────────────────────────────────────────────────────────
   WORKER CHIPS — replaces stacked worker rows with a compact chip
   row. Each chip is a <details> so clicking expands inline.
   ───────────────────────────────────────────────────────────────── */
.gov-workers-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 4px;
}
.gov-worker-chip {
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 4px;
  padding: 0;
  flex: 0 0 auto;
  max-width: 100%;
}
.gov-worker-chip summary {
  cursor: pointer;
  list-style: none;
  padding: 5px 9px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  flex-wrap: wrap;
}
.gov-worker-chip summary::-webkit-details-marker { display: none; }
.gov-worker-chip[open] summary { border-bottom: 1px solid rgba(255,255,255,0.06); }
.gov-worker-chip-step { font-family: "SF Mono", monospace; color: rgba(255,255,255,0.45); font-size: 10px; }
.gov-worker-chip-spec { color: rgba(255,255,255,0.65); font-size: 11px; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gov-worker-chip-body { padding: 6px 9px 8px; }
.gov-worker-chip.gov-worker-running { border-left: 2px solid #fb923c; }
.gov-worker-chip.gov-worker-failed  { border-left: 2px solid #f87171; }
.gov-worker-chip.gov-worker-done    { border-left: 2px solid rgba(34,197,94,0.55); }
.gov-worker-chip-pulse { animation: govPulse 1.8s ease-in-out infinite; }

/* ─────────────────────────────────────────────────────────────────
   PULSE ANIMATIONS — subtle. Running workers, lifecycle running
   segment, and blocking-flag warnings all use these.
   ───────────────────────────────────────────────────────────────── */
@keyframes govPulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(251,146,60,0); }
  50%      { opacity: 0.78; box-shadow: 0 0 0 3px rgba(251,146,60,0.15); }
}
@keyframes govPulseWarn {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(239,68,68,0); }
  50%      { opacity: 0.85; box-shadow: 0 0 0 3px rgba(239,68,68,0.18); }
}

/* ─────────────────────────────────────────────────────────────────
   TREE EDGES — visible connection rail from parent to child cards.
   Augments the existing left-border depth coloring with a small
   L-shaped tick on each non-root card.
   ───────────────────────────────────────────────────────────────── */
.gov-ruler-card[data-depth="1"]::before,
.gov-ruler-card[data-depth="2"]::before,
.gov-ruler-card[data-depth="3"]::before,
.gov-ruler-card[data-depth="4"]::before {
  content: "";
  position: absolute;
  left: -18px;
  top: 12px;
  width: 14px;
  height: 1px;
  background: rgba(255,255,255,0.15);
}
.gov-ruler-card { position: relative; }

/* Smooth scroll for in-page anchor jumps from the minimap. */
html { scroll-behavior: smooth; }

/* Brief highlight when an anchor is targeted by the minimap. */
.gov-ruler-card:target { box-shadow: 0 0 0 2px rgba(34,211,238,0.4); }
`;

export async function readDashboardCSS() {
  return CSS;
}
