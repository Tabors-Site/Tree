// renderer.js — descriptor → DOM. Called by main.js after every SEE.
//
// The descriptor shape comes from seed/ibp/descriptor.js#buildPlaceDescriptor.
// We render four regions:
//   top    — parent link + address + identity chip
//   middle-left  — beings list + matter list
//   middle-right — inspector (selected target) or chat panel
//   bottom — children spaces
//
// All click handlers route back through `flat` (main.js): navigation
// updates location.hash; main.js's hashchange listener calls navigate().
// Chat opens via chat.js#openChatFor.

import { flat } from "./main.js";
import { openChatFor, isChatOpen, getChatBeing } from "./chat.js";
import { showAuthOverlay } from "./identity.js";

// ────────────────────────────────────────────────────────────────
// Public surface
// ────────────────────────────────────────────────────────────────

export function setStatus(text) {
  const el = document.getElementById("status-line");
  if (el) el.textContent = text;
}

export function clearDetail() {
  document.getElementById("inspector")?.classList.add("hidden");
  document.getElementById("chat-panel")?.classList.add("hidden");
  document.getElementById("empty-detail")?.classList.remove("hidden");
}

export function renderDescriptor(desc, { session, discovery }) {
  if (!desc) return;
  renderTopBar(desc, { session, discovery });
  renderBeings(desc, { session });
  renderMatter(desc, { session });
  renderChildren(desc, { discovery });
  // If chat is open, re-render it against the latest beings[] state so
  // inbox.recent stays fresh.
  if (isChatOpen()) {
    const being = getChatBeing();
    const entry = (desc.beings || []).find((b) => b.being === being);
    if (entry) {
      // chat.js owns its own re-render; call it to refresh inbox panel.
      openChatFor(entry, { refresh: true });
    }
  }
}

// ────────────────────────────────────────────────────────────────
// Top bar — parent / address / identity chip
// ────────────────────────────────────────────────────────────────

function renderTopBar(desc, { session, discovery }) {
  const parentEl  = document.getElementById("parent-link");
  const addrEl    = document.getElementById("address-line");
  const idEl      = document.getElementById("identity-chip");
  parentEl.innerHTML = "";
  addrEl.innerHTML   = "";
  idEl.innerHTML     = "";

  // Parent link: walk up the chain by dropping the last path segment.
  const path = desc.address?.pathByNames || "/";
  if (path !== "/" && path !== "") {
    const parts = path.split("/").filter(Boolean);
    parts.pop();
    const parentPath = parts.length ? "/" + parts.join("/") : "/";
    const parentAddr = `${discovery.reality}${parentPath === "/" ? "/" : parentPath}`;
    parentEl.appendChild(navLink("↑ parent", parentAddr));
  } else {
    parentEl.textContent = "↑ (at root)";
    parentEl.classList.add("dim");
  }

  addrEl.textContent = `${discovery.reality}${path === "/" ? "" : path}`;

  // Identity chip — shows current being, click to release / claim other.
  const username = session?.username || "arrival";
  const chip = document.createElement("button");
  chip.className = "chip";
  chip.textContent = session?.token ? `@${username}` : `@arrival`;
  chip.title = session?.token
    ? "click to release this session and reclaim as someone else"
    : "click to claim or register";
  chip.onclick = () => {
    if (session?.token) flat.signOut();
    else showAuthOverlay(discovery.reality);
  };
  idEl.appendChild(chip);
}

// ────────────────────────────────────────────────────────────────
// Beings list
// ────────────────────────────────────────────────────────────────

function renderBeings(desc, { session }) {
  const ul = document.getElementById("beings-list");
  ul.innerHTML = "";
  const beings = desc.beings || [];
  if (beings.length === 0) {
    ul.appendChild(emptyRow("(no beings here)"));
    return;
  }
  for (const b of beings) {
    const li = document.createElement("li");
    li.className = "list-row";

    const meta = document.createElement("div");
    meta.className = "row-meta";

    const name = document.createElement("span");
    name.className = "row-name";
    name.textContent = `@${b.being}`;
    meta.appendChild(name);

    if (b.respondMode) meta.appendChild(badge(b.respondMode, "mode"));
    if (b.available === false) meta.appendChild(badge("busy", "busy"));
    if (b.inbox?.unconsumed > 0) meta.appendChild(badge(`inbox ${b.inbox.unconsumed}`, "queue"));
    if (b.activity?.kind) meta.appendChild(badge(b.activity.kind, "activity"));

    li.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "row-actions";

    const inspectBtn = document.createElement("button");
    inspectBtn.textContent = "inspect";
    inspectBtn.className = "btn-sm";
    inspectBtn.onclick = () => showInspector({ kind: "being", entry: b });
    actions.appendChild(inspectBtn);

    const chatBtn = document.createElement("button");
    chatBtn.textContent = "chat";
    chatBtn.className = "btn-sm btn-primary";
    chatBtn.disabled = !session?.token;
    chatBtn.title = session?.token ? "summon this being" : "claim an identity first";
    chatBtn.onclick = () => openChatFor(b);
    actions.appendChild(chatBtn);

    li.appendChild(actions);
    ul.appendChild(li);
  }
}

// ────────────────────────────────────────────────────────────────
// Matter list
// ────────────────────────────────────────────────────────────────

function renderMatter(desc, _opts) {
  const ul = document.getElementById("matter-list");
  ul.innerHTML = "";
  const matters = desc.matters || [];
  if (matters.length === 0) {
    ul.appendChild(emptyRow("(no matter here)"));
    return;
  }
  for (const m of matters) {
    const li = document.createElement("li");
    li.className = "list-row";

    const meta = document.createElement("div");
    meta.className = "row-meta";

    const name = document.createElement("span");
    name.className = "row-name";
    name.textContent = m.name || "(unnamed)";
    meta.appendChild(name);

    if (m.origin) meta.appendChild(badge(m.origin, "origin"));
    if (m.preview) {
      const prev = document.createElement("span");
      prev.className = "row-preview";
      prev.textContent = m.preview.length > 60 ? m.preview.slice(0, 60) + "…" : m.preview;
      meta.appendChild(prev);
    }
    li.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "row-actions";
    const inspectBtn = document.createElement("button");
    inspectBtn.textContent = "inspect";
    inspectBtn.className = "btn-sm";
    inspectBtn.onclick = () => showInspector({ kind: "matter", entry: m });
    actions.appendChild(inspectBtn);
    li.appendChild(actions);

    ul.appendChild(li);
  }
}

// ────────────────────────────────────────────────────────────────
// Children
// ────────────────────────────────────────────────────────────────

function renderChildren(desc, { discovery }) {
  const ul = document.getElementById("children-list");
  ul.innerHTML = "";
  const children = desc.children || [];
  if (children.length === 0) {
    const li = document.createElement("li");
    li.className = "dim";
    li.textContent = "(no children)";
    ul.appendChild(li);
    return;
  }
  for (const c of children) {
    const li = document.createElement("li");
    const addr = `${discovery.reality}${c.path}`;
    li.appendChild(navLink(`↓ ${c.name}`, addr));
    ul.appendChild(li);
  }
}

// ────────────────────────────────────────────────────────────────
// Inspector — full descriptor surface + invocable BE/DO ops
// ────────────────────────────────────────────────────────────────

function showInspector({ kind, entry }) {
  const empty = document.getElementById("empty-detail");
  const chat  = document.getElementById("chat-panel");
  const insp  = document.getElementById("inspector");
  empty.classList.add("hidden");
  chat.classList.add("hidden");
  insp.classList.remove("hidden");
  insp.innerHTML = "";

  if (kind === "being")  renderBeingInspector(insp, entry);
  else                   renderMatterInspector(insp, entry);
}

// ── Being inspector ─────────────────────────────────────────────

function renderBeingInspector(insp, b) {
  const fl       = flat.state;
  const reality  = fl.discovery?.reality;
  const path     = fl.descriptor?.address?.pathByNames || "/";
  const stance   = `${reality}${path}@${b.being}`.replace(/\/+@/, "/@");
  const isSelf   = fl.session?.username === b.being;

  // Header
  const h = document.createElement("h3");
  h.className = "pane-title";
  h.textContent = `@${b.being}`;
  insp.appendChild(h);

  const sub = document.createElement("div");
  sub.className = "sub";
  sub.textContent = stance;
  insp.appendChild(sub);

  // ─── State badges (live face of this being right now)
  const state = section("state");
  state.appendChild(kv("invocable by", b.invocableBy || "(unknown)"));
  if (b.respondMode) state.appendChild(kv("respondMode", b.respondMode));
  if (Array.isArray(b.triggerOn) && b.triggerOn.length) {
    state.appendChild(kv("triggerOn", b.triggerOn.join(", ")));
  }
  state.appendChild(kv("available", b.available === false ? "no" : "yes"));
  if (b.busy) state.appendChild(kv("busy", b.talkingTo ? `talking to ${b.talkingTo}` : "yes"));
  if (b.activity) {
    const act = `${b.activity.kind}${b.activity.content ? ` — ${b.activity.content}` : ""}`;
    state.appendChild(kv("activity", act));
  }
  insp.appendChild(state);

  // ─── Inbox
  const ib = b.inbox || {};
  const inbox = section("inbox");
  inbox.appendChild(kv("total / unconsumed", `${ib.total ?? 0} / ${ib.unconsumed ?? 0}`));
  if (ib.queueDepth)   inbox.appendChild(kv("queue depth", ib.queueDepth));
  if (Array.isArray(ib.pendingFrom) && ib.pendingFrom.length) {
    inbox.appendChild(kv("pending from", ib.pendingFrom.join(", ")));
  }
  if (Array.isArray(ib.recent) && ib.recent.length) {
    const recentTitle = document.createElement("div");
    recentTitle.className = "kv-label";
    recentTitle.textContent = "recent";
    inbox.appendChild(recentTitle);
    const ul = document.createElement("ul");
    ul.className = "inbox-list";
    for (const r of ib.recent.slice(0, 5)) {
      const li = document.createElement("li");
      const w = document.createElement("span"); w.className = "msg-who"; w.textContent = r.from || "?";
      const c = document.createElement("span"); c.className = "msg-content"; c.textContent = " " + (r.content || "").slice(0, 80);
      li.appendChild(w); li.appendChild(c);
      ul.appendChild(li);
    }
    inbox.appendChild(ul);
  }
  insp.appendChild(inbox);

  // ─── Navigation: see this stance
  const nav = section("navigation");
  const link = document.createElement("a");
  link.className = "nav-link";
  link.href = "#" + stance;
  link.textContent = `→ see ${stance.replace(reality, "")}`;
  link.title = "navigate to this being's stance and re-SEE from there";
  nav.appendChild(link);
  insp.appendChild(nav);

  // ─── Permissions
  if (b.permissions && typeof b.permissions === "object" && Object.keys(b.permissions).length) {
    const sec = section("permissions");
    sec.appendChild(jsonBlock(b.permissions));
    insp.appendChild(sec);
  }

  // ─── Qualities
  if (b.qualities && typeof b.qualities === "object" && Object.keys(b.qualities).length) {
    const sec = section("qualities");
    sec.appendChild(jsonBlock(b.qualities));
    insp.appendChild(sec);
  }

  // ─── BE actions (identity ops on this being's stance)
  const be = section("BE actions");
  if (b.being === "cherub") {
    // Cherub is the authentication being. Show claim + register inline.
    be.appendChild(beInlineForm("claim",    stance, ["name", "password"]));
    be.appendChild(beInlineForm("register", stance, ["name", "password"]));
  } else {
    // For any other being: switch (reclaim) if you're not them; release if you are.
    if (isSelf) {
      be.appendChild(beButton("release", stance, {}));
    } else {
      be.appendChild(beInlineForm("switch", stance, ["password"]));
    }
  }
  insp.appendChild(be);

  // ─── DO actions (ops whose targets include being or stance)
  const ops = [
    ...flat.operationsForTarget("being"),
    ...flat.operationsForTarget("stance"),
  ];
  // De-dup by name (an op listing both targets shows once).
  const seen = new Set();
  const unique = ops.filter((o) => seen.has(o.name) ? false : (seen.add(o.name), true));
  if (unique.length) {
    const sec = section(`DO actions (${unique.length})`);
    for (const op of unique) sec.appendChild(doInlineForm(op, stance));
    insp.appendChild(sec);
  }
}

// ── Matter inspector ────────────────────────────────────────────

function renderMatterInspector(insp, m) {
  const fl      = flat.state;
  const reality = fl.discovery?.reality;
  const path    = fl.descriptor?.address?.pathByNames || "/";
  const matterAddress = `${reality}${path}`.replace(/\/+$/, "") || reality;

  const h = document.createElement("h3");
  h.className = "pane-title";
  h.textContent = m.name || "(matter)";
  insp.appendChild(h);

  const sub = document.createElement("div");
  sub.className = "sub";
  sub.textContent = `matterId ${m.matterId || "?"}`;
  insp.appendChild(sub);

  const meta = section("meta");
  if (m.origin)     meta.appendChild(kv("origin", m.origin));
  if (m.byBeingId)  meta.appendChild(kv("written by", m.byBeingId));
  insp.appendChild(meta);

  if (m.preview) {
    const sec = section("preview");
    const pre = document.createElement("pre");
    pre.className = "preview-block";
    pre.textContent = m.preview;
    sec.appendChild(pre);
    insp.appendChild(sec);
  }

  if (m.qualities && typeof m.qualities === "object" && Object.keys(m.qualities).length) {
    const sec = section("qualities");
    sec.appendChild(jsonBlock(m.qualities));
    insp.appendChild(sec);
  }

  // DO actions targeting matter
  const matterOps = flat.operationsForTarget("matter");
  if (matterOps.length) {
    const sec = section(`DO actions (${matterOps.length})`);
    for (const op of matterOps) sec.appendChild(doInlineForm(op, matterAddress, { matterId: m.matterId }));
    insp.appendChild(sec);
  }
}

// ── Form builders ───────────────────────────────────────────────

function beInlineForm(op, stance, fields) {
  const wrap = document.createElement("div");
  wrap.className = "action-row";

  const opLabel = document.createElement("code");
  opLabel.className = "op-label";
  opLabel.textContent = `BE.${op}`;
  wrap.appendChild(opLabel);

  const form = document.createElement("form");
  form.className = "action-form";

  const inputs = {};
  for (const f of fields) {
    const input = document.createElement("input");
    input.type = f === "password" ? "password" : "text";
    input.placeholder = f;
    input.className = "action-input";
    inputs[f] = input;
    form.appendChild(input);
  }

  const btn = document.createElement("button");
  btn.type = "submit";
  btn.className = "btn-sm btn-primary";
  btn.textContent = op;
  form.appendChild(btn);

  const result = document.createElement("div");
  result.className = "action-result hidden";

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const creds = {};
    for (const f of fields) creds[f] = inputs[f].value;
    showResult(result, "…", "pending");
    btn.disabled = true;
    try {
      const r = await flat.beOp(op, stance, creds);
      showResult(result, JSON.stringify(r, null, 2), "ok");
    } catch (err) {
      showResult(result, `${err.code || "error"}: ${err.message || String(err)}`, "err");
    } finally {
      btn.disabled = false;
    }
  };

  wrap.appendChild(form);
  wrap.appendChild(result);
  return wrap;
}

function beButton(op, stance, payload) {
  const wrap = document.createElement("div");
  wrap.className = "action-row";

  const opLabel = document.createElement("code");
  opLabel.className = "op-label";
  opLabel.textContent = `BE.${op}`;
  wrap.appendChild(opLabel);

  const btn = document.createElement("button");
  btn.className = "btn-sm";
  btn.textContent = op;
  wrap.appendChild(btn);

  const result = document.createElement("div");
  result.className = "action-result hidden";

  btn.onclick = async () => {
    showResult(result, "…", "pending");
    btn.disabled = true;
    try {
      const r = await flat.beOp(op, stance, payload || {});
      showResult(result, JSON.stringify(r, null, 2), "ok");
    } catch (err) {
      showResult(result, `${err.code || "error"}: ${err.message || String(err)}`, "err");
    } finally {
      btn.disabled = false;
    }
  };

  wrap.appendChild(result);
  return wrap;
}

function doInlineForm(op, address, baseArgs = {}) {
  const wrap = document.createElement("div");
  wrap.className = "action-row";

  const opLabel = document.createElement("code");
  opLabel.className = "op-label";
  opLabel.textContent = op.name;
  opLabel.title = `targets: ${op.targets.join(", ") || "?"} • from ${op.ownerExtension}`;
  wrap.appendChild(opLabel);

  const form = document.createElement("form");
  form.className = "action-form";

  const args = document.createElement("input");
  args.type = "text";
  args.placeholder = Object.keys(baseArgs).length
    ? `args JSON (defaults: ${JSON.stringify(baseArgs)})`
    : "args JSON (or empty for {})";
  args.className = "action-input";
  form.appendChild(args);

  const btn = document.createElement("button");
  btn.type = "submit";
  btn.className = "btn-sm btn-primary";
  btn.textContent = "do";
  form.appendChild(btn);

  const result = document.createElement("div");
  result.className = "action-result hidden";

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    let extra = {};
    if (args.value.trim()) {
      try { extra = JSON.parse(args.value); }
      catch (e) { showResult(result, `parse error: ${e.message}`, "err"); return; }
    }
    showResult(result, "…", "pending");
    btn.disabled = true;
    try {
      const r = await flat.doOp(address, op.name, { ...baseArgs, ...extra });
      showResult(result, JSON.stringify(r, null, 2), "ok");
    } catch (err) {
      showResult(result, `${err.code || "error"}: ${err.message || String(err)}`, "err");
    } finally {
      btn.disabled = false;
    }
  };

  wrap.appendChild(form);
  wrap.appendChild(result);
  return wrap;
}

function showResult(el, text, kind) {
  el.className = `action-result action-${kind}`;
  el.classList.remove("hidden");
  el.textContent = text;
}

// ── Small structural helpers ────────────────────────────────────

function section(title) {
  const sec = document.createElement("div");
  sec.className = "panel-section";
  const h = document.createElement("h4");
  h.textContent = title;
  sec.appendChild(h);
  return sec;
}

function kv(label, value) {
  const row = document.createElement("div");
  row.className = "kv";
  const l = document.createElement("span");
  l.className = "kv-label";
  l.textContent = label;
  const v = document.createElement("span");
  v.className = "kv-value";
  v.textContent = value == null ? "(none)" : String(value);
  row.appendChild(l);
  row.appendChild(v);
  return row;
}

function jsonBlock(obj) {
  const pre = document.createElement("pre");
  pre.className = "json";
  pre.textContent = JSON.stringify(obj, null, 2);
  return pre;
}

// ────────────────────────────────────────────────────────────────
// Small helpers
// ────────────────────────────────────────────────────────────────

function navLink(label, address) {
  const a = document.createElement("a");
  a.className = "nav-link";
  a.href = "#" + address;
  a.textContent = label;
  return a;
}

function badge(text, kind) {
  const span = document.createElement("span");
  span.className = `badge badge-${kind}`;
  span.textContent = text;
  return span;
}

function emptyRow(text) {
  const li = document.createElement("li");
  li.className = "dim";
  li.textContent = text;
  return li;
}

