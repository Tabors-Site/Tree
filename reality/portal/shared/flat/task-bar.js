// task-bar.js — the position-aware action bar.
//
// A row of context tabs that update with the right stance. Each tab opens
// a dropdown of DO actions; clicking one mounts a directed form (op-form.js)
// in the detail pane. Three tabs today:
//
//   Place    — what acts on the space/matter you're standing in
//              (create child space, create matter, move, plant, roles,
//              render, permissions, delete) + a prefilled "edit this space".
//   Branch   — the branch lifecycle (fork, merge, pause, pointers) plus
//              clone (download) and graft (paste-in).
//   Reality  — what affects the whole reality / server (form seed, config,
//              close reality).
//
// Built as a small registry so more tabs/actions can be added later. The
// server auth-gates every op, so an action a viewer can't perform simply
// returns FORBIDDEN; the bar steers, it doesn't pre-authorize.

import { flat } from "./host.js";
import { renderOpForm } from "../op-form.js";

// One outside-click listener at a time. The bar re-renders on every SEE;
// we drop the previous listener before wiring a new one so they can't
// accumulate across navigations.
let _outsideHandler = null;

export function renderTaskBar(container, { descriptor, discovery, session } = {}) {
  if (!container) return;
  if (_outsideHandler) {
    document.removeEventListener("click", _outsideHandler);
    _outsideHandler = null;
  }
  container.innerHTML = "";
  // Every action needs an identity; without one, keep the bar quiet.
  if (!session?.username && !session?.beingId) return;

  const desc = descriptor || {};
  const reality =
    discovery?.reality || desc.address?.reality || desc.address?.place || "";
  const path = desc.address?.pathByNames || "/";
  const positionAddress = `${reality}${path === "/" ? "/" : path}`;
  const rootAddress = `${reality}/`;

  const loadedOps = flat.state?.operations || [];
  const opByName = new Map(loadedOps.map((op) => [op.name, op]));
  // The .operations catalog loads async after mount. Until it arrives,
  // don't filter — show every action optimistically rather than collapsing
  // each tab to its special-only entries. Once loaded, hide ops a reality
  // genuinely doesn't register.
  const opsLoaded = loadedOps.length > 0;

  // Order: Reality (far left), Branch, Place — broadest scope to
  // narrowest, like a window menu bar.
  const tabs = [
    { id: "reality", label: "Reality", actions: realityActions(rootAddress) },
    { id: "branch", label: "Branch", actions: branchActions(positionAddress) },
    { id: "place", label: "Place", actions: placeActions(positionAddress, desc) },
  ];

  const bar = document.createElement("div");
  bar.className = "task-bar";

  const tabRow = document.createElement("div");
  tabRow.className = "task-tabs";
  bar.appendChild(tabRow);

  const dropdown = document.createElement("div");
  dropdown.className = "task-dropdown hidden";
  bar.appendChild(dropdown);

  let openTab = null;
  const closeDropdown = () => {
    dropdown.classList.add("hidden");
    openTab = null;
    markActive(tabRow, null);
  };

  for (const tab of tabs) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "task-tab";
    btn.textContent = tab.label;
    btn.addEventListener("click", () => {
      if (openTab === tab.id) {
        closeDropdown();
        return;
      }
      openTab = tab.id;
      markActive(tabRow, btn);
      renderDropdown(dropdown, tab, opByName, opsLoaded, closeDropdown);
      // Anchor the overlay under the clicked tab (window-menu style).
      dropdown.style.left = `${btn.offsetLeft}px`;
    });
    btn.dataset.tab = tab.id;
    tabRow.appendChild(btn);
  }

  container.appendChild(bar);

  // Click anywhere outside the bar closes the open menu.
  _outsideHandler = (e) => {
    if (!bar.contains(e.target)) closeDropdown();
  };
  document.addEventListener("click", _outsideHandler);
}

function markActive(tabRow, activeBtn) {
  for (const b of tabRow.querySelectorAll(".task-tab")) {
    b.classList.toggle("active", b === activeBtn);
  }
}

function renderDropdown(dropdown, tab, opByName, opsLoaded, closeDropdown) {
  dropdown.innerHTML = "";
  dropdown.classList.remove("hidden");
  for (const action of tab.actions) {
    // Once the op catalog is loaded, skip actions whose op this reality
    // doesn't register (unless it's a special, non-op action). Before the
    // catalog loads, show everything optimistically.
    if (opsLoaded && action.op && !action.special && !opByName.has(action.op)) continue;
    const item = document.createElement("button");
    item.type = "button";
    item.className = "task-action" + (action.danger ? " task-action-danger" : "");
    item.textContent = action.label;
    item.addEventListener("click", () => {
      closeDropdown();
      openAction(action, opByName);
    });
    dropdown.appendChild(item);
  }
  if (!dropdown.children.length) {
    const none = document.createElement("div");
    none.className = "task-empty dim";
    none.textContent = "(no actions here)";
    dropdown.appendChild(none);
  }
}

// ── action handlers ────────────────────────────────────────────────

function openAction(action, opByName) {
  const body = openInspectorPanel(action.label);

  if (action.special === "edit-space") {
    return renderEditSpace(body, action);
  }
  if (action.special === "clone") {
    return renderClone(body, action, opByName);
  }
  if (action.special === "close-reality") {
    return renderCloseReality(body, action, opByName);
  }

  const op = opByName.get(action.op) || { name: action.op, args: null };
  renderOpForm(body, {
    op,
    address: action.address,
    values: action.values || {},
    submitLabel: action.submitLabel || "run",
    doOp: flat.doOp,
    onResult: (err) => { if (!err) refreshView(); },
  });
}

// "edit this space" — prefilled rename. The set-space handler writes one
// field at a time, so a custom doOp issues a set-space per changed field.
function renderEditSpace(body, action) {
  const currentName = action.values?.name || "";
  const op = {
    name: "set-space",
    args: { name: { type: "text", label: "Name (kebab-case)", required: false } },
  };
  renderOpForm(body, {
    op,
    address: action.address,
    values: action.values || {},
    submitLabel: "save changes",
    doOp: async (addr, _name, payload) => {
      const changed = [];
      if (payload.name != null && payload.name !== currentName) {
        await flat.doOp(addr, "set-space", { field: "name", value: payload.name });
        changed.push("name");
      }
      return { changed: changed.length ? changed : "(no changes)" };
    },
    onResult: (err) => { if (!err) refreshView(); },
  });
}

// clone-subtree returns a bundle; the portal downloads it as JSON rather
// than printing it. Custom doOp wraps the download and returns a summary.
function renderClone(body, action, opByName) {
  const op = opByName.get("clone-subtree") || {
    name: "clone-subtree",
    args: { name: { type: "text", label: "Clone name (optional)", required: false } },
  };
  renderOpForm(body, {
    op,
    address: action.address,
    submitLabel: "download clone",
    doOp: async (addr, _name, payload) => {
      const r = await flat.doOp(addr, "clone-subtree", payload);
      const bundle = r?.bundle;
      if (!bundle) throw new Error("clone returned no bundle");
      const label = payload.name || "place";
      const stamp = (bundle.meta?.createdAt || "").replace(/[:.]/g, "-").slice(0, 19) || "snapshot";
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${label}-${stamp}.clone.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      const c = bundle.content || {};
      return {
        downloaded: `${label}-${stamp}.clone.json`,
        spaces: c.spaces?.length || 0,
        beings: c.beings?.length || 0,
        matter: c.matter?.length || 0,
      };
    },
  });
}

// close-reality stops the server. Confirm before firing.
function renderCloseReality(body, action, opByName) {
  const op = opByName.get("close-reality") || { name: "close-reality", args: {} };
  renderOpForm(body, {
    op,
    address: action.address,
    submitLabel: "⚠ close reality",
    doOp: async (addr, name, payload) => {
      if (!window.confirm("Close the reality? This stops the running server for everyone.")) {
        throw new Error("cancelled");
      }
      return flat.doOp(addr, name, payload);
    },
  });
}

// ── tab → action definitions ───────────────────────────────────────

function placeActions(address, desc) {
  return [
    { label: "+ create child space", op: "create-space", address },
    { label: "edit this space", special: "edit-space", address, values: { name: desc.address?.leafName || "" } },
    { label: "+ create matter", op: "create-matter", address },
    { label: "move something", op: "move", address },
    { label: "plant a seed", op: "plant", address },
    { label: "set render", op: "set-render", address },
    { label: "author role (set-role)", op: "set-role", address },
    { label: "delete role", op: "delete-role", address },
    { label: "add contributor", op: "add-contributor", address },
    { label: "remove contributor", op: "remove-contributor", address },
    { label: "set owner", op: "set-owner", address },
    { label: "remove owner", op: "remove-owner", address },
    { label: "⚠ delete this space", op: "end-space", address, danger: true },
  ];
}

function branchActions(address) {
  return [
    { label: "fork a branch", op: "create-branch", address },
    { label: "merge branches", op: "merge-branches", address },
    { label: "pause branch", op: "pause-branch", address },
    { label: "unpause branch", op: "unpause-branch", address },
    { label: "delete branch", op: "delete-branch", address, danger: true },
    { label: "undelete branch", op: "undelete-branch", address },
    { label: "set pointer", op: "set-pointer", address },
    { label: "delete pointer", op: "delete-pointer", address },
    { label: "save clone (download)", op: "clone-subtree", special: "clone", address },
    { label: "graft a clone here", op: "graft-clone", address },
  ];
}

function realityActions(address) {
  return [
    { label: "form seed of reality", op: "capture-seed", address },
    { label: "set config", op: "set-config", address },
    { label: "delete config", op: "delete-config", address },
    { label: "⚠ close reality (exit server)", op: "close-reality", special: "close-reality", address, danger: true },
  ];
}

// ── plumbing ───────────────────────────────────────────────────────

// Mount a panel into the detail pane (same slot the inspector uses).
function openInspectorPanel(titleText) {
  document.getElementById("empty-detail")?.classList.add("hidden");
  document.getElementById("chat-panel")?.classList.add("hidden");
  const insp = document.getElementById("inspector");
  insp.classList.remove("hidden");
  insp.innerHTML = "";
  const head = document.createElement("div");
  head.className = "panel-header";
  head.textContent = titleText;
  insp.appendChild(head);
  const body = document.createElement("div");
  body.className = "task-form-body";
  insp.appendChild(body);
  return body;
}

// Re-SEE the current position so a mutation (new child, rename, …) shows.
function refreshView() {
  const addr = flat.state?.currentAddress;
  if (addr && typeof flat.navigate === "function") flat.navigate(addr);
}
