// TreeOS Portal Shared . flat-view context menu.
//
// Right-click primitive for the explorer. The menu is one DOM node owned
// by this module: showContextMenu({x, y, items}) shows it, any click
// outside or Escape dismisses it. Items are { label, onPick, disabled?,
// submenu? }. A submenu item shows another flyout on hover.
//
// The menu is the per-position action surface Tabor named: same source
// of truth as the chat's tool list (flat.operationsForTarget(kind)) plus
// a few seed verbs (do:create-space, do:create-matter, properties, etc).
// Extensions appear in the menu without registering anything new.

let activeMenu = null;
let activeSubmenu = null;
let dismissHandlers = null;

function dismiss() {
  if (activeMenu && activeMenu.parentNode) {
    activeMenu.parentNode.removeChild(activeMenu);
  }
  if (activeSubmenu && activeSubmenu.parentNode) {
    activeSubmenu.parentNode.removeChild(activeSubmenu);
  }
  activeMenu = null;
  activeSubmenu = null;
  if (dismissHandlers) {
    document.removeEventListener("click",       dismissHandlers.click,    true);
    document.removeEventListener("contextmenu", dismissHandlers.click,    true);
    document.removeEventListener("keydown",     dismissHandlers.key,      true);
    window.removeEventListener("scroll",        dismissHandlers.scroll,   true);
    window.removeEventListener("resize",        dismissHandlers.scroll,   true);
    dismissHandlers = null;
  }
}

function arm() {
  dismissHandlers = {
    click: (e) => {
      if (activeMenu && activeMenu.contains(e.target)) return;
      if (activeSubmenu && activeSubmenu.contains(e.target)) return;
      dismiss();
    },
    key: (e) => { if (e.key === "Escape") dismiss(); },
    scroll: () => dismiss(),
  };
  document.addEventListener("click",       dismissHandlers.click,  true);
  document.addEventListener("contextmenu", dismissHandlers.click,  true);
  document.addEventListener("keydown",     dismissHandlers.key,    true);
  window.addEventListener("scroll",        dismissHandlers.scroll, true);
  window.addEventListener("resize",        dismissHandlers.scroll, true);
}

function buildMenuEl(items, opts = {}) {
  const ul = document.createElement("ul");
  ul.className = "ctx-menu" + (opts.isSubmenu ? " ctx-submenu" : "");
  ul.setAttribute("able", "menu");

  let lastWasSeparator = true; // skip leading separators

  for (const item of items) {
    if (!item) continue;

    if (item.separator) {
      if (lastWasSeparator) continue;
      const li = document.createElement("li");
      li.className = "ctx-separator";
      ul.appendChild(li);
      lastWasSeparator = true;
      continue;
    }
    lastWasSeparator = false;

    const li = document.createElement("li");
    li.className = "ctx-item" + (item.disabled ? " ctx-item--disabled" : "")
      + (item.submenu ? " ctx-item--has-submenu" : "");
    li.setAttribute("able", "menuitem");

    const labelEl = document.createElement("span");
    labelEl.className = "ctx-label";
    labelEl.textContent = item.label;
    li.appendChild(labelEl);

    if (item.hint) {
      const hint = document.createElement("span");
      hint.className = "ctx-hint";
      hint.textContent = item.hint;
      li.appendChild(hint);
    }

    if (item.submenu) {
      const arrow = document.createElement("span");
      arrow.className = "ctx-arrow";
      arrow.textContent = "▸";
      li.appendChild(arrow);

      li.addEventListener("mouseenter", () => {
        if (item.disabled) return;
        if (activeSubmenu && activeSubmenu.parentNode) {
          activeSubmenu.parentNode.removeChild(activeSubmenu);
          activeSubmenu = null;
        }
        const sub = buildMenuEl(item.submenu, { isSubmenu: true });
        document.body.appendChild(sub);
        const rect = li.getBoundingClientRect();
        const subRect = sub.getBoundingClientRect();
        let left = rect.right - 4;
        if (left + subRect.width > window.innerWidth - 8) {
          left = rect.left - subRect.width + 4;
        }
        let top = rect.top;
        if (top + subRect.height > window.innerHeight - 8) {
          top = Math.max(8, window.innerHeight - subRect.height - 8);
        }
        sub.style.left = `${left}px`;
        sub.style.top  = `${top}px`;
        activeSubmenu = sub;
      });
    }

    if (item.disabled) {
      // no click handler
    } else if (typeof item.onPick === "function") {
      li.addEventListener("click", (e) => {
        e.stopPropagation();
        const fn = item.onPick;
        dismiss();
        try { fn(); } catch (err) { console.error("[ctx-menu] item failed:", err); }
      });
    }

    ul.appendChild(li);
  }

  return ul;
}

export function showContextMenu({ x, y, items }) {
  dismiss();
  if (!Array.isArray(items) || items.length === 0) return;

  const ul = buildMenuEl(items);
  document.body.appendChild(ul);

  // Clamp to viewport.
  const rect = ul.getBoundingClientRect();
  let left = x;
  let top  = y;
  if (left + rect.width  > window.innerWidth  - 8) left = Math.max(8, window.innerWidth  - rect.width  - 8);
  if (top  + rect.height > window.innerHeight - 8) top  = Math.max(8, window.innerHeight - rect.height - 8);
  ul.style.left = `${left}px`;
  ul.style.top  = `${top}px`;

  activeMenu = ul;
  arm();
}

export function closeContextMenu() { dismiss(); }
