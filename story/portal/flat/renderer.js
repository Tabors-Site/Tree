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

import { flat } from "./host.js";
import { openChatFor, isChatOpen, getChatBeing } from "./chat.js";
import { renderAbleManagerPanel } from "../shared/able-manager-panel.js";
import { renderBeingFlowPanel } from "../shared/being-flow-panel.js";
import { renderTimelineSection } from "./being-timeline.js";
import { setPortalStatus } from "../shared/portal-status.js";
import { renderOpForm } from "../shared/op-form.js";
import { renderTaskBar, openIdentityAction } from "./task-bar.js";

// ────────────────────────────────────────────────────────────────
// Public surface
// ────────────────────────────────────────────────────────────────

// Status messages route through the shared body-level toast (above
// every panel, red for errors). Also writes the legacy #status-line
// slot if it exists so any consumer reading it back still sees it.
export function setStatus(text) {
  setPortalStatus(text);
  const el = document.getElementById("status-line");
  if (el) el.textContent = text || "";
}

export function clearDetail() {
  document.getElementById("inspector")?.classList.add("hidden");
  document.getElementById("chat-panel")?.classList.add("hidden");
  document.getElementById("empty-detail")?.classList.remove("hidden");
}

export function renderDescriptor(desc, { session, discovery }) {
  if (!desc) return;
  renderTopBar(desc, { session, discovery });
  // The task menubar sits at the top of every view (Story / History /
  // Place) so its actions are always reachable, like a window menu bar.
  renderTaskBar(document.getElementById("task-menubar"), {
    descriptor: desc,
    session,
    discovery,
  });
  // Explorer dispatch — .reel/<kind>/<id>, .acts/<beingId>, .beings,
  // .threads/<id> return synthetic descriptors with is{Reel,ActChain,
  // BeingsCatalog,Thread} flags. Take over the middle area and render
  // the catalog/explorer instead of the normal position layout.
  if (desc.isReel || desc.isActChain || desc.isBeingsCatalog || desc.isThread) {
    renderExplorer(desc, { discovery });
    return;
  }
  // System catalog dispatch — .operations / .ables / .threads / .extensions
  // are normal positions whose children ARE the data (one space per
  // operation, able, thread, or extension). Without a catalog view they
  // just show "no beings here" with the items as nav chips in the bottom
  // bar — useless for browsing. Render the children as catalog rows
  // with their qualities surfaced inline.
  const catalogKind = detectCatalogPath(desc.address?.pathByNames);
  if (catalogKind) {
    renderSystemCatalog(desc, catalogKind, { discovery });
    return;
  }
  // Catalog-item dispatch — one level deeper: .operations/<op>,
  // .ables/<able>, .extensions/<ext>. Each is a regular space whose
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
  renderIdentityChip(session, discovery);
  // Breadcrumb + quick-nav retired with the action-center pass: the
  // shell IBPA, explorer, and console own movement; this view's header
  // is just identity. The stance bar is SHELL chrome (core/shell.js
  // repaints it from the shared model, including the selected being's
  // @qualifier) — the pre-shell push from here is retired too; it
  // raced the shell and stomped the selection with address.being:null.
}

function renderIdentityChip(session, discovery) {
  const idEl = document.getElementById("identity-chip");
  idEl.innerHTML = "";
  const story = discovery?.story || "";
  const username = session?.username || "arrival";
  const chip = document.createElement("button");
  chip.className = "chip" + (session?.token ? " chip-authed" : "");
  chip.textContent = session?.token ? `@${username}` : `@arrival`;
  chip.title = session?.token
    ? `signed in as @${username}\nbeing: ${session.beingAddress || "(unknown)"}\nid: ${session.beingId || "(not in session)"}\nclick for identity (key, export, sign out)`
    : "click to sign in with your name";
  chip.onclick = () => {
    if (session?.token) openIdentityAction();
    // The name layer is the single auth path (Name Form / being menu) — not a
    // flat-local claim/register overlay (which bypassed names + could mint an
    // i-am being).
    else flat.presentNameAuth?.();
  };
  idEl.appendChild(chip);
}

// syncAddressInput retired: the shared stance bar repaints itself
// from updateStanceBar and never clobbers a focused input.

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
  const dot = pill.querySelector(".conn-dot");
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
    if (b.inbox?.unconsumed > 0)
      meta.appendChild(badge(`inbox ${b.inbox.unconsumed}`, "queue"));
    if (b.activity?.kind) meta.appendChild(badge(b.activity.kind, "activity"));

    li.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "row-actions";

    // Explorer links — beings get both a fact-reel and an act-chain.
    // The being's id (when present) drives the synthetic SEE paths.
    const beingId = b.beingId || null;
    if (beingId && discovery?.story) {
      const factsA = document.createElement("a");
      factsA.className = "btn-sm btn-explore";
      factsA.href = `#${discovery.story}/.reel/being/${beingId}`;
      factsA.textContent = "facts";
      factsA.title = "this being's fact reel";
      actions.appendChild(factsA);

      const actsA = document.createElement("a");
      actsA.className = "btn-sm btn-explore";
      actsA.href = `#${discovery.story}/.acts/${beingId}`;
      actsA.textContent = "acts";
      actsA.title = "this being's act-chain";
      actions.appendChild(actsA);
    }

    const inspectBtn = document.createElement("button");
    inspectBtn.textContent = "inspect";
    inspectBtn.className = "btn-sm";
    inspectBtn.onclick = () => {
      // Interacting with a being refines the IBPA: the right stance
      // gains @<being>; every view shows the same focus.
      flat.selectBeing?.(b.beingId, b.being);
      showInspector({ kind: "being", entry: b });
    };
    actions.appendChild(inspectBtn);

    const chatBtn = document.createElement("button");
    chatBtn.textContent = "chat";
    chatBtn.className = "btn-sm btn-primary";
    chatBtn.disabled = !session?.token;
    chatBtn.title = session?.token
      ? "summon this being"
      : "claim an identity first";
    chatBtn.onclick = () => {
      flat.selectBeing?.(b.beingId, b.being);
      openChatFor(b);
    };
    actions.appendChild(chatBtn);

    // Per-intent summon buttons. Driven by the receiver's able
    // canSummon entries where as === "receiver". A "mate" button
    // appears next to chat for any being whose able declares
    // { intent: "mate", as: "receiver" } in canSummon (birther
    // ships this by default). Caller-side authorization happens at
    // dispatch — the substrate checks the caller's able's canSummon
    // entries with as === "actor" against this target. See
    // seed/AblesAreAuth.md ("canSummon is one field, two surfaces,
    // discriminated by as") + FEDERATION.md "mate + being".
    if (Array.isArray(b.canSummon) && session?.token) {
      for (const offer of b.canSummon) {
        if (offer?.as !== "receiver" || !offer?.intent) continue;
        const btn = document.createElement("button");
        btn.textContent =
          offer.intent === "mate"
            ? b.being === "cherub"
              ? "birth your first being"
              : "birth a child"
            : offer.intent;
        btn.className = "btn-sm";
        btn.title =
          offer.description ||
          `summon @${b.being} with intent="${offer.intent}"`;
        btn.onclick = () => openIntentSummon(b, offer);
        actions.appendChild(btn);
      }
    }

    li.appendChild(actions);
    ul.appendChild(li);
  }
}

// Open a focused summon prompt against a being with a specific intent.
// Today: a minimal prompt for any user-supplied params + dispatches
// the summon. The substrate-side able handler dispatches by
// message.intent and interprets the rest of the message accordingly.
//
// For "mate" specifically: the message can include optional name,
// homeSpaceId, password, cognition, defaultAble — all defaulted by
// the birther's handler. The summoner (you) becomes the father of
// the being-child; the target being becomes the mother.
function openIntentSummon(beingEntry, offer) {
  const isCherub = beingEntry.being === "cherub";
  const promptText =
    offer.intent === "mate"
      ? isCherub
        ? `Birth your first being through your name. It will be a top-level being, owned by you (cherub is right below I_AM). Name it:`
        : `Summon @${beingEntry.being} to mate. The new child has @${beingEntry.being} as mother and you as father. Optional: child name. (Leave blank for auto-generated.)`
      : `Summon @${beingEntry.being} with intent="${offer.intent}". Optional message:`;
  const userInput = window.prompt(promptText, "");
  if (userInput === null) return;
  const stance = beingEntry.stance || `@${beingEntry.being}`;
  // Intent rides on the envelope (per seed/SUMMON.md); only the
  // intent-specific payload fields go in content.
  const content = userInput.trim().length > 0 ? { name: userInput.trim() } : {};
  flat
    .sendSummon(stance, content, { intent: offer.intent })
    .then((res) => {
      const summary = res?.reply?.from
        ? `summoned @${beingEntry.being} (${offer.intent}); reply from ${res.reply.from}`
        : `summoned @${beingEntry.being} (${offer.intent})`;
      try {
        flat.setStatus?.(summary);
      } catch {}
    })
    .catch((err) => {
      try {
        flat.setStatus?.(`summon failed: ${err?.message || err}`);
      } catch {}
    });
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
  const ul = document.getElementById("lineage-list");
  const count = document.getElementById("lineage-count");
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
    ul.appendChild(
      emptyRow(
        "(no descendants yet — BE:birth from your own stance to mint one)",
      ),
    );
    return;
  }

  const story = discovery?.story || null;
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

    if (child.cognition) meta.appendChild(badge(child.cognition, "mode"));
    if (child.defaultAble)
      meta.appendChild(badge(child.defaultAble, "activity"));

    li.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "row-actions";

    // Inspect link → SEE the child's stance (so the user can drill in
    // and see ITS lineage too).
    if (story && child.name) {
      const a = document.createElement("a");
      a.className = "btn-sm btn-explore";
      a.href = `#${story}/@${child.name}`;
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
    inhabitBtn.onclick = () => triggerInhabit(child, { story });
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
async function triggerInhabit(child, { story }) {
  if (!story || !child?.name) return;
  setStatus(`inheriting @${child.name}...`);
  try {
    const { flat } = await import("./host.js");
    const stance = `${story}/@${child.name}`;
    const ack = await flat.beOp("connect", stance, {});
    if (!ack || ack.status === "error") {
      const msg = ack?.error?.message || "connect rejected";
      setStatus(`inhabit failed: ${msg}`);
      return;
    }
    const token = ack.data?.identityToken;
    const name = ack.data?.name || child.name;
    if (!token) {
      setStatus(`inhabit ok but no token returned (server bug?)`);
      return;
    }
    // Stash a one-shot session blob in the URL hash. The new tab reads
    // it on boot, copies into sessionStorage, clears the hash.
    const blob = encodeURIComponent(
      JSON.stringify({
        token,
        username: name,
        placeUrl: flat.state.session?.placeUrl || window.location.origin,
        inherited: true,
        // Who authorized this inhabit. Inheriter tab persists it and
        // listens for the spawner's pagehide on a BroadcastChannel —
        // when the spawner tab closes, the inheriter releases itself
        // (borrowed presence; lender leaves, lease ends).
        spawnerName: flat.state.session?.username || null,
      }),
    );
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

    if (m.type) meta.appendChild(badge(m.type, "type"));
    if (m.preview) {
      const prev = document.createElement("span");
      prev.className = "row-preview";
      prev.textContent =
        m.preview.length > 60 ? m.preview.slice(0, 60) + "…" : m.preview;
      meta.appendChild(prev);
    }
    li.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "row-actions";

    // Explorer link — open this matter's fact reel.
    if (m.matterId && discovery?.story) {
      const factsA = document.createElement("a");
      factsA.className = "btn-sm btn-explore";
      factsA.href = `#${discovery.story}/.reel/matter/${m.matterId}`;
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
// System catalogs — .operations / .ables / .threads / .extensions
// ────────────────────────────────────────────────────────────────

function detectCatalogPath(path) {
  if (typeof path !== "string") return null;
  // Match both the new "./X" canonical form and the legacy "/.X" form
  // some bookmarks may still carry.
  const m = path.match(/^\/(?:\.\/)?(operations|ables|threads|extensions)\/?$/);
  return m ? m[1] : null;
}

function detectCatalogItemPath(path) {
  if (typeof path !== "string") return null;
  // Item names can contain colons (`harmony:dancer-llm`), hyphens, dots.
  // Catch the catalog kind and the rest of the path (anything after).
  const m = path.match(
    /^\/(?:\.\/)?(operations|ables|extensions)\/([^/]+)\/?$/,
  );
  return m ? { kind: m[1], name: m[2] } : null;
}

const CATALOG_META = {
  operations: { icon: "⚙", title: "operations", sub: "registered DO actions" },
  ables: { icon: "◎", title: "ables", sub: "summonable able templates" },
  threads: {
    icon: "⧖",
    title: "threads",
    sub: "live coordination chains (rootCorrelations)",
  },
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
  else if (kind === "ables") renderAbleRowBody(main, item);
  else if (kind === "threads") renderThreadRowBody(main, item);
  else if (kind === "extensions") renderExtensionRowBody(main, item);

  li.appendChild(main);

  // ── Sub-row: address, links into the system
  const sub = document.createElement("div");
  sub.className = "catalog-sub";

  if (kind === "threads" && item.thread?.id && discovery?.story) {
    // Threads: link straight into the thread descriptor.
    const open = document.createElement("a");
    open.className = "btn-explore";
    open.href = `#${discovery.story}/./threads/${item.thread.id}`;
    open.textContent = "open thread";
    sub.appendChild(open);
  } else if (item.path && discovery?.story) {
    // Others: link to the item's own space (where qualities live).
    const open = document.createElement("a");
    open.className = "btn-explore";
    open.href = `#${discovery.story}${item.path}`;
    open.textContent = "open";
    sub.appendChild(open);
  }

  if (
    item.spaceId &&
    !String(item.spaceId).startsWith("thread:") &&
    discovery?.story
  ) {
    const reel = document.createElement("a");
    reel.className = "btn-explore";
    reel.href = `#${discovery.story}/.reel/space/${item.spaceId}`;
    reel.textContent = "facts";
    sub.appendChild(reel);
  }

  if (sub.children.length) li.appendChild(sub);
  return li;
}

// One-item detail view: SEE on `.operations/<op>` / `.ables/<able>` /
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
  h.innerHTML = `${meta.icon} <a class="dim" href="#${discovery.story}/.${kind}">${meta.title}</a> <span class="dim">/</span> ${name}`;
  header.appendChild(h);

  const sub = document.createElement("div");
  sub.className = "explorer-sub";
  const spaceId = desc.address?.spaceId;
  sub.textContent = spaceId ? `space ${spaceId}` : "(no spaceId)";
  header.appendChild(sub);

  if (spaceId && discovery?.story) {
    const reel = document.createElement("a");
    reel.className = "explorer-jump";
    reel.href = `#${discovery.story}/.reel/space/${spaceId}`;
    reel.textContent = `⛓ reel for this row`;
    header.appendChild(reel);
  }
  pane.appendChild(header);

  // Per-kind body. Read from qualities.<kind>.
  const q = desc.qualities || {};
  if (kind === "operations")
    renderOperationDetail(pane, q.operation || {}, name);
  else if (kind === "ables") renderAbleDetail(pane, q.able || {}, name);
  else if (kind === "extensions")
    renderExtensionDetail(pane, q.extension || q, name);
}

function renderOperationDetail(pane, op, name) {
  const grid = section("operation");
  grid.appendChild(kvBlock("name", name, { mono: true }));
  if (Array.isArray(op.targets) && op.targets.length) {
    grid.appendChild(kvBlock("targets", op.targets.join(", ")));
  }
  if (op.factAction)
    grid.appendChild(
      kvBlock("stamps factAction", op.factAction, { mono: true }),
    );
  if (op.ownerExtension)
    grid.appendChild(kvBlock("from extension", op.ownerExtension));
  grid.appendChild(kvBlock("skipAudit", op.skipAudit ? "true" : "false"));
  pane.appendChild(grid);

  if (op && Object.keys(op).length) {
    const raw = section("raw qualities.operation");
    raw.appendChild(jsonBlock(op));
    pane.appendChild(raw);
  }
}

function renderAbleDetail(pane, able, name) {
  const top = section("able");
  top.appendChild(kvBlock("name", name, { mono: true }));
  if (able.respondMode)
    top.appendChild(kvBlock("respondMode", able.respondMode));
  if (Array.isArray(able.triggerOn) && able.triggerOn.length) {
    top.appendChild(kvBlock("triggerOn", able.triggerOn.join(", ")));
  }
  if (able.replyTo) top.appendChild(kvBlock("replyTo", able.replyTo));
  pane.appendChild(top);

  // Capabilities — one section per verb. canSee is preloaded face
  // content (named sees + IBP addresses, rendered at moment-open);
  // do/summon/be are menus the LLM picks via tool calls. The legacy
  // `able.see` field collapsed into canSee on 2026-06-03.
  // Split canSummon by side so the able inspector reads cleanly:
  // outbound entries (what this able CAN send) vs inbound entries
  // (what this able ACCEPTS). Default `as: "actor"` preserves the
  // legacy display. See seed/AblesAreAuth.md "canSummon: one field,
  // two surfaces."
  const summonAll = Array.isArray(able.canSummon) ? able.canSummon : [];
  const summonActor = summonAll.filter(
    (e) => typeof e !== "object" || (e?.as ?? "actor") === "actor",
  );
  const summonReceiver = summonAll.filter(
    (e) => typeof e === "object" && e?.as === "receiver",
  );
  const caps = [
    ["canSee", able.canSee],
    ["canDo", able.canDo],
    ["canSummon (initiates)", summonActor],
    ["canSummon (accepts as receiver)", summonReceiver],
    ["canBe", able.canBe],
  ];
  for (const [label, list] of caps) {
    if (!Array.isArray(list) || list.length === 0) continue;
    const sec = section(label);
    const ul = document.createElement("ul");
    ul.className = "verb-list";
    for (const entry of list) {
      const li = document.createElement("li");
      const display =
        typeof entry === "object"
          ? entry.intent
            ? `intent="${entry.intent}"${entry.pattern ? ` target=${entry.pattern}` : ""}${entry.description ? ` — ${entry.description}` : ""}`
            : entry.pattern || JSON.stringify(entry)
          : String(entry);
      li.innerHTML = `<code>${escapeHtml(display)}</code>`;
      ul.appendChild(li);
    }
    sec.appendChild(ul);
    pane.appendChild(sec);
  }

  if (Array.isArray(able.permissions) && able.permissions.length) {
    const sec = section("permissions");
    sec.appendChild(jsonBlock(able.permissions));
    pane.appendChild(sec);
  }
}

function renderExtensionDetail(pane, ext, name) {
  const top = section("extension");
  top.appendChild(kvBlock("name", name, { mono: true }));
  if (ext.version) top.appendChild(kvBlock("version", ext.version));
  if (ext.description) top.appendChild(kvBlock("description", ext.description));
  if (ext.author) top.appendChild(kvBlock("author", ext.author));
  if (ext.installedAt)
    top.appendChild(kvBlock("installed at", String(ext.installedAt)));
  if (ext.enabled != null)
    top.appendChild(kvBlock("enabled", String(ext.enabled)));
  pane.appendChild(top);

  // Provides — list whatever capability arrays it advertises.
  const provideKeys = [
    "operations",
    "ables",
    "tools",
    "hooks",
    "seeds",
    "subscriptions",
    "schedules",
    "routes",
  ];
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
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
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

function renderAbleRowBody(main, item) {
  const able = item.qualities?.able || {};
  if (able.respondMode) main.appendChild(badge(able.respondMode, "mode"));
  if (Array.isArray(able.triggerOn) && able.triggerOn.length) {
    main.appendChild(badge(`on:${able.triggerOn.join(",")}`, "activity"));
  }
  // Compact capability summary: counts of canDo/canSee/canSummon/canBe.
  const caps = [];
  if (able.canDo?.length) caps.push(`do:${able.canDo.length}`);
  if (able.canSee?.length) caps.push(`see:${able.canSee.length}`);
  if (able.canSummon?.length) caps.push(`sum:${able.canSummon.length}`);
  if (able.canBe?.length) caps.push(`be:${able.canBe.length}`);
  if (caps.length) {
    const c = document.createElement("span");
    c.className = "dim catalog-ts";
    c.textContent = caps.join(" · ");
    c.title = `canDo: ${(able.canDo || []).join(", ") || "—"}\ncanSee: ${(able.canSee || []).join(", ") || "—"}\ncanSummon: ${(able.canSummon || []).join(", ") || "—"}\ncanBe: ${(able.canBe || []).join(", ") || "—"}`;
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
  else if (desc.isActChain)
    renderActChainExplorer(pane, desc.actChain, discovery);
  else if (desc.isBeingsCatalog)
    renderBeingsCatalog(pane, desc.beingsCatalog, discovery);
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
  h.innerHTML = `⧖ <a class="dim" href="#${discovery.story}/./threads">thread</a> <span class="dim">/</span> ${short(thread.id, 16)}`;
  h.title = thread.id;
  header.appendChild(h);

  const sub = document.createElement("div");
  sub.className = "explorer-sub";
  const parts = [];
  parts.push(
    `state: <span class="thread-state thread-state-${thread.state}">${thread.state}</span>`,
  );
  parts.push(`${thread.depth} act${thread.depth === 1 ? "" : "s"}`);
  if (thread.liveCount)
    parts.push(`<span class="dim">${thread.liveCount} live</span>`);
  if (thread.completeCount)
    parts.push(`<span class="dim">${thread.completeCount} complete</span>`);
  if (thread.severedCount)
    parts.push(`<span class="chain-bad">${thread.severedCount} severed</span>`);
  sub.innerHTML = parts.join(" · ");
  header.appendChild(sub);

  pane.appendChild(header);

  // Metadata block.
  const meta = section("thread");
  meta.appendChild(kvBlock("rootCorrelation", thread.id, { mono: true }));
  meta.appendChild(kvBlock("state", thread.state));
  if (thread.rootStartedAt)
    meta.appendChild(kvBlock("started at", String(thread.rootStartedAt)));
  if (thread.lastAct)
    meta.appendChild(kvBlock("last act at", String(thread.lastAct)));
  if (thread.parentThread && discovery?.story) {
    meta.appendChild(
      kvBlock("parent thread", thread.parentThread, {
        mono: true,
        link: `#${discovery.story}/./threads/${thread.parentThread}`,
      }),
    );
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
      a.href = `#${discovery.story}/.acts/${p}`;
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

// Global beings catalog — every Being row across the story. Different
// from the per-position beings list (which only shows beings homed at
// the current space). Used to answer "what beings exist?" the way
// .operations answers "what ops exist?".
function renderBeingsCatalog(pane, catalog, discovery) {
  const { beings, count } = catalog || {};

  const header = document.createElement("header");
  header.className = "explorer-header";

  const h = document.createElement("h2");
  h.className = "explorer-title";
  h.innerHTML = `∴ <span class="dim">beings</span> <span class="dim">across</span> ${discovery?.story || ""}`;
  header.appendChild(h);

  const sub = document.createElement("div");
  sub.className = "explorer-sub";
  sub.textContent = `${count} being${count === 1 ? "" : "s"} · global catalog · ordered by birth`;
  header.appendChild(sub);
  pane.appendChild(header);

  if (!beings || beings.length === 0) {
    const empty = document.createElement("div");
    empty.className = "explorer-empty";
    empty.textContent = "(no beings exist in this story yet)";
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
  if (b.defaultAble) {
    const able = badge(b.defaultAble, "activity");
    able.title =
      b.ables?.length > 1 ? `ables: ${b.ables.join(", ")}` : `default able`;
    main.appendChild(able);
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

  if (discovery?.story) {
    const facts = document.createElement("a");
    facts.className = "btn-explore";
    facts.href = `#${discovery.story}/.reel/being/${b.beingId}`;
    facts.textContent = "facts";
    sub.appendChild(facts);

    const acts = document.createElement("a");
    acts.className = "btn-explore";
    acts.href = `#${discovery.story}/.acts/${b.beingId}`;
    acts.textContent = "acts";
    sub.appendChild(acts);

    if (b.homeSpace) {
      const home = document.createElement("a");
      home.className = "btn-explore";
      home.href = `#${discovery.story}/.reel/space/${b.homeSpace}`;
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
  sub.innerHTML =
    `${count} fact${count === 1 ? "" : "s"} · newest first · ` +
    chainVerdictSummary(verdict);
  header.appendChild(sub);

  // Quick-nav: if the target is a being, offer a one-click jump to its acts.
  if (target.kind === "being" && discovery?.story) {
    const jump = document.createElement("a");
    jump.className = "explorer-jump";
    jump.href = `#${discovery.story}/.acts/${target.id}`;
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
// against the next-older block's identity (its _id IS its content
// hash under full CAS). Returns:
//   { ok: bool, verified: N, broken: M, perBlock: ["ok" | "genesis" | "edge" | "broken"] }
function verifyChain(facts) {
  const out = { ok: true, verified: 0, broken: 0, perBlock: [] };
  for (let i = 0; i < facts.length; i++) {
    const f = facts[i];
    // The older neighbor in the window (if present).
    const older = facts[i + 1];
    if (older) {
      const olderId = older._id || older.h;
      if (f.p && olderId && String(f.p) === String(olderId)) {
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
      else out.perBlock.push("edge");
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
  chain.textContent =
    chainStatus === "ok"
      ? "✓"
      : chainStatus === "genesis"
        ? "◇"
        : chainStatus === "broken"
          ? "✗"
          : "·";
  chain.title =
    chainStatus === "ok"
      ? "prev-hash matches predecessor block"
      : chainStatus === "genesis"
        ? "first fact on this reel (genesis)"
        : chainStatus === "broken"
          ? "prev-hash DOES NOT match predecessor — chain broken here"
          : "predecessor outside visible window";
  summary.appendChild(chain);

  const seq = document.createElement("span");
  seq.className = "block-seq";
  seq.textContent = `#${f.seq ?? "?"}`;
  seq.title = "per-reel sequence (block height)";
  summary.appendChild(seq);

  const action = document.createElement("span");
  action.className = "block-action";
  action.textContent = `${f.verb}:${f.act}`;
  summary.appendChild(action);

  const target = document.createElement("span");
  target.className = "block-target dim";
  const tk = f.of?.kind || "?";
  const ti = f.of?.id ? short(String(f.of.id)) : "?";
  target.textContent = `→ ${tk}/${ti}`;
  summary.appendChild(target);

  const doer = document.createElement("span");
  doer.className = "block-doer";
  doer.textContent = f.beingName
    ? `@${f.beingName}`
    : f.through
      ? short(f.through)
      : "?";
  doer.title = f.through || "";
  summary.appendChild(doer);

  const ts = document.createElement("span");
  ts.className = "block-ts dim";
  ts.textContent = formatTs(f.date);
  ts.title = f.date || "";
  summary.appendChild(ts);

  const hash = document.createElement("code");
  hash.className = "block-hash";
  // The fact's identity IS its content hash (_id) under full CAS.
  hash.textContent = `#${short(f._id, 10)}`;
  hash.title = f._id
    ? `identity: ${f._id}\nprev: ${f.p || "(genesis)"}`
    : "(no identity)";
  summary.appendChild(hash);

  const toggle = document.createElement("button");
  toggle.className = "block-toggle";
  toggle.textContent = "▸";
  toggle.title = "expand";
  summary.appendChild(toggle);

  li.appendChild(summary);

  // Content sub-row — show a human-readable derived from params when
  // available (summon content, create-* name, set-* field=value).
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

  detail.appendChild(
    kvBlock("identity (hash)", f._id || "(none)", { mono: true }),
  );
  detail.appendChild(kvBlock("p (prev)", f.p || "(genesis)", { mono: true }));
  if (f.actId)
    detail.appendChild(
      kvBlock("act id", f.actId, {
        mono: true,
        link:
          discovery && f.through
            ? `#${discovery.story}/.acts/${f.through}`
            : null,
      }),
    );
  if (f.params != null) detail.appendChild(jsonKv("params", f.params));
  if (f.result != null) detail.appendChild(jsonKv("result", f.result));
  // Target link — clickable for navigation into the target's own reel.
  if (discovery?.story && f.of?.kind && f.of?.id) {
    const linkText = `${f.of.kind}/${f.of.id}`;
    detail.appendChild(
      kvBlock("target", linkText, {
        mono: true,
        link: `#${discovery.story}/.reel/${f.of.kind}/${f.of.id}`,
      }),
    );
  }
  // Doer link — to the doer's own facts.
  if (discovery?.story && f.through) {
    detail.appendChild(
      kvBlock("doer", f.beingName || f.through, {
        mono: true,
        link: `#${discovery.story}/.reel/being/${f.through}`,
      }),
    );
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

  if (discovery?.story) {
    const jump = document.createElement("a");
    jump.className = "explorer-jump";
    jump.href = `#${discovery.story}/.reel/being/${being.id}`;
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
  // content the user actually wants to read; row 2 (sub) shows able +
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
  // transport-acts and other ables, endMessage may be empty and the
  // startMessage carries the meaning. Prefer the response when it's a
  // non-empty string; otherwise format the inbound (which may itself
  // be an object — subscription wakes carry { event, spaceId, ... }).
  const endText =
    typeof a.endMessage?.content === "string" && a.endMessage.content.trim()
      ? a.endMessage.content
      : null;
  const startText = formatActPayload(a.startMessage?.content);

  // A structured act has no prose response: its content IS the Facts it
  // stamped (a dancer's step, any tool call). When endMessage is empty
  // but the act produced Facts, show what it DID rather than echoing the
  // wake that triggered it. An act with neither prose nor Facts is a
  // SEE that left no trace and never reaches here.
  const actText =
    !endText && Array.isArray(a.facts) && a.facts.length
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

  const able = document.createElement("span");
  able.className = "block-able";
  able.textContent = a.activeAble || "(no able)";
  sub.appendChild(able);

  if (a.ibpAddress) {
    const addr = document.createElement("span");
    addr.className = "block-target dim";
    addr.textContent = short(a.ibpAddress, 40);
    addr.title = a.ibpAddress;
    sub.appendChild(addr);
  }

  const root = document.createElement("code");
  root.className = "block-hash";
  root.textContent = a.rootCorrelation
    ? `root:${short(a.rootCorrelation, 8)}`
    : "(no root)";
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
  } else if (
    typeof a.endMessage?.content === "string" &&
    a.endMessage.content
  ) {
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
  if (a.ibpAddress)
    detail.appendChild(kvBlock("ibp address", a.ibpAddress, { mono: true }));
  if (a.activeAble) detail.appendChild(kvBlock("able", a.activeAble));
  if (a.priority) detail.appendChild(kvBlock("priority", a.priority));
  if (a.to && discovery?.story) {
    detail.appendChild(
      kvBlock("being out", a.to, {
        mono: true,
        link: `#${discovery.story}/.reel/being/${a.to}`,
      }),
    );
  }
  if (a.rootCorrelation)
    detail.appendChild(
      kvBlock("rootCorrelation", a.rootCorrelation, { mono: true }),
    );
  if (a.inReplyTo)
    detail.appendChild(kvBlock("inReplyTo", a.inReplyTo, { mono: true }));
  if (a.parentThread)
    detail.appendChild(kvBlock("parentThread", a.parentThread, { mono: true }));
  if (a.answers)
    detail.appendChild(kvBlock("answers (summon)", a.answers, { mono: true }));
  if (a.startMessage?.content)
    detail.appendChild(jsonKv("in (start message)", a.startMessage));
  if (a.endMessage?.content || a.endMessage?.stopped)
    detail.appendChild(jsonKv("out (end message)", a.endMessage));
  // The Facts this moment stamped — the act's substrate-change content,
  // the other half of "what happened" alongside any prose end message.
  if (Array.isArray(a.facts) && a.facts.length) {
    detail.appendChild(jsonKv(`facts (${a.facts.length})`, a.facts));
  }
  // The face this moment ran under . what the being saw and could do.
  // Stamped on every act; renders a faint marker when absent (legacy).
  detail.appendChild(renderFace(a.innerFace, discovery));
  if (a.severedAt)
    detail.appendChild(kvBlock("severed at", String(a.severedAt)));
  if (a.receivedAt)
    detail.appendChild(kvBlock("received at", String(a.receivedAt)));
  if (a.stampedAt)
    detail.appendChild(kvBlock("stamped at", String(a.stampedAt)));

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
  sub.onclick = expand;
  return li;
}

// Headline label for one stamped fact: the action plus its summary,
// so an act-block whose moment produced no prose still reads as what it
// did ("harmony:step → (5, 4)", "create-space name \"dance-floor\""). The
// action name carries the verb intent; factSummaryLine carries the
// payload. Returns null only for a fact with no action at all.
function factActionLabel(f) {
  if (!f || !f.act) return null;
  const summary = factSummaryLine(f);
  return summary ? `${f.act} ${summary}` : f.act;
}

// Derive a one-line content summary from a fact's verb/action/params.
// Returns null if nothing useful to show — caller skips the sub-row.
function factSummaryLine(f) {
  if (!f) return null;
  const p = f.params;
  // summon — the message content is the headline.
  if (f.verb === "call") {
    const c = p?.content;
    if (typeof c === "string" && c) return `"${c}"`;
    if (
      c &&
      typeof c === "object" &&
      typeof c.content === "string" &&
      c.content
    ) {
      return `"${c.content}"`;
    }
  }
  // be:register / be:claim / be:birth — name on the spec / params.
  if (f.verb === "be" && (f.act === "register" || f.act === "claim")) {
    if (p?.name) return `@${p.name}`;
  }
  if (f.verb === "be" && f.act === "birth" && p?.spec?.name) {
    return `@${p.spec.name}`;
  }
  // create-* — name on the spec.
  if (/^create/.test(f.act) && p?.spec?.name) {
    return `name "${p.spec.name}"${p.spec.type ? ` (type ${p.spec.type})` : ""}`;
  }
  // set-* — field = value. coord renders as a position so a dancer's
  // step reads "→ (5, 4)" rather than "coord = {"x":5,"y":4}".
  if (/^set/.test(f.act) && p?.field) {
    const v = p.value;
    if (
      p.field === "coord" &&
      v &&
      typeof v.x === "number" &&
      typeof v.y === "number"
    ) {
      return `→ (${v.x}, ${v.y})`;
    }
    const vs =
      typeof v === "string"
        ? v
        : typeof v === "number" || typeof v === "boolean"
          ? String(v)
          : safeJson(v, 60);
    return `${p.field} = ${vs}`;
  }
  // place-being / move — coords or path.
  if (/place|move/.test(f.act) && p) {
    if (typeof p.x === "number" && typeof p.y === "number")
      return `→ (${p.x}, ${p.y})`;
    if (p.path) return `→ ${p.path}`;
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
  } catch {
    return null;
  }
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
  if (typeof c.text === "string" && c.text.trim()) return c.text;
  if (typeof c.content === "string" && c.content.trim()) return c.content;
  // Subscription / scheduled-wake / drummer-tick / DO-trigger shape.
  if (c.event) {
    const parts = [String(c.event)];
    if (c.spaceId) parts.push(`at space/${shortIdInline(c.spaceId)}`);
    if (c.actorBeingId) parts.push(`by being/${shortIdInline(c.actorBeingId)}`);
    if (c.matterId) parts.push(`on matter/${shortIdInline(c.matterId)}`);
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
  } catch {
    return "";
  }
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

// Render one capability/occupant list to a single comma-joined string,
// folding the clampList sentinel ({kind:"truncated", count:N}) into a
// trailing "+N more". Plain strings pass through; only the sentinel is
// an object. Returns { text, shown, more } so the caller can label it.
function joinFaceList(list) {
  const names = [];
  let more = 0;
  for (const item of list || []) {
    if (item && typeof item === "object" && item.kind === "truncated") {
      more += Number(item.count) || 0;
      continue;
    }
    names.push(item?.name || item?.id || String(item));
  }
  let text = names.join(", ");
  if (more) text += (text ? ", " : "") + `+${more} more`;
  return { text: text || "(none)", shown: names.length, more };
}

// Render an act's "face" . the canonical inner face the being had on
// hand when this moment stamped. Carries orientation, able, position,
// capabilities, the able.canSee-resolved blocks, and origin
// ("local" or "foreign"). Stamped on every act regardless of cognition;
// null on legacy acts predating the field (render a faint marker
// rather than breaking the block). Returns a stacked kv container.
function renderFace(face, discovery) {
  const wrap = document.createElement("div");
  wrap.className = "kv-block kv-block-stack block-face";
  const l = document.createElement("span");
  l.className = "kv-block-label";
  l.textContent = "face";
  wrap.appendChild(l);

  if (!face) {
    const none = document.createElement("span");
    none.className = "kv-block-value dim";
    none.textContent = "(no face recorded)";
    wrap.appendChild(none);
    return wrap;
  }

  const body = document.createElement("div");
  body.className = "face-body";

  if (face.orientation)
    body.appendChild(kvBlock("orientation", face.orientation));
  if (face.able) body.appendChild(kvBlock("able", face.able));
  if (face.origin && face.origin !== "local") {
    body.appendChild(kvBlock("origin", face.origin));
  }

  if (face.position) {
    const positionName = face.position.name || face.position.id || "(position)";
    const link =
      face.position.id && discovery?.story
        ? `#${discovery.story}/.reel/space/${face.position.id}`
        : null;
    body.appendChild(kvBlock("position", positionName, { link }));
  }

  // Capabilities: one row per present capability key (canDo / canSummon /
  // canBe today), iterated generically. Skip empty lists.
  const caps = face.capabilities;
  if (caps && typeof caps === "object") {
    for (const key of Object.keys(caps)) {
      if (!Array.isArray(caps[key]) || !caps[key].length) continue;
      const { text } = joinFaceList(caps[key]);
      body.appendChild(kvBlock(key, text));
    }
  }

  // canSee-resolved blocks: one row per block, labeled by the block's
  // label, with a compact preview of the payload. The full payload is
  // available to anyone hitting the act-chain SEE directly; here we
  // surface enough to badge what the able admitted into perception.
  if (Array.isArray(face.blocks) && face.blocks.length) {
    for (const b of face.blocks) {
      if (!b || b.kind === "truncated") {
        if (b && b.kind === "truncated") {
          body.appendChild(kvBlock("blocks", `+${b.count} more`));
        }
        continue;
      }
      const label = b.label || b.key || "(block)";
      let preview;
      if (typeof b.payload === "string") {
        preview =
          b.payload.length > 80 ? b.payload.slice(0, 80) + "..." : b.payload;
      } else if (b.payload != null) {
        try {
          const s = JSON.stringify(b.payload);
          preview = s.length > 80 ? s.slice(0, 80) + "..." : s;
        } catch {
          preview = "(unrenderable)";
        }
      } else {
        preview = "(empty)";
      }
      const sourceTag = b.source ? ` <${b.source}>` : "";
      body.appendChild(kvBlock(`saw ${label}${sourceTag}`, preview));
    }
  }

  wrap.appendChild(body);
  return wrap;
}

// renderChildren retired with the action-center pass — child browsing
// belongs to the explorer view; this view is the work surface.

// ────────────────────────────────────────────────────────────────
// Inspector — full descriptor surface + invocable BE/DO ops
// ────────────────────────────────────────────────────────────────

export function showInspector({ kind, entry }) {
  const empty = document.getElementById("empty-detail");
  const chat = document.getElementById("chat-panel");
  const insp = document.getElementById("inspector");
  empty.classList.add("hidden");
  chat.classList.add("hidden");
  insp.classList.remove("hidden");
  insp.innerHTML = "";

  if (kind === "being") {
    // @able-manager opens a dedicated authoring panel instead of the
    // generic being inspector. The being itself is scripted (no chat),
    // and the panel is the whole point of the being's existence.
    if (entry?.being === "able-manager") {
      renderAbleManagerPanel(insp, entry, {
        story: flat.state.discovery?.story,
        username: flat.state.session?.username || null,
        descriptor: flat.state.descriptor,
        see: (addr) => flat.state.client.see(addr),
        doOp: flat.doOp,
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
  const fl = flat.state;
  const story = fl.discovery?.story;
  const path = fl.descriptor?.address?.pathByNames || "/";
  const stance = `${story}${path}@${b.being}`.replace(/\/+@/, "/@");
  const isSelf = fl.session?.username === b.being;

  // Header
  const h = document.createElement("h3");
  h.className = "pane-title";
  h.textContent = `@${b.being}`;
  insp.appendChild(h);

  const sub = document.createElement("div");
  sub.className = "sub";
  sub.textContent = stance;
  insp.appendChild(sub);

  // ─── Identity: the permanent id (the ed25519 pubkey) under the
  //     contextual name. The id never changes; the name can.
  if (b.beingId) {
    const idSec = section("identity");
    idSec.appendChild(kv("id (public key)", String(b.beingId)));
    insp.appendChild(idSec);
  }

  // ─── State badges (live face of this being right now)
  const state = section("state");
  state.appendChild(kv("invocable by", b.invocableBy || "(unknown)"));
  if (b.respondMode) state.appendChild(kv("respondMode", b.respondMode));
  if (Array.isArray(b.triggerOn) && b.triggerOn.length) {
    state.appendChild(kv("triggerOn", b.triggerOn.join(", ")));
  }
  state.appendChild(kv("available", b.available === false ? "no" : "yes"));
  if (b.busy)
    state.appendChild(
      kv("busy", b.talkingTo ? `talking to ${b.talkingTo}` : "yes"),
    );
  if (b.activity) {
    const act = `${b.activity.kind}${b.activity.content ? ` — ${b.activity.content}` : ""}`;
    state.appendChild(kv("activity", act));
  }
  insp.appendChild(state);

  // ─── Inbox
  const ib = b.inbox || {};
  const inbox = section("inbox");
  inbox.appendChild(
    kv("total / unconsumed", `${ib.total ?? 0} / ${ib.unconsumed ?? 0}`),
  );
  if (ib.queueDepth) inbox.appendChild(kv("queue depth", ib.queueDepth));
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
      const w = document.createElement("span");
      w.className = "msg-who";
      w.textContent = r.from || "?";
      const c = document.createElement("span");
      c.className = "msg-content";
      c.textContent = " " + (r.content || "").slice(0, 80);
      li.appendChild(w);
      li.appendChild(c);
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
  link.textContent = `→ see ${stance.replace(story, "")}`;
  link.title = "navigate to this being's stance and re-SEE from there";
  nav.appendChild(link);
  insp.appendChild(nav);

  // ─── Permissions
  if (
    b.permissions &&
    typeof b.permissions === "object" &&
    Object.keys(b.permissions).length
  ) {
    const sec = section("permissions");
    sec.appendChild(jsonBlock(b.permissions));
    insp.appendChild(sec);
  }

  // ─── Qualities
  if (
    b.qualities &&
    typeof b.qualities === "object" &&
    Object.keys(b.qualities).length
  ) {
    const sec = section("qualities");
    sec.appendChild(jsonBlock(b.qualities));
    insp.appendChild(sec);
  }

  // ─── BE actions (identity ops on this being's stance)
  const be = section("BE actions");
  if (b.being === "cherub") {
    // Cherub is the authentication being. Show connect + birth inline.
    be.appendChild(beInlineForm("connect", stance, ["name", "password"]));
    be.appendChild(beInlineForm("birth", stance, ["name", "password"]));
  } else {
    // For any other being: release if you are them. No bind-as-other
    // shortcut anymore . release first, then connect through cherub.
    if (isSelf) {
      be.appendChild(beButton("release", stance, {}));
    }
  }
  insp.appendChild(be);

  // ─── Able Flow editor (when signed in — server gates the save)
  // The mad-libs editor authors the being's `qualities.flow`. Per
  // Flow doctrine, the flow is the source of truth for which ables
  // wake the being and how they compose. Reading the existing flow is
  // public (rides on the descriptor's beings[]); saving goes through
  // set-being which authorize gates per-stance.
  if (fl.session?.username) {
    const flowSec = document.createElement("section");
    flowSec.className = "panel-section";
    insp.appendChild(flowSec);
    renderBeingFlowPanel(flowSec, b, {
      story: story,
      username: fl.session.username,
      descriptor: fl.descriptor,
      see: (addr) => fl.client.see(addr),
      doOp: flat.doOp,
    });
  }

  // ─── Timeline (recent acts on this being's reel; click to fold to past)
  renderTimelineSection(insp, b, { story });

  // ─── LLM at this space (7-step chain preview + per-being config)
  // Calls the llm-assigner:preview-llm-chain DO op to show which LLM
  // would be picked if this being were summoned RIGHT NOW from this
  // position. The session user is the actor; this being is the
  // receiver. Below the chain, the user's own qualities.llm config
  // surfaces (default list, slots per able, force flags) with
  // affordances to edit via the set-being-llm form.
  renderLlmSection(insp, b, { story, stance });

  // ─── DO actions (ops whose targets include being or stance)
  const ops = [
    ...flat.operationsForTarget("being"),
    ...flat.operationsForTarget("stance"),
  ];
  // De-dup by name (an op listing both targets shows once).
  const seen = new Set();
  const unique = ops.filter((o) =>
    seen.has(o.name) ? false : (seen.add(o.name), true),
  );
  if (unique.length) {
    const sec = section(`DO actions (${unique.length})`);
    for (const op of unique) sec.appendChild(doInlineForm(op, stance));
    insp.appendChild(sec);
  }
}

// ── Matter inspector ────────────────────────────────────────────

function renderMatterInspector(insp, m) {
  const fl = flat.state;
  const story = fl.discovery?.story;
  const path = fl.descriptor?.address?.pathByNames || "/";
  const matterAddress = `${story}${path}`.replace(/\/+$/, "") || story;

  const h = document.createElement("h3");
  h.className = "pane-title";
  h.textContent = m.name || "(matter)";
  insp.appendChild(h);

  const sub = document.createElement("div");
  sub.className = "sub";
  sub.textContent = `matterId ${m.matterId || "?"}`;
  insp.appendChild(sub);

  const meta = section("meta");
  if (m.type) meta.appendChild(kv("type", m.type));
  if (m.byBeingId) meta.appendChild(kv("written by", m.byBeingId));
  insp.appendChild(meta);

  if (m.preview) {
    const sec = section("preview");
    const pre = document.createElement("pre");
    pre.className = "preview-block";
    pre.textContent = m.preview;
    sec.appendChild(pre);
    insp.appendChild(sec);
  }

  if (
    m.qualities &&
    typeof m.qualities === "object" &&
    Object.keys(m.qualities).length
  ) {
    const sec = section("qualities");
    sec.appendChild(jsonBlock(m.qualities));
    insp.appendChild(sec);
  }

  // DO actions targeting matter
  const matterOps = flat.operationsForTarget("matter");
  if (matterOps.length) {
    const sec = section(`DO actions (${matterOps.length})`);
    for (const op of matterOps)
      sec.appendChild(
        doInlineForm(op, matterAddress, { matterId: m.matterId }),
      );
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
      showResult(
        result,
        `${err.code || "error"}: ${err.message || String(err)}`,
        "err",
      );
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
      showResult(
        result,
        `${err.code || "error"}: ${err.message || String(err)}`,
        "err",
      );
    } finally {
      btn.disabled = false;
    }
  };

  wrap.appendChild(result);
  return wrap;
}

// One DO operation as a directed form. Delegates to the shared schema
// renderer (op-form.js): ops that declare an `args` schema render clean
// labeled fields; schema-less ops fall back to a single JSON box. Any
// `baseArgs` (e.g. { matterId }) are context, not fields — they're merged
// into the call at submit, not shown.
function doInlineForm(op, address, baseArgs = {}) {
  const wrap = document.createElement("div");
  wrap.className = "action-row";
  const doOp = Object.keys(baseArgs).length
    ? (addr, name, args) => flat.doOp(addr, name, { ...baseArgs, ...args })
    : flat.doOp;
  renderOpForm(wrap, { op, address, doOp, submitLabel: "do" });
  return wrap;
}

// ── LLM section ────────────────────────────────────────────────────
//
// Renders below the being inspector. Two halves:
//
//   1. CHAIN PREVIEW — calls llm-assigner:preview-llm-chain to fetch
//      the 7-step ordered candidate list for (receiver=this being,
//      actor=session user, able=main). Renders as a vertical flow:
//        ✓ step 1  receiver-being:default  gpt-4o-mini  (CHOSEN)
//          step 3  receiver-story:slot   claude-3-5-sonnet
//          ...
//      and a `reason:` line at the bottom showing why the chain
//      stopped (cap, no candidates, etc.).
//
//   2. PER-BEING CONFIG — shows the being's current qualities.llm
//      (default fallback list count, slots per able, force flags).
//      Affordances expand to the set-being-llm DO form.
//
// Self-only edit: the form fields show for every viewer but
// authorize() rejects the write unless the caller is the being.
function renderLlmSection(insp, b, { story, stance } = {}) {
  const fl = flat.state;
  const sec = section("LLM at this space");
  insp.appendChild(sec);

  // Live state — repopulated by the preview call below.
  const flowDiv = document.createElement("div");
  flowDiv.className = "llm-flow";
  flowDiv.textContent = "(loading chain…)";
  sec.appendChild(flowDiv);

  // Per-being qualities.llm summary.
  const cfg = b.qualities?.llm || {};
  const configDiv = document.createElement("div");
  configDiv.className = "llm-config";
  const cfgTitle = document.createElement("div");
  cfgTitle.className = "kv-label";
  cfgTitle.textContent = `${b.being}'s LLM config`;
  configDiv.appendChild(cfgTitle);
  const defaultLen = Array.isArray(cfg.default)
    ? cfg.default.length
    : cfg.default
      ? 1
      : 0;
  configDiv.appendChild(
    kv(
      "default fallback",
      `${defaultLen} connection${defaultLen === 1 ? "" : "s"}`,
    ),
  );
  const slots = cfg.slots && typeof cfg.slots === "object" ? cfg.slots : {};
  const slotKeys = Object.keys(slots);
  if (slotKeys.length) {
    for (const r of slotKeys) {
      const list = Array.isArray(slots[r])
        ? slots[r]
        : slots[r]
          ? [slots[r]]
          : [];
      configDiv.appendChild(
        kv(
          `slot: ${r}`,
          `${list.length} connection${list.length === 1 ? "" : "s"}`,
        ),
      );
    }
  } else {
    configDiv.appendChild(kv("able slots", "(none)"));
  }
  if (cfg.forceReceiver === true)
    configDiv.appendChild(kv("forceReceiver", "yes — chain caps here"));
  if (cfg.forceActor === true)
    configDiv.appendChild(kv("forceActor", "yes — chain jumps to actor side"));
  if (cfg.preferOwn === true) configDiv.appendChild(kv("preferOwn", "yes"));
  sec.appendChild(configDiv);

  // Edit affordance — link out to the set-being-llm DO form. Already
  // rendered below in the "DO actions" section; here we just nudge the
  // user to find it.
  const editHint = document.createElement("div");
  editHint.className = "sub muted";
  editHint.textContent = "Edit via set-being-llm in DO actions below.";
  sec.appendChild(editHint);

  // Fire the preview op. The receiver is this being's beingId (from
  // the descriptor). The actor is the signed-in user (by name; the op
  // resolves names). Able defaults to "main" — a future enhancement
  // can let the user pick a different able here.
  const receiverBeingId = b.beingId || null;
  const actorBeingName = fl.session?.username || null;
  const able = b.defaultAble || "main";

  if (!receiverBeingId) {
    flowDiv.textContent = "(receiver beingId unavailable — descriptor missing)";
    return;
  }

  // SEE op call. The 7-step chain is a read-only perception — no Fact
  // stamped. `story.see("llm-chain", args)` dispatches through the
  // unified SEE ops registry (parallel to story.do).
  Promise.resolve(
    fl.client.see("llm-chain", {
      args: {
        receiverBeingId,
        receiverSpaceId: fl.descriptor?.position?.spaceId || null,
        actorBeingName,
        able,
      },
    }),
  )
    .then((res) => {
      flowDiv.innerHTML = "";
      const r = (res && res.result) || res || {};
      const chain = Array.isArray(r.chain) ? r.chain : [];
      const reason = r.reason || null;
      const chosen = r.chosen || null;

      if (chain.length === 0) {
        const p = document.createElement("div");
        p.className = "sub";
        p.textContent = reason || "(no candidates in chain)";
        flowDiv.appendChild(p);
        return;
      }

      const head = document.createElement("div");
      head.className = "kv-label";
      head.textContent = `chain preview — able: ${able}`;
      flowDiv.appendChild(head);

      const ul = document.createElement("ul");
      ul.className = "llm-chain";
      for (const entry of chain) {
        const li = document.createElement("li");
        li.className = "llm-chain-entry";
        const isChosen =
          chosen &&
          entry.connectionId === chosen.connectionId &&
          entry.step === chosen.step &&
          entry.source === chosen.source;
        const marker = document.createElement("span");
        marker.className = "llm-chain-marker";
        marker.textContent = isChosen ? "✓" : " ";
        const step = document.createElement("span");
        step.className = "llm-chain-step";
        step.textContent = `step ${entry.step}`;
        const src = document.createElement("span");
        src.className = "llm-chain-source";
        src.textContent = entry.source;
        const model = document.createElement("span");
        model.className = "llm-chain-model";
        model.textContent =
          entry.model || entry.name || entry.connectionId.slice(0, 8);
        if (isChosen) li.style.fontWeight = "bold";
        li.appendChild(marker);
        li.appendChild(step);
        li.appendChild(src);
        li.appendChild(model);
        ul.appendChild(li);
      }
      flowDiv.appendChild(ul);

      if (reason) {
        const rDiv = document.createElement("div");
        rDiv.className = "sub muted";
        rDiv.textContent = `reason: ${reason}`;
        flowDiv.appendChild(rDiv);
      }
    })
    .catch((err) => {
      flowDiv.innerHTML = "";
      const p = document.createElement("div");
      p.className = "sub muted";
      p.textContent = `(preview failed: ${err?.message || err})`;
      flowDiv.appendChild(p);
    });
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
