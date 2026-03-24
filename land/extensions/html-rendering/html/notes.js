/* --------------------------------------------------------- */
/* HTML renderers for notes pages                            */
/* --------------------------------------------------------- */

import mime from "mime-types";
import { getLandUrl } from "../../../canopy/identity.js";
import { baseStyles, backNavStyles } from "./baseStyles.js";
import { escapeHtml, renderMedia } from "./utils.js";

function renderBookNode(node, depth, token, version) {
  const level = Math.min(depth, 5);
  const H = `h${level}`;
  const qs = token ? `?token=${token}&html` : `?html`;

  let html = `
    <section class="book-section depth-${depth}" id="toc-${node.nodeId}">
      <${H}>${escapeHtml(node.nodeName ?? node.nodeId)}</${H}>
  `;

  for (const note of node.notes) {
    const noteUrl = `/api/v1/node/${node.nodeId}/${note.version}/notes/${note.noteId}${qs}`;

    if (note.type === "text") {
      html += `
        <div class="note-content">
          <a href="${noteUrl}" class="note-link">${escapeHtml(note.content)}</a>
        </div>
      `;
    }

    if (note.type === "file") {
      const fileUrl = `/api/v1/uploads/${note.content}${
        token ? `?token=${token}` : ""
      }`;
      const mimeType = mime.lookup(note.content) || "";

      html += `
        <div class="file-container">
          <a href="${noteUrl}" class="note-link file-link">${escapeHtml(note.content)}</a>
          ${renderMedia(fileUrl, mimeType)}
        </div>
      `;
    }
  }

  for (const child of node.children) {
    html += renderBookNode(child, depth + 1, token, version);
  }

  html += `</section>`;
  return html;
}

function renderToc(node, maxDepth, depth = 1, isRoot = false) {
  const children = node.children || [];
  const hasChildren = children.length > 0 && (maxDepth === 0 || isRoot || depth < maxDepth);

  const childList = hasChildren
    ? `<ul class="toc-list">${children.map((c) => renderToc(c, maxDepth, isRoot ? 1 : depth + 1, false)).join("")}</ul>`
    : "";

  if (isRoot) return childList;

  const name = escapeHtml(node.nodeName ?? node.nodeId);
  const link = `<a href="javascript:void(0)" onclick="tocScroll('toc-${node.nodeId}')" class="toc-link">${name}</a>`;

  return `<li>${link}${childList}</li>`;
}

function renderTocBlock(book, maxDepth) {
  const inner = renderToc(book, maxDepth, 1, true);
  return `<nav class="book-toc"><div class="toc-title">Table of Contents</div>${inner}</nav>`;
}

function getBookDepth(node, depth = 0) {
  const children = node.children || [];
  if (children.length === 0) return depth;
  return Math.max(...children.map((c) => getBookDepth(c, depth + 1)));
}

const parseBool = (v) => v === "true";

function normalizeStatusFilters(query) {
  const parse = (v) =>
    v === "true" ? true : v === "false" ? false : undefined;

  const filters = {
    active: parse(query.active),
    trimmed: parse(query.trimmed),
    completed: parse(query.completed),
  };

  const hasAny = Object.values(filters).some((v) => v !== undefined);
  return hasAny ? filters : null;
}

/* --------------------------------------------------------- */
/* Exported render functions                                  */
/* --------------------------------------------------------- */

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

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="theme-color" content="#667eea">
<title>${isNew ? "New Note" : "Edit Note"} · Editor</title>
<style>
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
</style>
</head>
<body>

<!-- Hidden element for measuring text width -->
<div id="textMeasurer"></div>

<!-- ── ZEN EXIT BUTTON (mobile) ─────────────── -->
<button class="zen-exit-btn" id="zenExitBtn" title="Exit Zen Mode">✕</button>

<!-- ── TOOLBAR ──────────────────────────────── -->
<div class="toolbar">
  <a href="/api/v1/node/${nodeId}/${version}/notes${qs}" class="tb-back" id="backBtn">← <span>Notes</span></a>
  <div class="tb-sep"></div>
  <button class="tb-btn" id="sidebarToggle" title="Toggle sidebar">☰</button>
  <button class="tb-btn" id="zenToggle" title="Zen mode">🧘</button>
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
  ${isNew ? "" : '<button class="tb-btn" id="historyToggle" title="Edit history">🕒</button>'}
  <button class="tb-copy" id="copyBtn" title="Copy all text">📋 <span>Copy</span></button>
</div>

<!-- ── MAIN ─────────────────────────────────── -->
<div class="main">

  <!-- SIDEBAR -->
  <div class="sidebar hidden" id="sidebar">
    <div class="sidebar-header">
      <span class="sidebar-title">Notes</span>
      <button class="sidebar-close" id="sidebarCloseBtn">✕</button>
    </div>
    <div class="sidebar-list" id="notesList">
      <div style="text-align:center;padding:20px;color:rgba(255,255,255,0.3);font-size:13px;">Loading…</div>
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
            <textarea id="editor" placeholder="Start writing…">${safeContent}</textarea>
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
    <span class="bb-stat bb-energy" id="energyCost">⚡0</span>
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
    <div class="modal-icon">🗑️</div>
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
      <button class="sidebar-close" id="historyCloseBtn">✕</button>
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

<script>
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
    btn.firstChild.textContent = "✓ ";
    if (btnSpan) btnSpan.textContent = "Copied";
    btn.classList.add("copied");

    setTimeout(function() {
      btn.firstChild.textContent = "📋 ";
      if (btnSpan) btnSpan.textContent = "Copy";
      btn.classList.remove("copied");
    }, 1500);
  }).catch(function() {
    // Fallback for older browsers
    try {
      document.execCommand("copy");
      btn.firstChild.textContent = "✓ ";
      if (btnSpan) btnSpan.textContent = "Copied";
      btn.classList.add("copied");

      setTimeout(function() {
        btn.firstChild.textContent = "📋 ";
        if (btnSpan) btnSpan.textContent = "Copy";
        btn.classList.remove("copied");
      }, 1500);
    } catch (e) {
      if (btnSpan) btnSpan.textContent = "Failed";
      setTimeout(function() {
        btn.firstChild.textContent = "📋 ";
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
   SAVE → POST (new) or PUT (existing)
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

    if (!currentNoteId) {
      var newId = data._id || (data.note && data.note._id);
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
   DELETE → DELETE route
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
    var notes = data.notes || data || [];
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
    historyData = data.history || [];

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
</script>
</body>
</html>`;
}

export function renderBookPage({
  nodeId,
  token,
  title,
  content,
  options,
  tocEnabled,
  tocDepth,
  isStatusActive,
  isStatusCompleted,
  isStatusTrimmed,
  book,
  hasContent,
}) {
  const treeDepth = hasContent ? Math.min(getBookDepth(book), 5) : 0;

  let tocDepthSelect = "";
  if (tocEnabled && hasContent && treeDepth > 1) {
    let opts = `<option value="0" ${tocDepth === 0 ? "selected" : ""}>All Depths</option>`;
    for (let i = 1; i <= treeDepth; i++) {
      opts += `<option value="${i}" ${tocDepth === i ? "selected" : ""}>Depth ${i}${i === 5 ? " (max)" : ""}</option>`;
    }
    tocDepthSelect = `<select class="toc-select" onchange="setTocDepth(this.value)">${opts}</select>`;
  }

  const bookContent = hasContent
    ? renderBookNode(book, 1, token)
    : `
    <div class="empty-state">
      <div class="empty-state-icon">📖</div>
      <div class="empty-state-text">No content</div>
      <div class="empty-state-subtext">
        This node has no notes or child notes under the current filters.
      </div>
    </div>
  `;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>Book: ${escapeHtml(title)}</title>
  <style>
    ${baseStyles}

    /* ── Book page overrides on base ── */
    body { padding: 0; }

    /* Top Navigation Bar - Glass */
    .top-nav {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      padding: 10px 20px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      border-bottom: 1px solid rgba(255, 255, 255, 0.28);
      position: sticky;
      top: 0;
      z-index: 100;
      animation: fadeInUp 0.5s ease-out;
    }

    .top-nav-content {
      max-width: 900px;
      margin: 0 auto;
    }

    .nav-buttons {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 4px;
    }

    .nav-left {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    /* Glass Navigation Buttons */
    .nav-button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(10px);
      color: white;
      text-decoration: none;
      border-radius: 980px;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.3s;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.3);
      position: relative;
      overflow: hidden;
      cursor: pointer;
      touch-action: manipulation;
    }

    .nav-button::before {
      content: "";
      position: absolute;
      inset: -40%;
      background: radial-gradient(
        120% 60% at 0% 0%,
        rgba(255, 255, 255, 0.35),
        transparent 60%
      );
      opacity: 0;
      transform: translateX(-30%) translateY(-10%);
      transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      pointer-events: none;
    }

    .nav-button:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
    }

    .nav-button:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

    .page-title {
      font-size: 20px;
      font-weight: 600;
      color: white;
      margin-bottom: 12px;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      letter-spacing: -0.3px;
    }

    /* Glass Filter Buttons */
    .filters {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .filter-button {
      padding: 8px 14px;
      font-size: 13px;
      font-weight: 600;
      border-radius: 980px;
      border: 1px solid rgba(255, 255, 255, 0.25);
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(10px);
      color: white;
      cursor: pointer;
      transition: all 0.3s;
      font-family: inherit;
      white-space: nowrap;
      position: relative;
      overflow: hidden;
    }

    .filter-button::before {
      content: "";
      position: absolute;
      inset: -40%;
      background: radial-gradient(
        120% 60% at 0% 0%,
        rgba(255, 255, 255, 0.35),
        transparent 60%
      );
      opacity: 0;
      transform: translateX(-30%) translateY(-10%);
      transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      pointer-events: none;
    }

    .filter-button:hover {
      background: rgba(255, 255, 255, 0.25);
      transform: translateY(-1px);
    }

    .filter-button:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

    .filter-button.active {
      background: rgba(255, 255, 255, 0.35);
      border-color: rgba(255, 255, 255, 0.5);
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.15),
        inset 0 1px 0 rgba(255, 255, 255, 0.4);
    }

    .filter-button.active:hover {
      background: rgba(255, 255, 255, 0.45);
      transform: translateY(-2px);
      box-shadow: 0 6px 25px rgba(0, 0, 0, 0.2);
    }

    .toc-select {
      padding: 8px 14px;
      font-size: 13px;
      font-weight: 600;
      border-radius: 980px;
      border: 1px solid rgba(255, 255, 255, 0.25);
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(10px);
      color: white;
      cursor: pointer;
      font-family: inherit;
      appearance: none;
      -webkit-appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='white' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 12px center;
      padding-right: 30px;
    }

    .toc-select option {
      background: #5a56c4;
      color: white;
    }

    /* Content Container */
    .content-wrapper {
      padding: 24px 20px;
    }

    .content {
      max-width: 900px;
      margin: 0 auto;
      font-family: "Charter", "Georgia", "Iowan Old Style", "Times New Roman", serif;
      line-height: 1.7;
      word-wrap: break-word;
      overflow-wrap: break-word;
      animation: fadeInUp 0.6s ease-out 0.1s both;
    }

    /* Layered Glass Sections - Each depth gets more opaque glass */
    .book-section {
      margin-bottom: 40px;
      position: relative;
    }

    .book-section.depth-1 {
      margin-bottom: 48px;
      padding: 24px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
    }

    .book-section.depth-2 {
      margin-bottom: 32px;
      margin-left: 8px;
      padding: 20px;
      background: rgba(255, 255, 255, 0.06);
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.12);
    }

    .book-section.depth-3 {
      margin-bottom: 24px;
      margin-left: 8px;
      padding: 16px;
      background: rgba(255, 255, 255, 0.04);
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .book-section.depth-4 {
      margin-bottom: 20px;
      margin-left: 8px;
      padding: 12px;
      background: rgba(255, 255, 255, 0.03);
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.08);
    }

    .book-section.depth-5 {
      margin-bottom: 16px;
      margin-left: 8px;
      padding: 10px;
      background: rgba(255, 255, 255, 0.02);
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.06);
    }

    /* Heading Hierarchy */
    h1, h2, h3, h4, h5 {
      font-weight: 600;
      line-height: 1.3;
      margin: 0 0 16px 0;
      color: white;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      letter-spacing: -0.5px;
    }

    h1 {
      font-size: 36px;
      margin-top: 48px;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 2px solid rgba(255, 255, 255, 0.3);
    }

    .book-section.depth-1:first-child h1 {
      margin-top: 0;
    }

    h2 {
      font-size: 30px;
      margin-top: 40px;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.2);
    }

    h3 {
      font-size: 24px;
      margin-top: 32px;
      margin-bottom: 16px;
    }

    h4 {
      font-size: 20px;
      margin-top: 24px;
      margin-bottom: 12px;
    }

    h5 {
      font-size: 18px;
      margin-top: 20px;
      margin-bottom: 10px;
    }

    /* Note Content - Glowing Text */
    .note-content {
      margin: 16px 0 28px 0;
      padding: 0;
      font-size: 18px;
      line-height: 1.8;
      color: white;
      word-wrap: break-word;
      overflow-wrap: break-word;
      font-weight: 400;
    }

    .note-link {
      color: inherit;
      text-decoration: none;
      white-space: pre-wrap;
      word-wrap: break-word;
      overflow-wrap: break-word;
      display: block;
      padding: 12px 16px;
      margin: -12px -16px;
      border-radius: 8px;
      transition: all 0.3s;
      position: relative;
      overflow: hidden;
    }

    .note-link::before {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(
        110deg,
        transparent 40%,
        rgba(255, 255, 255, 0.2),
        transparent 60%
      );
      opacity: 0;
      transform: translateX(-100%);
      pointer-events: none;
    }

    .note-link:hover {
      background-color: rgba(255, 255, 255, 0.1);
      transform: translateX(4px);
    }

    .note-link:hover::before {
      opacity: 1;
      animation: glassShimmer 1s ease forwards;
    }

    @keyframes glassShimmer {
      0% {
        opacity: 0;
        transform: translateX(-120%) skewX(-15deg);
      }
      50% {
        opacity: 1;
      }
      100% {
        opacity: 0;
        transform: translateX(120%) skewX(-15deg);
      }
    }

    .note-link:active {
      background-color: rgba(255, 255, 255, 0.15);
    }

    /* File Containers - Deeper Glass */
    .file-container {
      margin: 24px 0;
      padding: 20px;
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(18px);
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 12px;
      transition: all 0.3s;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
    }

    .file-container:hover {
      border-color: rgba(255, 255, 255, 0.5);
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
      background: rgba(255, 255, 255, 0.2);
    }

    .file-container .note-link {
      display: inline-block;
      margin-bottom: 12px;
      color: white;
      font-size: 16px;
      font-weight: 600;
      padding: 4px 8px;
      margin: -4px -8px 8px;
    }

    .file-container .note-link:hover {
      background-color: rgba(255, 255, 255, 0.15);
      text-decoration: underline;
    }

    /* Media Elements */
    img {
      max-width: 100%;
      height: auto;
      border-radius: 8px;
      margin-top: 12px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    video, audio {
      max-width: 100%;
      margin-top: 12px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    iframe {
      width: 100%;
      height: 600px;
      border: none;
      border-radius: 8px;
      margin-top: 12px;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    /* Empty State */
    .empty-state {
      text-align: center;
      padding: 80px 40px;
    }

    .empty-state-icon {
      font-size: 64px;
      margin-bottom: 16px;
      filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.2));
    }

    .empty-state-text {
      font-size: 24px;
      color: white;
      margin-bottom: 8px;
      font-weight: 600;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    .empty-state-subtext {
      font-size: 16px;
      color: rgba(255, 255, 255, 0.8);
    }

    /* Responsive Design */
    @media (max-width: 1024px) {
    }

    @media (max-width: 768px) {
      .top-nav {
        padding: 12px 16px;
      }

      .nav-button {
        padding: 8px 12px;
        font-size: 13px;
      }

      .page-title {
        font-size: 18px;
      }

      .filter-button {
        padding: 6px 12px;
        font-size: 12px;
      }

      .content-wrapper {
        padding: 24px 16px;
      }

      h1 {
        font-size: 30px;
      }

      h2 {
        font-size: 26px;
      }

      h3 {
        font-size: 22px;
      }

      h4 {
        font-size: 19px;
      }

      h5 {
        font-size: 17px;
      }

      .note-content {
        font-size: 17px;
      }

      .book-section.depth-2,
      .book-section.depth-3,
      .book-section.depth-4,
      .book-section.depth-5 {
        margin-left: 4px;
      }
    }

    @media (max-width: 480px) {
      .nav-buttons {
        flex-direction: column;
        align-items: stretch;
      }

      .nav-left {
        width: 100%;
        flex-direction: column;
      }

      .nav-button {
        justify-content: center;
        width: 100%;
      }

      .book-section.depth-1,
      .book-section.depth-2,
      .book-section.depth-3,
      .book-section.depth-4,
      .book-section.depth-5 {
        margin-left: 0;
        padding: 12px;
      }
    }

    html { scroll-behavior: smooth; }

    .book-toc {
      max-width: 900px;
      margin: 20px auto 24px;
      padding: 20px 28px;
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      border: 1px solid rgba(255, 255, 255, 0.28);
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
    }

    .toc-title {
      font-size: 18px;
      font-weight: 700;
      color: white;
      margin-bottom: 10px;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    .toc-list {
      list-style: none;
      padding-left: 18px;
      margin: 0;
    }

    .book-toc > .toc-list {
      padding-left: 0;
    }

    .book-toc li {
      margin: 2px 0;
    }

    .toc-link {
      display: inline-block;
      color: white;
      text-decoration: none;
      padding: 3px 0;
      font-size: 15px;
      font-weight: 500;
      transition: opacity 0.2s;
    }

    .toc-link:hover {
      opacity: 0.7;
      text-decoration: underline;
    }

    .book-toc > .toc-list > li > .toc-link {
      font-weight: 700;
      font-size: 16px;
    }
  </style>
</head>
<body>
  <!-- Top Navigation -->
  <div class="top-nav">
    <div class="top-nav-content">
      <div class="nav-buttons">
        <div class="nav-left">
          <a href="/api/v1/root/${nodeId}?token=${token ?? ""}&html" class="nav-button">
            ← Back to Tree
          </a>

        </div>
        <button class="nav-button" onclick="generateShare()">
          🔗 Generate Share Link
        </button>
      </div>

<div class="page-title">Book: ${escapeHtml(title)}</div>

      <!-- Filters -->
      <div class="filters">
        <button onclick="toggleFlag('latestVersionOnly')" class="filter-button ${
          options.latestVersionOnly ? "active" : ""
        }">
          Latest Versions Only
        </button>
        <button onclick="toggleFlag('lastNoteOnly')" class="filter-button ${
          options.lastNoteOnly ? "active" : ""
        }">
          Most Recent Note
        </button>
        <button onclick="toggleFlag('leafNotesOnly')" class="filter-button ${
          options.leafNotesOnly ? "active" : ""
        }">
          Leaf Details Only
        </button>
        <button onclick="toggleFlag('filesOnly')" class="filter-button ${
          options.filesOnly ? "active" : ""
        }">
          Files Only
        </button>
        <button onclick="toggleFlag('textOnly')" class="filter-button ${
          options.textOnly ? "active" : ""
        }">
          Text Only
        </button>
        <button onclick="toggleStatus('active')" class="filter-button ${
          isStatusActive ? "active" : ""
        }">
          Active
        </button>
        <button onclick="toggleStatus('completed')" class="filter-button ${
          isStatusCompleted ? "active" : ""
        }">
          Completed
        </button>
        <button onclick="toggleStatus('trimmed')" class="filter-button ${
          isStatusTrimmed ? "active" : ""
        }">
          Trimmed
        </button>
        <button onclick="toggleFlag('toc')" class="filter-button ${
          tocEnabled ? "active" : ""
        }">
          Table of Contents
        </button>
        ${tocDepthSelect}
      </div>
    </div>
  </div>

  <!-- Content -->
  <div class="content-wrapper">
    ${tocEnabled && hasContent ? renderTocBlock(book, tocDepth) : ""}
    <div class="content">
      ${bookContent}
    </div>
  </div>

  <script>
    function tocScroll(id) {
      var el = document.getElementById(id);
      if (!el) return;
      var nav = document.querySelector('.top-nav');
      var offset = nav ? nav.offsetHeight + 12 : 12;
      var top = el.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: top, behavior: 'smooth' });
    }
  </script>

  <!-- Lazy Media Loader -->
  <script>
    const lazyObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;

          const el = entry.target;
          const src = el.dataset.src;

          if (src) {
            el.src = src;
            el.removeAttribute("data-src");
          }

          observer.unobserve(el);
        });
      },
      { rootMargin: "200px" }
    );

    document
      .querySelectorAll(".lazy-media[data-src]")
      .forEach(el => lazyObserver.observe(el));
  </script>

  <script>
    function toggleFlag(flag) {
      const url = new URL(window.location.href);

      if (url.searchParams.has(flag)) {
        url.searchParams.delete(flag);
      } else {
        url.searchParams.set(flag, "true");
      }

      url.searchParams.set("html", "true");
      window.location.href = url.toString();
    }

    function toggleStatus(flag) {
      const url = new URL(window.location.href);
      const params = url.searchParams;

      const defaults = {
        active: true,
        completed: true,
        trimmed: false,
      };

      const current = params.has(flag)
        ? params.get(flag) === "true"
        : defaults[flag];

      const next = !current;

      if (next === defaults[flag]) {
        params.delete(flag);
      } else {
        params.set(flag, String(next));
      }

      params.set("html", "true");
      window.location.href = url.toString();
    }

    async function generateShare() {
      const params = Object.fromEntries(new URLSearchParams(window.location.search));
      const res = await fetch(window.location.pathname + "/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });

      const data = await res.json();
      if (data.redirect) {
        window.location.href = data.redirect;
      }
    }

    function setTocDepth(val) {
      const url = new URL(window.location.href);
      if (val === "0") {
        url.searchParams.delete("tocDepth");
      } else {
        url.searchParams.set("tocDepth", val);
      }
      url.searchParams.set("html", "true");
      window.location.href = url.toString();
    }
  </script>

</body>
</html>
  `;
}

export function renderSharedBookPage({
  nodeId,
  title,
  content,
  shareTocEnabled,
  shareTocDepth,
  book,
  hasContent,
}) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Book: ${escapeHtml(title)} - TreeOS</title>
  <meta name="description" content="Book view of ${escapeHtml(title)} on TreeOS." />
  <meta property="og:title" content="Book: ${escapeHtml(title)} - TreeOS" />
  <meta property="og:description" content="Book view of ${escapeHtml(title)} on TreeOS." />
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="TreeOS" />
  <meta property="og:image" content="${getLandUrl()}/tree.png" />
  <style>
    ${baseStyles}

    /* ── Shared book page overrides on base ── */
    body { padding: 0; }

    /* Top Navigation Bar - Glass */
    .top-nav {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      padding: 10px 20px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      border-bottom: 1px solid rgba(255, 255, 255, 0.28);
      position: sticky;
      top: 0;
      z-index: 100;
      animation: fadeInUp 0.5s ease-out;
    }

    .top-nav-content {
      max-width: 900px;
      margin: 0 auto;
    }

    .nav-buttons {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: nowrap;
    }

    /* Glass Navigation Buttons */
    .nav-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 8px 10px;
      flex: 1;
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(10px);
      color: white;
      text-decoration: none;
      border-radius: 980px;
      font-weight: 600;
      font-size: 13px;
      white-space: nowrap;
      transition: all 0.3s;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.3);
      position: relative;
      overflow: hidden;
      cursor: pointer;
      touch-action: manipulation;
    }

    .nav-button::before {
      content: "";
      position: absolute;
      inset: -40%;
      background: radial-gradient(
        120% 60% at 0% 0%,
        rgba(255, 255, 255, 0.35),
        transparent 60%
      );
      opacity: 0;
      transform: translateX(-30%) translateY(-10%);
      transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      pointer-events: none;
    }

    .nav-button:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
    }

    .nav-button:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

    .page-title {
      font-size: 20px;
      font-weight: 600;
      color: white;
      margin-bottom: 12px;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      letter-spacing: -0.3px;
    }

    /* Glass Filter Buttons */
    .filters {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .filter-button {
      padding: 8px 14px;
      font-size: 13px;
      font-weight: 600;
      border-radius: 980px;
      border: 1px solid rgba(255, 255, 255, 0.25);
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(10px);
      color: white;
      cursor: pointer;
      transition: all 0.3s;
      font-family: inherit;
      white-space: nowrap;
      position: relative;
      overflow: hidden;
    }

    .filter-button::before {
      content: "";
      position: absolute;
      inset: -40%;
      background: radial-gradient(
        120% 60% at 0% 0%,
        rgba(255, 255, 255, 0.35),
        transparent 60%
      );
      opacity: 0;
      transform: translateX(-30%) translateY(-10%);
      transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      pointer-events: none;
    }

    .filter-button:hover {
      background: rgba(255, 255, 255, 0.25);
      transform: translateY(-1px);
    }

    .filter-button:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

    .filter-button.active {
      background: rgba(255, 255, 255, 0.35);
      border-color: rgba(255, 255, 255, 0.5);
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.15),
        inset 0 1px 0 rgba(255, 255, 255, 0.4);
    }

    .filter-button.active:hover {
      background: rgba(255, 255, 255, 0.45);
      transform: translateY(-2px);
      box-shadow: 0 6px 25px rgba(0, 0, 0, 0.2);
    }

    .toc-select {
      padding: 8px 14px;
      font-size: 13px;
      font-weight: 600;
      border-radius: 980px;
      border: 1px solid rgba(255, 255, 255, 0.25);
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(10px);
      color: white;
      cursor: pointer;
      font-family: inherit;
      appearance: none;
      -webkit-appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='white' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 12px center;
      padding-right: 30px;
    }

    .toc-select option {
      background: #5a56c4;
      color: white;
    }

    /* Content Container */
    .content-wrapper {
      padding: 24px 20px;
    }

    .content {
      max-width: 900px;
      margin: 0 auto;
      font-family: "Charter", "Georgia", "Iowan Old Style", "Times New Roman", serif;
      line-height: 1.7;
      word-wrap: break-word;
      overflow-wrap: break-word;
      animation: fadeInUp 0.6s ease-out 0.1s both;
    }

    /* Layered Glass Sections - Each depth gets more opaque glass */
    .book-section {
      margin-bottom: 40px;
      position: relative;
    }

    .book-section.depth-1 {
      margin-bottom: 48px;
      padding: 24px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
    }

    .book-section.depth-2 {
      margin-bottom: 32px;
      margin-left: 8px;
      padding: 20px;
      background: rgba(255, 255, 255, 0.06);
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.12);
    }

    .book-section.depth-3 {
      margin-bottom: 24px;
      margin-left: 8px;
      padding: 16px;
      background: rgba(255, 255, 255, 0.04);
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .book-section.depth-4 {
      margin-bottom: 20px;
      margin-left: 8px;
      padding: 12px;
      background: rgba(255, 255, 255, 0.03);
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.08);
    }

    .book-section.depth-5 {
      margin-bottom: 16px;
      margin-left: 8px;
      padding: 10px;
      background: rgba(255, 255, 255, 0.02);
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.06);
    }

    /* Heading Hierarchy */
    h1, h2, h3, h4, h5 {
      font-weight: 600;
      line-height: 1.3;
      margin: 0 0 16px 0;
      color: white;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      letter-spacing: -0.5px;
    }

    h1 {
      font-size: 36px;
      margin-top: 48px;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 2px solid rgba(255, 255, 255, 0.3);
    }

    .book-section.depth-1:first-child h1 {
      margin-top: 0;
    }

    h2 {
      font-size: 30px;
      margin-top: 40px;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.2);
    }

    h3 {
      font-size: 24px;
      margin-top: 32px;
      margin-bottom: 16px;
    }

    h4 {
      font-size: 20px;
      margin-top: 24px;
      margin-bottom: 12px;
    }

    h5 {
      font-size: 18px;
      margin-top: 20px;
      margin-bottom: 10px;
    }

    /* Note Content - Glowing Text */
    .note-content {
      margin: 16px 0 28px 0;
      padding: 0;
      font-size: 18px;
      line-height: 1.8;
      color: #F5F5DC;
      word-wrap: break-word;
      overflow-wrap: break-word;
      font-weight: 400;
    }

    .note-link {
      color: inherit;
      text-decoration: none;
      white-space: pre-wrap;
      word-wrap: break-word;
      overflow-wrap: break-word;
      display: block;
      padding: 12px 16px;
      margin: -12px -16px;
      border-radius: 8px;
      transition: all 0.3s;
      position: relative;
      overflow: hidden;
    }

    .note-link::before {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(
        110deg,
        transparent 40%,
        rgba(255, 255, 255, 0.2),
        transparent 60%
      );
      opacity: 0;
      transform: translateX(-100%);
      pointer-events: none;
    }

    .note-link:hover {
      background-color: rgba(255, 255, 255, 0.1);
      transform: translateX(4px);
    }

    .note-link:hover::before {
      opacity: 1;
      animation: glassShimmer 1s ease forwards;
    }

    @keyframes glassShimmer {
      0% {
        opacity: 0;
        transform: translateX(-120%) skewX(-15deg);
      }
      50% {
        opacity: 1;
      }
      100% {
        opacity: 0;
        transform: translateX(120%) skewX(-15deg);
      }
    }

    .note-link:active {
      background-color: rgba(255, 255, 255, 0.15);
    }

    /* File Containers - Deeper Glass */
    .file-container {
      margin: 24px 0;
      padding: 20px;
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(18px);
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 12px;
      transition: all 0.3s;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
    }

    .file-container:hover {
      border-color: rgba(255, 255, 255, 0.5);
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
      background: rgba(255, 255, 255, 0.2);
    }

    .file-container .note-link {
      display: inline-block;
      margin-bottom: 12px;
      color: white;
      font-size: 16px;
      font-weight: 600;
      padding: 4px 8px;
      margin: -4px -8px 8px;
    }

    .file-container .note-link:hover {
      background-color: rgba(255, 255, 255, 0.15);
      text-decoration: underline;
    }

    /* Media Elements */
    img {
      max-width: 100%;
      height: auto;
      border-radius: 8px;
      margin-top: 12px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    video, audio {
      max-width: 100%;
      margin-top: 12px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    iframe {
      width: 100%;
      height: 600px;
      border: none;
      border-radius: 8px;
      margin-top: 12px;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    /* Empty State */
    .empty-state {
      text-align: center;
      padding: 80px 40px;
    }

    .empty-state-icon {
      font-size: 64px;
      margin-bottom: 16px;
      filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.2));
    }

    .empty-state-text {
      font-size: 24px;
      color: white;
      margin-bottom: 8px;
      font-weight: 600;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    .empty-state-subtext {
      font-size: 16px;
      color: rgba(255, 255, 255, 0.8);
    }

    /* Responsive Design */
    @media (max-width: 1024px) {
    }

    @media (max-width: 768px) {
      .top-nav {
        padding: 12px 16px;
      }

      .nav-button {
        padding: 8px 12px;
        font-size: 13px;
      }

      .page-title {
        font-size: 18px;
      }

      .filter-button {
        padding: 6px 12px;
        font-size: 12px;
      }

      .content-wrapper {
        padding: 24px 16px;
      }

      h1 {
        font-size: 30px;
      }

      h2 {
        font-size: 26px;
      }

      h3 {
        font-size: 22px;
      }

      h4 {
        font-size: 19px;
      }

      h5 {
        font-size: 17px;
      }

      .note-content {
        font-size: 17px;
      }

      .book-section.depth-2,
      .book-section.depth-3,
      .book-section.depth-4,
      .book-section.depth-5 {
        margin-left: 4px;
      }
    }

    @media (max-width: 480px) {
      .nav-button {
        padding: 8px 6px;
        font-size: 11px;
        gap: 2px;
      }

      .book-section.depth-1,
      .book-section.depth-2,
      .book-section.depth-3,
      .book-section.depth-4,
      .book-section.depth-5 {
        margin-left: 0;
        padding: 12px;
      }
    }

    html { scroll-behavior: smooth; }

    .book-toc {
      max-width: 900px;
      margin: 20px auto 24px;
      padding: 20px 28px;
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      border: 1px solid rgba(255, 255, 255, 0.28);
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
    }

    .toc-title {
      font-size: 18px;
      font-weight: 700;
      color: white;
      margin-bottom: 10px;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    .toc-list {
      list-style: none;
      padding-left: 18px;
      margin: 0;
    }

    .book-toc > .toc-list {
      padding-left: 0;
    }

    .book-toc li {
      margin: 2px 0;
    }

    .toc-link {
      display: inline-block;
      color: white;
      text-decoration: none;
      padding: 3px 0;
      font-size: 15px;
      font-weight: 500;
      transition: opacity 0.2s;
    }

    .toc-link:hover {
      opacity: 0.7;
      text-decoration: underline;
    }

    .book-toc > .toc-list > li > .toc-link {
      font-weight: 700;
      font-size: 16px;
    }

    .share-book-title {
      max-width: 900px;
      margin: 24px auto 0;
      font-size: 28px;
      font-weight: 700;
      color: white;
      text-shadow: 0 2px 12px rgba(0, 0, 0, 0.2);
      text-align: center;
    }

    /* Title toggle active state */
    .nav-button.active {
      background: rgba(255, 255, 255, 0.4);
      border-color: rgba(255, 255, 255, 0.5);
    }

    /* Hide titles mode */
    #bookContent.hide-titles h1,
    #bookContent.hide-titles h2,
    #bookContent.hide-titles h3,
    #bookContent.hide-titles h4,
    #bookContent.hide-titles h5 {
      display: none;
    }

    /* TOC scroll-to-top circle */
    .toc-top-btn {
      position: fixed;
      top: 60px;
      right: 16px;
      z-index: 200;
      width: 42px;
      height: 42px;
      border-radius: 50%;
      border: 1px solid rgba(255, 255, 255, 0.3);
      background: rgba(var(--glass-water-rgb), 0.5);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      color: white;
      font-size: 18px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s, transform 0.3s;
      touch-action: manipulation;
    }

    .toc-top-btn.visible {
      opacity: 1;
      pointer-events: auto;
    }

    .toc-top-btn:hover {
      background: rgba(var(--glass-water-rgb), 0.7);
      transform: scale(1.1);
    }
  </style>
</head>
<body>
  <!-- Share Nav -->
  <div class="top-nav">
    <div class="top-nav-content">
      <div class="nav-buttons">
        <a href="/" class="nav-button" onclick="event.preventDefault();window.top.location.href='/';">Home</a>
        <button class="nav-button" id="copyUrlBtn">Copy URL</button>
        <button class="nav-button" id="copyTextBtn">Copy Text</button>
        <button class="nav-button" id="toggleTitlesBtn" onclick="toggleTitles()" title="Toggle Titles">Aa</button>
      </div>
    </div>
  </div>

  ${shareTocEnabled && hasContent ? `<button class="toc-top-btn" id="tocTopBtn" onclick="window.scrollTo({top:0,behavior:'smooth'})">&#9650;</button>` : ""}

  <!-- Content -->
  <div class="content-wrapper">
    ${shareTocEnabled && hasContent ? `<div class="share-book-title">${escapeHtml(title)}</div>${renderTocBlock(book, shareTocDepth)}` : ""}
    <div class="content" id="bookContent">
      ${content}
    </div>
  </div>

  <script>
    function tocScroll(id) {
      var el = document.getElementById(id);
      if (!el) return;
      var nav = document.querySelector('.top-nav');
      var offset = nav ? nav.offsetHeight + 12 : 12;
      var top = el.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: top, behavior: 'smooth' });
    }

    function toggleTitles() {
      var bc = document.getElementById('bookContent');
      var btn = document.getElementById('toggleTitlesBtn');
      bc.classList.toggle('hide-titles');
      if (bc.classList.contains('hide-titles')) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }

    ${shareTocEnabled && hasContent ? `
    (function() {
      var tocBtn = document.getElementById('tocTopBtn');
      if (!tocBtn) return;
      window.addEventListener('scroll', function() {
        if (window.scrollY > 200) {
          tocBtn.classList.add('visible');
        } else {
          tocBtn.classList.remove('visible');
        }
      }, { passive: true });
    })();
    ` : ""}
  </script>

  <!-- Lazy Media Loader -->
  <script>
    document.getElementById("copyUrlBtn").addEventListener("click", function() {
      var url = new URL(window.location.href);
      url.searchParams.delete("token");
      if (!url.searchParams.has("html")) url.searchParams.set("html", "");
      navigator.clipboard.writeText(url.toString()).then(function() {
        this.textContent = "Copied";
        setTimeout(function() { document.getElementById("copyUrlBtn").textContent = "Copy URL"; }, 900);
      }.bind(this));
    });

    document.getElementById("copyTextBtn").addEventListener("click", function() {
      var text = document.getElementById("bookContent").innerText;
      navigator.clipboard.writeText(text).then(function() {
        document.getElementById("copyTextBtn").textContent = "Copied";
        setTimeout(function() { document.getElementById("copyTextBtn").textContent = "Copy Text"; }, 900);
      });
    });

    const lazyObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;

          const el = entry.target;
          const src = el.dataset.src;

          if (src) {
            el.src = src;
            el.removeAttribute("data-src");
          }

          observer.unobserve(el);
        });
      },
      { rootMargin: "200px" }
    );

    document
      .querySelectorAll(".lazy-media[data-src]")
      .forEach(el => lazyObserver.observe(el));
  </script>

  <script>
    function toggleFlag(flag) {
      const url = new URL(window.location.href);

      if (url.searchParams.has(flag)) {
        url.searchParams.delete(flag);
      } else {
        url.searchParams.set(flag, "true");
      }

      url.searchParams.set("html", "true");
      window.location.href = url.toString();
    }

    function toggleStatus(flag) {
      const url = new URL(window.location.href);
      const params = url.searchParams;

      const defaults = {
        active: true,
        completed: true,
        trimmed: false,
      };

      const current = params.has(flag)
        ? params.get(flag) === "true"
        : defaults[flag];

      const next = !current;

      if (next === defaults[flag]) {
        params.delete(flag);
      } else {
        params.set(flag, String(next));
      }

      params.set("html", "true");
      window.location.href = url.toString();
    }

    async function generateShare() {
      const params = Object.fromEntries(new URLSearchParams(window.location.search));
      const res = await fetch(window.location.pathname + "/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });

      const data = await res.json();
      if (data.redirect) {
        window.location.href = data.redirect;
      }
    }
  </script>

</body>
</html>
  `;
}

export function renderNotesList({
  nodeId,
  version,
  token,
  nodeName,
  notes,
  currentUserId,
}) {
  const base = `/api/v1/node/${nodeId}/${version}`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>${escapeHtml(nodeName)} — Notes</title>
  <style>
${baseStyles}

/* ── Notes list overrides on base ── */
body {
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
  min-height: auto;
}

/* Glass Top Navigation */
.top-nav {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  padding: 16px 20px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border-bottom: 1px solid rgba(255, 255, 255, 0.28);
  flex-shrink: 0;
}

.top-nav-content {
  max-width: 900px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.nav-left {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

/* Glass Navigation Buttons */
.nav-button,
.book-button {
  position: relative;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  border-radius: 980px;
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  color: white;
  text-decoration: none;
  font-size: 15px;
  font-weight: 500;
  letter-spacing: -0.2px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  cursor: pointer;
  transition: background 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.3s ease;
  white-space: nowrap;
}

.nav-button::before,
.book-button::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(
      120% 60% at 0% 0%,
      rgba(255, 255, 255, 0.35),
      transparent 60%
    ),
    linear-gradient(
      120deg,
      transparent 30%,
      rgba(255, 255, 255, 0.25),
      transparent 70%
    );
  opacity: 0;
  transform: translateX(-30%) translateY(-10%);
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.nav-button:hover,
.book-button:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-1px);
  animation: waterDrift 2.2s ease-in-out infinite alternate;
}

.nav-button:hover::before,
.book-button:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

@keyframes waterDrift {
  0% { transform: translateY(-1px); }
  100% { transform: translateY(1px); }
}

.book-button {
  --glass-alpha: 0.34;
  --glass-alpha-hover: 0.46;
  font-weight: 600;
}

.page-title {
  width: 100%;
  margin-top: 12px;
  font-size: 18px;
  font-weight: 600;
  color: white;
  letter-spacing: -0.3px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.page-title a {
  color: white;
  text-decoration: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.3);
  transition: all 0.2s;
}

.page-title a:hover {
  border-bottom-color: white;
  text-shadow: 0 0 8px rgba(255, 255, 255, 0.8);
}

/* Notes Container */
.notes-container {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  position: relative;
  z-index: 1;
}

.notes-wrapper {
  max-width: 900px;
  margin: 0 auto;
  width: 100%;
}

.notes-list {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Glass Note Messages */
.note-item {
  display: flex;
  animation: slideIn 0.3s ease-out;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.note-item.self {
  flex-direction: row-reverse;
}

.note-bubble {
  position: relative;
  max-width: 70%;
  padding: 14px 18px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.28);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  color: white;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

/* Self messages - slightly more opaque */
.note-item.self .note-bubble {
  background: rgba(255, 255, 255, 0.2);
}

/* Reflection messages - golden tint */
.note-item.reflection .note-bubble {
  background: rgba(255, 215, 79, 0.25);
  border-color: rgba(255, 215, 79, 0.4);
  box-shadow: 0 4px 16px rgba(255, 193, 7, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
}

.file-badge {
  display: inline-block;
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.note-author {
  font-weight: 600;
  margin-bottom: 6px;
  font-size: 13px;
  opacity: 0.85;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  letter-spacing: -0.2px;
}

.note-author a {
  color: inherit;
  text-decoration: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.3);
}

.note-author a:hover {
  border-bottom-color: white;
}

.note-item.self .note-author {
  display: none;
}

.note-content {
  font-size: 15px;
  line-height: 1.5;
  margin-bottom: 6px;
  font-weight: 400;
}

.note-content a {
  color: inherit;
  text-decoration: none;
}

.note-content a:hover {
  text-shadow: 0 0 8px rgba(255, 255, 255, 0.8);
}

.note-meta {
  font-size: 11px;
  opacity: 0.7;
  margin-top: 6px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.delete-button {
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 50%;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  opacity: 0.7;
  transition: all 0.2s;
  font-size: 12px;
  color: white;
}

/* Character counter */
.char-counter {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  margin-top: 6px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  font-weight: 500;
  transition: color 0.2s;
}

.char-counter.warning {
  color: rgba(255, 193, 7, 0.9);
}

.char-counter.danger {
  color: rgba(239, 68, 68, 0.9);
  font-weight: 600;
}

.char-counter.disabled {
  opacity: 0.4;
}

/* Energy display (shared between text and file) */
.energy-display {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 10px;
  padding: 2px 8px;
  background: rgba(255, 215, 79, 0.2);
  border: 1px solid rgba(255, 215, 79, 0.3);
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 215, 79, 1);
  transition: all 0.2s;
}

.energy-display:empty {
  display: none;
}

.energy-display.file-energy {
  background: rgba(255, 220, 100, 0.9);
  border-color: rgba(255, 200, 50, 1);
  color: #1a1a1a;
  font-size: 13px;
  font-weight: 700;
  padding: 4px 12px;
  box-shadow: 0 2px 8px rgba(255, 200, 50, 0.4);
}

/* File selected indicator */
.file-selected-badge {
  display: none;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 20px;
  font-size: 12px;
  font-weight: 500;
  color: white;
}

.file-selected-badge.visible {
  display: inline-flex;
}

.file-selected-badge .file-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-selected-badge .clear-file {
  background: rgba(255, 255, 255, 0.2);
  border: none;
  border-radius: 50%;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 10px;
  color: white;
  transition: all 0.2s;
}

.file-selected-badge .clear-file:hover {
  background: rgba(239, 68, 68, 0.4);
}

@keyframes fadeIn {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}

.delete-button:hover {
  opacity: 1;
  background: rgba(239, 68, 68, 0.3);
  border-color: rgba(239, 68, 68, 0.5);
  transform: scale(1.1);
}

/* Glass Input Bar */
.input-bar {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  padding: 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.28);
  box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  flex-shrink: 0;
}

.input-form {
  max-width: 900px;
  margin: 0 auto;
}

textarea {
  width: 100%;
  padding: 14px 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 12px;
  font-family: inherit;
  font-size: 16px;
  line-height: 1.5;
  resize: none;
  transition: all 0.3s;
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
  color: white;
  font-weight: 500;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  height: 56px;
  max-height: 120px;
  overflow-y: hidden;
}

textarea::placeholder {
  color: rgba(255, 255, 255, 0.5);
}

textarea:focus {
  outline: none;
  border-color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.25);
  box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.15),
    0 8px 30px rgba(0, 0, 0, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.4);
  transform: translateY(-2px);
}

textarea:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  background: rgba(255, 255, 255, 0.08);
  transform: none;
}

textarea:disabled::placeholder {
  color: rgba(255, 255, 255, 0.3);
}

.input-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.input-options {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

input[type="file"] {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.9);
  cursor: pointer;
}

input[type="file"]::file-selector-button {
  padding: 8px 16px;
  border-radius: 980px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(10px);
  color: white;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  transition: all 0.2s;
  margin-right: 10px;
}

input[type="file"]::file-selector-button:hover {
  background: rgba(255, 255, 255, 0.3);
  transform: translateY(-1px);
}

/* Hide file input when file is selected, show badge instead */
input[type="file"].hidden-input {
  display: none;
}

/* Glass Send Button */
.send-button {
  position: relative;
  overflow: hidden;
  padding: 12px 28px;
  border-radius: 980px;
  background: rgba(255, 255, 255, 0.25);
  backdrop-filter: blur(10px);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.3);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.2px;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  white-space: nowrap;
  transition: all 0.3s;
}

.send-button::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(
    120% 60% at 0% 0%,
    rgba(255, 255, 255, 0.35),
    transparent 60%
  );
  opacity: 0;
  transform: translateX(-30%) translateY(-10%);
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.send-button:hover {
  background: rgba(255, 255, 255, 0.35);
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
}

.send-button:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

.send-button.loading .send-label {
  opacity: 0;
}

/* Progress bar */
.send-progress {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  width: 0%;
  background: linear-gradient(
    90deg,
    rgba(255,255,255,0.25),
    rgba(255,255,255,0.6),
    rgba(255,255,255,0.25)
  );
  transition: width 0.2s ease;
  pointer-events: none;
}

/* Loading state */
.send-button.loading {
  cursor: default;
  animation: none;
  transform: none;
}

/* Responsive Design */
@media (max-width: 768px) {
  .top-nav {
    padding: 12px 16px;
  }

  .nav-button,
  .book-button {
    padding: 8px 16px;
    font-size: 14px;
  }

  .page-title {
    font-size: 16px;
  }

  .notes-container {
    padding: 16px 12px;
  }

  .note-bubble {
    max-width: 85%;
    padding: 12px 16px;
  }

  .input-bar {
    padding: 16px;
  }

  .input-controls {
    flex-direction: column;
    align-items: stretch;
  }

  .input-options {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .send-button {
    width: 100%;
  }

  textarea {
    font-size: 16px;
    height: 60px;
  }
}

@media (max-width: 480px) {
  .nav-left {
    width: 100%;
    flex-direction: column;
  }

  .nav-button,
  .book-button {
    width: 100%;
    justify-content: center;
  }
}
     html, body {
        background: #736fe6;
        margin: 0;
        padding: 0;
      }
        .editor-open-btn {
  width: 44px; height: 44px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(10px);
  color: white; font-size: 18px;
  cursor: pointer; transition: all 0.3s;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}

.editor-open-btn:hover {
  background: rgba(255, 255, 255, 0.35);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
  @media (max-width: 768px) {
  .input-controls {
    flex-direction: row;
    align-items: center;
    flex-wrap: nowrap;
  }

  .input-options {
    flex-direction: row;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }

  .input-options input[type="file"] {
    max-width: 140px;
    font-size: 0;
  }

  .input-options input[type="file"]::file-selector-button {
    margin-right: 0;
    padding: 8px 12px;
    font-size: 12px;
  }

  .send-button {
    width: auto;
    padding: 10px 20px;
    flex-shrink: 0;
  }
}
  </style>
</head>
<body>
  <!-- Top Navigation -->
  <div class="top-nav">
    <div class="top-nav-content">
      <div class="nav-left">
        <a href="/api/v1/root/${nodeId}?token=${token}&html" class="nav-button">
          ← Back to Tree
        </a>
        <a href="${base}?token=${token}&html" class="nav-button">
          Back to Version
        </a>
      </div>

      <div class="page-title">
        Notes for <a href="${base}?token=${token}&html">${escapeHtml(nodeName)} v${version}</a>
      </div>
    </div>
  </div>

  <!-- Notes Container -->
  <div class="notes-container">
    <div class="notes-wrapper">
      <ul class="notes-list">
      ${notes
        .map((n) => {
          const isSelf =
            currentUserId && n.userId && n.userId.toString() === currentUserId;
          const rawPreview =
            n.contentType === "text"
              ? n.content.length > 169
                ? n.content.substring(0, 500) + "..."
                : n.content
              : n.content.split("/").pop();
          const preview = escapeHtml(rawPreview);

          const userLabel = n.userId
            ? `<a href="/api/v1/user/${n.userId}?token=${token}&html">${escapeHtml(n.username ?? n.userId)}</a>`
            : escapeHtml(n.username ?? "Unknown user");

          return `
          <li
            class="note-item ${isSelf ? "self" : "other"} ${
              n.isReflection ? "reflection" : ""
            }"
            data-note-id="${n._id}"
            data-node-id="${n.nodeId}"
            data-version="${n.version}"
          >
            <div class="note-bubble">
              ${
                n.contentType === "file"
                  ? '<div class="file-badge">📎 File</div>'
                  : ""
              }
              ${!isSelf ? `<div class="note-author">${userLabel}</div>` : ""}
              <div class="note-content">
                <a href="${base}/notes/${n._id}?token=${token}&html">
                  ${preview}
                </a>
              </div>
              <div class="note-meta">
                <span>${new Date(n.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}</span>
                <button class="delete-button" title="Delete note">✕</button>
              </div>
            </div>
          </li>
        `;
        })
        .join("")}
    </ul>
    </div>
  </div>

  <!-- Input Bar -->
  <div class="input-bar">
    <form
      method="POST"
      action="/api/v1/node/${nodeId}/${version}/notes?token=${token}&html"
      enctype="multipart/form-data"
      class="input-form"
      id="noteForm"
    >
      <textarea
        name="content"
        rows="1"
        placeholder="Write a note..."
        id="noteTextarea"
        maxlength="5000"
      ></textarea>
      <div class="char-counter" id="charCounter">
        <span id="charCount">0</span> / 5000
        <span class="energy-display" id="energyDisplay"></span>
      </div>

      <div class="input-controls">
        <div class="input-options">
          <input type="file" name="file" id="fileInput" />
          <div class="file-selected-badge" id="fileSelectedBadge">
            <span>📎</span>
            <span class="file-name" id="fileName"></span>
            <button type="button" class="clear-file" id="clearFileBtn" title="Remove file">✕</button>
          </div>
          <button type="button" class="editor-open-btn" id="openEditorBtn" title="Open in Editor">✏️</button>
        </div>
        <button type="submit" class="send-button" id="sendBtn">
          <span class="send-label">Send</span>
          <span class="send-progress"></span>
        </button>
      </div>
    </form>
  </div>

  <script>
    // Auto-scroll to bottom on load
    const container = document.querySelector('.notes-container');
    container.scrollTop = container.scrollHeight;

    // Elements
    const form = document.getElementById('noteForm');
    const textarea = document.getElementById('noteTextarea');
    const charCounter = document.getElementById('charCounter');
    const charCount = document.getElementById('charCount');
    const energyDisplay = document.getElementById('energyDisplay');
    const fileInput = document.getElementById('fileInput');
    const fileSelectedBadge = document.getElementById('fileSelectedBadge');
    const fileName = document.getElementById('fileName');
    const clearFileBtn = document.getElementById('clearFileBtn');
    const sendBtn = document.getElementById('sendBtn');
    const progressBar = sendBtn.querySelector('.send-progress');

    const MAX_CHARS = 5000;
    let hasFile = false;

    // Auto-resize textarea
    textarea.addEventListener('input', function() {
      this.style.height = 'auto';
      const newHeight = Math.min(this.scrollHeight, 120);
      this.style.height = newHeight + 'px';
      this.style.overflowY = this.scrollHeight > 120 ? 'auto' : 'hidden';
      updateCharCounter();
    });

    // Character counter with energy (1 energy per 1000 chars)
    function updateCharCounter() {
      const len = textarea.value.length;
      charCount.textContent = len;

      // Styling based on remaining
      const remaining = MAX_CHARS - len;
      charCounter.classList.remove('warning', 'danger', 'disabled');

      if (hasFile) {
        charCounter.classList.add('disabled');
      } else if (remaining <= 100) {
        charCounter.classList.add('danger');
      } else if (remaining <= 500) {
        charCounter.classList.add('warning');
      }

      // Energy cost: 1 per 1000 chars (minimum 1 if any text)
      if (len > 0 && !hasFile) {
        const cost = Math.max(1, Math.ceil(len / 1000));
        energyDisplay.textContent = '⚡' + cost;
        energyDisplay.classList.remove('file-energy');
      } else if (!hasFile) {
        energyDisplay.textContent = '';
      }
    }

    // File energy calculation
    const FILE_MIN_COST = 5;
    const FILE_BASE_RATE = 1.5;
    const FILE_MID_RATE = 3;
    const SOFT_LIMIT_MB = 100;
    const HARD_LIMIT_MB = 1024;

    function calculateFileEnergy(sizeMB) {
      if (sizeMB <= SOFT_LIMIT_MB) {
        return Math.max(FILE_MIN_COST, Math.ceil(sizeMB * FILE_BASE_RATE));
      }
      if (sizeMB <= HARD_LIMIT_MB) {
        const base = SOFT_LIMIT_MB * FILE_BASE_RATE;
        const extra = (sizeMB - SOFT_LIMIT_MB) * FILE_MID_RATE;
        return Math.ceil(base + extra);
      }
      const base = SOFT_LIMIT_MB * FILE_BASE_RATE +
                   (HARD_LIMIT_MB - SOFT_LIMIT_MB) * FILE_MID_RATE;
      const overGB = sizeMB - HARD_LIMIT_MB;
      return Math.ceil(base + Math.pow(overGB / 50, 2) * 50);
    }

    // File selection - blocks text input
    fileInput.addEventListener('change', function() {
      if (this.files && this.files[0]) {
        const file = this.files[0];
        hasFile = true;

        // Disable textarea
        textarea.disabled = true;
        textarea.value = '';
        textarea.placeholder = 'File selected - text disabled';

        // Show file badge, hide file input
        fileInput.classList.add('hidden-input');
        fileSelectedBadge.classList.add('visible');

        // Truncate filename for display
        let displayName = file.name;
        if (displayName.length > 20) {
          displayName = displayName.substring(0, 17) + '...';
        }
        fileName.textContent = displayName;
        fileSelectedBadge.title = file.name;

        // Calculate and show energy (+1 for the note itself)
        const sizeMB = file.size / (1024 * 1024);
        const fileCost = calculateFileEnergy(sizeMB);
        const totalCost = fileCost + 1;
        energyDisplay.textContent = '~⚡' + totalCost;
        energyDisplay.classList.add('file-energy');

        // Update char counter state
        updateCharCounter();
      }
    });

    // Clear file selection
    clearFileBtn.addEventListener('click', function() {
      hasFile = false;
      fileInput.value = '';
      fileInput.classList.remove('hidden-input');
      fileSelectedBadge.classList.remove('visible');

      // Re-enable textarea
      textarea.disabled = false;
      textarea.placeholder = 'Write a note...';

      // Clear energy display
      energyDisplay.textContent = '';
      energyDisplay.classList.remove('file-energy');

      updateCharCounter();
    });

    // Delete note functionality
    document.addEventListener('click', async (e) => {
      if (!e.target.classList.contains('delete-button')) return;

      const noteItem = e.target.closest('.note-item');
      const noteId = noteItem.dataset.noteId;
      const nodeId = noteItem.dataset.nodeId;
      const version = noteItem.dataset.version;

      if (!confirm('Delete this note? This cannot be undone.')) return;

      const token = new URLSearchParams(window.location.search).get('token') || '';
      const qs = token ? '?token=' + encodeURIComponent(token) : '';

      try {
        const res = await fetch(
          '/api/v1/node/' + nodeId + '/' + version + '/notes/' + noteId + qs,
          { method: 'DELETE' }
        );

        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Delete failed');

        noteItem.style.opacity = '0';
        noteItem.style.transform = 'translateY(-10px)';
        setTimeout(() => noteItem.remove(), 300);
      } catch (err) {
        alert('Failed to delete: ' + (err.message || 'Unknown error'));
      }
    });

    // Form submission with progress
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      sendBtn.classList.add('loading');
      sendBtn.disabled = true;

      const formData = new FormData(form);
      const xhr = new XMLHttpRequest();

      xhr.open('POST', form.action, true);

      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const percent = Math.round((e.loaded / e.total) * 100);
        progressBar.style.width = percent + '%';
      };

      xhr.onload = () => {
        document.location.reload();
      };

      xhr.onerror = () => {
        alert('Send failed');
        sendBtn.classList.remove('loading');
        sendBtn.disabled = false;
        progressBar.style.width = '0%';
      };

      xhr.send(formData);
    });

    // Enter to submit
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        form.requestSubmit();
      }
    });

    // Editor button
    document.getElementById("openEditorBtn").addEventListener("click", function() {
      var token = new URLSearchParams(window.location.search).get("token") || "";
      var qs = token ? "?token=" + encodeURIComponent(token) + "&html" : "?html";
      var content = textarea.value.trim();
      var editorUrl = "/api/v1/node/${nodeId}/${version}/notes/editor" + qs;

      if (content) {
        sessionStorage.setItem("tree-editor-draft", content);
      }

      window.location.href = editorUrl;
    });

    // Form reset handler
    form.addEventListener('reset', () => {
      hasFile = false;
      fileInput.classList.remove('hidden-input');
      fileSelectedBadge.classList.remove('visible');
      textarea.disabled = false;
      textarea.placeholder = 'Write a note...';
      energyDisplay.textContent = '';
      energyDisplay.classList.remove('file-energy');
      charCount.textContent = '0';
      charCounter.classList.remove('warning', 'danger', 'disabled');
    });
  </script>
</body>
</html>
`;
}

export function renderTextNote({
  back,
  backText,
  userLink,
  editorButton,
  note,
}) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>Note by ${escapeHtml(note.userId?.username || "User")} - TreeOS</title>
  <meta name="description" content="${escapeHtml((note.content || "").slice(0, 160))}" />
  <meta property="og:title" content="Note by ${escapeHtml(note.userId?.username || "User")} - TreeOS" />
  <meta property="og:description" content="${escapeHtml((note.content || "").slice(0, 160))}" />
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="TreeOS" />
  <meta property="og:image" content="${getLandUrl()}/tree.png" />
  <style>
    ${baseStyles}
    ${backNavStyles}

    /* Note Card */
    .note-card {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      border-radius: 16px;
      padding: 32px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.28);
      position: relative;
      overflow: hidden;
      animation: fadeInUp 0.6s ease-out 0.1s both;
    }

    /* User Info */
    .user-info {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.2);
    }

    .user-info::before {
      content: '👤';
      font-size: 18px;
    }

    .user-info a {
      color: white;
      text-decoration: none;
      font-weight: 600;
      font-size: 15px;
      transition: all 0.2s;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    .user-info a:hover {
      text-shadow: 0 0 12px rgba(255, 255, 255, 0.8);
      transform: translateX(2px);
    }

    .note-time {
      margin-left: auto;
      font-size: 13px;
      color: rgba(255, 255, 255, 0.6);
      font-weight: 400;
    }

    /* Copy Button Bar */
    .copy-bar {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-bottom: 16px;
    }

    .copy-btn {
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.3);
      cursor: pointer;
      font-size: 20px;
      padding: 8px 12px;
      border-radius: 980px;
      transition: all 0.3s;
      position: relative;
      overflow: hidden;
    }

    .copy-btn::before {
      content: "";
      position: absolute;
      inset: -40%;
      background: radial-gradient(
        120% 60% at 0% 0%,
        rgba(255, 255, 255, 0.35),
        transparent 60%
      );
      opacity: 0;
      transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      pointer-events: none;
    }

    .copy-btn:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .copy-btn:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

    .copy-btn:active {
      transform: translateY(0);
    }

    #copyUrlBtn {
      background: rgba(255, 255, 255, 0.25);
    }

    /* Note Content */
    pre {
      background: rgba(255, 255, 255, 0.3);
      backdrop-filter: blur(20px) saturate(150%);
      -webkit-backdrop-filter: blur(20px) saturate(150%);
      padding: 20px;
      border-radius: 12px;
      font-size: 16px;
      line-height: 1.7;
      white-space: pre-wrap;
      word-wrap: break-word;
      border: 1px solid rgba(255, 255, 255, 0.3);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      color: #3d2f8f;
      font-weight: 600;
      text-shadow:
        0 0 10px rgba(102, 126, 234, 0.4),
        0 1px 3px rgba(255, 255, 255, 1);
      box-shadow:
        0 4px 20px rgba(0, 0, 0, 0.1),
        inset 0 1px 0 rgba(255, 255, 255, 0.4);
      position: relative;
      overflow: hidden;
      transition: all 0.3s ease;
    }

    pre::before {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(
        110deg,
        transparent 40%,
        rgba(255, 255, 255, 0.4),
        transparent 60%
      );
      opacity: 0;
      transform: translateX(-100%);
      pointer-events: none;
    }

    pre:hover {
      border-color: rgba(255, 255, 255, 0.5);
      box-shadow:
        0 8px 32px rgba(102, 126, 234, 0.2),
        inset 0 1px 0 rgba(255, 255, 255, 0.6);
    }
/* Programmatic shimmer trigger */
pre.flash::before {
  opacity: 1;
  animation: glassShimmer 1.2s ease forwards;
}

    pre:hover::before {
      opacity: 1;
      animation: glassShimmer 1.2s ease forwards;
    }

    pre.copied {
      animation: textGlow 0.8s ease-out;
    }

    @keyframes textGlow {
      0% {
        box-shadow:
          0 4px 20px rgba(0, 0, 0, 0.1),
          inset 0 1px 0 rgba(255, 255, 255, 0.4);
      }
      50% {
        box-shadow:
          0 0 40px rgba(102, 126, 234, 0.6),
          0 0 60px rgba(102, 126, 234, 0.4),
          inset 0 1px 0 rgba(255, 255, 255, 0.8);
        text-shadow:
          0 0 20px rgba(102, 126, 234, 0.8),
          0 0 30px rgba(102, 126, 234, 0.6),
          0 1px 3px rgba(255, 255, 255, 1);
      }
      100% {
        box-shadow:
          0 4px 20px rgba(0, 0, 0, 0.1),
          inset 0 1px 0 rgba(255, 255, 255, 0.4);
      }
    }

    @keyframes glassShimmer {
      0% {
        opacity: 0;
        transform: translateX(-120%) skewX(-15deg);
      }
      50% {
        opacity: 1;
      }
      100% {
        opacity: 0;
        transform: translateX(120%) skewX(-15deg);
      }
    }

    /* Responsive */
    @media (max-width: 640px) {
      body {
        padding: 16px;
      }

      .note-card {
        padding: 24px 20px;
      }

      pre {
        font-size: 17px;
        padding: 16px;
      }

      .back-nav {
        flex-direction: column;
      }

      .back-link {
        justify-content: center;
      }
    }

    @media (min-width: 641px) and (max-width: 1024px) {
      .container {
        max-width: 700px;
      }
    }
      .editor-btn {
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.editor-btn:hover {
  background: rgba(255, 255, 255, 0.35);
}

  </style>
</head>
<body>
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="${back}" class="back-link">${backText}</a>
      <button id="copyUrlBtn" class="copy-btn" title="Copy URL to share">🔗</button>
    </div>

    <!-- Note Card -->
    <div class="note-card">
      <div class="user-info">
        ${userLink}
        ${note.createdAt ? `<span class="note-time">${new Date(note.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} at ${new Date(note.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>` : ""}
      </div>
<div class="copy-bar">
  ${editorButton}
  <button id="copyNoteBtn" class="copy-btn" title="Copy note">📋</button>
</div>


<pre id="noteContent">${escapeHtml(note.content)}</pre>
    </div>
  </div>

  <script>
    const copyNoteBtn = document.getElementById("copyNoteBtn");
    const copyUrlBtn = document.getElementById("copyUrlBtn");
    const noteContent = document.getElementById("noteContent");

    copyNoteBtn.addEventListener("click", () => {
  navigator.clipboard.writeText(noteContent.textContent).then(() => {
    copyNoteBtn.textContent = "✔️";
    setTimeout(() => (copyNoteBtn.textContent = "📋"), 900);

    // text glow (already existing)
    noteContent.classList.add("copied");
    setTimeout(() => noteContent.classList.remove("copied"), 800);

    // delayed glass shimmer (0.5s)
    setTimeout(() => {
      noteContent.classList.remove("flash"); // reset if still present
      void noteContent.offsetWidth;          // force reflow so animation restarts
      noteContent.classList.add("flash");

      setTimeout(() => {
        noteContent.classList.remove("flash");
      }, 1300); // slightly longer than animation
    }, 600);
  });
});


    copyUrlBtn.addEventListener("click", () => {
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      if (!url.searchParams.has('html')) {
        url.searchParams.set('html', '');
      }
      navigator.clipboard.writeText(url.toString()).then(() => {
        copyUrlBtn.textContent = "✔️";
        setTimeout(() => (copyUrlBtn.textContent = "🔗"), 900);
      });
    });
  </script>
</body>
</html>
`;
}

export function renderFileNote({
  back,
  backText,
  userLink,
  note,
  fileName,
  fileUrl,
  mediaHtml,
  fileDeleted,
}) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>${escapeHtml(fileName)}</title>
  <style>
    ${baseStyles}
    ${backNavStyles}

    /* File Card */
    .file-card {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      border-radius: 16px;
      padding: 32px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.28);
      position: relative;
      overflow: hidden;
      animation: fadeInUp 0.6s ease-out 0.1s both;
    }

    /* User Info */
    .user-info {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.2);
    }

    .user-info::before {
      content: '👤';
      font-size: 18px;
    }

    .user-info a {
      color: white;
      text-decoration: none;
      font-weight: 600;
      font-size: 15px;
      transition: all 0.2s;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    .user-info a:hover {
      text-shadow: 0 0 12px rgba(255, 255, 255, 0.8);
      transform: translateX(2px);
    }

    .note-time {
      margin-left: auto;
      font-size: 13px;
      color: rgba(255, 255, 255, 0.6);
      font-weight: 400;
    }

    /* File Header */
    h1 {
      font-size: 24px;
      font-weight: 700;
      color: white;
      margin-bottom: 20px;
      word-break: break-word;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    /* Action Buttons */
    .action-bar {
      display: flex;
      gap: 12px;
      margin-bottom: 24px;
      flex-wrap: wrap;
    }

    .download {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 20px;
      background: rgba(255, 255, 255, 0.25);
      backdrop-filter: blur(10px);
      color: white;
      text-decoration: none;
      border-radius: 980px;
      font-weight: 600;
      font-size: 15px;
      transition: all 0.3s;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.3);
      cursor: pointer;
      position: relative;
      overflow: hidden;
    }

    .download::after {
      content: '⬇️';
      font-size: 16px;
      margin-left: 4px;
    }

    .download::before {
      content: "";
      position: absolute;
      inset: -40%;
      background: radial-gradient(
        120% 60% at 0% 0%,
        rgba(255, 255, 255, 0.35),
        transparent 60%
      );
      opacity: 0;
      transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      pointer-events: none;
    }

    .download:hover {
      background: rgba(255, 255, 255, 0.35);
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
    }

    .download:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

    .copy-url-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 20px;
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(10px);
      color: white;
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 980px;
      font-weight: 600;
      font-size: 15px;
      transition: all 0.3s;
      cursor: pointer;
      position: relative;
      overflow: hidden;
    }

    .copy-url-btn::after {
      content: '🔗';
      font-size: 16px;
      margin-left: 4px;
    }

    .copy-url-btn::before {
      content: "";
      position: absolute;
      inset: -40%;
      background: radial-gradient(
        120% 60% at 0% 0%,
        rgba(255, 255, 255, 0.35),
        transparent 60%
      );
      opacity: 0;
      transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      pointer-events: none;
    }

    .copy-url-btn:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .copy-url-btn:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

    /* Media Container */
    .media {
      margin-top: 24px;
      padding-top: 24px;
      border-top: 1px solid rgba(255, 255, 255, 0.2);
    }

    .media img,
    .media video,
    .media audio {
      max-width: 100%;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    /* Responsive */
    @media (max-width: 640px) {
      body {
        padding: 16px;
      }

      .file-card {
        padding: 24px 20px;
      }

      h1 {
        font-size: 22px;
      }

      .action-bar {
        flex-direction: column;
      }

      .download,
      .copy-url-btn {
        padding: 12px 18px;
        font-size: 16px;
        width: 100%;
        justify-content: center;
      }

      .back-nav {
        flex-direction: column;
      }

      .back-link {
        justify-content: center;
      }
    }

    @media (min-width: 641px) and (max-width: 1024px) {
      .container {
        max-width: 700px;
      }
    }
      @media (max-width: 768px) {
  .send-progress {
    animation: shimmer 1.2s infinite linear;
  }
}

@keyframes shimmer {
  0% { background-position: -200px 0; }
  100% { background-position: 200px 0; }
}

  </style>
</head>
<body>
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="${back}" class="back-link">${backText}</a>
    </div>

    <!-- File Card -->
    <div class="file-card">
      <div class="user-info">
        ${userLink}
        ${note.createdAt ? `<span class="note-time">${new Date(note.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} at ${new Date(note.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>` : ""}
      </div>

<h1>${escapeHtml(fileName)}</h1>

      ${fileDeleted ? "" : `<div class="action-bar">
        <a class="download" href="${fileUrl}" download>Download</a>
        <button id="copyUrlBtn" class="copy-url-btn">Share</button>
      </div>`}

      <div class="media">
        ${fileDeleted ? `<p style="color:rgba(255,255,255,0.6); padding:40px 0;">File was deleted</p>` : mediaHtml}
      </div>
    </div>
  </div>

  <script>
    const copyUrlBtn = document.getElementById("copyUrlBtn");

    copyUrlBtn.addEventListener("click", () => {
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      if (!url.searchParams.has('html')) {
        url.searchParams.set('html', '');
      }
      navigator.clipboard.writeText(url.toString()).then(() => {
        const originalText = copyUrlBtn.textContent;
        copyUrlBtn.textContent = "✔️ Copied!";
        setTimeout(() => (copyUrlBtn.textContent = originalText), 900);
      });
    });
  </script>
</body>
</html>
`;
}

export { parseBool, normalizeStatusFilters, renderBookNode };
