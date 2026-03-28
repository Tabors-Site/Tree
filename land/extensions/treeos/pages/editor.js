/* --------------------------------------------------------- */
/* Editor page                                               */
/* --------------------------------------------------------- */

import { page } from "../../html-rendering/html/layout.js";
import { baseStyles } from "../../html-rendering/html/baseStyles.js";

export function renderEditorPage({
  nodeId,
  version,
  noteId,
  noteContent,
  qs,
  tokenQS,
  originalLength,
}) {
  const isNew = !noteId;
  const safeContent = (noteContent || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const css = `
${baseStyles}

/* ── Editor-specific overrides on base ── */
:root {
  --glass-rgb: 115, 111, 230;
  --sidebar-w: 280px;
  --toolbar-h: 52px;
  --bottombar-h: 44px;
  --editor-font-size: 13px;
  --editor-line-height: 2.1;
  --editor-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
}

html, body { height: 100%; overflow: hidden; }
body {
  font-family: var(--editor-font);
  color: white; display: flex; flex-direction: column;
  height: 100vh; height: 100dvh;
  padding: 0; min-height: auto;
}

/* Override base orbs: editor uses a single subtler orb */
body::before {
  opacity: 0.05;
  animation-duration: 25s;
}
body::before { transform: none; }
body::after { display: none; }

/* ── TOOLBAR ─────────────────── */
.toolbar {
  height: var(--toolbar-h); display: flex; align-items: center; gap: 6px;
  padding: 0 12px;
  background: rgba(var(--glass-rgb), 0.35);
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-bottom: 1px solid rgba(255,255,255,0.15);
  flex-shrink: 0; z-index: 20;
  overflow-x: auto; overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
}
.toolbar::-webkit-scrollbar { display: none; }

.tb-btn {
  padding: 6px 12px; border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.15);
  background: rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.8);
  font-size: 13px; font-weight: 600; font-family: inherit;
  cursor: pointer; transition: all 0.2s;
  white-space: nowrap; flex-shrink: 0;
  display: inline-flex; align-items: center; gap: 4px;
}
.tb-btn:hover { background: rgba(255,255,255,0.18); color: white; }
.tb-btn.active { background: rgba(72,187,178,0.35); border-color: rgba(72,187,178,0.5); color: white; }

.tb-sep { width: 1px; height: 24px; background: rgba(255,255,255,0.12); flex-shrink: 0; margin: 0 4px; }
.tb-range-wrap { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.tb-range-label { font-size: 11px; color: rgba(255,255,255,0.5); font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; white-space: nowrap; }

.tb-range {
  -webkit-appearance: none; appearance: none;
  width: 80px; height: 4px;
  background: rgba(255,255,255,0.2);
  border-radius: 4px; outline: none; cursor: pointer;
}
.tb-range::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: white; box-shadow: 0 2px 6px rgba(0,0,0,0.2); cursor: pointer; }
.tb-range::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: white; box-shadow: 0 2px 6px rgba(0,0,0,0.2); border: none; cursor: pointer; }

.tb-spacer { flex: 1; min-width: 8px; }

.tb-copy {
  padding: 6px 12px; border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.15);
  background: rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.8);
  font-size: 13px; font-weight: 600; font-family: inherit;
  cursor: pointer; transition: all 0.2s;
  white-space: nowrap; flex-shrink: 0;
  display: inline-flex; align-items: center; gap: 4px;
  min-width: 36px; justify-content: center;
}
.tb-copy:hover { background: rgba(255,255,255,0.18); color: white; }
.tb-copy.copied { background: rgba(72,187,120,0.3); border-color: rgba(72,187,120,0.5); color: white; }

@media (max-width: 768px) {
  .tb-copy { padding: 6px 10px; }
}

.tb-back {
  padding: 6px 14px; border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.15);
  background: rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.8);
  font-size: 13px; font-weight: 600; font-family: inherit;
  cursor: pointer; text-decoration: none; transition: all 0.2s;
  flex-shrink: 0; display: inline-flex; align-items: center; gap: 4px;
}
.tb-back:hover { background: rgba(255,255,255,0.18); color: white; }

/* ── MAIN ────────────────────── */
.main { flex: 1; display: flex; overflow: hidden; position: relative; }

/* ── SIDEBAR ─────────────────── */
.sidebar {
  width: var(--sidebar-w); flex-shrink: 0;
  display: flex; flex-direction: column;
  background: rgba(var(--glass-rgb), 0.22);
  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
  border-right: 1px solid rgba(255,255,255,0.12);
  overflow: hidden;
  z-index: 15;
}
.sidebar.hidden { display: none; }

.sidebar-header {
  padding: 16px; border-bottom: 1px solid rgba(255,255,255,0.1);
  display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;
}
.sidebar-title { font-size: 14px; font-weight: 700; color: rgba(255,255,255,0.9); }

.sidebar-close {
  width: 28px; height: 28px; border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.6); font-size: 14px;
  cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: all 0.2s;
}
.sidebar-close:hover { background: rgba(255,255,255,0.2); color: white; }

.sidebar-list { flex: 1; overflow-y: auto; padding: 8px; }
.sidebar-list::-webkit-scrollbar { width: 4px; }
.sidebar-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 4px; }

.note-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: 10px;
  cursor: pointer; transition: all 0.2s;
  border: 1px solid transparent; margin-bottom: 2px;
}
.note-item:hover { background: rgba(255,255,255,0.1); }
.note-item.active { background: rgba(72,187,178,0.2); border-color: rgba(72,187,178,0.35); }

.note-item-icon {
  width: 32px; height: 32px; border-radius: 8px;
  background: rgba(255,255,255,0.1);
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; flex-shrink: 0;
}
.note-item-info { min-width: 0; flex: 1; }
.note-item-username { font-size: 11px; color: rgba(255,255,255,0.5); font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 2px; }
.note-item-preview { font-size: 13px; font-weight: 500; color: rgba(255,255,255,0.85); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.note-item-meta { font-size: 11px; color: rgba(255,255,255,0.4); margin-top: 2px; }

.sidebar-new {
  margin: 8px; padding: 10px; border-radius: 10px;
  border: 2px dashed rgba(255,255,255,0.15); background: transparent;
  color: rgba(255,255,255,0.5); font-size: 13px; font-weight: 600;
  font-family: inherit; cursor: pointer; transition: all 0.2s;
  text-align: center; flex-shrink: 0;
}
.sidebar-new:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.25); color: rgba(255,255,255,0.8); }

/* ── EDITOR ──────────────────── */
.editor-wrap { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

.editor-scroll {
  flex: 1; overflow-y: auto; overflow-x: hidden;
  padding: 16px 16px; display: flex; justify-content: center;
  -webkit-overflow-scrolling: touch;
}
.editor-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.editor-scroll::-webkit-scrollbar-track { background: rgba(255,255,255,0.05); }
.editor-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 4px; }
.editor-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.3); }

/* Code mode: enable horizontal scroll on outer container */
.editor-scroll.code-scroll-enabled {
  overflow-x: auto;
  justify-content: flex-start;
}

.editor-container { width: 100%; max-width: 100%; }

/* Code mode: container expands to fit content */
.editor-container.code-mode-active {
  width: max-content;
  min-width: 100%;
  max-width: none;
}

/* ── LINE NUMBERS + EDITOR LAYOUT ── */
.editor-with-lines {
  display: flex;
  width: 100%;
}

.editor-container.code-mode-active .editor-with-lines {
  width: max-content;
  min-width: 100%;
}

.line-numbers {
  display: none;
  flex-shrink: 0;
  padding-right: 12px;
  margin-right: 12px;
  border-right: 1px solid rgba(255,255,255,0.03);
  text-align: right;
  user-select: none;
  pointer-events: none;
  color: rgba(255,255,255,0.3);
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono', Consolas, monospace;
  font-size: var(--editor-font-size);
  line-height: var(--editor-line-height);
}

.line-numbers.show {
  display: block;
}

.line-numbers span {
  display: block;
}

.editor-code-scroll {
  flex: 1;
  min-width: 0;
  overflow-x: visible;
  overflow-y: visible;
}

.editor-code-scroll::-webkit-scrollbar { height: 8px; }
.editor-code-scroll::-webkit-scrollbar-track { background: rgba(255,255,255,0.05); }
.editor-code-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 4px; }
.editor-code-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.3); }

#editor {
  width: 100%;
  min-height: calc(100vh - var(--toolbar-h) - var(--bottombar-h) - 32px);
  background: transparent; border: none; outline: none; resize: none;
  color: rgba(255,255,255,0.95);
  font-family: var(--editor-font);
  font-size: var(--editor-font-size);
  line-height: var(--editor-line-height);
  caret-color: rgba(72,187,178,0.9);
  padding: 0; -webkit-font-smoothing: antialiased;
  overflow: hidden;
}
#editor::placeholder { color: rgba(255,255,255,0.25); font-style: italic; }
#editor.mono {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono', Consolas, monospace;
  white-space: pre;
  word-wrap: normal;
  overflow-wrap: normal;
}

/* ── BOTTOM BAR ──────────────── */
.bottombar {
  height: var(--bottombar-h);
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 16px;
  background: rgba(var(--glass-rgb), 0.3);
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-top: 1px solid rgba(255,255,255,0.12);
  flex-shrink: 0; z-index: 20; gap: 12px;
}
.bb-left, .bb-right { display: flex; align-items: center; gap: 12px; }
.bb-stat { font-size: 12px; color: rgba(255,255,255,0.4); font-weight: 500; white-space: nowrap; }

.bb-energy {
  color: rgba(100,220,255,0.7); font-weight: 600;
  padding: 2px 8px; background: rgba(100,220,255,0.1);
  border-radius: 980px; border: 1px solid rgba(100,220,255,0.15);
}

.bb-status { font-size: 12px; font-weight: 600; white-space: nowrap; transition: color 0.3s; }
.bb-status.saved { color: rgba(72,187,120,0.8); }
.bb-status.unsaved { color: rgba(250,204,21,0.8); }
.bb-status.saving { color: rgba(100,220,255,0.8); }
.bb-status.error { color: rgba(239,68,68,0.8); }

.save-btn {
  padding: 6px 20px; border-radius: 980px;
  border: 1px solid rgba(72,187,178,0.45); background: rgba(72,187,178,0.3);
  color: white; font-size: 13px; font-weight: 700;
  font-family: inherit; cursor: pointer; transition: all 0.2s; white-space: nowrap;
}
.save-btn:hover { background: rgba(72,187,178,0.45); transform: translateY(-1px); }
.save-btn:active { transform: translateY(0); }
.save-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }

.delete-btn {
  padding: 6px 16px; border-radius: 980px;
  border: 1px solid rgba(239,68,68,0.4); background: rgba(239,68,68,0.2);
  color: rgba(255,255,255,0.8); font-size: 13px; font-weight: 600;
  font-family: inherit; cursor: pointer; transition: all 0.2s;
  white-space: nowrap; display: none;
}
.delete-btn:hover { background: rgba(239,68,68,0.35); color: white; }
.delete-btn.show { display: inline-flex; }

/* ── DELETE MODAL ────────────── */
.modal-overlay {
  display: none; position: fixed; inset: 0; z-index: 100;
  background: rgba(0,0,0,0.6);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  align-items: center; justify-content: center; padding: 20px;
}
.modal-overlay.show { display: flex; }

.modal-box {
  background: rgba(var(--glass-rgb), 0.5);
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 20px; padding: 32px;
  border: 1px solid rgba(255,255,255,0.28);
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  max-width: 420px; width: 100%; text-align: center;
}
.modal-icon { font-size: 48px; margin-bottom: 16px; }
.modal-title { font-size: 20px; font-weight: 700; color: white; margin-bottom: 8px; }
.modal-text { font-size: 14px; color: rgba(255,255,255,0.7); line-height: 1.6; margin-bottom: 24px; }
.modal-actions { display: flex; gap: 12px; justify-content: center; }

.modal-btn {
  padding: 10px 24px; border-radius: 980px;
  font-size: 14px; font-weight: 600; font-family: inherit;
  cursor: pointer; transition: all 0.2s; border: 1px solid;
}
.modal-btn-cancel { background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.2); color: rgba(255,255,255,0.8); }
.modal-btn-cancel:hover { background: rgba(255,255,255,0.22); color: white; }
.modal-btn-delete { background: rgba(239,68,68,0.3); border-color: rgba(239,68,68,0.5); color: white; }
.modal-btn-delete:hover { background: rgba(239,68,68,0.5); }

/* ── ZEN ─────────────────────── */
body.zen .toolbar { display: none; }
body.zen .sidebar { display: none; }
body.zen .bottombar { opacity: 0; transition: opacity 0.3s; }
body.zen:hover .bottombar { opacity: 1; }
body.zen .editor-scroll { padding: 24px; }

/* ── ZEN EXIT BUTTON (mobile only) ── */
.zen-exit-btn {
  display: none;
  position: fixed;
  top: 16px;
  right: 16px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid rgba(255,255,255,0.2);
  background: rgba(var(--glass-rgb), 0.5);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  color: rgba(255,255,255,0.8);
  font-size: 18px;
  cursor: pointer;
  z-index: 30;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  box-shadow: 0 4px 20px rgba(0,0,0,0.2);
}
.zen-exit-btn:hover {
  background: rgba(var(--glass-rgb), 0.7);
  color: white;
  transform: scale(1.05);
}

@media (max-width: 768px) {
  body.zen .zen-exit-btn {
    display: flex;
  }
}

/* ── MOBILE ──────────────────── */
@media (max-width: 768px) {
  :root { --sidebar-w: 280px; }

  .sidebar {
    position: fixed; top: 0; left: 0; bottom: 0;
    width: var(--sidebar-w);
    background: rgba(var(--glass-rgb), 0.95);
    backdrop-filter: blur(30px); -webkit-backdrop-filter: blur(30px);
    z-index: 50;
    display: flex;
  }

  .sidebar.hidden { display: none; }
  .toolbar { gap: 4px; padding: 0 8px; }
  .tb-range-wrap { display: flex; }
  .tb-range-label { display: none; }
  .tb-range { width: 80px; }
  .tb-sep { display: none; }
  .editor-scroll { padding: 16px; }
  body.zen .bottombar { opacity: 1; }
  .tb-back span { display: none; }
  .tb-copy span { display: none; }
}

@media (max-width: 480px) {
  .bb-stat:not(.bb-energy) { display: none; }
  .save-btn { padding: 6px 16px; }
  .tb-range { width: 60px; }
}

/* ── Hidden text measurer ── */
#textMeasurer {
  position: absolute;
  visibility: hidden;
  height: auto;
  width: auto;
  white-space: pre;
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono', Consolas, monospace;
  font-size: var(--editor-font-size);
  line-height: var(--editor-line-height);
  pointer-events: none;
}

/* ── HISTORY PANEL ──────────── */
.history-overlay {
  position: fixed; inset: 0; z-index: 90;
  background: rgba(0,0,0,0.5);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  display: flex; justify-content: center; align-items: center;
  padding: 20px;
}
.history-overlay.hidden { display: none; }

.history-panel {
  background: rgba(var(--glass-rgb), 0.65);
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.2);
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  width: 100%; max-width: 700px;
  max-height: 80vh;
  display: flex; flex-direction: column;
  overflow: hidden;
}

.history-header {
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255,255,255,0.1);
  display: flex; align-items: center; justify-content: space-between;
  flex-shrink: 0;
}
.history-title { font-size: 16px; font-weight: 700; color: rgba(255,255,255,0.9); }

.history-list {
  max-height: 200px; overflow-y: auto; padding: 8px 12px;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
.history-list::-webkit-scrollbar { width: 4px; }
.history-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 4px; }

.history-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px; border-radius: 8px;
  cursor: pointer; transition: all 0.2s;
  border: 1px solid transparent; margin-bottom: 2px;
}
.history-item:hover { background: rgba(255,255,255,0.1); }
.history-item.active { background: rgba(72,187,178,0.2); border-color: rgba(72,187,178,0.35); }

.history-item-badge {
  padding: 2px 8px; border-radius: 980px;
  font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.5px; flex-shrink: 0;
}
.history-item-badge.add { background: rgba(72,187,120,0.25); color: rgba(72,187,120,0.9); }
.history-item-badge.edit { background: rgba(100,220,255,0.2); color: rgba(100,220,255,0.9); }

.history-item-info { flex: 1; min-width: 0; }
.history-item-user { font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.85); }
.history-item-date { font-size: 11px; color: rgba(255,255,255,0.4); margin-top: 1px; }

.history-view { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
.history-view.hidden { display: none; }

.history-view-header {
  padding: 10px 16px;
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  flex-shrink: 0;
}
.history-view-modes { display: flex; gap: 4px; }

.history-view-content {
  flex: 1; overflow-y: auto; padding: 12px 16px;
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono', Consolas, monospace;
  font-size: 12px; line-height: 1.6;
  white-space: pre-wrap; word-break: break-word;
}
.history-view-content::-webkit-scrollbar { width: 4px; }
.history-view-content::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 4px; }

.diff-line { padding: 1px 8px; border-radius: 3px; margin: 0; }
.diff-same { color: rgba(255,255,255,0.7); }
.diff-add { background: rgba(72,187,120,0.2); color: rgba(72,187,120,0.95); }
.diff-del { background: rgba(239,68,68,0.2); color: rgba(239,68,68,0.95); }
.history-empty { text-align: center; padding: 40px 20px; color: rgba(255,255,255,0.3); font-size: 13px; }

@media (max-width: 768px) {
  .history-panel { max-width: 100%; max-height: 90vh; border-radius: 12px; }
  .history-list { max-height: 150px; }
}
`;

  const body = `
<!-- Hidden element for measuring text width -->
<div id="textMeasurer"></div>

<!-- ── ZEN EXIT BUTTON (mobile) ─────────────── -->
<button class="zen-exit-btn" id="zenExitBtn" title="Exit Zen Mode">\u2715</button>

<!-- ── TOOLBAR ──────────────────────────────── -->
<div class="toolbar">
  <a href="/api/v1/node/${nodeId}/${version}/notes${qs}" class="tb-back" id="backBtn">\u2190 <span>Notes</span></a>
  <div class="tb-sep"></div>
  <button class="tb-btn" id="sidebarToggle" title="Toggle sidebar">\u2630</button>
  <button class="tb-btn" id="zenToggle" title="Zen mode">\ud83e\uddd8</button>
  <button class="tb-btn" id="monoToggle" title="Code mode (monospace)">{ }</button>
  <div class="tb-sep"></div>
  <div class="tb-range-wrap tb-fontsize">
    <span class="tb-range-label">Font</span>
    <input type="range" class="tb-range" id="fontSizeRange" min="13" max="28" value="20" title="Font Size">
  </div>
  <div class="tb-range-wrap tb-lineheight">
    <span class="tb-range-label">Spacing</span>
    <input type="range" class="tb-range" id="lineHeightRange" min="12" max="30" value="16" step="1" title="Line Spacing">
  </div>

  <div class="tb-spacer"></div>
  ${isNew ? "" : '<button class="tb-btn" id="historyToggle" title="Edit history">\ud83d\udd52</button>'}
  <button class="tb-copy" id="copyBtn" title="Copy all text">\ud83d\udccb <span>Copy</span></button>
</div>

<!-- ── MAIN ─────────────────────────────────── -->
<div class="main">

  <!-- SIDEBAR -->
  <div class="sidebar hidden" id="sidebar">
    <div class="sidebar-header">
      <span class="sidebar-title">Notes</span>
      <button class="sidebar-close" id="sidebarCloseBtn">\u2715</button>
    </div>
    <div class="sidebar-list" id="notesList">
      <div style="text-align:center;padding:20px;color:rgba(255,255,255,0.3);font-size:13px;">Loading\u2026</div>
    </div>
    <button class="sidebar-new" id="newNoteBtn">+ New Note</button>
  </div>

  <!-- EDITOR -->
  <div class="editor-wrap">
    <div class="editor-scroll" id="editorScroll">
      <div class="editor-container" id="editorContainer">
        <div class="editor-with-lines" id="editorWithLines">
          <div class="line-numbers" id="lineNumbers"></div>
          <div class="editor-code-scroll" id="editorCodeScroll">
            <textarea id="editor" placeholder="Start writing\u2026">${safeContent}</textarea>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- ── BOTTOM BAR ──────────────────────────── -->
<div class="bottombar">
  <div class="bb-left">
    <span class="bb-stat" id="charCount">0 chars</span>
    <span class="bb-stat" id="wordCount">0 words</span>
    <span class="bb-stat" id="lineCount">0 lines</span>
    <span class="bb-stat bb-energy" id="energyCost">\u26a10</span>
  </div>
  <div class="bb-right">
    <span class="bb-status" id="saveStatus">${isNew ? "New note" : "Loaded"}</span>
    <button class="delete-btn" id="deleteBtn">Delete</button>
    <button class="save-btn" id="saveBtn">Save</button>
  </div>
</div>

<!-- ── DELETE MODAL ─────────────────────────── -->
<div class="modal-overlay" id="deleteModal">
  <div class="modal-box">
    <div class="modal-icon">\ud83d\uddd1\ufe0f</div>
    <div class="modal-title">Delete this note?</div>
    <div class="modal-text">
      It looks like you cleared everything out.<br>
      Would you like to delete this note entirely?<br>
      This cannot be undone.
    </div>
    <div class="modal-actions">
      <button class="modal-btn modal-btn-cancel" id="deleteCancelBtn">Cancel</button>
      <button class="modal-btn modal-btn-delete" id="deleteConfirmBtn">Delete</button>
    </div>
  </div>
</div>

<!-- ── HISTORY PANEL ───────────────────────────── -->
<div class="history-overlay hidden" id="historyOverlay">
  <div class="history-panel">
    <div class="history-header">
      <span class="history-title">Edit History</span>
      <button class="sidebar-close" id="historyCloseBtn">\u2715</button>
    </div>
    <div class="history-list" id="historyList">
      <div style="text-align:center;padding:20px;color:rgba(255,255,255,0.3);font-size:13px;">Loading...</div>
    </div>
    <div class="history-view hidden" id="historyView">
      <div class="history-view-header">
        <div class="history-view-modes">
          <button class="tb-btn active" id="historyFullBtn">Full Content</button>
          <button class="tb-btn" id="historyDiffBtn">Show Changes</button>
        </div>
        <button class="save-btn" id="historyRestoreBtn">Restore</button>
      </div>
      <div class="history-view-content" id="historyViewContent"></div>
    </div>
  </div>
</div>
`;

  const js = `
/* ═══════════════════════════════════════════════════
   STATE
   ═══════════════════════════════════════════════════ */
var nodeId      = "${nodeId}";
var version     = "${version}";
var currentNoteId = ${noteId ? '"' + noteId + '"' : "null"};
var qs          = "${qs}";
var tokenQS     = "${tokenQS}";
var isNew       = ${isNew};
var originalLen = ${originalLength || 0};
var lastSaved   = ${isNew ? '""' : 'document.getElementById("editor").value'};
var saving      = false;
var navigatingAway = false;

/* ═══════════════════════════════════════════════════
   DOM REFS
   ═══════════════════════════════════════════════════ */
var editor       = document.getElementById("editor");
var saveBtn      = document.getElementById("saveBtn");
var deleteBtn    = document.getElementById("deleteBtn");
var saveStatus   = document.getElementById("saveStatus");
var charCountEl  = document.getElementById("charCount");
var wordCountEl  = document.getElementById("wordCount");
var lineCountEl  = document.getElementById("lineCount");
var energyCostEl = document.getElementById("energyCost");
var sidebar      = document.getElementById("sidebar");
var notesList    = document.getElementById("notesList");
var lineNumbersEl = document.getElementById("lineNumbers");
var editorScroll = document.getElementById("editorScroll");
var editorWithLines = document.getElementById("editorWithLines");
var editorCodeScroll = document.getElementById("editorCodeScroll");
var editorContainer = document.getElementById("editorContainer");
var textMeasurer = document.getElementById("textMeasurer");

/* ═══════════════════════════════════════════════════
   SETTINGS (persisted in localStorage)
   ═══════════════════════════════════════════════════ */
function loadSettings() {
  try {
    var s = JSON.parse(localStorage.getItem("tree-editor-settings") || "{}");
    if (s.fontSize)   document.getElementById("fontSizeRange").value   = s.fontSize;
    if (s.lineHeight) document.getElementById("lineHeightRange").value = s.lineHeight;
    if (s.mono) {
      editor.classList.add("mono");
      lineNumbersEl.classList.add("show");
      editorScroll.classList.add("code-scroll-enabled");
      editorContainer.classList.add("code-mode-active");
      document.getElementById("monoToggle").classList.add("active");
    }
    applySettings();
  } catch (e) {}
}

function persistSettings() {
  try {
    localStorage.setItem("tree-editor-settings", JSON.stringify({
      fontSize:   document.getElementById("fontSizeRange").value,
      lineHeight: document.getElementById("lineHeightRange").value,
      mono:       editor.classList.contains("mono")
    }));
  } catch (e) {}
}

function applySettings() {
  var fontSize = document.getElementById("fontSizeRange").value;
  var lineHeight = document.getElementById("lineHeightRange").value;

  document.documentElement.style.setProperty("--editor-font-size", fontSize + "px");
  document.documentElement.style.setProperty("--editor-line-height", lineHeight / 10);

  autoGrowEditor();
}

document.getElementById("fontSizeRange").oninput   = function() { applySettings(); persistSettings(); };
document.getElementById("lineHeightRange").oninput  = function() { applySettings(); persistSettings(); };

document.getElementById("monoToggle").onclick = function() {
  editor.classList.toggle("mono");
  lineNumbersEl.classList.toggle("show");
  editorScroll.classList.toggle("code-scroll-enabled");
  editorContainer.classList.toggle("code-mode-active");
  this.classList.toggle("active");
  autoGrowEditor();
  persistSettings();
};

/* ═══════════════════════════════════════════════════
   MEASURE TEXT WIDTH FOR CODE MODE
   ═══════════════════════════════════════════════════ */
function measureTextWidth(text) {
  // Update measurer styles to match editor
  var computedStyle = getComputedStyle(editor);
  textMeasurer.style.fontFamily = computedStyle.fontFamily;
  textMeasurer.style.fontSize = computedStyle.fontSize;
  textMeasurer.style.lineHeight = computedStyle.lineHeight;
  textMeasurer.style.letterSpacing = computedStyle.letterSpacing;

  // Find the longest line
  var lines = text.split("\\n");
  var maxWidth = 0;

  for (var i = 0; i < lines.length; i++) {
    textMeasurer.textContent = lines[i] || " ";
    var width = textMeasurer.offsetWidth;
    if (width > maxWidth) maxWidth = width;
  }

  return maxWidth;
}

function updateEditorWidth() {
  if (!editor.classList.contains("mono")) {
    // Normal mode: reset width
    editor.style.width = "100%";
    return;
  }

  // Code mode: measure and set width to fit longest line
  var contentWidth = measureTextWidth(editor.value);
  var minWidth = editorScroll.clientWidth - 80; // Account for padding and line numbers
  var newWidth = Math.max(contentWidth + 20, minWidth); // Add some padding

  editor.style.width = newWidth + "px";
}

/* ═══════════════════════════════════════════════════
   AUTO-GROW EDITOR (like VS Code / Word)
   ═══════════════════════════════════════════════════ */
function autoGrowEditor() {
  var minH = window.innerHeight - 52 - 44 - 32;

  editor.style.height = 'auto';
  var newHeight = Math.max(editor.scrollHeight, minH);
  editor.style.height = newHeight + 'px';

  updateLineNumbers();
  updateEditorWidth();
}

/* ═══════════════════════════════════════════════════
   LINE NUMBERS
   ═══════════════════════════════════════════════════ */
function updateLineNumbers() {
  if (!editor.classList.contains("mono")) return;

  var lines = editor.value.split("\\n");
  var count = lines.length;
  var html = "";
  for (var i = 1; i <= count; i++) {
    html += "<span>" + i + "</span>";
  }
  lineNumbersEl.innerHTML = html;
}

/* ═══════════════════════════════════════════════════
   ZEN MODE
   ═══════════════════════════════════════════════════ */
function exitZenMode() {
  document.body.classList.remove("zen");
  document.getElementById("zenToggle").classList.remove("active");
  autoGrowEditor();
}

document.getElementById("zenToggle").onclick = function() {
  document.body.classList.toggle("zen");
  this.classList.toggle("active");
  autoGrowEditor();
};

document.getElementById("zenExitBtn").onclick = exitZenMode;

/* ═══════════════════════════════════════════════════
   COPY ALL TEXT
   ═══════════════════════════════════════════════════ */
document.getElementById("copyBtn").onclick = function() {
  var btn = this;
  var btnSpan = btn.querySelector("span");

  // Select all text
  editor.select();
  editor.setSelectionRange(0, editor.value.length);

  // Copy to clipboard
  navigator.clipboard.writeText(editor.value).then(function() {
    btn.firstChild.textContent = "\\u2713 ";
    if (btnSpan) btnSpan.textContent = "Copied";
    btn.classList.add("copied");

    setTimeout(function() {
      btn.firstChild.textContent = "\\ud83d\\udccb ";
      if (btnSpan) btnSpan.textContent = "Copy";
      btn.classList.remove("copied");
    }, 1500);
  }).catch(function() {
    // Fallback for older browsers
    try {
      document.execCommand("copy");
      btn.firstChild.textContent = "\\u2713 ";
      if (btnSpan) btnSpan.textContent = "Copied";
      btn.classList.add("copied");

      setTimeout(function() {
        btn.firstChild.textContent = "\\ud83d\\udccb ";
        if (btnSpan) btnSpan.textContent = "Copy";
        btn.classList.remove("copied");
      }, 1500);
    } catch (e) {
      if (btnSpan) btnSpan.textContent = "Failed";
      setTimeout(function() {
        btn.firstChild.textContent = "\\ud83d\\udccb ";
        if (btnSpan) btnSpan.textContent = "Copy";
      }, 1500);
    }
  });
};

/* ═══════════════════════════════════════════════════
   SIDEBAR TOGGLE
   ═══════════════════════════════════════════════════ */
function toggleSidebar() {
  sidebar.classList.toggle("hidden");
  document.getElementById("sidebarToggle").classList.toggle("active");
}

document.getElementById("sidebarToggle").onclick = toggleSidebar;

document.getElementById("sidebarCloseBtn").onclick = function() {
  sidebar.classList.add("hidden");
  document.getElementById("sidebarToggle").classList.remove("active");
};

/* ═══════════════════════════════════════════════════
   ENERGY ESTIMATE (mirrors server: min 1, max 5)
   ═══════════════════════════════════════════════════ */
function estimateEnergy(chars) {
  return Math.min(5, Math.max(1, 1 + Math.floor(chars / 1000)));
}

/* ═══════════════════════════════════════════════════
   STATS + ENERGY + EMPTY DETECTION
   ═══════════════════════════════════════════════════ */
function updateStats() {
  var text    = editor.value;
  var len     = text.length;
  var trimmed = text.trim().length;

  charCountEl.textContent = len + " chars";
  wordCountEl.textContent = (text.trim() ? text.trim().split(/\\s+/).length : 0) + " words";
  lineCountEl.textContent = text.split("\\n").length + " lines";

  var cost;
  if (isNew && !currentNoteId) {
    cost = len > 0 ? estimateEnergy(len) : 0;
  } else {
    var delta = Math.max(0, len - originalLen);
    cost = delta > 0 ? estimateEnergy(delta) : 1;
  }
  energyCostEl.textContent = "\\u26A1" + cost;

  if (!isNew && currentNoteId) {
    if (trimmed === 0) {
      deleteBtn.classList.add("show");
      saveBtn.disabled = true;
    } else {
      deleteBtn.classList.remove("show");
      saveBtn.disabled = false;
    }
  } else {
    saveBtn.disabled = trimmed === 0;
  }
}

/* ═══════════════════════════════════════════════════
   DIRTY TRACKING
   ═══════════════════════════════════════════════════ */
function isDirty() {
  return editor.value !== lastSaved;
}

function markDirty() {
  if (isDirty()) {
    saveStatus.textContent = "Unsaved changes";
    saveStatus.className = "bb-status unsaved";
  }
}

editor.addEventListener("input", function() {
  updateStats();
  markDirty();
  autoGrowEditor();
});

editor.addEventListener("paste", function() {
  setTimeout(autoGrowEditor, 0);
});

/* ═══════════════════════════════════════════════════
   NAVIGATION WITH UNSAVED CHECK
   ═══════════════════════════════════════════════════ */
function navigateWithCheck(url) {
  if (isDirty()) {
    if (!confirm("Unsaved changes. Discard?")) {
      return false;
    }
  }
  navigatingAway = true;
  window.location.href = url;
  return true;
}

document.getElementById("backBtn").onclick = function(e) {
  e.preventDefault();
  navigateWithCheck("/api/v1/node/" + nodeId + "/" + version + "/notes" + qs);
};

/* ═══════════════════════════════════════════════════
   SAVE -> POST (new) or PUT (existing)
   ═══════════════════════════════════════════════════ */
async function doSave() {
  if (saving) return;
  var content = editor.value;

  if (!isNew && currentNoteId && !content.trim()) {
    openDeleteModal();
    return;
  }

  if (!content.trim()) {
    saveStatus.textContent = "Cannot save empty note";
    saveStatus.className = "bb-status error";
    return;
  }

  saving = true;
  saveBtn.disabled = true;
  saveStatus.textContent = "Saving\\u2026";
  saveStatus.className = "bb-status saving";

  try {
    var url, method;

    if (currentNoteId) {
      url    = "/api/v1/node/" + nodeId + "/" + version + "/notes/" + currentNoteId;
      method = "PUT";
    } else {
      url    = "/api/v1/node/" + nodeId + "/" + version + "/notes";
      method = "POST";
    }

    var res = await fetch(url, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: content, contentType: "text" }),
      credentials: "include"
    });

    if (!res.ok) {
      var errData = await res.json().catch(function() { return {}; });
      throw new Error(errData.error || "Save failed (" + res.status + ")");
    }

    var data = await res.json();
    var inner = data.data || data;

    if (!currentNoteId) {
      var newId = inner._id || (inner.note && inner.note._id);
      if (newId) {
        currentNoteId = newId;
        isNew = false;
        originalLen = content.length;
        history.replaceState(null, "",
          "/api/v1/node/" + nodeId + "/" + version + "/notes/" + currentNoteId + "/editor" + qs
        );
      }
    } else {
      originalLen = content.length;
    }

    lastSaved = content;

    var msg = "Saved";
    var eu  = data.energyUsed || 0;
    if (eu > 0) msg += " \\u00b7 \\u26A1" + eu;
    saveStatus.textContent = msg;
    saveStatus.className   = "bb-status saved";

    navigatingAway = true;
    if (currentNoteId) {
      window.location.href =
        "/api/v1/node/" + nodeId + "/" + version + "/notes/" + currentNoteId + qs;
    } else {
      window.location.href =
        "/api/v1/node/" + nodeId + "/" + version + "/notes" + qs;
    }

    loadNotes();

  } catch (err) {
    saveStatus.textContent = err.message;
    saveStatus.className   = "bb-status error";
  } finally {
    saving = false;
    saveBtn.disabled = false;
    updateStats();
  }
}

saveBtn.onclick = doSave;

/* ═══════════════════════════════════════════════════
   DELETE -> DELETE route
   ═══════════════════════════════════════════════════ */
function openDeleteModal()  { document.getElementById("deleteModal").classList.add("show"); }
function closeDeleteModal() { document.getElementById("deleteModal").classList.remove("show"); }

document.getElementById("deleteCancelBtn").onclick = closeDeleteModal;
document.getElementById("deleteModal").onclick = function(e) { if (e.target === this) closeDeleteModal(); };

document.getElementById("deleteConfirmBtn").onclick = async function() {
  if (!currentNoteId) return;
  this.disabled   = true;
  this.textContent = "Deleting\\u2026";

  try {
    var res = await fetch(
      "/api/v1/node/" + nodeId + "/" + version + "/notes/" + currentNoteId,
      { method: "DELETE", credentials: "include" }
    );

    if (!res.ok) {
      var errData = await res.json().catch(function() { return {}; });
      throw new Error(errData.error || "Delete failed");
    }

    navigatingAway = true;
    window.location.href = "/api/v1/node/" + nodeId + "/notes" + qs;

  } catch (err) {
    closeDeleteModal();
    saveStatus.textContent = err.message;
    saveStatus.className   = "bb-status error";
    this.disabled   = false;
    this.textContent = "Delete";
  }
};

deleteBtn.onclick = openDeleteModal;

/* ═══════════════════════════════════════════════════
   KEYBOARD SHORTCUTS
   ═══════════════════════════════════════════════════ */
document.addEventListener("keydown", function(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); doSave(); }
  if (e.key === "Escape") {
    if (document.getElementById("deleteModal").classList.contains("show")) closeDeleteModal();
    else if (document.body.classList.contains("zen")) {
      exitZenMode();
    }
  }
});

editor.addEventListener("keydown", function(e) {
  // Enter key in code mode: scroll to left to see line numbers
  if (e.key === "Enter" && editor.classList.contains("mono")) {
    setTimeout(function() {
      editorScroll.scrollLeft = 0;
    }, 0);
  }

  if (e.key !== "Tab") return;
  e.preventDefault();
  var s = this.selectionStart, end = this.selectionEnd, v = this.value;

  if (e.shiftKey) {
    var ls = v.lastIndexOf("\\n", s - 1) + 1;
    if (v.substring(ls, ls + 2) === "  ") {
      this.value = v.substring(0, ls) + v.substring(ls + 2);
      this.selectionStart = Math.max(s - 2, ls);
      this.selectionEnd   = Math.max(end - 2, ls);
    }
  } else {
    this.value = v.substring(0, s) + "  " + v.substring(end);
    this.selectionStart = this.selectionEnd = s + 2;
  }
  updateStats(); markDirty(); autoGrowEditor();
});

/* ═══════════════════════════════════════════════════
   SIDEBAR: LOAD NOTES LIST
   ═══════════════════════════════════════════════════ */
async function loadNotes() {
  try {
    var token = new URLSearchParams(qs.replace("?","")).get("token");
    var fetchUrl = "/api/v1/node/" + nodeId + "/" + version + "/notes";
    if (token) fetchUrl += "?token=" + encodeURIComponent(token);
    var res = await fetch(fetchUrl, { credentials: "include" });
    var data  = await res.json();
    var inner = data.data || data;
    var notes = inner.notes || inner || [];
    if (!Array.isArray(notes)) notes = [];
    if (!notes.length) { notesList.innerHTML = emptyMsg("No notes yet"); return; }

    var html = "";
    for (var i = 0; i < notes.length; i++) {
      var n      = notes[i];
      var nId    = n._id || n.id;
      var isFile = n.contentType === "file";
      var icon   = isFile ? "\\ud83d\\udcce" : "\\ud83d\\udcdd";
      var preview;
      var username = n.username || n.user || n.author || "Unknown";

      if (isFile) preview = n.content ? n.content.split("/").pop() : "File";
      else        preview = (n.content || "").slice(0, 60) || "Empty note";

      var active = nId === currentNoteId;
      var date   = n.createdAt ? new Date(n.createdAt).toLocaleDateString() : "";

      html +=
        '<div class="note-item' + (active ? " active" : "") +
        '" data-id="' + nId + '" data-type="' + (n.contentType || "text") + '">' +
          '<div class="note-item-icon">' + icon + '</div>' +
          '<div class="note-item-info">' +
            '<div class="note-item-username">' + esc(username) + '</div>' +
            '<div class="note-item-preview">' + esc(preview) + '</div>' +
            '<div class="note-item-meta">' + date + '</div>' +
          '</div>' +
        '</div>';
    }
    notesList.innerHTML = html;

    notesList.querySelectorAll(".note-item").forEach(function(item) {
      item.onclick = function() {
        var nId   = item.dataset.id;
        var nType = item.dataset.type;
        if (nId === currentNoteId) return;

        var targetUrl;
        if (nType === "file")
          targetUrl = "/api/v1/node/" + nodeId + "/" + version + "/notes/" + nId + tokenQS;
        else
          targetUrl = "/api/v1/node/" + nodeId + "/" + version + "/notes/" + nId + "/editor" + qs;

        navigateWithCheck(targetUrl);
      };
    });

  } catch (err) {
    notesList.innerHTML = emptyMsg("Error loading notes");
  }
}

function emptyMsg(t) {
  return '<div style="text-align:center;padding:20px;color:rgba(255,255,255,0.3);font-size:13px;">' + t + '</div>';
}

function esc(s) { return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

/* ═══════════════════════════════════════════════════
   NEW NOTE BUTTON
   ═══════════════════════════════════════════════════ */
document.getElementById("newNoteBtn").onclick = function() {
  navigateWithCheck("/api/v1/node/" + nodeId + "/" + version + "/notes/editor" + qs);
};

/* ═══════════════════════════════════════════════════
   WARN ON LEAVE
   ═══════════════════════════════════════════════════ */
window.addEventListener("beforeunload", function(e) {
  if (!navigatingAway && isDirty()) {
    e.preventDefault();
    e.returnValue = "";
  }
});

/* ═══════════════════════════════════════════════════
   WINDOW RESIZE
   ═══════════════════════════════════════════════════ */
window.addEventListener("resize", function() {
  autoGrowEditor();
});

/* ═══════════════════════════════════════════════════
   EDIT HISTORY
   ═══════════════════════════════════════════════════ */
var historyData = [];
var selectedHistoryIdx = -1;
var historyMode = "full"; // "full" or "diff"

var historyToggleBtn = document.getElementById("historyToggle");
var historyOverlay = document.getElementById("historyOverlay");
var historyCloseBtn = document.getElementById("historyCloseBtn");
var historyListEl = document.getElementById("historyList");
var historyView = document.getElementById("historyView");
var historyViewContent = document.getElementById("historyViewContent");
var historyFullBtn = document.getElementById("historyFullBtn");
var historyDiffBtn = document.getElementById("historyDiffBtn");
var historyRestoreBtn = document.getElementById("historyRestoreBtn");

if (historyToggleBtn) {
  historyToggleBtn.onclick = function() {
    historyOverlay.classList.remove("hidden");
    loadHistory();
  };
}

if (historyCloseBtn) {
  historyCloseBtn.onclick = function() {
    historyOverlay.classList.add("hidden");
  };
}

if (historyOverlay) {
  historyOverlay.onclick = function(e) {
    if (e.target === historyOverlay) historyOverlay.classList.add("hidden");
  };
}

async function loadHistory() {
  historyListEl.innerHTML = '<div style="text-align:center;padding:20px;color:rgba(255,255,255,0.3);font-size:13px;">Loading...</div>';
  historyView.classList.add("hidden");
  selectedHistoryIdx = -1;

  try {
    var token = new URLSearchParams(qs.replace("?","")).get("token");
    var fetchUrl = "/api/v1/node/" + nodeId + "/" + version + "/notes/" + currentNoteId + "/history";
    if (token) fetchUrl += "?token=" + encodeURIComponent(token);
    var res = await fetch(fetchUrl, { credentials: "include" });
    var data = await res.json();
    var histInner = data.data || data;
    historyData = histInner.history || [];

    if (!historyData.length) {
      historyListEl.innerHTML = '<div class="history-empty">No edit history available yet.<br>History is recorded on future saves.</div>';
      return;
    }

    var html = "";
    for (var i = historyData.length - 1; i >= 0; i--) {
      var h = historyData[i];
      var d = new Date(h.date);
      var dateStr = d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      var badgeClass = h.action === "add" ? "add" : "edit";
      var badgeLabel = h.action === "add" ? "Created" : "Edit";

      html +=
        '<div class="history-item" data-idx="' + i + '">' +
          '<span class="history-item-badge ' + badgeClass + '">' + badgeLabel + '</span>' +
          '<div class="history-item-info">' +
            '<div class="history-item-user">' + esc(h.username) + '</div>' +
            '<div class="history-item-date">' + esc(dateStr) + '</div>' +
          '</div>' +
        '</div>';
    }
    historyListEl.innerHTML = html;

    var items = historyListEl.querySelectorAll(".history-item");
    for (var j = 0; j < items.length; j++) {
      items[j].onclick = function() {
        var idx = parseInt(this.getAttribute("data-idx"));
        selectHistoryEntry(idx);
        var all = historyListEl.querySelectorAll(".history-item");
        for (var k = 0; k < all.length; k++) all[k].classList.remove("active");
        this.classList.add("active");
      };
    }
  } catch (e) {
    historyListEl.innerHTML = '<div class="history-empty">Failed to load history.</div>';
  }
}

function selectHistoryEntry(idx) {
  selectedHistoryIdx = idx;
  historyView.classList.remove("hidden");
  renderHistoryView();
}

if (historyFullBtn) {
  historyFullBtn.onclick = function() {
    historyMode = "full";
    historyFullBtn.classList.add("active");
    historyDiffBtn.classList.remove("active");
    renderHistoryView();
  };
}

if (historyDiffBtn) {
  historyDiffBtn.onclick = function() {
    historyMode = "diff";
    historyDiffBtn.classList.add("active");
    historyFullBtn.classList.remove("active");
    renderHistoryView();
  };
}

if (historyRestoreBtn) {
  historyRestoreBtn.onclick = function() {
    if (selectedHistoryIdx < 0 || !historyData[selectedHistoryIdx]) return;
    editor.value = historyData[selectedHistoryIdx].content;
    historyOverlay.classList.add("hidden");
    updateStats();
    markDirty();
    autoGrowEditor();
  };
}

function renderHistoryView() {
  if (selectedHistoryIdx < 0) return;
  var entry = historyData[selectedHistoryIdx];

  if (entry.content === null || entry.content === undefined) {
    historyViewContent.innerHTML = '<div class="history-empty">Content was not recorded for this entry.</div>';
    historyRestoreBtn.style.display = "none";
    return;
  }
  historyRestoreBtn.style.display = "";

  if (historyMode === "full") {
    historyViewContent.innerHTML = '<pre style="margin:0;white-space:pre-wrap;word-break:break-word;color:rgba(255,255,255,0.85);">' + esc(entry.content) + '</pre>';
  } else {
    var prevContent = "";
    for (var p = selectedHistoryIdx - 1; p >= 0; p--) {
      if (historyData[p].content !== null && historyData[p].content !== undefined) {
        prevContent = historyData[p].content;
        break;
      }
    }
    var diffHtml = computeDiff(prevContent, entry.content);
    historyViewContent.innerHTML = diffHtml;
  }
}

// ── LCS-based line diff ──
function computeDiff(oldText, newText) {
  var oldLines = oldText.split("\\n");
  var newLines = newText.split("\\n");
  var m = oldLines.length;
  var n = newLines.length;

  // Build LCS table
  var dp = [];
  for (var i = 0; i <= m; i++) {
    dp[i] = [];
    for (var j = 0; j <= n; j++) {
      if (i === 0 || j === 0) dp[i][j] = 0;
      else if (oldLines[i-1] === newLines[j-1]) dp[i][j] = dp[i-1][j-1] + 1;
      else dp[i][j] = Math.max(dp[i-1][j], dp[i][j-1]);
    }
  }

  // Backtrack to get diff ops
  var ops = [];
  var ci = m, cj = n;
  while (ci > 0 || cj > 0) {
    if (ci > 0 && cj > 0 && oldLines[ci-1] === newLines[cj-1]) {
      ops.push({ type: "same", text: oldLines[ci-1] });
      ci--; cj--;
    } else if (cj > 0 && (ci === 0 || dp[ci][cj-1] >= dp[ci-1][cj])) {
      ops.push({ type: "add", text: newLines[cj-1] });
      cj--;
    } else {
      ops.push({ type: "del", text: oldLines[ci-1] });
      ci--;
    }
  }
  ops.reverse();

  var html = '<div>';
  for (var k = 0; k < ops.length; k++) {
    var op = ops[k];
    var cls = op.type === "same" ? "diff-same" : (op.type === "add" ? "diff-add" : "diff-del");
    var prefix = op.type === "same" ? "  " : (op.type === "add" ? "+ " : "- ");
    html += '<div class="diff-line ' + cls + '">' + esc(prefix + op.text) + '</div>';
  }
  html += '</div>';
  return html;
}

/* ═══════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════ */
loadSettings();
updateStats();
loadNotes();
if (!isNew) lastSaved = editor.value;
autoGrowEditor();
setTimeout(function() { editor.focus(); }, 100);

try {
  var draft = sessionStorage.getItem("tree-editor-draft");
  if (draft && isNew && !editor.value) {
    editor.value = draft;
    sessionStorage.removeItem("tree-editor-draft");
    updateStats();
    markDirty();
    autoGrowEditor();
  }
} catch (e) {}
`;

  return page({
    title: `${isNew ? "New Note" : "Edit Note"} \u00b7 Editor`,
    css,
    body,
    js,
    bare: true,
  });
}
