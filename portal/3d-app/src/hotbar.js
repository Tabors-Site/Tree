// TreeOS Portal 3D — hotbar.
//
// Minecraft-style 9-slot inventory across the bottom of the screen.
// Each slot holds a "plantable" item (currently: seeds the operator
// can plant in the world). Selection is driven by the number keys
// 1..9 and the mouse wheel; the selected slot highlights and its
// item is what `getSelected()` returns.
//
// The hotbar is a thin presentation layer over a flat array of slot
// objects:
//
//   { kind: "seed", name: "coder:governing-coder", label: "coder",
//     description: "Bootstrap a code-project rulership..." }
//
// Today only the "seed" kind exists; future kinds (matter templates,
// summons, tools) drop into the same shape without touching the hotbar.

const SLOT_COUNT = 9;

let _root      = null;
let _slotsDom  = [];
let _slots     = new Array(SLOT_COUNT).fill(null);
let _selected  = 0;
let _onChange  = () => {};

/**
 * Mount the hotbar into the given parent element. Returns the public
 * API. Call once at boot.
 */
export function initHotbar(parent, { onSelectionChange } = {}) {
  _onChange = typeof onSelectionChange === "function" ? onSelectionChange : () => {};

  _root = document.createElement("div");
  _root.id = "hotbar";
  _root.setAttribute("aria-label", "Hotbar");

  _slotsDom = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const slot = document.createElement("div");
    slot.className = "hotbar-slot";
    slot.dataset.index = String(i);
    slot.innerHTML = `
      <div class="slot-icon"></div>
      <div class="slot-num">${i + 1}</div>
      <div class="slot-label"></div>
    `;
    slot.addEventListener("click", () => setSelectedIndex(i));
    slot.addEventListener("mouseenter", () => _showTooltipFor(i));
    slot.addEventListener("mouseleave", () => _hideTooltip());
    _root.appendChild(slot);
    _slotsDom.push(slot);
  }

  parent.appendChild(_root);

  // Number keys 1..9 select the slot. Mouse wheel scrolls selection.
  window.addEventListener("keydown", _onKeyDown);
  window.addEventListener("wheel", _onWheel, { passive: true });

  _renderAll();
  return {
    setSlots,
    setSelectedIndex,
    getSelected,
    getSelectedIndex,
    hide,
    show,
  };
}

/**
 * Fill the hotbar from a list of slot objects. Up to SLOT_COUNT items
 * are taken; rest are blank. Maintains the current selection index when
 * possible.
 */
export function setSlots(items) {
  const next = new Array(SLOT_COUNT).fill(null);
  for (let i = 0; i < Math.min(SLOT_COUNT, items?.length || 0); i++) {
    next[i] = items[i] || null;
  }
  _slots = next;
  _renderAll();
}

export function getSelected() {
  return _slots[_selected] || null;
}

export function getSelectedIndex() {
  return _selected;
}

export function setSelectedIndex(i) {
  const idx = ((i % SLOT_COUNT) + SLOT_COUNT) % SLOT_COUNT;
  if (idx === _selected) return;
  _selected = idx;
  _renderSelection();
  _onChange(getSelected(), _selected);
}

export function hide() { if (_root) _root.style.display = "none"; }
export function show() { if (_root) _root.style.display = "flex"; }

// ────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────

function _renderAll() {
  if (!_slotsDom.length) return;
  for (let i = 0; i < SLOT_COUNT; i++) {
    const slot = _slotsDom[i];
    const item = _slots[i];
    const label = slot.querySelector(".slot-label");
    const icon = slot.querySelector(".slot-icon");
    if (item) {
      slot.classList.add("filled");
      label.textContent = item.label || _shortName(item.name);
      icon.innerHTML = _iconSvg(item);
    } else {
      slot.classList.remove("filled");
      label.textContent = "";
      icon.innerHTML = "";
    }
  }
  _renderSelection();
}

function _renderSelection() {
  for (let i = 0; i < SLOT_COUNT; i++) {
    _slotsDom[i].classList.toggle("selected", i === _selected);
  }
}

function _shortName(fullName) {
  if (!fullName) return "";
  // "coder:governing-coder" → "governing-coder"
  const idx = fullName.indexOf(":");
  return idx >= 0 ? fullName.slice(idx + 1) : fullName;
}

// Per-kind icon. A seed gets a stylized sapling; future kinds add
// their own glyphs. SVG is inline so no asset loading.
function _iconSvg(item) {
  if (item.kind === "seed") {
    return `<svg viewBox="0 0 24 24" width="28" height="28">
      <path d="M12 21 V11" stroke="#7fb38d" stroke-width="1.6" fill="none"/>
      <path d="M12 13 C8 12, 6 9, 7 6 C10 7, 12 9, 12 13 Z" fill="#4f8a5f"/>
      <path d="M12 13 C16 12, 18 9, 17 6 C14 7, 12 9, 12 13 Z" fill="#5fa672"/>
      <ellipse cx="12" cy="21" rx="3.5" ry="0.8" fill="#3a2a1c"/>
    </svg>`;
  }
  return "";
}

let _tooltipEl = null;
function _showTooltipFor(i) {
  const item = _slots[i];
  if (!item) return;
  _ensureTooltipEl();
  _tooltipEl.innerHTML = `
    <div class="tt-title">${escapeHtml(item.label || item.name)}</div>
    <div class="tt-name">${escapeHtml(item.name)}</div>
    ${item.description ? `<div class="tt-desc">${escapeHtml(item.description)}</div>` : ""}
  `;
  const slot = _slotsDom[i];
  const r = slot.getBoundingClientRect();
  _tooltipEl.style.display = "block";
  const ttRect = _tooltipEl.getBoundingClientRect();
  const left = Math.max(8, Math.min(window.innerWidth - ttRect.width - 8, r.left + r.width / 2 - ttRect.width / 2));
  _tooltipEl.style.left = `${left}px`;
  _tooltipEl.style.top  = `${r.top - ttRect.height - 8}px`;
}

function _hideTooltip() {
  if (_tooltipEl) _tooltipEl.style.display = "none";
}

function _ensureTooltipEl() {
  if (_tooltipEl) return;
  _tooltipEl = document.createElement("div");
  _tooltipEl.id = "hotbar-tooltip";
  document.body.appendChild(_tooltipEl);
}

function _onKeyDown(e) {
  // 1..9 select. Don't fire when typing in a UI input or a panel is open.
  if (_isTypingInUI()) return;
  if (!e.key || e.key.length !== 1) return;
  const n = "123456789".indexOf(e.key);
  if (n < 0) return;
  e.preventDefault();
  setSelectedIndex(n);
}

function _onWheel(e) {
  // Wheel rotates selection. Block while typing or interacting with panels.
  if (_isTypingInUI()) return;
  const dir = e.deltaY > 0 ? 1 : -1;
  setSelectedIndex(_selected + dir);
}

function _isTypingInUI() {
  const el = document.activeElement;
  if (!el || el === document.body) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if (el.isContentEditable) return true;
  // A modal panel is open ⇒ block hotbar input. We detect via the
  // .overlay class the existing UI uses for sign-in / talk / etc.
  if (document.querySelector(".overlay")) return true;
  return false;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
