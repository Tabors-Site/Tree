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
import { renderRolesPanel } from "./roles-panel.js";

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
  if (action.special === "roles") {
    return renderRolesPanel(body, action, opByName, { refreshView });
  }
  if (action.special === "branch-info") {
    return renderBranchInfo(body);
  }
  if (action.special === "birth-self") {
    return renderBirthSelf(body, action);
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

// clone-subtree is a SEE op (pure read; no Fact stamped). The portal
// downloads the returned bundle as JSON rather than printing it.
// Custom dispatcher wraps the download and returns a summary.
function renderClone(body, action, _opByName) {
  // Synthetic op-form spec — clone-subtree is a SEE op, so it's not in
  // the DO opByName map. We render a one-field form for the optional
  // clone name, then dispatch via flat.state.client.see with the
  // current spaceId.
  const op = {
    name: "clone-subtree",
    args: { name: { type: "text", label: "Clone name (optional)", required: false } },
  };
  renderOpForm(body, {
    op,
    address: action.address,
    submitLabel: "download clone",
    doOp: async (_addr, _name, payload) => {
      const spaceId = flat.state.descriptor?.address?.spaceId
        || flat.state.descriptor?.position?.spaceId
        || null;
      if (!spaceId) throw new Error("no spaceId on current descriptor to clone from");
      const r = await flat.state.client.see("clone-subtree", {
        args: { spaceId, name: payload.name || null },
      });
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

// "view branch info" — pick any branch and see its full record: the
// branch-point seqs, pointers aimed at it, scope, lineage, children,
// be:birth on self. Prompts for a name + password; dispatches BE:birth
// against the caller's OWN stance. The current user becomes the new
// being's parent (the mother, per the federation doctrine). Solo
// birth — father stays null.
//
// Doctrinally: be:birth is the only birth verb. Target = own stance
// means "I am the mother of a new being." The wire dispatcher
// (verbs/be.js) detects target === caller's stance and routes through
// birthBeing directly. No @birther intermediary.
function renderBirthSelf(body, action) {
  const op = {
    name: "be:birth",
    args: {
      name:     { type: "text", label: "Name (kebab-case, unique on this reality)", required: true },
      password: { type: "text", label: "Password (placeholder; substitute future credential)", required: true },
    },
  };
  const reality = (flat.state?.discovery?.reality || "").replace(/\/+$/, "");
  const myName = flat.state?.session?.username || null;
  if (!myName) {
    body.textContent = "sign in first to birth a being (your stance is the target — the caller becomes mother).";
    return;
  }
  const selfStance = `${reality}/@${myName}`;
  renderOpForm(body, {
    op,
    address:     selfStance,
    values:      action.values || {},
    submitLabel: "birth",
    doOp: async (_addr, _opName, payload) => {
      if (typeof flat.beOp !== "function") {
        throw new Error("flat.beOp not available; refresh and try again");
      }
      return flat.beOp("birth", selfStance, payload);
    },
    onResult: (err) => { if (!err) { /* parent stays at current view */ } },
  });
}

// who/when. Reads the synthetic `<reality>/.branches/<path>` SEE
// (readable by any logged-in being); no mutation.
async function renderBranchInfo(body) {
  const reality = flat.state?.discovery?.reality
    || flat.state?.descriptor?.address?.reality
    || flat.state?.descriptor?.address?.place || "";
  const client = flat.state?.client;
  if (!client) { body.textContent = "portal not ready"; return; }
  const currentBranch = flat.state?.descriptor?.address?.branch || "0";

  const pickWrap = document.createElement("div");
  pickWrap.className = "op-field";
  const lbl = document.createElement("label");
  lbl.textContent = "branch";
  const select = document.createElement("select");
  select.className = "op-input";
  pickWrap.appendChild(lbl);
  pickWrap.appendChild(select);
  body.appendChild(pickWrap);

  const info = document.createElement("div");
  info.className = "branch-info-body";
  info.textContent = "loading…";
  body.appendChild(info);

  const branches = await _loadAllBranches(client, reality);
  select.innerHTML = "";
  for (const b of branches) {
    const o = document.createElement("option");
    o.value = b.path;
    o.textContent = b.path === "0"
      ? "main (#0)"
      : `#${b.path}${b.label ? ` — ${b.label}` : ""}`;
    select.appendChild(o);
  }
  select.value = branches.some((b) => b.path === currentBranch) ? currentBranch : (branches[0]?.path || "0");

  const renderFor = async (path) => {
    info.innerHTML = "";
    info.textContent = "loading…";
    let graph = null, err = null;
    try {
      const desc = await client.see(`${reality}/.branches/${path}`);
      graph = desc?.branches || null;
    } catch (e) {
      err = e?.code ? `${e.code}: ${e.message || ""}` : (e?.message || String(e));
    }
    info.innerHTML = "";
    _renderBranchInfoFields(info, path, graph, err);
  };
  select.addEventListener("change", () => renderFor(select.value));
  await renderFor(select.value);
}

// Recursively walk `.branches/<path>` to collect every branch for the
// picker. Depth-capped + seen-guarded like the 3D loader. Best-effort:
// a failed sub-fetch just leaves that subtree out of the list.
async function _loadAllBranches(client, reality) {
  const out = new Map();
  const seen = new Set();
  async function visit(path, depth) {
    if (depth > 6 || seen.has(path)) return;
    seen.add(path);
    try {
      const desc = await client.see(`${reality}/.branches/${path}`);
      const g = desc?.branches;
      if (!g) return;
      if (g.current) out.set(g.current.path, g.current.label || null);
      for (const ch of (g.children || [])) out.set(ch.path, ch.label || null);
      for (const ch of (g.children || [])) await visit(ch.path, depth + 1);
    } catch { /* leave this subtree out */ }
  }
  await visit("0", 0);
  if (!out.has("0")) out.set("0", "main");
  return [...out.entries()]
    .map(([path, label]) => ({ path, label }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function _branchKv(container, k, v) {
  const row = document.createElement("div");
  row.className = "kv-block";
  const l = document.createElement("span");
  l.className = "kv-block-label";
  l.textContent = k;
  const val = document.createElement("span");
  val.className = "kv-block-value";
  val.textContent = v;
  row.appendChild(l);
  row.appendChild(val);
  container.appendChild(row);
}

function _renderBranchInfoFields(container, path, graph, err) {
  const cur = graph?.current;
  if (err || !cur) {
    const d = document.createElement("div");
    d.className = "action-result action-err";
    d.textContent = err || `branch "${path}" not found`;
    container.appendChild(d);
    return;
  }
  const pointers = graph.pointers || {};
  const aimed = Object.keys(pointers).filter((n) => pointers[n] === path).sort();
  const lineage = Array.isArray(graph.lineage) ? graph.lineage : [];
  const children = Array.isArray(graph.children) ? graph.children : [];

  _branchKv(container, "path", `#${cur.path}`);
  if (cur.label) _branchKv(container, "label", cur.label);
  _branchKv(container, "live", cur.isLive ? "yes" : "no");
  _branchKv(container, "parent", cur.parent ? `#${cur.parent}` : "main (root)");
  _branchKv(container, "lineage", lineage.map((p) => `#${p}`).join(" → ") || "—");
  _branchKv(container, "children", children.length ? children.map((c) => `#${c.path}`).join(", ") : "—");
  _branchKv(container, "pointers here", aimed.length ? aimed.join(", ") : "—");
  const anchor = cur.anchor && typeof cur.anchor === "object" ? cur.anchor : {};
  const ak = Object.keys(anchor);
  _branchKv(container, "branch-point", ak.length ? ak.map((k) => `${k} @ seq ${anchor[k]}`).join(", ") : "(forked at genesis / no reels)");
  _branchKv(container, "scope", cur.scope?.path ? `subtree ${cur.scope.path}` : "whole reality");
  _branchKv(container, "created", `${cur.createdAt || "?"}${cur.createdBy ? ` by ${String(cur.createdBy).slice(0, 8)}` : ""}`);
  if (cur.mergeSources?.length) _branchKv(container, "merged from", cur.mergeSources.map((s) => `#${s}`).join(" + "));
  if (cur.paused) _branchKv(container, "paused", `yes${cur.pausedAt ? ` (${cur.pausedAt})` : ""}`);
  if (cur.deleted) _branchKv(container, "deleted", `yes${cur.deletedAt ? ` (${cur.deletedAt})` : ""}`);
  if (cur.archivedBecause) _branchKv(container, "archived", cur.archivedBecause);

  const rawBtn = document.createElement("button");
  rawBtn.type = "button";
  rawBtn.className = "btn-sm";
  rawBtn.textContent = "show raw JSON";
  rawBtn.style.marginTop = "8px";
  const pre = document.createElement("pre");
  pre.className = "json";
  pre.style.display = "none";
  rawBtn.onclick = () => {
    if (pre.style.display === "none") {
      pre.textContent = JSON.stringify(graph, null, 2);
      pre.style.display = "block";
      rawBtn.textContent = "hide raw JSON";
    } else {
      pre.style.display = "none";
      rawBtn.textContent = "show raw JSON";
    }
  };
  container.appendChild(rawBtn);
  container.appendChild(pre);
}

// ── tab → action definitions ───────────────────────────────────────

function placeActions(address, desc) {
  return [
    { label: "+ create child space", op: "create-space", address },
    { label: "edit this space", special: "edit-space", address, values: { name: desc.address?.leafName || "" } },
    { label: "+ create matter", op: "create-matter", address },
    // be:birth on self. The actor becomes mother of a new child
    // being on this reality. Solo birth — no father; child's identity
    // chain traces only through the actor. The current path routes
    // through @birther's BE:birth (existing mint flow; the new being's
    // tree parent is the caller). See FEDERATION.md "be:birth is the
    // only birth verb."
    { label: "+ birth a being (you become mother)", special: "birth-self", address },
    { label: "move something", op: "move", address },
    { label: "plant a seed", op: "plant", address },
    { label: "set render", op: "set-render", address },
    { label: "delete role", op: "delete-role", address },
    // Roles panel: roles in effect at this position (walk ancestor
    // qualities.roles), the viewer's held grants that reach here,
    // and an author-role form for owners. Replaces the retired
    // qualities.permissions panel. See roles-panel.js.
    { label: "roles", special: "roles", address, values: { descriptor: desc } },
    { label: "+ add member (any class)", op: "add-member", address },
    { label: "remove member", op: "remove-member", address },
    { label: "set owner", op: "set-owner", address },
    { label: "remove owner", op: "remove-owner", address },
    { label: "⚠ delete this space", op: "end-space", address, danger: true },
  ];
}

function branchActions(address) {
  return [
    { label: "view branch info", special: "branch-info" },
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
    // Reality-level roles. The reality root hosts the foundational
    // roles (global, human, arrival, cherub, ...) in qualities.roles.
    // Same panel as the place-tab "roles" entry, just rooted at /.
    // Owners of the reality root (the I-Am + anointed angels) get the
    // author-role form for system-wide roles.
    { label: "roles (reality-wide)", special: "roles", address },
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
