// task-bar.js — THE action menubar (the text view's main feature).
//
// Window-menu style: a row of context tabs keyed off the IBPA. Each
// tab opens a dropdown; clicking an action mounts its form/panel in
// the work area (the detail pane). Scope runs broadest → narrowest:
//
//   Story  — what affects the whole story / server (form seed,
//              config, close story).
//   History  — the history lifecycle (fork, merge, pause, pointers)
//              plus clone (download) and graft (paste-in).
//   Place    — what acts on the space you're standing in (create
//              space/matter, move, plant, roles, render, delete).
//   @being   — appears when the IBPA's right stance carries a being
//              (clicked in ANY view): chat, inspect, the being's
//              summon intents, and its role's verb actions.
//
// The inbox (your work queue) rides the right edge of the bar.
//
// Built as a small registry so more tabs/actions can be added later. The
// server auth-gates every op, so an action a viewer can't perform simply
// returns FORBIDDEN; the bar steers, it doesn't pre-authorize.

import { flat, refreshInboxCount } from "./host.js";
import { openChatFor } from "./chat.js";
import { renderOpForm } from "../shared/op-form.js";
import { renderRolesPanel } from "./roles-panel.js";
import { renderLlmPanel } from "./llm-panel.js";
import { renderInboxPanel } from "./inbox-panel.js";
import { renderMatterComposer } from "./matter-composer.js";
import { renderIdentityPanel } from "../shared/identity-panel.js";
import { renderPeersPanel } from "./peers-panel.js";
import { renderFederationPanel } from "./federation-panel.js";

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
  const story =
    discovery?.story || desc.address?.story || desc.address?.place || "";
  const path = desc.address?.pathByNames || "/";
  const positionAddress = `${story}${path === "/" ? "/" : path}`;
  const rootAddress = `${story}/`;

  const loadedOps = flat.state?.operations || [];
  const opByName = new Map(loadedOps.map((op) => [op.name, op]));
  // The .operations catalog loads async after mount. Until it arrives,
  // don't filter — show every action optimistically rather than collapsing
  // each tab to its special-only entries. Once loaded, hide ops a story
  // genuinely doesn't register.
  const opsLoaded = loadedOps.length > 0;

  // Order: Story (far left), History, Place — broadest scope to
  // narrowest, like a window menu bar.
  const tabs = [
    { id: "story", label: "Story", actions: storyActions(rootAddress) },
    { id: "branch", label: "History", actions: historyActions(positionAddress) },
    { id: "place", label: "Place", actions: placeActions(positionAddress, desc) },
    { id: "federation", label: "Federation", actions: federationActions() },
  ];

  // The @being menu — narrowest scope, keyed off the IBPA's right
  // stance. A being selected in ANY view (or an explicitly navigated
  // stance address) puts its menu here; the dispatch stance is the
  // same string the bar shows.
  const selName = flat.state?.selectedBeing?.name || desc.address?.being || null;
  const beingEntry = selName
    ? (desc.beings || []).find((b) => (b.being || b.name) === selName)
      || (desc.residents || []).find((b) => (b.being || b.name) === selName)
    : null;
  if (beingEntry) {
    const history = desc.address?.history || "0";
    const bq = history === "0" ? "" : `#${history}`;
    const stance = `${story}${bq}${path}@${selName}`.replace(/\/+@/, "/@");
    tabs.push({
      id: "being",
      label: `@${selName}`,
      actions: beingActions(beingEntry, stance),
    });
  }

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

  // The inbox — your work queue — rides the right edge of the bar.
  // The badge elements re-render with the bar; host.js's poll keeps
  // the count fresh by id.
  const spacer = document.createElement("div");
  spacer.className = "task-spacer";
  tabRow.appendChild(spacer);
  const inboxBtn = document.createElement("button");
  inboxBtn.type = "button";
  inboxBtn.id = "inbox-chip";
  inboxBtn.className = "task-tab task-inbox";
  inboxBtn.title = "your inbox — pending summons addressed to you";
  inboxBtn.innerHTML = `inbox <span id="inbox-count" class="dim">·</span>`;
  inboxBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeDropdown();
    openInboxAction();
  });
  tabRow.appendChild(inboxBtn);
  refreshInboxCount?.();

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
    // Once the op catalog is loaded, skip actions whose op this story
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
  // Being actions that own their panel (chat) or navigate — handled
  // before the generic inspector panel opens.
  if (action.special === "being-chat") {
    return openChatFor(action.being);
  }
  if (action.special === "being-inspect") {
    // Dynamic import: renderer.js statically imports this file; a
    // static back-import would be a cycle.
    return import("./renderer.js").then((m) => m.showInspector({ kind: "being", entry: action.being }));
  }
  if (action.special === "being-facts" || action.special === "being-acts") {
    const story = flat.state?.discovery?.story || "";
    const history = flat.state?.descriptor?.address?.history || "0";
    const bq = history === "0" ? "" : `#${history}`;
    const id = action.being?.beingId;
    if (!id) return;
    const path = action.special === "being-facts" ? `/.reel/being/${id}` : `/.acts/${id}`;
    return flat.navigate(`${story}${bq}${path}`);
  }

  const body = openInspectorPanel(action.label);

  if (action.special === "being-identity") {
    return renderIdentityPanel(body, { state: flat.state, see: flat.see, being: action.being });
  }
  if (action.special === "being-intent") {
    return renderIntentSummon(body, action);
  }
  if (action.special === "being-verb") {
    return renderBeingVerb(body, action, opByName);
  }
  if (action.special === "edit-space") {
    return renderEditSpace(body, action);
  }
  if (action.special === "create-matter") {
    return renderMatterComposer(body, action, { refreshView });
  }
  if (action.special === "clone") {
    return renderClone(body, action, opByName);
  }
  if (action.special === "close-story") {
    return renderCloseStory(body, action, opByName);
  }
  if (action.special === "roles") {
    return renderRolesPanel(body, action, opByName, { refreshView });
  }
  if (action.special === "llm") {
    return renderLlmPanel(body, action, opByName, { refreshView, mode: "place" });
  }
  if (action.special === "llm-story") {
    return renderLlmPanel(body, action, opByName, { refreshView, mode: "story" });
  }
  if (action.special === "inbox") {
    return renderInboxPanel(body, action, opByName, { refreshView });
  }
  if (action.special === "federation-peers") {
    return renderPeersPanel(body, action, opByName, { refreshView });
  }
  if (action.special === "federation-activity") {
    return renderFederationPanel(body, action, opByName, { refreshView });
  }
  if (action.special === "branch-info") {
    return renderHistoryInfo(body);
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

// External opener for the inbox panel. The inbox is per-being and the
// identity chip mounts it directly rather than burying it in
// placeActions. Host code calls this when the user clicks the inbox
// chip in the header.
export function openInboxAction() {
  const body = openInspectorPanel("your inbox");
  return renderInboxPanel(body, { label: "your inbox" }, new Map(), {
    refreshView: () => {},
  });
}

// External opener for the identity panel. The identity chip in the
// header mounts it directly: your name (the label), your key (the
// permanent id), key export, password ops, story provenance, and
// sign-out (which moved here off the chip).
export function openIdentityAction() {
  const body = openInspectorPanel("your identity");
  return renderIdentityPanel(body, {
    state: flat.state,
    doOp: flat.doOp,
    see: flat.see,
    beOp: flat.beOp,
    signIn: flat.signIn,
    signOut: flat.signOut,
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

// capture-template is a SEE op (pure read; no Fact stamped). The portal
// downloads the returned bundle as JSON rather than printing it.
// Custom dispatcher wraps the download and returns a summary.
function renderClone(body, action, _opByName) {
  // Synthetic op-form spec — capture-template is a SEE op, so it's not in
  // the DO opByName map. We render a one-field form for the optional
  // clone name, then dispatch via flat.state.client.see with the
  // current spaceId.
  const op = {
    name: "capture-template",
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
      const r = await flat.state.client.see("capture-template", {
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
      a.download = `${label}-${stamp}.seed.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      const c = bundle.content || {};
      return {
        downloaded: `${label}-${stamp}.seed.json`,
        spaces: c.spaces?.length || 0,
        beings: c.beings?.length || 0,
        matter: c.matter?.length || 0,
      };
    },
  });
}

// close-story stops the server. Confirm before firing.
function renderCloseStory(body, action, opByName) {
  const op = opByName.get("close-story") || { name: "close-story", args: {} };
  renderOpForm(body, {
    op,
    address: action.address,
    submitLabel: "⚠ close story",
    doOp: async (addr, name, payload) => {
      if (!window.confirm("Close the story? This stops the running server for everyone.")) {
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
      name:     { type: "text", label: "Name (kebab-case, unique on this story)", required: true },
      password: { type: "text", label: "Password (placeholder; substitute future credential)", required: true },
    },
  };
  const story = (flat.state?.discovery?.story || "").replace(/\/+$/, "");
  const myName = flat.state?.session?.username || null;
  if (!myName) {
    body.textContent = "sign in first to birth a being (your stance is the target — the caller becomes mother).";
    return;
  }
  const selfStance = `${story}/@${myName}`;
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

// who/when. Reads the synthetic `<story>/.branches/<path>` SEE
// (readable by any logged-in being); no mutation.
async function renderHistoryInfo(body) {
  const story = flat.state?.discovery?.story
    || flat.state?.descriptor?.address?.story
    || flat.state?.descriptor?.address?.place || "";
  const client = flat.state?.client;
  if (!client) { body.textContent = "portal not ready"; return; }
  const currentHistory = flat.state?.descriptor?.address?.history || "0";

  const pickWrap = document.createElement("div");
  pickWrap.className = "op-field";
  const lbl = document.createElement("label");
  lbl.textContent = "history";
  const select = document.createElement("select");
  select.className = "op-input";
  pickWrap.appendChild(lbl);
  pickWrap.appendChild(select);
  body.appendChild(pickWrap);

  const info = document.createElement("div");
  info.className = "branch-info-body";
  info.textContent = "loading…";
  body.appendChild(info);

  const branches = await _loadAllBranches(client, story);
  select.innerHTML = "";
  for (const b of branches) {
    const o = document.createElement("option");
    o.value = b.path;
    o.textContent = b.path === "0"
      ? "main (#0)"
      : `#${b.path}${b.label ? ` — ${b.label}` : ""}`;
    select.appendChild(o);
  }
  select.value = branches.some((b) => b.path === currentHistory) ? currentHistory : (branches[0]?.path || "0");

  const renderFor = async (path) => {
    info.innerHTML = "";
    info.textContent = "loading…";
    let graph = null, err = null;
    try {
      const desc = await client.see(`${story}/.branches/${path}`);
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
async function _loadAllBranches(client, story) {
  const out = new Map();
  const seen = new Set();
  async function visit(path, depth) {
    if (depth > 6 || seen.has(path)) return;
    seen.add(path);
    try {
      const desc = await client.see(`${story}/.branches/${path}`);
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
  _branchKv(container, "scope", cur.scope?.path ? `subtree ${cur.scope.path}` : "whole story");
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

// ── being actions (the @being menu) ────────────────────────────────
//
// World-driven, same rule as the 3D action menu: the portal doesn't
// know what a being does — it renders the summon intents the role
// declares (canSummon as:"receiver") and the verb actions[] the
// descriptor carries, plus the universal four: chat, inspect, facts,
// acts. Dispatch is against the IBPA stance the bar shows.

function beingActions(entry, stance) {
  const items = [
    { label: "chat (summon)", special: "being-chat", being: entry },
    { label: "inspect", special: "being-inspect", being: entry },
  ];
  for (const offer of (Array.isArray(entry.canSummon) ? entry.canSummon : [])) {
    if (offer && offer.as === "receiver" && offer.intent) {
      items.push({
        label: `summon: ${offer.intent}`,
        special: "being-intent",
        being: entry,
        intent: offer.intent,
        address: stance,
      });
    }
  }
  for (const a of (Array.isArray(entry.actions) ? entry.actions : [])) {
    items.push({
      label: a.label || `${a.verb} ${a.action}`,
      special: "being-verb",
      being: entry,
      beingAction: a,
      address: stance,
    });
  }
  if (entry.beingId) {
    items.push({ label: "identity (key)", special: "being-identity", being: entry });
    items.push({ label: "view facts (reel)", special: "being-facts", being: entry });
    items.push({ label: "view acts (chain)", special: "being-acts", being: entry });
  }
  return items;
}

// Intent-qualified summon: one content field, dispatched with the
// envelope intent the receiver's role declared.
function renderIntentSummon(body, action) {
  const op = {
    name: `summon (${action.intent})`,
    args: { content: { type: "multiline", label: "message", required: true } },
  };
  renderOpForm(body, {
    op,
    address: action.address,
    submitLabel: `summon: ${action.intent}`,
    doOp: async (_addr, _name, payload) => {
      const { correlation, reply } = await flat.sendSummon(
        action.address, payload.content || "", { intent: action.intent },
      );
      return { sent: true, correlation, reply: reply?.status || reply || null };
    },
  });
}

// A verb action from the being's descriptor actions[] block. DO renders
// the registered op form at the being's stance; BE dispatches through
// flat.beOp; SUMMON falls back to chat.
function renderBeingVerb(body, action, opByName) {
  const a = action.beingAction;
  if (a.verb === "call") {
    return openChatFor(action.being);
  }
  if (a.verb === "be") {
    const op = { name: `be:${a.action}`, args: a.args || {} };
    return renderOpForm(body, {
      op,
      address: action.address,
      submitLabel: a.label || a.action,
      doOp: (_addr, _name, payload) => flat.beOp(a.action, action.address, payload),
    });
  }
  // DO — prefer the registered op's arg schema; fall back to the
  // action's own.
  const op = opByName.get(a.action) || { name: a.action, args: a.args || null };
  renderOpForm(body, {
    op,
    address: action.address,
    submitLabel: a.label || "run",
    doOp: flat.doOp,
    onResult: (err) => { if (!err) refreshView(); },
  });
}

// ── tab → action definitions ───────────────────────────────────────

function placeActions(address, desc) {
  return [
    { label: "+ create child space", op: "create-space", address },
    { label: "edit this space", special: "edit-space", address, values: { name: (desc.address?.pathByNames || "").split("/").filter(Boolean).pop() || "" } },
    // The PLACE flow — drop a file / paste a URL / type text, live
    // "will become: <type>" preview, one create-matter DO. The
    // composer panel replaces the generic op form (which still
    // exists for any op without a special).
    { label: "+ create matter", special: "create-matter", op: "create-matter", address },
    // be:birth on self. The actor becomes mother of a new child
    // being on this story. Solo birth — no father; child's identity
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
    // LLM panel: the 7-step chain preview + connection management +
    // per-being / per-space slot assignments + force flags. Anyone can
    // configure their own being; the space + story writes are
    // owner/angel-gated by the substrate. See llm-panel.js.
    { label: "llm", special: "llm", address, values: { descriptor: desc } },
    // (Inbox is per-being, not per-place — surfaced as a chip in the
    // identity bar, not in placeActions. See openInboxAction below.)
    { label: "set owner", op: "set-owner", address },
    { label: "remove owner", op: "remove-owner", address },
    { label: "⚠ delete this space", op: "end-space", address, danger: true },
  ];
}

function historyActions(address) {
  return [
    { label: "view history info", special: "branch-info" },
    { label: "fork a branch", op: "create-branch", address },
    { label: "merge histories", op: "merge-histories", address },
    { label: "pause history", op: "pause-history", address },
    { label: "unpause history", op: "unpause-history", address },
    { label: "delete history", op: "delete-history", address, danger: true },
    { label: "undelete history", op: "undelete-history", address },
    { label: "set pointer", op: "set-pointer", address },
    { label: "delete pointer", op: "delete-pointer", address },
    { label: "save clone (download)", op: "capture-template", special: "clone", address },
    { label: "graft a clone here", op: "plant-template", address },
  ];
}

function storyActions(address) {
  return [
    { label: "form seed of story", op: "capture-graft", address },
    { label: "set config", op: "set-config", address },
    { label: "delete config", op: "delete-config", address },
    // Story-level roles. The story root hosts the foundational
    // roles (global, human, arrival, cherub, ...) in qualities.roles.
    // Same panel as the place-tab "roles" entry, just rooted at /.
    // Owners of the story root (the I-Am + anointed angels) get the
    // author-role form for system-wide roles.
    { label: "roles (story-wide)", special: "roles", address },
    // Story-level LLM. Angels can configure the floor every chain
    // falls through to at step 4 (qualities.llm on the story root):
    // default fallback list, per-role slots, force flags.
    { label: "llm (story defaults)", special: "llm-story", address },
    { label: "⚠ close story (exit server)", op: "close-story", special: "close-story", address, danger: true },
  ];
}

// Federation tab — story-scoped peer transfers. Both panels act on the
// local @federation-manager: peers is the outbound surface (graft a being,
// offer / request a template), activity is the incoming / in-flight queue.
// No `op` field: these are special panels, always shown (not catalog-gated).
function federationActions() {
  return [
    { label: "peers (graft / send / request)", special: "federation-peers" },
    { label: "activity (incoming / in flight)", special: "federation-activity" },
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
