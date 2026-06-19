// being-flow-panel.js — 3D portal frame around the shared per-being
// roleFlow editor. Mirrors role-manager-panel.js (the modal chrome,
// Esc/× close, ctx adapter); the inner body is the shared
// renderBeingFlowPanel.

import { renderBeingFlowPanel } from "../shared/being-flow-panel.js";

let _panelEl = null;
let _onClose = null;

export function showBeingFlowPanel({ state, beingEntry, onClose }) {
  if (_panelEl) return;
  document.exitPointerLock?.();

  _onClose = onClose;

  const el = document.createElement("div");
  el.className = "being-flow-modal";
  el.style.cssText = `
    position: fixed; left: 50%; top: 50%;
    transform: translate(-50%, -50%);
    background: rgba(10, 13, 12, 0.94);
    border: 1px solid #2c3a32; border-radius: 6px;
    padding: 16px 20px; min-width: 520px; max-width: 720px;
    pointer-events: auto; z-index: 12;
    font-family: ui-monospace, monospace; color: #c8d3cb;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
    max-height: 86vh; overflow-y: auto;
  `;

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "×";
  closeBtn.title = "close";
  closeBtn.style.cssText = `
    position: absolute; top: 8px; right: 12px;
    background: transparent; color: #6b7d72; border: none;
    font-size: 18px; line-height: 1; cursor: pointer; padding: 0 4px;
  `;
  closeBtn.onclick = () => hideBeingFlowPanel();
  el.appendChild(closeBtn);

  const body = document.createElement("div");
  body.className = "bf-panel-body";
  body.style.cssText = `font-size: 12px;`;
  el.appendChild(body);

  document.body.appendChild(el);
  _panelEl = el;

  el.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      ev.stopPropagation();
      hideBeingFlowPanel();
    }
  });
  el.tabIndex = -1;
  el.focus();

  renderBeingFlowPanel(body, beingEntry, {
    story:    state.discovery?.story,
    username:   state.session?.username || null,
    descriptor: state.descriptor,
    see:        (addr) => state.client.see(addr),
    doOp:       (addr, action, params) => state.client.do(addr, action, params),
  });
}

export function hideBeingFlowPanel() {
  if (!_panelEl) return;
  _panelEl.remove();
  _panelEl = null;
  if (typeof _onClose === "function") {
    const fn = _onClose;
    _onClose = null;
    fn();
  }
}

export function isBeingFlowPanelOpen() {
  return !!_panelEl;
}
