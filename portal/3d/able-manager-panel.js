// able-manager-panel.js — 3D portal frame around the shared
// able-manager UI. The shared module (../shared/able-manager-panel.js)
// renders the catalog + form + flow editor into whatever container we
// hand it; this file owns the modal chrome (centered overlay, close
// button, body scroll, dismiss-on-Escape) and the ctx adapter that
// connects the panel to the 3D portal's state and WS client.

import { renderAbleManagerPanel } from "../shared/able-manager-panel.js";

let _panelEl = null;
let _onClose = null;

export function showAbleManagerPanel({ state, beingEntry, onClose }) {
  if (_panelEl) return; // already open
  document.exitPointerLock?.();

  _onClose = onClose;

  const el = document.createElement("div");
  el.className = "able-manager-modal";
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
  closeBtn.onclick = () => hideAbleManagerPanel();
  el.appendChild(closeBtn);

  const body = document.createElement("div");
  body.className = "rm-panel-body";
  body.style.cssText = `font-size: 12px;`;
  el.appendChild(body);

  document.body.appendChild(el);
  _panelEl = el;

  // Esc closes. Captured so the panel always wins over the scene's
  // own Esc handler when this panel is on top.
  const escHandler = (ev) => {
    if (ev.key === "Escape") {
      ev.stopPropagation();
      hideAbleManagerPanel();
    }
  };
  el.addEventListener("keydown", escHandler);
  el.tabIndex = -1;
  el.focus();

  // Hand the body off to the shared renderer with a ctx adapter the
  // 3D portal's state already satisfies.
  renderAbleManagerPanel(body, beingEntry, {
    story:    state.discovery?.story,
    history:    state.descriptor?.address?.history || "0",
    username:   state.session?.username || null,
    descriptor: state.descriptor,
    see:        (addr) => state.client.see(addr),
    doOp:       (addr, action, params) => state.client.do(addr, action, params),
  });
}

export function hideAbleManagerPanel() {
  if (!_panelEl) return;
  _panelEl.remove();
  _panelEl = null;
  if (typeof _onClose === "function") {
    const fn = _onClose;
    _onClose = null;
    fn();
  }
}

export function isAbleManagerPanelOpen() {
  return !!_panelEl;
}
