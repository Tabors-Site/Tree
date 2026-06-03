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
import { renderRoleManagerPanel } from "../../shared/role-manager-panel.js";
import { renderBeingFlowPanel } from "../../shared/being-flow-panel.js";
import { renderTimelineSection } from "./being-timeline.js";

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
  // Explorer dispatch — .reel/<kind>/<id>, .acts/<beingId>, .beings,
  // .threads/<id> return synthetic descriptors with is{Reel,ActChain,
  // BeingsCatalog,Thread} flags. Take over the middle area and render
  // the catalog/explorer instead of the normal position layout.
  if (desc.isReel || desc.isActChain || desc.isBeingsCatalog || desc.isThread) {
    renderExplorer(desc, { discovery });
    return;
  }
  // System catalog dispatch — .operations / .roles / .threads / .extensions
  // are normal positions whose children ARE the data (one space per
  // operation, role, thread, or extension). Without a catalog view they
  // just show "no beings here" with the items as nav chips in the bottom
  // bar — useless for browsing. Render the children as catalog rows
  // with their qualities surfaced inline.
  const catalogKind = detectCatalogPath(desc.address?.pathByNames);
  if (catalogKind) {
    renderSystemCatalog(desc, catalogKind, { discovery });
    return;
  }
  // Catalog-item dispatch — one level deeper: .operations/<op>,
  // .roles/<role>, .extensions/<ext>. Each is a regular space whose
  // qualities namespace carries the item's data. Without a detail view
  // they render as an empty position (no beings, no matter, no children).
  const catalogItem = detectCatalogItemPath(desc.address?.pathByNames);
  if (catalogItem) {
    renderCatalogItemDetail(desc, catalogItem, { discovery });
    return;
  }
  // Restore normal layout (in case we came back from an explorer view).
  restoreNormalLayout();
  renderBeings(desc, { session, discovery });
  renderMatter(desc, { session, discovery });
  renderChildren(desc, { discovery });
  renderLineage(desc, { session, discovery });
  renderCounts(desc);
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
  renderBreadcrumb(desc, discovery);
  renderQuickNav(desc, discovery);
  renderBranchChip(desc, discovery);
  renderIdentityChip(session, discovery);
  syncAddressInput(desc, discovery);
}

// Branch chip — the small indicator showing which divergent world the
// portal is looking at. Main ("0") is implicit and the chip stays empty
// to keep the top bar quiet for the common case. On any other branch
// the chip lights up with `#<path>` and clicking it switches back to
// main. The branch travels in the address itself (the `#` qualifier the
// substrate parses); this chip just surfaces and toggles it.
function renderBranchChip(desc, discovery) {
  const el = document.getElementById("branch-chip");
  if (!el) return;
  el.innerHTML = "";
  const branch = desc.address?.branch || "0";
  if (branch === "0") {
    // Main is implicit. Stay quiet.
    el.classList.add("hidden");
    return;
  }
  el.classList.remove("hidden");
  const reality = discovery?.reality || "";
  const path = desc.address?.pathByNames || "/";
  const being = desc.address?.being ? `@${desc.address.being}` : "";
  const chip = document.createElement("button");
  chip.className = "chip chip-branch";
  chip.textContent = `#${branch}`;
  chip.title =
    `on branch #${branch} (divergent world)\n` +
    `click to return to main`;
  chip.onclick = () => {
    // Strip the # qualifier and navigate back to main at the same
    // position. The substrate treats `treeos.ai/path` as `#0/path`.
    location.hash = `#${reality}${path === "/" ? "/" : path}${being}`;
  };
  el.appendChild(chip);
}

// Lineage breadcrumb — clickable trail from reality root → current
// position. Replaces the single ↑ parent link. Each segment navigates.
// Also surfaces a "⛓ facts" link beside the leaf for the space-reel
// explorer when a real spaceId is present (i.e. on normal positions,
// not on synthetic .reel/.acts/.beings views).
function renderBreadcrumb(desc, discovery) {
  const bc = document.getElementById("breadcrumb");
  bc.innerHTML = "";
  const reality = discovery?.reality || "?";
  // Preserve the active branch qualifier across crumb clicks so walking
  // up the tree stays in the same divergent world. The branch chip is
  // the explicit way back to main.
  const branch = desc.address?.branch || "0";
  const bq = branch === "0" ? "" : `#${branch}`;

  // Reality root segment — always clickable.
  bc.appendChild(crumbLink(reality, `${reality}${bq}/`, { home: true }));

  const path = desc.address?.pathByNames || "/";
  if (path && path !== "/" && path !== "") {
    const parts = path.split("/").filter(Boolean);
    let accum = "";
    for (const seg of parts) {
      accum += "/" + seg;
      const sep = document.createElement("span");
      sep.className = "crumb-sep dim";
      sep.textContent = "/";
      bc.appendChild(sep);
      // Decorate system segments differently.
      const isSystem = seg.startsWith(".");
      bc.appendChild(crumbLink(seg, `${reality}${bq}${accum}`, { system: isSystem }));
    }
  }

  // If on a normal position with a spaceId, surface a small ⛓ facts
  // link beside the breadcrumb for the space-reel explorer.
  const spaceId = desc.address?.spaceId;
  if (spaceId && !desc.isReel && !desc.isActChain && !desc.isBeingsCatalog) {
    const reel = document.createElement("a");
    reel.href = `#${reality}${bq}/.reel/space/${spaceId}`;
    reel.className = "breadcrumb-side";
    reel.textContent = "⛓ facts";
    reel.title = "view this space's fact reel";
    bc.appendChild(reel);
  }
}

function crumbLink(text, address, { home = false, system = false } = {}) {
  const a = document.createElement("a");
  a.className = "crumb" + (home ? " crumb-home" : "") + (system ? " crumb-system" : "");
  a.href = "#" + address;
  a.textContent = text;
  return a;
}

// Quick-nav chips — jump to system spaces and synthetic catalogs.
// Each chip's data-tag determines its href.
function renderQuickNav(desc, discovery) {
  const reality = discovery?.reality;
  if (!reality) return;
  // Quick-nav stays inside the active branch — clicking "ops" on `#1a`
  // takes you to `#1a/./operations`, not back to main. The branch chip
  // is the explicit return to main.
  const branch = desc.address?.branch || "0";
  const bq = branch === "0" ? "" : `#${branch}`;
  const QN = {
    home:       `${reality}${bq}/`,
    beings:     `${reality}${bq}/.beings`,
    operations: `${reality}${bq}/./operations`,
    roles:      `${reality}${bq}/./roles`,
    threads:    `${reality}${bq}/./threads`,
    extensions: `${reality}${bq}/./extensions`,
  };
  for (const chip of document.querySelectorAll("#quick-nav .qn-chip")) {
    const tag = chip.dataset.tag;
    if (QN[tag]) chip.href = "#" + QN[tag];
    // Mark active if current address matches.
    const here = (desc.address?.pathByNames || "/");
    let active = false;
    if (tag === "home"       && here === "/") active = true;
    else if (tag === "beings"     && /^\/\.beings\b/.test(here))     active = true;
    else if (tag === "operations" && /^\/\.operations\b/.test(here)) active = true;
    else if (tag === "roles"      && /^\/\.roles\b/.test(here))      active = true;
    else if (tag === "threads"    && /^\/\.threads\b/.test(here))    active = true;
    else if (tag === "extensions" && /^\/\.extensions\b/.test(here)) active = true;
    chip.classList.toggle("active", active);
  }
}

function renderIdentityChip(session, discovery) {
  const idEl = document.getElementById("identity-chip");
  idEl.innerHTML = "";
  const reality = discovery?.reality || "";
  const username = session?.username || "arrival";
  const chip = document.createElement("button");
  chip.className = "chip" + (session?.token ? " chip-authed" : "");
  chip.textContent = session?.token ? `@${username}` : `@arrival`;
  chip.title = session?.token
    ? `signed in as @${username}\nbeing: ${session.beingAddress || "(unknown)"}\nclick to sign out`
    : "click to claim or register";
  chip.onclick = () => {
    if (session?.token) flat.signOut();
    else showAuthOverlay(reality);
  };
  idEl.appendChild(chip);
}

// Reflect the current address in the input (unless the user is editing).
function syncAddressInput(desc, discovery) {
  const input = document.getElementById("address-input");
  if (!input) return;
  if (document.activeElement === input) return; // don't clobber typing
  const reality = discovery?.reality || "";
  const path = desc.address?.pathByNames || "/";
  // Surface the branch in the address bar when non-main, the way it
  // would appear if the user typed it. Main stays implicit.
  const branch = desc.address?.branch || "0";
  const branchPart = branch === "0" ? "" : `#${branch}`;
  input.value = `${reality}${branchPart}${path === "/" ? "/" : path}`;
}

// Render the count badge next to each section title.
function renderCounts(desc) {
  const b = document.getElementById("beings-count");
  const m = document.getElementById("matter-count");
  if (b) b.textContent = desc.beings?.length ? `${desc.beings.length}` : "";
  if (m) m.textContent = desc.matters?.length ? `${desc.matters.length}` : "";
}

// Update the connection-status pill in the top bar. Called from main.js
// via flat.setConnection() whenever the socket state changes.
export function setConnectionStatus(state, detail = "") {
  const pill = document.getElementById("connection-pill");
  if (!pill) return;
  const dot  = pill.querySelector(".conn-dot");
  const text = pill.querySelector(".conn-text");
  pill.title = `socket: ${state}${detail ? " — " + detail : ""}`;
  dot.className = "conn-dot";
  if (state === "connected") {
    dot.classList.add("conn-ok");
    text.textContent = "live";
  } else if (state === "disconnected" || state === "error") {
    dot.classList.add("conn-err");
    text.textContent = state === "error" ? "error" : "offline";
  } else {
    dot.classList.add("conn-pending");
    text.textContent = state || "connecting…";
  }
}

// Loading bar — a thin pulsing line under the top bar while a SEE is
// in flight. Show on navigate start, hide on settle.
export function setLoading(active) {
  const el = document.getElementById("loading-bar");
  if (!el) return;
  el.classList.toggle("hidden", !active);
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
// Being-tree lineage — children of the stance's being
// ────────────────────────────────────────────────────────────────
//
// When the stance carries a beingId, the descriptor includes
// beingLineage: an array of {beingId, name, cognition, ...} for every
// being parented under it. Render as a list with an "inhabit" button
// per row. Inhabit calls BE:connect with the ancestor-relation auth
// path (cherub Mode 3); on success the response carries inherited:true
// and a fresh token, which we hand to a new browser tab so both
// connections (this tab on the parent, the new tab on the child) live
// independently. Tab close → BE:release on its own token.

function renderLineage(desc, { session, discovery }) {
  const section = document.getElementById("lineage-section");
  const ul      = document.getElementById("lineage-list");
  const count   = document.getElementById("lineage-count");
  if (!section || !ul) return;

  const items = Array.isArray(desc.beingLineage) ? desc.beingLineage : null;
  if (!items) {
    section.classList.add("hidden");
    ul.innerHTML = "";
    if (count) count.textContent = "";
    return;
  }
  section.classList.remove("hidden");
  if (count) count.textContent = items.length ? `${items.length}` : "";
  ul.innerHTML = "";

  if (items.length === 0) {
    ul.appendChild(emptyRow("(no descendants yet — BE:birth from your own stance to mint one)"));
    return;
  }

  const reality = discovery?.reality || null;
  const canInhabit = !!session?.token; // need an active session to inherit-connect

  for (const child of items) {
    const li = document.createElement("li");
    li.className = "list-row";

    const meta = document.createElement("div");
    meta.className = "row-meta";

    const name = document.createElement("span");
    name.className = "row-name";
    name.textContent = `@${child.name || child.beingId.slice(0, 8)}`;
    meta.appendChild(name);

    if (child.cognition)   meta.appendChild(badge(child.cognition, "mode"));
    if (child.defaultRole) meta.appendChild(badge(child.defaultRole, "activity"));

    li.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "row-actions";

    // Inspect link → SEE the child's stance (so the user can drill in
    // and see ITS lineage too).
    if (reality && child.name) {
      const a = document.createElement("a");
      a.className = "btn-sm btn-explore";
      a.href = `#${reality}/@${child.name}`;
      a.textContent = "open";
      a.title = "navigate to this being's stance";
      actions.appendChild(a);
    }

    const inhabitBtn = document.createElement("button");
    inhabitBtn.textContent = "inhabit";
    inhabitBtn.className = "btn-sm btn-primary";
    inhabitBtn.disabled = !canInhabit;
    inhabitBtn.title = canInhabit
      ? "open a new tab driving this being"
      : "sign in first";
    inhabitBtn.onclick = () => triggerInhabit(child, { reality });
    actions.appendChild(inhabitBtn);

    li.appendChild(actions);
    ul.appendChild(li);
  }
}

// Inhabit handler. Calls flat.beOp("connect") on the child stance; the
// substrate's cherub Mode-3 path returns a fresh token gated on the
// caller-being-tree ancestor relation. On success, open a new browser
// tab with the inheriter token in the URL hash so the new tab can
// boot its own independent session without clobbering this tab's
// localStorage.
async function triggerInhabit(child, { reality }) {
  if (!reality || !child?.name) return;
  setStatus(`inheriting @${child.name}...`);
  try {
    const { flat } = await import("./main.js");
    const stance = `${reality}/@${child.name}`;
    const ack = await flat.beOp("connect", stance, {});
    if (!ack || ack.status === "error") {
      const msg = ack?.error?.message || "connect rejected";
      setStatus(`inhabit failed: ${msg}`);
      return;
    }
    const token = ack.data?.identityToken;
    const name  = ack.data?.name || child.name;
    if (!token) {
      setStatus(`inhabit ok but no token returned (server bug?)`);
      return;
    }
    // Stash a one-shot session blob in the URL hash. The new tab reads
    // it on boot, copies into sessionStorage, clears the hash.
    const blob = encodeURIComponent(JSON.stringify({
      token,
      username: name,
      placeUrl: flat.state.session?.placeUrl || window.location.origin,
      inherited: true,
      // Who authorized this inhabit. Inheriter tab persists it and
      // listens for the spawner's pagehide on a BroadcastChannel —
      // when the spawner tab closes, the inheriter releases itself
      // (borrowed presence; lender leaves, lease ends).
      spawnerName: flat.state.session?.username || null,
    }));
    const url = `${window.location.pathname}#inhabit=${blob}`;
    window.open(url, "_blank");
    setStatus(`opened new tab for @${name}`);
  } catch (err) {
    setStatus(`inhabit failed: ${err?.message || String(err)}`);
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
// System catalogs — .operations / .roles / .threads / .extensions
// ────────────────────────────────────────────────────────────────

function detectCatalogPath(path) {
  if (typeof path !== "string") return null;
  // Match both the new "./X" canonical form and the legacy "/.X" form
  // some bookmarks may still carry.
  const m = path.match(/^\/(?:\.\/)?(operations|roles|threads|extensions)\/?$/);
  return m ? m[1] : null;
}

function detectCatalogItemPath(path) {
  if (typeof path !== "string") return null;
  // Item names can contain colons (`harmony:dancer-llm`), hyphens, dots.
  // Catch the catalog kind and the rest of the path (anything after).
  const m = path.match(/^\/(?:\.\/)?(operations|roles|extensions)\/([^/]+)\/?$/);
  return m ? { kind: m[1], name: m[2] } : null;
}

const CATALOG_META = {
  operations: { icon: "⚙", title: "operations", sub: "registered DO actions" },
  roles:      { icon: "◎", title: "roles",      sub: "summonable role templates" },
  threads:    { icon: "⧖", title: "threads",    sub: "live coordination chains (rootCorrelations)" },
  extensions: { icon: "⊕", title: "extensions", sub: "installed extensions" },
};

function renderSystemCatalog(desc, kind, { discovery }) {
  // Take over the middle pane like the other catalogs do.
  const middle = document.getElementById("middle");
  document.getElementById("position-pane")?.classList.add("hidden");
  document.getElementById("detail-pane")?.classList.add("hidden");
  let pane = document.getElementById("explorer-pane");
  if (pane) pane.remove();
  pane = document.createElement("section");
  pane.id = "explorer-pane";
  middle.appendChild(pane);

  const meta = CATALOG_META[kind];
  const items = desc.children || [];

  const header = document.createElement("header");
  header.className = "explorer-header";
  const h = document.createElement("h2");
  h.className = "explorer-title";
  h.innerHTML = `${meta.icon} <span class="dim">${meta.title}</span>`;
  header.appendChild(h);
  const sub = document.createElement("div");
  sub.className = "explorer-sub";
  sub.textContent = `${items.length} item${items.length === 1 ? "" : "s"} · ${meta.sub}`;
  header.appendChild(sub);
  pane.appendChild(header);

  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "explorer-empty";
    empty.textContent = `(no ${meta.title} registered)`;
    pane.appendChild(empty);
    return;
  }

  const ul = document.createElement("ul");
  ul.className = "catalog-list";
  for (const item of items) {
    ul.appendChild(renderCatalogRow(kind, item, discovery));
  }
  pane.appendChild(ul);
}

function renderCatalogRow(kind, item, discovery) {
  const li = document.createElement("li");
  li.className = "catalog-row";

  // ── Headline row: icon, name, kind-specific badges, timestamp/right-side
  const main = document.createElement("div");
  main.className = "catalog-main";

  const name = document.createElement("span");
  name.className = "row-name";
  name.textContent = item.name || "(unnamed)";
  main.appendChild(name);

  if (kind === "operations") renderOperationRowBody(main, item);
  else if (kind === "roles") renderRoleRowBody(main, item);
  else if (kind === "threads") renderThreadRowBody(main, item);
  else if (kind === "extensions") renderExtensionRowBody(main, item);

  li.appendChild(main);

  // ── Sub-row: address, links into the system
  const sub = document.createElement("div");
  sub.className = "catalog-sub";

  if (kind === "threads" && item.thread?.id && discovery?.reality) {
    // Threads: link straight into the thread descriptor.
    const open = document.createElement("a");
    open.className = "btn-explore";
    open.href = `#${discovery.reality}/./threads/${item.thread.id}`;
    open.textContent = "open thread";
    sub.appendChild(open);
  } else if (item.path && discovery?.reality) {
    // Others: link to the item's own space (where qualities live).
    const open = document.createElement("a");
    open.className = "btn-explore";
    open.href = `#${discovery.reality}${item.path}`;
    open.textContent = "open";
    sub.appendChild(open);
  }

  if (item.spaceId && !String(item.spaceId).startsWith("thread:") && discovery?.reality) {
    const reel = document.createElement("a");
    reel.className = "btn-explore";
    reel.href = `#${discovery.reality}/.reel/space/${item.spaceId}`;
    reel.textContent = "facts";
    sub.appendChild(reel);
  }

  if (sub.children.length) li.appendChild(sub);
  return li;
}

// One-item detail view: SEE on `.operations/<op>` / `.roles/<role>` /
// `.extensions/<ext>`. The descriptor is a normal position descriptor;
// the item's data lives on `qualities.<kind>`. Take over the explorer
// pane and surface the data in a way that's actually useful.
function renderCatalogItemDetail(desc, { kind, name }, { discovery }) {
  const middle = document.getElementById("middle");
  document.getElementById("position-pane")?.classList.add("hidden");
  document.getElementById("detail-pane")?.classList.add("hidden");
  let pane = document.getElementById("explorer-pane");
  if (pane) pane.remove();
  pane = document.createElement("section");
  pane.id = "explorer-pane";
  middle.appendChild(pane);

  const meta = CATALOG_META[kind] || { icon: "·", title: kind, sub: "" };

  // Header with breadcrumb-like trail back to the catalog.
  const header = document.createElement("header");
  header.className = "explorer-header";
  const h = document.createElement("h2");
  h.className = "explorer-title";
  h.innerHTML = `${meta.icon} <a class="dim" href="#${discovery.reality}/.${kind}">${meta.title}</a> <span class="dim">/</span> ${name}`;
  header.appendChild(h);

  const sub = document.createElement("div");
  sub.className = "explorer-sub";
  const spaceId = desc.address?.spaceId;
  sub.textContent = spaceId ? `space ${spaceId}` : "(no spaceId)";
  header.appendChild(sub);

  if (spaceId && discovery?.reality) {
    const reel = document.createElement("a");
    reel.className = "explorer-jump";
    reel.href = `#${discovery.reality}/.reel/space/${spaceId}`;
    reel.textContent = `⛓ reel for this row`;
    header.appendChild(reel);
  }
  pane.appendChild(header);

  // Per-kind body. Read from qualities.<kind>.
  const q = desc.qualities || {};
  if (kind === "operations") renderOperationDetail(pane, q.operation || {}, name);
  else if (kind === "roles") renderRoleDetail(pane, q.role || {}, name);
  else if (kind === "extensions") renderExtensionDetail(pane, q.extension || q, name);
}

function renderOperationDetail(pane, op, name) {
  const grid = section("operation");
  grid.appendChild(kvBlock("name", name, { mono: true }));
  if (Array.isArray(op.targets) && op.targets.length) {
    grid.appendChild(kvBlock("targets", op.targets.join(", ")));
  }
  if (op.factAction) grid.appendChild(kvBlock("stamps factAction", op.factAction, { mono: true }));
  if (op.ownerExtension) grid.appendChild(kvBlock("from extension", op.ownerExtension));
  grid.appendChild(kvBlock("skipAudit", op.skipAudit ? "true" : "false"));
  pane.appendChild(grid);

  if (op && Object.keys(op).length) {
    const raw = section("raw qualities.operation");
    raw.appendChild(jsonBlock(op));
    pane.appendChild(raw);
  }
}

function renderRoleDetail(pane, role, name) {
  const top = section("role");
  top.appendChild(kvBlock("name", name, { mono: true }));
  if (role.respondMode) top.appendChild(kvBlock("respondMode", role.respondMode));
  if (Array.isArray(role.triggerOn) && role.triggerOn.length) {
    top.appendChild(kvBlock("triggerOn", role.triggerOn.join(", ")));
  }
  if (role.replyTo) top.appendChild(kvBlock("replyTo", role.replyTo));
  pane.appendChild(top);

  // Capabilities — one section per verb.
  const caps = [
    ["canSee",    role.canSee],
    ["canDo",     role.canDo],
    ["canSummon", role.canSummon],
    ["canBe",     role.canBe],
    ["see",       role.see],
  ];
  for (const [label, list] of caps) {
    if (!Array.isArray(list) || list.length === 0) continue;
    const sec = section(label);
    const ul = document.createElement("ul");
    ul.className = "verb-list";
    for (const entry of list) {
      const li = document.createElement("li");
      li.innerHTML = `<code>${escapeHtml(String(entry))}</code>`;
      ul.appendChild(li);
    }
    sec.appendChild(ul);
    pane.appendChild(sec);
  }

  if (Array.isArray(role.permissions) && role.permissions.length) {
    const sec = section("permissions");
    sec.appendChild(jsonBlock(role.permissions));
    pane.appendChild(sec);
  }
}

function renderExtensionDetail(pane, ext, name) {
  const top = section("extension");
  top.appendChild(kvBlock("name", name, { mono: true }));
  if (ext.version) top.appendChild(kvBlock("version", ext.version));
  if (ext.description) top.appendChild(kvBlock("description", ext.description));
  if (ext.author) top.appendChild(kvBlock("author", ext.author));
  if (ext.installedAt) top.appendChild(kvBlock("installed at", String(ext.installedAt)));
  if (ext.enabled != null) top.appendChild(kvBlock("enabled", String(ext.enabled)));
  pane.appendChild(top);

  // Provides — list whatever capability arrays it advertises.
  const provideKeys = ["operations", "roles", "tools", "hooks", "seeds", "subscriptions", "schedules", "routes"];
  for (const k of provideKeys) {
    const v = ext[k];
    if (Array.isArray(v) && v.length) {
      const sec = section(`provides ${k}`);
      const ul = document.createElement("ul");
      ul.className = "verb-list";
      for (const entry of v) {
        const li = document.createElement("li");
        const txt = typeof entry === "string" ? entry : JSON.stringify(entry);
        li.innerHTML = `<code>${escapeHtml(txt)}</code>`;
        ul.appendChild(li);
      }
      sec.appendChild(ul);
      pane.appendChild(sec);
    } else if (v && typeof v === "object") {
      const sec = section(`provides ${k}`);
      sec.appendChild(jsonBlock(v));
      pane.appendChild(sec);
    }
  }

  // Raw qualities at the bottom for completeness.
  const raw = section("raw qualities");
  raw.appendChild(jsonBlock(ext));
  pane.appendChild(raw);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  }[c]));
}

function renderOperationRowBody(main, item) {
  const op = item.qualities?.operation || {};
  const targets = Array.isArray(op.targets) ? op.targets : [];
  if (targets.length) main.appendChild(badge(`→ ${targets.join("/")}`, "mode"));
  if (op.ownerExtension && op.ownerExtension !== "seed") {
    main.appendChild(badge(op.ownerExtension, "activity"));
  }
  if (op.factAction && op.factAction !== item.name) {
    const fa = document.createElement("span");
    fa.className = "dim catalog-ts";
    fa.textContent = `stamps ${op.factAction}`;
    main.appendChild(fa);
  }
  if (op.skipAudit) main.appendChild(badge("no-audit", "busy"));
}

function renderRoleRowBody(main, item) {
  const role = item.qualities?.role || {};
  if (role.respondMode) main.appendChild(badge(role.respondMode, "mode"));
  if (Array.isArray(role.triggerOn) && role.triggerOn.length) {
    main.appendChild(badge(`on:${role.triggerOn.join(",")}`, "activity"));
  }
  // Compact capability summary: counts of canDo/canSee/canSummon/canBe.
  const caps = [];
  if (role.canDo?.length)     caps.push(`do:${role.canDo.length}`);
  if (role.canSee?.length)    caps.push(`see:${role.canSee.length}`);
  if (role.canSummon?.length) caps.push(`sum:${role.canSummon.length}`);
  if (role.canBe?.length)     caps.push(`be:${role.canBe.length}`);
  if (caps.length) {
    const c = document.createElement("span");
    c.className = "dim catalog-ts";
    c.textContent = caps.join(" · ");
    c.title = `canDo: ${(role.canDo||[]).join(", ") || "—"}\ncanSee: ${(role.canSee||[]).join(", ") || "—"}\ncanSummon: ${(role.canSummon||[]).join(", ") || "—"}\ncanBe: ${(role.canBe||[]).join(", ") || "—"}`;
    main.appendChild(c);
  }
}

function renderThreadRowBody(main, item) {
  const t = item.thread || {};
  if (t.lastAct) {
    const ts = document.createElement("span");
    ts.className = "dim catalog-ts";
    ts.textContent = `last ${formatTs(t.lastAct)}`;
    ts.title = t.lastAct;
    main.appendChild(ts);
  }
  main.appendChild(badge("live", "queue"));
}

function renderExtensionRowBody(main, item) {
  const ext = item.qualities?.extension || item.qualities || {};
  if (ext.version) main.appendChild(badge(`v${ext.version}`, "mode"));
  if (ext.description) {
    const d = document.createElement("span");
    d.className = "dim catalog-ts";
    d.textContent = String(ext.description).slice(0, 80);
    d.title = ext.description;
    main.appendChild(d);
  }
}

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
  else if (desc.isBeingsCatalog) renderBeingsCatalog(pane, desc.beingsCatalog, discovery);
  else if (desc.isThread) renderThreadDetail(pane, desc.thread, discovery);
}

// Thread detail view — metadata header + the act chain that constitutes
// this thread, oldest-first (natural reading order, opposite of the
// global act-chain view which is newest-first).
function renderThreadDetail(pane, thread, discovery) {
  if (!thread) {
    const empty = document.createElement("div");
    empty.className = "explorer-empty";
    empty.textContent = "(thread not found)";
    pane.appendChild(empty);
    return;
  }

  const header = document.createElement("header");
  header.className = "explorer-header";
  const h = document.createElement("h2");
  h.className = "explorer-title";
  h.innerHTML = `⧖ <a class="dim" href="#${discovery.reality}/./threads">thread</a> <span class="dim">/</span> ${short(thread.id, 16)}`;
  h.title = thread.id;
  header.appendChild(h);

  const sub = document.createElement("div");
  sub.className = "explorer-sub";
  const parts = [];
  parts.push(`state: <span class="thread-state thread-state-${thread.state}">${thread.state}</span>`);
  parts.push(`${thread.depth} act${thread.depth === 1 ? "" : "s"}`);
  if (thread.liveCount)     parts.push(`<span class="dim">${thread.liveCount} live</span>`);
  if (thread.completeCount) parts.push(`<span class="dim">${thread.completeCount} complete</span>`);
  if (thread.severedCount)  parts.push(`<span class="chain-bad">${thread.severedCount} severed</span>`);
  sub.innerHTML = parts.join(" · ");
  header.appendChild(sub);

  pane.appendChild(header);

  // Metadata block.
  const meta = section("thread");
  meta.appendChild(kvBlock("rootCorrelation", thread.id, { mono: true }));
  meta.appendChild(kvBlock("state", thread.state));
  if (thread.rootStartedAt) meta.appendChild(kvBlock("started at", String(thread.rootStartedAt)));
  if (thread.lastAct)       meta.appendChild(kvBlock("last act at", String(thread.lastAct)));
  if (thread.parentThread && discovery?.reality) {
    meta.appendChild(kvBlock("parent thread", thread.parentThread, {
      mono: true,
      link: `#${discovery.reality}/./threads/${thread.parentThread}`,
    }));
  }
  if (Array.isArray(thread.participants) && thread.participants.length) {
    const row = document.createElement("div");
    row.className = "kv-block kv-block-stack";
    const lbl = document.createElement("span");
    lbl.className = "kv-block-label";
    lbl.textContent = "participants";
    row.appendChild(lbl);
    const chips = document.createElement("div");
    chips.className = "verb-list";
    for (const p of thread.participants) {
      const a = document.createElement("a");
      a.className = "btn-explore";
      a.href = `#${discovery.reality}/.acts/${p}`;
      a.textContent = short(p, 14);
      a.title = `view acts by ${p}`;
      chips.appendChild(a);
    }
    row.appendChild(chips);
    meta.appendChild(row);
  }
  if (thread.pending) {
    const note = document.createElement("div");
    note.className = "kv-block";
    note.innerHTML = `<span class="kv-block-label">note</span><span class="kv-block-value dim">summon emitted; no moment has sealed yet (projection ahead of acts).</span>`;
    meta.appendChild(note);
  }
  pane.appendChild(meta);

  // Acts in the thread — re-use the same renderActBlock as .acts/<id>
  // so the look is consistent. Oldest-first here (chronological flow).
  const acts = Array.isArray(thread.acts) ? thread.acts : [];
  if (acts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "explorer-empty";
    empty.textContent = thread.pending
      ? "(pending — projection shows the summon but no Act has sealed yet)"
      : "(no acts in this thread yet)";
    pane.appendChild(empty);
    return;
  }
  const listHead = document.createElement("h4");
  listHead.className = "pane-title";
  listHead.style.marginTop = "16px";
  listHead.textContent = "acts in this thread (oldest first)";
  pane.appendChild(listHead);

  const list = document.createElement("ol");
  list.className = "block-list";
  for (const a of acts) list.appendChild(renderActBlock(a, discovery));
  pane.appendChild(list);
}

// Global beings catalog — every Being row across the reality. Different
// from the per-position beings list (which only shows beings homed at
// the current space). Used to answer "what beings exist?" the way
// .operations answers "what ops exist?".
function renderBeingsCatalog(pane, catalog, discovery) {
  const { beings, count } = catalog || {};

  const header = document.createElement("header");
  header.className = "explorer-header";

  const h = document.createElement("h2");
  h.className = "explorer-title";
  h.innerHTML = `∴ <span class="dim">beings</span> <span class="dim">across</span> ${discovery?.reality || ""}`;
  header.appendChild(h);

  const sub = document.createElement("div");
  sub.className = "explorer-sub";
  sub.textContent = `${count} being${count === 1 ? "" : "s"} · global catalog · ordered by birth`;
  header.appendChild(sub);
  pane.appendChild(header);

  if (!beings || beings.length === 0) {
    const empty = document.createElement("div");
    empty.className = "explorer-empty";
    empty.textContent = "(no beings exist in this reality yet)";
    pane.appendChild(empty);
    return;
  }

  const ul = document.createElement("ul");
  ul.className = "catalog-list";
  for (const b of beings) ul.appendChild(renderBeingCatalogRow(b, discovery));
  pane.appendChild(ul);
}

function renderBeingCatalogRow(b, discovery) {
  const li = document.createElement("li");
  li.className = "catalog-row";

  const main = document.createElement("div");
  main.className = "catalog-main";

  const name = document.createElement("span");
  name.className = "row-name";
  name.textContent = `@${b.name || "(unnamed)"}`;
  main.appendChild(name);

  if (b.cognition) main.appendChild(badge(b.cognition, "mode"));
  if (b.defaultRole) {
    const role = badge(b.defaultRole, "activity");
    role.title = b.roles?.length > 1 ? `roles: ${b.roles.join(", ")}` : `default role`;
    main.appendChild(role);
  }
  if (b.createdAt) {
    const ts = document.createElement("span");
    ts.className = "dim catalog-ts";
    ts.textContent = formatTs(b.createdAt);
    ts.title = b.createdAt;
    main.appendChild(ts);
  }

  li.appendChild(main);

  // Sub-line: ids + nav links.
  const sub = document.createElement("div");
  sub.className = "catalog-sub";

  const idSpan = document.createElement("code");
  idSpan.className = "catalog-id";
  idSpan.textContent = short(b.beingId, 20);
  idSpan.title = b.beingId;
  sub.appendChild(idSpan);

  if (discovery?.reality) {
    const facts = document.createElement("a");
    facts.className = "btn-explore";
    facts.href = `#${discovery.reality}/.reel/being/${b.beingId}`;
    facts.textContent = "facts";
    sub.appendChild(facts);

    const acts = document.createElement("a");
    acts.className = "btn-explore";
    acts.href = `#${discovery.reality}/.acts/${b.beingId}`;
    acts.textContent = "acts";
    sub.appendChild(acts);

    if (b.homeSpace) {
      const home = document.createElement("a");
      home.className = "btn-explore";
      home.href = `#${discovery.reality}/.reel/space/${b.homeSpace}`;
      home.textContent = "home reel";
      home.title = `homed at space ${b.homeSpace}`;
      sub.appendChild(home);
    }
  }

  li.appendChild(sub);
  return li;
}

function renderReelExplorer(pane, reel, discovery) {
  const { target, facts, count } = reel || {};

  // Verify the hash chain across the visible window. Facts come desc by
  // seq, so block[i+1] is the predecessor of block[i]. Each block's `p`
  // (prev-hash) should equal the next-oldest block's `h`.
  const verdict = verifyChain(facts || []);

  const header = document.createElement("header");
  header.className = "explorer-header";

  const h = document.createElement("h2");
  h.className = "explorer-title";
  h.innerHTML = `⛓ <span class="dim">reel</span> ${target.kind}<span class="dim">/</span>${target.name || target.id}`;
  header.appendChild(h);

  const sub = document.createElement("div");
  sub.className = "explorer-sub";
  sub.innerHTML = `${count} fact${count === 1 ? "" : "s"} · newest first · `
    + chainVerdictSummary(verdict);
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
  for (let i = 0; i < facts.length; i++) {
    list.appendChild(renderFactBlock(facts[i], discovery, verdict.perBlock[i]));
  }
  pane.appendChild(list);
}

// Walk the fact array (newest-first) and check each block's prev-hash
// against the next-older block's self-hash. Returns:
//   { ok: bool, verified: N, broken: M, perBlock: ["ok" | "genesis" | "edge" | "broken"] }
function verifyChain(facts) {
  const out = { ok: true, verified: 0, broken: 0, perBlock: [] };
  for (let i = 0; i < facts.length; i++) {
    const f = facts[i];
    // The older neighbor in the window (if present).
    const older = facts[i + 1];
    if (older) {
      if (f.p && older.h && String(f.p) === String(older.h)) {
        out.verified++;
        out.perBlock.push("ok");
      } else {
        out.broken++;
        out.ok = false;
        out.perBlock.push("broken");
      }
    } else {
      // Oldest in the window. Genesis if p is null/zero; otherwise we
      // can't check (the predecessor is outside the visible window).
      if (!f.p || /^0+$/.test(String(f.p))) out.perBlock.push("genesis");
      else                                  out.perBlock.push("edge");
    }
  }
  return out;
}

function chainVerdictSummary(v) {
  if (v.broken > 0) {
    return `<span class="chain-bad">✗ ${v.broken} broken link${v.broken === 1 ? "" : "s"}</span> · ${v.verified} verified`;
  }
  if (v.verified === 0) {
    return `<span class="chain-dim">— single-block window —</span>`;
  }
  return `<span class="chain-ok">✓ ${v.verified} link${v.verified === 1 ? "" : "s"} verified</span>`;
}

function renderFactBlock(f, discovery, chainStatus = "edge") {
  const li = document.createElement("li");
  li.className = "block";

  // Summary row (always shown).
  const summary = document.createElement("div");
  summary.className = "block-summary";

  // Chain-link indicator: ✓ (verified link to predecessor), ◇ (genesis),
  // · (window edge — predecessor outside visible range), ✗ (broken link).
  const chain = document.createElement("span");
  chain.className = `block-chain chain-${chainStatus}`;
  chain.textContent = chainStatus === "ok"      ? "✓"
                    : chainStatus === "genesis" ? "◇"
                    : chainStatus === "broken"  ? "✗"
                    :                             "·";
  chain.title = chainStatus === "ok"      ? "prev-hash matches predecessor block"
              : chainStatus === "genesis" ? "first fact on this reel (genesis)"
              : chainStatus === "broken"  ? "prev-hash DOES NOT match predecessor — chain broken here"
              :                             "predecessor outside visible window";
  summary.appendChild(chain);

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

  // Content sub-row — show a human-readable derived from params when
  // available (be:summon content, create-* name, set-* field=value).
  // Keeps the headline scannable; full payload still in expand.
  const summaryText = factSummaryLine(f);
  if (summaryText) {
    const sub = document.createElement("div");
    sub.className = "block-sub block-content";
    sub.textContent = summaryText;
    sub.title = summaryText;
    li.appendChild(sub);
  }

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
  li.className = "block block-act";

  // Two-row layout for acts: row 1 (compact summary) shows the headline
  // content the user actually wants to read; row 2 (sub) shows role +
  // address + correlation. Everything else expands behind the toggle.
  const head = document.createElement("div");
  head.className = "block-head";

  const ts = document.createElement("span");
  ts.className = "block-ts";
  ts.textContent = formatTs(a.stampedAt || a.receivedAt);
  ts.title = a.stampedAt || a.receivedAt || "";
  head.appendChild(ts);

  // Headline strategy: an act-chain shows what the being DID. For LLM
  // beings, "did" = the words they returned (endMessage.content). For
  // transport-acts and other roles, endMessage may be empty and the
  // startMessage carries the meaning. Prefer the response when it's a
  // non-empty string; otherwise format the inbound (which may itself
  // be an object — subscription wakes carry { event, spaceId, ... }).
  const endText = (typeof a.endMessage?.content === "string" && a.endMessage.content.trim())
    ? a.endMessage.content
    : null;
  const startText = formatActPayload(a.startMessage?.content);

  // A structured act has no prose response: its content IS the Facts it
  // stamped (a dancer's step, any tool call). When endMessage is empty
  // but the act produced Facts, show what it DID rather than echoing the
  // wake that triggered it. An act with neither prose nor Facts is a
  // SEE that left no trace and never reaches here.
  const actText = (!endText && Array.isArray(a.facts) && a.facts.length)
    ? a.facts.map(factActionLabel).filter(Boolean).join(", ")
    : null;
  const headline = endText || actText || startText;
  const isResponse = !!endText;
  const isStructuredAct = !endText && !!actText;

  const content = document.createElement("div");
  content.className = "block-content";
  content.textContent = headline;
  content.title = headline;
  if (isResponse || isStructuredAct) {
    const tag = document.createElement("span");
    tag.className = "content-tag dim";
    tag.textContent = isResponse ? "↳" : "⚙";
    tag.title = isResponse
      ? "this being's response (end message)"
      : "what this moment did (stamped facts)";
    content.prepend(tag);
  }
  head.appendChild(content);

  if (a.priority && a.priority !== "INTERACTIVE") {
    const p = document.createElement("span");
    p.className = `block-pri pri-${a.priority.toLowerCase()}`;
    p.textContent = a.priority;
    head.appendChild(p);
  }
  if (a.severedAt) {
    const s = document.createElement("span");
    s.className = "block-pri pri-severed";
    s.textContent = "severed";
    head.appendChild(s);
  }

  const toggle = document.createElement("button");
  toggle.className = "block-toggle";
  toggle.textContent = "▸";
  head.appendChild(toggle);
  li.appendChild(head);

  const sub = document.createElement("div");
  sub.className = "block-sub";

  const role = document.createElement("span");
  role.className = "block-role";
  role.textContent = a.activeRole || "(no role)";
  sub.appendChild(role);

  if (a.ibpAddress) {
    const addr = document.createElement("span");
    addr.className = "block-target dim";
    addr.textContent = short(a.ibpAddress, 40);
    addr.title = a.ibpAddress;
    sub.appendChild(addr);
  }

  const root = document.createElement("code");
  root.className = "block-hash";
  root.textContent = a.rootCorrelation ? `root:${short(a.rootCorrelation, 8)}` : "(no root)";
  root.title = a.rootCorrelation || "";
  sub.appendChild(root);

  // Show the OTHER message as a sub-line so the user sees both at a
  // glance. If the headline was the response (endMessage), the sub-line
  // shows the trigger (startMessage). If the headline was the trigger,
  // and there's an endMessage, surface it here.
  if (isResponse || isStructuredAct) {
    const triggerLine = document.createElement("span");
    triggerLine.className = "block-trigger dim";
    triggerLine.textContent = "from: " + truncate(startText, 100);
    triggerLine.title = startText;
    sub.appendChild(triggerLine);
  } else if (typeof a.endMessage?.content === "string" && a.endMessage.content) {
    const out = document.createElement("span");
    out.className = "block-end dim";
    out.textContent = "↳ " + truncate(a.endMessage.content, 120);
    out.title = a.endMessage.content;
    sub.appendChild(out);
  }
  li.appendChild(sub);

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
  if (a.startMessage?.content) detail.appendChild(jsonKv("in (start message)", a.startMessage));
  if (a.endMessage?.content || a.endMessage?.stopped) detail.appendChild(jsonKv("out (end message)", a.endMessage));
  // The Facts this moment stamped — the act's substrate-change content,
  // the other half of "what happened" alongside any prose end message.
  if (Array.isArray(a.facts) && a.facts.length) {
    detail.appendChild(jsonKv(`facts (${a.facts.length})`, a.facts));
  }
  if (a.severedAt)       detail.appendChild(kvBlock("severed at", String(a.severedAt)));
  if (a.receivedAt)      detail.appendChild(kvBlock("received at", String(a.receivedAt)));
  if (a.stampedAt)       detail.appendChild(kvBlock("stamped at", String(a.stampedAt)));

  li.appendChild(detail);

  toggle.onclick = (ev) => {
    ev.stopPropagation();
    const open = detail.classList.toggle("hidden");
    toggle.textContent = open ? "▸" : "▾";
  };
  // Click anywhere on the head or sub rows to expand, except on real links.
  const expand = (ev) => {
    if (ev.target.tagName === "A" || ev.target === toggle) return;
    toggle.click();
  };
  head.onclick = expand;
  sub.onclick  = expand;
  return li;
}

// Headline label for one stamped fact: the action plus its summary,
// so an act-block whose moment produced no prose still reads as what it
// did ("harmony:step → (5, 4)", "create-space name \"dance-floor\""). The
// action name carries the verb intent; factSummaryLine carries the
// payload. Returns null only for a fact with no action at all.
function factActionLabel(f) {
  if (!f || !f.action) return null;
  const summary = factSummaryLine(f);
  return summary ? `${f.action} ${summary}` : f.action;
}

// Derive a one-line content summary from a fact's verb/action/params.
// Returns null if nothing useful to show — caller skips the sub-row.
function factSummaryLine(f) {
  if (!f) return null;
  const p = f.params;
  // be:summon — the message content is the headline.
  if (f.verb === "be" && f.action === "summon") {
    const c = p?.content;
    if (typeof c === "string" && c) return `"${c}"`;
    if (c && typeof c === "object" && typeof c.content === "string" && c.content) {
      return `"${c.content}"`;
    }
  }
  // be:register / be:claim — name of the registered being.
  if (f.verb === "be" && (f.action === "register" || f.action === "claim")) {
    if (p?.name) return `@${p.name}`;
  }
  // create-* — name on the spec.
  if (/^create/.test(f.action) && p?.spec?.name) {
    return `name "${p.spec.name}"${p.spec.type ? ` (type ${p.spec.type})` : ""}`;
  }
  // set-* — field = value. coord renders as a position so a dancer's
  // step reads "→ (5, 4)" rather than "coord = {"x":5,"y":4}".
  if (/^set/.test(f.action) && p?.field) {
    const v = p.value;
    if (p.field === "coord" && v && typeof v.x === "number" && typeof v.y === "number") {
      return `→ (${v.x}, ${v.y})`;
    }
    const vs = typeof v === "string" ? v
              : typeof v === "number" || typeof v === "boolean" ? String(v)
              : safeJson(v, 60);
    return `${p.field} = ${vs}`;
  }
  // place-being / move — coords or path.
  if (/place|move/.test(f.action) && p) {
    if (typeof p.x === "number" && typeof p.y === "number") return `→ (${p.x}, ${p.y})`;
    if (p.path) return `→ ${p.path}`;
  }
  // be:summon-create — what got created.
  if (f.action === "summon-create" && p?.name) {
    return `created @${p.name}${p.role ? ` as ${p.role}` : ""}`;
  }
  // Generic fallback: short JSON of params.
  if (p && typeof p === "object") {
    const s = safeJson(p, 100);
    if (s && s !== "{}") return s;
  }
  return null;
}

function safeJson(v, cap = 80) {
  try {
    const s = JSON.stringify(v);
    if (!s) return null;
    return s.length > cap ? s.slice(0, cap) + "…" : s;
  } catch { return null; }
}

function truncate(s, n) {
  const str = typeof s === "string" ? s : String(s ?? "");
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}

// Acts' startMessage.content is `Mixed` (Act schema): humans send
// strings, scripted/subscription wakes send structured payloads like
// { event, spaceId, actorBeingId, timestamp } or { event, drumMatterId, ... }.
// Return a one-liner suitable for the act-block headline.
function formatActPayload(c) {
  if (c == null || c === "") return "(no content)";
  if (typeof c === "string") return c;
  if (typeof c !== "object") return String(c);
  // Common nested shapes — peel the outer wrapper.
  if (typeof c.text === "string"    && c.text.trim())    return c.text;
  if (typeof c.content === "string" && c.content.trim()) return c.content;
  // Subscription / scheduled-wake / drummer-tick / DO-trigger shape.
  if (c.event) {
    const parts = [String(c.event)];
    if (c.spaceId)      parts.push(`at space/${shortIdInline(c.spaceId)}`);
    if (c.actorBeingId) parts.push(`by being/${shortIdInline(c.actorBeingId)}`);
    if (c.matterId)     parts.push(`on matter/${shortIdInline(c.matterId)}`);
    if (c.drumMatterId) parts.push(`drum/${shortIdInline(c.drumMatterId)}`);
    return parts.join(" ");
  }
  // Last resort: compact JSON.
  const s = safeJson(c, 120);
  return s || "[object]";
}

function shortIdInline(id) {
  const s = String(id);
  return s.length > 12 ? s.slice(0, 8) + "…" : s;
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

  if (kind === "being") {
    // @role-manager opens a dedicated authoring panel instead of the
    // generic being inspector. The being itself is scripted (no chat),
    // and the panel is the whole point of the being's existence.
    if (entry?.being === "role-manager") {
      renderRoleManagerPanel(insp, entry, {
        reality:    flat.state.discovery?.reality,
        username:   flat.state.session?.username || null,
        descriptor: flat.state.descriptor,
        see:        (addr) => flat.state.client.see(addr),
        doOp:       flat.doOp,
      });
      return;
    }
    renderBeingInspector(insp, entry);
  } else {
    renderMatterInspector(insp, entry);
  }
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
    // Cherub is the authentication being. Show connect + birth inline.
    be.appendChild(beInlineForm("connect", stance, ["name", "password"]));
    be.appendChild(beInlineForm("birth",   stance, ["name", "password"]));
  } else {
    // For any other being: release if you are them. No bind-as-other
    // shortcut anymore . release first, then connect through cherub.
    if (isSelf) {
      be.appendChild(beButton("release", stance, {}));
    }
  }
  insp.appendChild(be);

  // ─── Role Flow editor (when signed in — server gates the save)
  // The mad-libs editor authors the being's `qualities.roleFlow`. Per
  // RoleFlow doctrine, the flow is the source of truth for which roles
  // wake the being and how they compose. Reading the existing flow is
  // public (rides on the descriptor's beings[]); saving goes through
  // set-being which authorize gates per-stance.
  if (fl.session?.username) {
    const flowSec = document.createElement("section");
    flowSec.className = "panel-section";
    insp.appendChild(flowSec);
    renderBeingFlowPanel(flowSec, b, {
      reality:    reality,
      username:   fl.session.username,
      descriptor: fl.descriptor,
      see:        (addr) => fl.client.see(addr),
      doOp:       flat.doOp,
    });
  }

  // ─── Timeline (recent acts on this being's reel; click to fold to past)
  renderTimelineSection(insp, b, { reality });

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

