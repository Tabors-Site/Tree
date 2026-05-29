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
  // Explorer dispatch — .reel/<kind>/<id> and .acts/<beingId> return
  // synthetic descriptors with isReel / isActChain flags. Take over
  // the middle area and render the chain explorer instead of the
  // normal position layout.
  if (desc.isReel || desc.isActChain) {
    renderExplorer(desc, { discovery });
    return;
  }
  // Restore normal layout (in case we came back from an explorer view).
  restoreNormalLayout();
  renderBeings(desc, { session, discovery });
  renderMatter(desc, { session, discovery });
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

// Hide explorer DOM and show the normal two-pane position layout.
// Called whenever a non-explorer descriptor arrives.
function restoreNormalLayout() {
  const explorer = document.getElementById("explorer-pane");
  if (explorer) explorer.remove();
  document.getElementById("position-pane")?.classList.remove("hidden");
  document.getElementById("detail-pane")?.classList.remove("hidden");
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

  // "facts on this space" link — opens the reel explorer for the
  // current spaceId. Only shown on normal position views (not on
  // explorer views themselves; those land on .reel/... / .acts/...
  // paths and don't carry a spaceId).
  const spaceId = desc.address?.spaceId;
  if (spaceId && !desc.isReel && !desc.isActChain) {
    const sep = document.createElement("span");
    sep.className = "dim sep";
    sep.textContent = " · ";
    addrEl.appendChild(sep);
    const reelLink = document.createElement("a");
    reelLink.href = `#${discovery.reality}/.reel/space/${spaceId}`;
    reelLink.className = "explorer-link";
    reelLink.textContent = "⛓ facts";
    reelLink.title = "view this space's fact reel (hash-chained explorer)";
    addrEl.appendChild(reelLink);
  }

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

function renderBeings(desc, { session, discovery }) {
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

    // Explorer links — beings get both a fact-reel and an act-chain.
    // The being's id (when present) drives the synthetic SEE paths.
    const beingId = b.beingId || null;
    if (beingId && discovery?.reality) {
      const factsA = document.createElement("a");
      factsA.className = "btn-sm btn-explore";
      factsA.href = `#${discovery.reality}/.reel/being/${beingId}`;
      factsA.textContent = "facts";
      factsA.title = "this being's fact reel";
      actions.appendChild(factsA);

      const actsA = document.createElement("a");
      actsA.className = "btn-sm btn-explore";
      actsA.href = `#${discovery.reality}/.acts/${beingId}`;
      actsA.textContent = "acts";
      actsA.title = "this being's act-chain";
      actions.appendChild(actsA);
    }

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

function renderMatter(desc, { discovery } = {}) {
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

    // Explorer link — open this matter's fact reel.
    if (m.matterId && discovery?.reality) {
      const factsA = document.createElement("a");
      factsA.className = "btn-sm btn-explore";
      factsA.href = `#${discovery.reality}/.reel/matter/${m.matterId}`;
      factsA.textContent = "facts";
      factsA.title = "this matter's fact reel";
      actions.appendChild(factsA);
    }

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

// ────────────────────────────────────────────────────────────────
// Explorer — block-list view for .reel/<kind>/<id> and .acts/<beingId>
// ────────────────────────────────────────────────────────────────

function renderExplorer(desc, { discovery }) {
  // Hide the normal two-pane layout; mount an #explorer-pane spanning
  // the middle region. Re-mounted each call so navigation between
  // explorer addresses doesn't accumulate stale rows.
  const middle = document.getElementById("middle");
  document.getElementById("position-pane")?.classList.add("hidden");
  document.getElementById("detail-pane")?.classList.add("hidden");
  let pane = document.getElementById("explorer-pane");
  if (pane) pane.remove();
  pane = document.createElement("section");
  pane.id = "explorer-pane";
  middle.appendChild(pane);

  if (desc.isReel) renderReelExplorer(pane, desc.reel, discovery);
  else if (desc.isActChain) renderActChainExplorer(pane, desc.actChain, discovery);
}

function renderReelExplorer(pane, reel, discovery) {
  const { target, facts, count } = reel || {};

  const header = document.createElement("header");
  header.className = "explorer-header";

  const h = document.createElement("h2");
  h.className = "explorer-title";
  h.innerHTML = `⛓ <span class="dim">reel</span> ${target.kind}<span class="dim">/</span>${target.name || target.id}`;
  header.appendChild(h);

  const sub = document.createElement("div");
  sub.className = "explorer-sub";
  sub.textContent = `${count} fact${count === 1 ? "" : "s"} • newest first • hash-chained per reel`;
  header.appendChild(sub);

  // Quick-nav: if the target is a being, offer a one-click jump to its acts.
  if (target.kind === "being" && discovery?.reality) {
    const jump = document.createElement("a");
    jump.className = "explorer-jump";
    jump.href = `#${discovery.reality}/.acts/${target.id}`;
    jump.textContent = `→ acts by this being`;
    header.appendChild(jump);
  }
  pane.appendChild(header);

  if (!facts || facts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "explorer-empty";
    empty.textContent = `(no facts on this ${target.kind}'s reel yet)`;
    pane.appendChild(empty);
    return;
  }

  const list = document.createElement("ol");
  list.className = "block-list";
  for (const f of facts) list.appendChild(renderFactBlock(f, discovery));
  pane.appendChild(list);
}

function renderFactBlock(f, discovery) {
  const li = document.createElement("li");
  li.className = "block";

  // Summary row (always shown).
  const summary = document.createElement("div");
  summary.className = "block-summary";

  const seq = document.createElement("span");
  seq.className = "block-seq";
  seq.textContent = `#${f.seq ?? "?"}`;
  seq.title = "per-reel sequence (block height)";
  summary.appendChild(seq);

  const action = document.createElement("span");
  action.className = "block-action";
  action.textContent = `${f.verb}:${f.action}`;
  summary.appendChild(action);

  const target = document.createElement("span");
  target.className = "block-target dim";
  const tk = f.target?.kind || "?";
  const ti = f.target?.id ? short(String(f.target.id)) : "?";
  target.textContent = `→ ${tk}/${ti}`;
  summary.appendChild(target);

  const doer = document.createElement("span");
  doer.className = "block-doer";
  doer.textContent = f.beingName ? `@${f.beingName}` : (f.beingId ? short(f.beingId) : "?");
  doer.title = f.beingId || "";
  summary.appendChild(doer);

  const ts = document.createElement("span");
  ts.className = "block-ts dim";
  ts.textContent = formatTs(f.date);
  ts.title = f.date || "";
  summary.appendChild(ts);

  const hash = document.createElement("code");
  hash.className = "block-hash";
  hash.textContent = `h:${short(f.h, 10)}`;
  hash.title = f.h ? `full: ${f.h}\nprev: ${f.p || "(genesis)"}` : "(no hash)";
  summary.appendChild(hash);

  const toggle = document.createElement("button");
  toggle.className = "block-toggle";
  toggle.textContent = "▸";
  toggle.title = "expand";
  summary.appendChild(toggle);

  li.appendChild(summary);

  // Detail (hidden by default).
  const detail = document.createElement("div");
  detail.className = "block-detail hidden";

  detail.appendChild(kvBlock("fact id", f._id, { mono: true }));
  detail.appendChild(kvBlock("h (self)", f.h || "(none)", { mono: true }));
  detail.appendChild(kvBlock("p (prev)", f.p || "(genesis)", { mono: true }));
  if (f.actId) detail.appendChild(kvBlock("act id", f.actId, { mono: true, link: discovery && f.beingId ? `#${discovery.reality}/.acts/${f.beingId}` : null }));
  if (f.params != null) detail.appendChild(jsonKv("params", f.params));
  if (f.result != null) detail.appendChild(jsonKv("result", f.result));
  // Target link — clickable for navigation into the target's own reel.
  if (discovery?.reality && f.target?.kind && f.target?.id) {
    const linkText = `${f.target.kind}/${f.target.id}`;
    detail.appendChild(kvBlock("target", linkText, {
      mono: true,
      link: `#${discovery.reality}/.reel/${f.target.kind}/${f.target.id}`,
    }));
  }
  // Doer link — to the doer's own facts.
  if (discovery?.reality && f.beingId) {
    detail.appendChild(kvBlock("doer", f.beingName || f.beingId, {
      mono: true,
      link: `#${discovery.reality}/.reel/being/${f.beingId}`,
    }));
  }

  li.appendChild(detail);

  toggle.onclick = () => {
    const open = detail.classList.toggle("hidden");
    toggle.textContent = open ? "▸" : "▾";
  };
  summary.onclick = (ev) => {
    if (ev.target === toggle || ev.target.tagName === "A") return;
    toggle.click();
  };
  return li;
}

function renderActChainExplorer(pane, chain, discovery) {
  const { being, acts, count } = chain || {};

  const header = document.createElement("header");
  header.className = "explorer-header";

  const h = document.createElement("h2");
  h.className = "explorer-title";
  h.innerHTML = `⧗ <span class="dim">act-chain</span> @${being.name || being.id}`;
  header.appendChild(h);

  const sub = document.createElement("div");
  sub.className = "explorer-sub";
  sub.textContent = `${count} act${count === 1 ? "" : "s"} • newest first • each act = one moment this being authored`;
  header.appendChild(sub);

  if (discovery?.reality) {
    const jump = document.createElement("a");
    jump.className = "explorer-jump";
    jump.href = `#${discovery.reality}/.reel/being/${being.id}`;
    jump.textContent = `→ facts on this being's reel`;
    header.appendChild(jump);
  }
  pane.appendChild(header);

  if (!acts || acts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "explorer-empty";
    empty.textContent = "(this being has no acts yet)";
    pane.appendChild(empty);
    return;
  }

  const list = document.createElement("ol");
  list.className = "block-list";
  for (const a of acts) list.appendChild(renderActBlock(a, discovery));
  pane.appendChild(list);
}

function renderActBlock(a, discovery) {
  const li = document.createElement("li");
  li.className = "block";

  const summary = document.createElement("div");
  summary.className = "block-summary";

  const ts = document.createElement("span");
  ts.className = "block-ts";
  ts.textContent = formatTs(a.stampedAt || a.receivedAt);
  ts.title = a.stampedAt || a.receivedAt || "";
  summary.appendChild(ts);

  const role = document.createElement("span");
  role.className = "block-action";
  role.textContent = a.activeRole || "(no role)";
  summary.appendChild(role);

  const addr = document.createElement("span");
  addr.className = "block-target dim";
  addr.textContent = a.ibpAddress ? short(a.ibpAddress, 32) : "(no address)";
  addr.title = a.ibpAddress || "";
  summary.appendChild(addr);

  if (a.priority && a.priority !== "INTERACTIVE") {
    const p = document.createElement("span");
    p.className = `block-pri pri-${a.priority.toLowerCase()}`;
    p.textContent = a.priority;
    summary.appendChild(p);
  }

  if (a.severedAt) {
    const s = document.createElement("span");
    s.className = "block-pri pri-severed";
    s.textContent = "severed";
    summary.appendChild(s);
  }

  const root = document.createElement("code");
  root.className = "block-hash";
  root.textContent = a.rootCorrelation ? `root:${short(a.rootCorrelation, 8)}` : "(no root)";
  root.title = a.rootCorrelation || "";
  summary.appendChild(root);

  const toggle = document.createElement("button");
  toggle.className = "block-toggle";
  toggle.textContent = "▸";
  summary.appendChild(toggle);
  li.appendChild(summary);

  const detail = document.createElement("div");
  detail.className = "block-detail hidden";
  detail.appendChild(kvBlock("act id", a._id, { mono: true }));
  if (a.ibpAddress) detail.appendChild(kvBlock("ibp address", a.ibpAddress, { mono: true }));
  if (a.activeRole) detail.appendChild(kvBlock("role", a.activeRole));
  if (a.priority) detail.appendChild(kvBlock("priority", a.priority));
  if (a.beingOut && discovery?.reality) {
    detail.appendChild(kvBlock("being out", a.beingOut, {
      mono: true,
      link: `#${discovery.reality}/.reel/being/${a.beingOut}`,
    }));
  }
  if (a.rootCorrelation) detail.appendChild(kvBlock("rootCorrelation", a.rootCorrelation, { mono: true }));
  if (a.inReplyTo)       detail.appendChild(kvBlock("inReplyTo",       a.inReplyTo,       { mono: true }));
  if (a.parentThread)    detail.appendChild(kvBlock("parentThread",    a.parentThread,    { mono: true }));
  if (a.answers)         detail.appendChild(kvBlock("answers (summon)", a.answers,        { mono: true }));
  if (a.startMessage?.content) detail.appendChild(jsonKv("start message", a.startMessage));
  if (a.endMessage?.content || a.endMessage?.stopped) detail.appendChild(jsonKv("end message", a.endMessage));
  if (a.severedAt)       detail.appendChild(kvBlock("severed at", String(a.severedAt)));
  if (a.receivedAt)      detail.appendChild(kvBlock("received at", String(a.receivedAt)));
  if (a.stampedAt)       detail.appendChild(kvBlock("stamped at", String(a.stampedAt)));

  li.appendChild(detail);

  toggle.onclick = () => {
    const open = detail.classList.toggle("hidden");
    toggle.textContent = open ? "▸" : "▾";
  };
  summary.onclick = (ev) => {
    if (ev.target === toggle || ev.target.tagName === "A") return;
    toggle.click();
  };
  return li;
}

// ── Explorer helpers ────────────────────────────────────────────

function short(s, n = 12) {
  if (typeof s !== "string") return s;
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}

function formatTs(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    // Compact local time; full ISO sits in title.
    return d.toLocaleString(undefined, { hour12: false });
  } catch { return ""; }
}

function kvBlock(label, value, { mono = false, link = null } = {}) {
  const row = document.createElement("div");
  row.className = "kv-block";
  const l = document.createElement("span");
  l.className = "kv-block-label";
  l.textContent = label;
  row.appendChild(l);
  let v;
  if (link) {
    v = document.createElement("a");
    v.href = link;
  } else {
    v = document.createElement("span");
  }
  v.className = "kv-block-value" + (mono ? " mono" : "");
  v.textContent = value == null ? "(none)" : String(value);
  row.appendChild(v);
  return row;
}

function jsonKv(label, obj) {
  const row = document.createElement("div");
  row.className = "kv-block kv-block-stack";
  const l = document.createElement("span");
  l.className = "kv-block-label";
  l.textContent = label;
  row.appendChild(l);
  const pre = document.createElement("pre");
  pre.className = "json";
  pre.textContent = JSON.stringify(obj, null, 2);
  row.appendChild(pre);
  return row;
}

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

