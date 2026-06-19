// TreeOS Portal . core/shell.js
//
// The portal shell — the chrome that stays up no matter which view is
// mounted. Three rows of responsibility:
//
//   1. Being tabs. The whole user space is tabbed per being: each tab
//      is one PortalContext (its own client, session, state). Switch
//      tabs and you switch beings; each tab remembers its own view.
//   2. The IBPA stance bar — always visible, on every view — plus
//      back/forward/story/home/root and the four-view switcher.
//   3. The content region (#view-root) the active view draws into,
//      and the cross-view chrome: branch/timeline bar, status toast,
//      ghost/paused cues.
//
// The kernel doesn't know which view is active; the shell doesn't
// know what a view renders. Both only share the state model.

import "../styles/shell.css";
import { initStanceBar, placeStanceBar, updateStanceBar } from "../shared/stance-bar.js";
import { setPortalStatus } from "../shared/portal-status.js";
import { createViewHost, VIEW_NAMES } from "./views.js";
import { createPortalContext } from "./context.js";
import { resolvePlaceConfig } from "./config.js";
import { showNameForm, hideNameForm } from "../shared/name-form.js";
import { showBeingPicker, hideBeingPicker } from "../shared/being-picker.js";
import { showNameTree, hideNameTree, isNameTreeOpen } from "../shared/name-tree-panel.js";

// The IBPA stance bar is PINNED TO THE VERY TOP — the portal's one
// constant surface. The being-tab strip rides directly under it and
// also never hides; every view (3D included) renders below both, so
// one tab can be in 3D while another tab is in text on another being.
const SHELL_DOM = `
<div id="portal-shell">
  <header id="portal-topbar">
    <button class="nav-btn" id="nav-back"    title="Back (B)"    disabled>&lsaquo;</button>
    <button class="nav-btn" id="nav-forward" title="Forward (N)" disabled>&rsaquo;</button>
    <div id="stance-slot" style="display:flex; flex:1; min-width:0;"></div>
    <button class="nav-btn" id="nav-send"  title="Go to the typed address (Enter)">&#10132;</button>
    <button class="nav-btn" id="nav-place" title="Story root">/</button>
    <button class="nav-btn" id="nav-home"  title="Your home" disabled>~</button>
    <span id="branch-button-slot" style="display:flex"></span>
    <nav id="view-switcher" title="views (Alt+1..5)"></nav>
    <button class="nav-btn" id="nav-tree" style="display:none" title="your being hierarchy — see it on this branch, grant a name access">&#127795;</button>
    <button class="nav-btn" id="lock-dot" style="display:none" title="signing session"></button>
    <span id="conn-dot" class="conn-idle" title="socket"></span>
  </header>
  <div id="portal-tabs"></div>
  <main id="view-root">
    <div class="view-boot"><span class="vb-pulse"></span>finding your place…</div>
  </main>
  <footer id="statement-bar">
    <input id="statement-input" type="text" autocomplete="off" spellcheck="false"
           placeholder="Say the Word — I make a space, I give tabor the role…" disabled />
    <div id="statement-hint"></div>
  </footer>
  <div id="overlays"></div>
</div>
`.trim();

export function mountShell({ rootEl, primaryCtx, defaultView = "3d" }) {
  rootEl.innerHTML = SHELL_DOM;
  const els = {
    tabs:     rootEl.querySelector("#portal-tabs"),
    topbar:   rootEl.querySelector("#portal-topbar"),
    back:     rootEl.querySelector("#nav-back"),
    forward:  rootEl.querySelector("#nav-forward"),
    send:     rootEl.querySelector("#nav-send"),
    place:    rootEl.querySelector("#nav-place"),
    home:     rootEl.querySelector("#nav-home"),
    switcher: rootEl.querySelector("#view-switcher"),
    tree:     rootEl.querySelector("#nav-tree"),
    viewRoot: rootEl.querySelector("#view-root"),
    statement:     rootEl.querySelector("#statement-input"),
    statementHint: rootEl.querySelector("#statement-hint"),
  };

  const viewHost = createViewHost(els.viewRoot);
  const tabs = [];               // [{ ctx, unsubs: [] }]
  let activeCtx = null;
  let branchBar = null;
  let branchBarRefreshTimer = null;
  let tabCounter = 0;

  // ── Chrome repaint ──────────────────────────────────────────────

  // Build the view-switcher buttons ONCE — stable nodes, class
  // toggles only. Rebuilding them per state change would replace the
  // node mid-click (mousedown on the old, mouseup on the new).
  const switcherButtons = new Map();
  for (const name of VIEW_NAMES) {
    const b = document.createElement("button");
    b.dataset.view = name;
    b.textContent = name;
    b.addEventListener("click", () => switchView(name));
    els.switcher.appendChild(b);
    switcherButtons.set(name, b);
  }

  // ── The statement bar (chrome — shared by every view) ───────────
  // Any Name with a being types the Word live, in any view; the backend presses it (typeIntoBook)
  // and the views — which are renders of what it does — repaint from the fact it lays via their own
  // subscriptions. Invalid Word shows the parser/gate hint and lays nothing.
  els.statement.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter" || !activeCtx) return;
    e.preventDefault();
    const text = els.statement.value.trim();
    if (!text) return;
    const m = activeCtx.state.get();
    const address = m.discovery?.story || m.descriptor?.address?.place;
    if (!address) { els.statementHint.textContent = "no place to stand yet"; return; }
    els.statementHint.textContent = "";
    try {
      const res = await activeCtx.client.type(text, address);
      if (res.ok) {
        els.statement.value = "";                        // the views repaint from the new fact
        // A statement always resolves at the live edge. If we were viewing the past, the fact
        // landed NOW — snap forward to it (returnToNow clears the anchor + re-sees live).
        if (m.descriptor?.isHistorical) activeCtx.navigation?.returnToNow?.();
      } else {
        els.statementHint.textContent = res.error || "that isn't valid Word";
      }
    } catch (err) {
      els.statementHint.textContent = err?.message || "the press failed";
    } finally {
      els.statement.focus();
    }
  });

  function repaintChrome() {
    if (!activeCtx) return;
    const m = activeCtx.state.get();
    // The statement bar is for a Name with a being — enabled once you hold one.
    if (els.statement) {
      const hasBeing = !!(m.session?.beingId || m.session?.token);
      els.statement.disabled = !hasBeing;
      els.statement.placeholder = hasBeing
        ? "Say the Word — I make a space, I give tabor the role…"
        : "connect a Name to speak the Word…";
    }
    updateStanceBar({
      story:    m.discovery?.story || m.descriptor?.address?.place || "",
      username:   m.session?.username || null,
      signedIn:   !!m.session?.token,
      viewBranch: m.descriptor?.address?.branch || "0",
      path:       m.descriptor?.address?.pathByNames || "/",
      // The right stance's @qualifier: an explicitly-navigated stance
      // address wins; otherwise the selected being (clicking a being
      // in ANY view refines the IBPA — the address is the truth every
      // dispatch reads).
      being:      m.descriptor?.address?.being || m.selectedBeing?.name || null,
      actorBranch: m.actorBranch || "0",
      actorPath:   m.actorPosition || "/",
    });
    els.back.disabled    = !(m.historyIndex > 0);
    els.forward.disabled = !(m.historyIndex < m.history.length - 1);
    els.home.disabled    = !m.session?.token;
    // Socket health dot — reads the live connection state the context
    // already tracks.
    const dot = rootEl.querySelector("#conn-dot");
    if (dot) {
      dot.className = m.connection === "connected" ? "conn-ok"
        : (m.connection === "error" || m.connection === "disconnected") ? "conn-err"
        : "conn-idle";
      dot.title = `socket: ${m.connection || "idle"}`;
    }
    // The NAME lock. It is the ONE place to sign out of your name
    // (name:release) — so it shows whenever you are signed into a name
    // (session.token present), at the arrival floor or driving any being.
    // It does NOT depend on a per-being human signing latch (that was the
    // old dead latch, removed): a name is signed in or it isn't.
    const lock = rootEl.querySelector("#lock-dot");
    if (lock) {
      if (!m.session?.token) {
        lock.style.display = "none";
      } else {
        lock.style.display = "";
        lock.textContent = "🔒";
        lock.className = "nav-btn lock-name";
        lock.title = "signed in as your name — click to sign out (name:release)";
      }
    }
    // The hierarchy button rides with the lock: visible whenever a name is
    // signed in (it's your Name's being-tree). Text view only — the 3d world
    // shows the tree spatially; this panel is the text surface.
    if (els.tree) {
      els.tree.style.display = (m.session?.token && viewHost.activeName === "GUI") ? "" : "none";
    }
    // Ghost cue follows the active tab's descriptor.
    document.body.classList.toggle("ghost-view", !!m.descriptor?.isHistorical);
    repaintSwitcher();
  }

  // The lock button is the NAME's own be:release. Clicking it signs OUT of the
  // name (name:release) and drops back to the bare story domain — the Name
  // menu. This is distinct from releasing a BEING (a tab close), which keeps
  // the name; the lock is the full sign-out, "the name calling its own
  // release." (Was the old do:signing-lock latch, now moved to the name.)
  async function toggleSigningLatch() {
    if (!activeCtx) return;
    try {
      await activeCtx.client?.nameRelease();
    } catch (err) {
      console.warn("[portal:shell] name release:", err?.code || err?.message || err);
    }
    // Drop the stored name-session so a refresh doesn't re-seat the released
    // name; back to the bare story (the Name menu).
    try { activeCtx.clearSession?.(); } catch { /* best-effort */ }
    hideNameTree();
    presentNameForm(activeCtx);
  }

  // Show the Name Form over the bare story. On connect it persists the
  // name-only token and re-runs the gate (which now lands at the Being Picker).
  function presentNameForm(ctx) {
    if (!ctx?.client) return;
    hideBeingPicker();
    const story = ctx.state.get("discovery")?.story || "";
    showNameForm({
      client:        ctx.client,
      storyDomain: story,
      onConnected:   async (result) => {
        try { ctx.adoptNameSession?.(result?.token, result?.nameId); } catch { /* best-effort */ }
        await presentNameGate(ctx);
      },
    });
  }

  // Show the Being Picker (signed-in name, no being). Pick a being you own and
  // connect into it — passwordless (owned connect), on the chosen branch. The
  // be:connect issues the being-JWT; adoptSession reconnects this tab as that
  // being and lands the world.
  function presentBeingPicker(ctx, nameId) {
    if (!ctx?.client) return;
    hideNameForm();
    const story = ctx.state.get("discovery")?.story || "";
    showBeingPicker({
      client:        ctx.client,
      storyDomain: story,
      nameId,
      onSignOut:     async () => {
        try { await ctx.client?.nameRelease(); } catch { /* best-effort */ }
        try { ctx.clearSession?.(); } catch { /* best-effort */ }
        presentNameForm(ctx);
      },
      onConnect:     async (beingName, branch) => {
        const result = await ctx.client.be("connect", `${story}/@${beingName}`, {});
        await ctx.adoptSession(result, beingName);
        // Branch pick: if it differs from where connect seated us, switch.
        if (branch && result?.seatBranch && branch !== String(result.seatBranch)) {
          try { await ctx.client.be("switch", `${story}/@${beingName}`, { branch }); } catch { /* stay on home */ }
        }
        repaintChrome();
      },
      // Birth the name's FIRST being through cherub (summon:mate). The socket is
      // a bodiless name at the arrival floor; the wire seats @arrival as the
      // vessel, signed by the name, so cherub births a TOP-LEVEL being owned by
      // the name. Then drive it (owned connect, passwordless) + land the world.
      onBirthFirst:  async (beingName) => {
        // Pre-flight the ONE error the async birth can't report back. Cherub
        // births on its OWN moment, so a failure there (e.g. the being name is
        // already taken — names are the branch-wide being handle) never returns
        // through this summon's ack; it's logged + the inbox row evicted. The
        // common cause is a name collision, which we CAN see synchronously: if
        // SEE resolves a being by that name, the birth would fail, so refuse now
        // with a clear message instead of a confusing 18s timeout.
        try {
          const seen = await ctx.client.see(`${story}/@${beingName}`);
          if (seen?.identity?.beingId) {
            throw new Error(`@${beingName} is already taken on this story — pick another name`);
          }
        } catch (err) {
          if (/already taken/i.test(err?.message || "")) throw err;
          /* NAME/BEING_NOT_FOUND → the name is free; proceed */
        }
        await ctx.client.call(`${story}/@cherub`, {
          from: `${story}/@arrival`,
          content: { name: beingName },
          intent: "mate",
        });
        // Cherub births on its own moment (async); poll the name's roster.
        let appeared = null;
        for (let i = 0; i < 60 && !appeared; i++) {
          await new Promise((r) => setTimeout(r, 300));
          try {
            const d = await ctx.client.nameSee(nameId);
            appeared = (d?.beings || []).find((b) => b.name === beingName) || null;
          } catch { /* keep polling */ }
        }
        if (!appeared) throw new Error("birth didn't land — the name may be taken, or cherub is busy. Try another name or reopen 'your beings'.");
        const result = await ctx.client.be("connect", `${story}/@${beingName}`, {});
        await ctx.adoptSession(result, beingName);
        repaintChrome();
      },
    });
  }

  // The Name Hierarchy panel (text view). Your Name's being-tree on the branch
  // you stand on (the IBPA left stance) + the grant surface. Reading the tree
  // is bodiless (the name channel); GRANTING/REVOKING are world acts, so canAct
  // reflects whether you're driving a being. reopen() re-reads the CURRENT
  // branch each call, so the ⟳ refresh re-scopes after a branch switch, and a
  // grant/revoke refreshes in place.
  async function presentNameHierarchy(ctx = activeCtx) {
    if (!ctx?.client) return;
    let nameId = null;
    try { nameId = (await ctx.client.nameWhoami())?.nameId || null; } catch { /* not signed in */ }
    if (!nameId) { presentNameForm(ctx); return; }
    const story = ctx.state.get("discovery")?.story || "";
    const branch  = ctx.state.get("descriptor")?.address?.branch || "0";
    const canAct  = !!ctx.state.get("session")?.beingId;
    await showNameTree({
      client: ctx.client,
      story,
      nameId,
      branch,
      canAct,
      reopen: () => presentNameHierarchy(ctx),
    });
  }

  // The Name gate: run after the primary context lands (and after each name
  // connect/release). Three states — no name -> the Name Form (the Name layer
  // is in front of the world, the one BLOCKING gate, since you need a name to
  // do anything); a name but NO being -> the world stands at the ARRIVAL FLOOR
  // (you're signed in, bodiless, facing cherub) with a NON-BLOCKING "your
  // beings" panel to drive an existing being or birth your first; a name + a
  // being -> the landed world (panels down).
  async function presentNameGate(ctx = primaryCtx) {
    let who = null;
    try { who = await ctx.client?.nameWhoami(); } catch { /* fall through to world */ return; }
    if (!who?.nameId) { hideBeingPicker(); presentNameForm(ctx); return; }
    const sess = ctx.state.get("session");
    if (!sess?.beingId) {
      hideNameForm();
      // RESUME the name's last open being (its last be:connect with no
      // be:release, read off the name's chain — who.lastBeing). Drive it
      // straight (owned connect, passwordless). If there is none, the name
      // stands at the arrival floor with the non-blocking being menu.
      if (who.lastBeing?.beingName) {
        try {
          const story = ctx.state.get("discovery")?.story || "";
          const result = await ctx.client.be("connect", `${story}/@${who.lastBeing.beingName}`, {});
          await ctx.adoptSession(result, who.lastBeing.beingName);
          hideBeingPicker();
          repaintChrome();
          return;
        } catch { /* being gone / connect failed -> fall to the being menu */ }
      }
      // The being menu ("Your beings") is the TEXT view's surface; in the 3D
      // world you stand at the arrival floor and reach cherub there directly.
      // So only pop the panel in text view; hide it in 3D.
      if (viewHost.activeName === "GUI") presentBeingPicker(ctx, who.nameId);
      else hideBeingPicker();
      return;
    }
    hideNameForm(); hideBeingPicker();
  }
  const maybeShowNameForm = () => presentNameGate(primaryCtx);

  function repaintTabs() {
    els.tabs.innerHTML = "";
    for (const t of tabs) {
      const m = t.ctx.state.get();
      const tab = document.createElement("button");
      tab.className = "ptab" + (t.ctx === activeCtx ? " active" : "");
      tab.title = m.session?.beingAddress || "anonymous arrival";
      const name = document.createElement("span");
      name.textContent = `@${m.session?.username || "arrival"}`;
      tab.appendChild(name);
      if (tabs.length > 1 && t.ctx !== tabs[0].ctx) {
        const close = document.createElement("button");
        close.className = "ptab-close";
        close.textContent = "×";
        close.title = "close this being tab";
        close.addEventListener("click", (ev) => { ev.stopPropagation(); closeTab(t.ctx); });
        tab.appendChild(close);
      }
      tab.addEventListener("click", () => switchTab(t.ctx));
      els.tabs.appendChild(tab);
    }
    const add = document.createElement("button");
    add.id = "ptab-add";
    add.textContent = "+";
    add.title = "open another being in a new tab";
    add.addEventListener("click", openAddTabPrompt);
    els.tabs.appendChild(add);
  }

  function repaintSwitcher() {
    const current = activeCtx?.state.get("activeView") || defaultView;
    for (const [name, b] of switcherButtons) {
      b.classList.toggle("active", name === current);
    }
  }

  // ── Branch / timeline bar (chrome — applies to every view) ──────

  async function ensureBranchBar() {
    if (branchBar || !activeCtx?.client) return;
    const { mountBranchBar } = await import("../3d/branch-bar.js");
    branchBar = mountBranchBar({
      client:  activeCtx.client,
      story: activeCtx.state.get("discovery")?.story || "treeos.ai",
      // Topbar-hosted: branches/timeline are chrome, present on all
      // four views equally (rewind state rides the shared model).
      buttonHost: rootEl.querySelector("#branch-button-slot"),
      // The bar reads the ACTIVE tab's model through this accessor —
      // no window.__state dependency (kept only as legacy fallback).
      getState: () => activeCtx?.state.raw,
    });
    const desc = activeCtx.state.get("descriptor");
    if (desc) branchBar.update(desc);
  }

  function scheduleBranchBarRefresh() {
    if (branchBarRefreshTimer) return;
    branchBarRefreshTimer = setTimeout(() => {
      branchBarRefreshTimer = null;
      const desc = activeCtx?.state.get("descriptor");
      if (desc) branchBar?.update(desc);
    }, 500);
  }

  // ── Tab management ──────────────────────────────────────────────

  function wireCtx(ctx) {
    const unsubs = [];
    unsubs.push(ctx.state.subscribe((partial, meta) => {
      if (ctx !== activeCtx) {
        // Background tabs only repaint their label (session changes).
        if ("session" in partial) repaintTabs();
        return;
      }
      if ("session" in partial) repaintTabs();
      repaintChrome();
      if ("descriptor" in partial && partial.descriptor) {
        branchBar?.update(partial.descriptor);
        if (meta?.reason === "rewind") setPortalStatus("ghost view — return to now to act");
      }
    }));
    unsubs.push(ctx.events.on("status", (text) => {
      if (ctx === activeCtx) setPortalStatus(text);
    }));
    unsubs.push(ctx.events.on("client", (client) => {
      if (ctx === activeCtx) {
        branchBar?.setClient(client, ctx.state.get("discovery")?.story);
        window.__state = ctx.state.raw;
      }
    }));
    unsubs.push(ctx.events.on("branch", () => {
      if (ctx === activeCtx) branchBar?.refreshAddress?.();
    }));
    for (const type of ["live-position", "live-fact", "live-while-historical"]) {
      unsubs.push(ctx.events.on(type, () => {
        if (ctx === activeCtx) scheduleBranchBarRefresh();
      }));
    }
    return unsubs;
  }

  function addTab(ctx) {
    ctx.shell = shellApi;
    tabs.push({ ctx, unsubs: wireCtx(ctx) });
    repaintTabs();
    return ctx;
  }

  async function switchTab(ctx) {
    if (ctx === activeCtx) return;
    activeCtx = ctx;
    window.__state = ctx.state.raw;          // legacy readers (branch-bar)
    branchBar?.setClient(ctx.client, ctx.state.get("discovery")?.story);
    const desc = ctx.state.get("descriptor");
    if (desc) branchBar?.update(desc);
    repaintTabs();
    repaintChrome();
    await viewHost.switchView(ctx.state.get("activeView") || defaultView, ctx);
  }

  async function closeTab(ctx) {
    const i = tabs.findIndex((t) => t.ctx === ctx);
    if (i < 0 || ctx === tabs[0].ctx) return;   // primary tab stays
    const [t] = tabs.splice(i, 1);
    for (const u of t.unsubs) u();
    // Closing a being's tab RELEASES that being (be:release). You stop driving
    // it; your NAME stays signed in (the name's session persists, not the
    // being's). Because it's an explicit release, the last-being auto-resume
    // won't bring it back — you closed it on purpose. Best-effort; the
    // disconnect auto-release safety net covers a hard close.
    try {
      const story   = ctx.state.get("discovery")?.story;
      const beingName = ctx.state.get("session")?.username;
      if (story && beingName && ctx.state.get("session")?.beingId) {
        await ctx.client?.be("release", `${story}/@${beingName}`, {});
      }
    } catch { /* best effort; the disconnect auto-release covers a hard close */ }
    ctx.destroy();
    if (activeCtx === ctx) await switchTab(tabs[0].ctx);
    else repaintTabs();
  }

  // Open another being in a new in-app tab. `session` shape matches
  // the stored one; pass null to start the tab as arrival.
  async function addTabFromSession(session) {
    const ctx = createPortalContext({
      id: `tab-${++tabCounter}`,
      persist: false,
      session,
    });
    addTab(ctx);
    // Connect BEFORE mounting a view into the tab — views read
    // ctx.client at mount.
    try {
      await ctx.start();
    } catch (err) {
      setPortalStatus(`tab failed: ${err?.message || err}`);
    }
    try {
      await switchTab(ctx);
    } catch (err) {
      console.warn("[shell] tab view mount failed:", err?.message || err);
    }
    repaintTabs();
    return ctx;
  }

  // Open a tab from a BE:connect ack (the in-app inhabit path).
  async function addTabFromAck(ack, { spawnerName = null } = {}) {
    const cfg = resolvePlaceConfig();
    return addTabFromSession({
      placeUrl:       activeCtx?.state.get("session")?.placeUrl || cfg.placeUrl,
      placeIsProxied: cfg.useProxy,
      token:          ack.identityToken,
      username:       ack.name,
      beingAddress:   ack.beingAddress,
      inherited:      true,
      spawnerName,
    });
  }

  function openAddTabPrompt() {
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `
      <div class="overlay-card">
        <h2>new being tab</h2>
        <div class="sub">one being per tab — the whole user space is tabbed per being</div>
        <div class="field"><label>name</label><input data-el="name" autocomplete="off" /></div>
        <div class="field"><label>password</label><input data-el="password" type="password" /></div>
        <button class="btn" data-el="connect">connect as this being</button>
        <button class="btn-link" data-el="arrival">open as arrival instead</button>
        <button class="btn-link" data-el="cancel">cancel</button>
        <div class="error" data-el="error"></div>
      </div>`;
    document.body.appendChild(overlay);
    const q = (s) => overlay.querySelector(`[data-el=${s}]`);
    const close = () => overlay.remove();
    q("cancel").addEventListener("click", close);
    overlay.addEventListener("click", (ev) => { if (ev.target === overlay) close(); });
    q("arrival").addEventListener("click", async () => { close(); await addTabFromSession(null); });
    q("connect").addEventListener("click", async () => {
      const name = q("name").value.trim();
      const password = q("password").value;
      if (!name) { q("error").textContent = "name required"; return; }
      close();
      const ctx = await addTabFromSession(null);
      try {
        await ctx.signIn("connect", name, password);
      } catch (err) {
        setPortalStatus(`connect failed: ${err?.code || ""} ${err?.message || err}`);
      }
      repaintTabs();
    });
    setTimeout(() => q("name").focus(), 0);
  }

  // ── View switching ──────────────────────────────────────────────

  async function switchView(name) {
    if (!activeCtx) return;
    await viewHost.switchView(name, activeCtx);
    repaintSwitcher();
    // The hierarchy panel is text-view-only (the 3d world shows the tree
    // spatially); drop it when leaving text.
    if (viewHost.activeName !== "text") hideNameTree();
    // The being menu is text-view-only: re-run the name gate so it appears in
    // text and hides in 3D (the arrival floor) when the name has no being.
    presentNameGate(activeCtx).catch(() => {});
  }

  // ── Stance bar + nav buttons ────────────────────────────────────

  initStanceBar({
    onNavigate: (raw) => activeCtx?.navigation.navigate(raw)
      .catch((err) => setPortalStatus(`see failed: ${err?.code || ""} ${err?.message || ""}`)),
    onSwitchBranch: (branchPath) => {
      import("../3d/branch-bar.js")
        .then((m) => m.switchIntoBranch(branchPath))
        .catch((err) => console.warn("[shell] branch switch failed:", err?.message || err));
    },
    // Drive another being your name owns from the left stance. For EVERY BE op
    // the actor is your NAME, acting THROUGH the being it's currently using — a
    // being never calls BE on itself or on another being. So setting the stance
    // to @arrival isn't switching to a being and isn't arrival doing anything:
    // it's your name calling be:release on the being it's using. That being
    // drops, your name goes bodiless, and the floor (where @arrival is the auth
    // being a bodiless name rides) is simply where a bodiless name stands. Any
    // other being is an OWNED switch: your name be:connects it, after we confirm
    // it's one of your beings ON that branch (the name tree), so a being you
    // don't own / that isn't there comes back as a clear name error instead of
    // a confusing low-level connect failure.
    onSwitchBeing: async (being, branch) => {
      const ctx = activeCtx;
      if (!ctx?.client) return;
      const story = ctx.state.get("discovery")?.story || "";
      const hash = branch && branch !== "0" ? branch : "main";
      try {
        if (being === "arrival") {
          // Your NAME releases the being it's currently using (cur): the name is
          // the actor, calling be:release THROUGH cur; cur is the being released.
          // The live socket stays name-bound, so we keep the name (token+nameId)
          // and only clear the being — bodiless, the name stands at the floor.
          const cur = ctx.state.get("session")?.username;
          if (!cur) return; // already bodiless
          try { await ctx.client.be("release", `${story}/@${cur}`, {}); } catch { /* best-effort */ }
          const s = ctx.state.get("session") || {};
          try { ctx.saveSession?.({ ...s, beingId: null, username: null, beingAddress: null }); } catch { /* best-effort */ }
          try { await ctx.navigation.landAnonymous(); } catch { /* best-effort */ }
          await presentNameGate(ctx);
          repaintChrome();
          return;
        }
        // Confirm ownership on this branch via the name tree (your beings there).
        const tree = await ctx.client.nameTree(branch);
        const owned = new Set();
        const walk = (ns) => (ns || []).forEach((n) => { if (n?.name) owned.add(n.name); walk(n.children); });
        walk(tree?.roots);
        if (!owned.has(being)) {
          setPortalStatus(`that name doesn't have @${being} on #${hash}`);
          return; // bar already restored on blur
        }
        const result = await ctx.client.be("connect", `${story}/@${being}`, {});
        await ctx.adoptSession(result, being);
        if (branch && result?.seatBranch && branch !== String(result.seatBranch)) {
          try { await ctx.client.be("switch", `${story}/@${being}`, { branch }); } catch { /* stay on home */ }
        }
        repaintChrome();
      } catch (err) {
        setPortalStatus(`couldn't drive @${being} on #${hash}: ${err?.code || err?.message || err}`);
      }
    },
  });
  placeStanceBar(rootEl.querySelector("#stance-slot"));

  els.back.addEventListener("click",    () => activeCtx?.navigation.back());
  els.forward.addEventListener("click", () => activeCtx?.navigation.forward());
  els.place.addEventListener("click",   () => activeCtx?.navigation.navigate("/").catch(() => {}));
  els.home.addEventListener("click",    () => activeCtx?.navigation.navigate("/~").catch(() => {}));
  rootEl.querySelector("#lock-dot")?.addEventListener("click", () => { toggleSigningLatch(); });
  // The hierarchy button: toggle the Name Hierarchy panel for the active tab.
  els.tree?.addEventListener("click", () => {
    if (isNameTreeOpen()) hideNameTree();
    else presentNameHierarchy(activeCtx).catch(() => {});
  });
  // The send arrow submits whatever is typed in the IBPA's receiving
  // side — the click-equivalent of pressing Enter in the address.
  els.send.addEventListener("click", () => {
    const input = document.getElementById("address-input");
    const raw = input?.value?.trim();
    if (raw) {
      activeCtx?.navigation.navigate(raw)
        .catch((err) => setPortalStatus(`see failed: ${err?.code || ""} ${err?.message || ""}`));
    }
  });

  // ── Window-level wiring ─────────────────────────────────────────

  // Branch-tree clicks set location.hash; turn that into a navigate.
  const windowListeners = []; // [target, type, fn] — removed by destroy()
  const listen = (target, type, fn) => {
    target.addEventListener(type, fn);
    windowListeners.push([target, type, fn]);
  };

  const onHashChange = () => {
    const raw = location.hash.replace(/^#/, "");
    if (!raw || raw.startsWith("inhabit=")) return;
    activeCtx?.navigation.navigate(raw).catch(() => {});
  };
  listen(window, "hashchange", onHashChange);

  // Rewind / return / pause events from the branch bar flow through
  // the active context's navigation.
  const onRewind = (ev) => {
    const at = ev?.detail?.atTimestamp;
    if (at) activeCtx?.navigation.rewindTo(at);
  };
  const onNow = (ev) => {
    activeCtx?.navigation.returnToNow({ preserveCamera: ev?.detail?.preserveCamera === true });
  };
  const onPaused = (ev) => {
    document.body.classList.toggle("paused-branch", !!ev?.detail?.paused);
  };
  listen(window, "branchbar:rewind", onRewind);
  listen(window, "branchbar:now", onNow);
  listen(window, "branchbar:paused-self", onPaused);

  // Alt+1..5 switch views; backslash flips 3d <-> text (back-compat).
  const onKeydown = (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const i = ["1", "2", "3", "4", "5"].indexOf(e.key);
      if (i >= 0 && VIEW_NAMES[i]) { e.preventDefault(); switchView(VIEW_NAMES[i]); return; }
    }
    if (e.code === "Backslash") {
      const t = e.target;
      const inField = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (inField) return;
      e.preventDefault();
      switchView(viewHost.activeName === "GUI" ? "3d" : "GUI");
    }
  };
  listen(window, "keydown", onKeydown);

  // In-app inherited tabs release on page close, like browser-tab
  // inheriters do.
  listen(window, "pagehide", () => {
    for (const t of tabs.slice(1)) {
      const sess = t.ctx.state.get("session");
      if (!sess?.inherited) continue;
      const story = t.ctx.state.get("discovery")?.story;
      if (story && sess.username) {
        try { t.ctx.client?.be("release", `${story}/@${sess.username}`, {}).catch(() => {}); } catch {}
      }
    }
  });

  // ── Shell API (views reach this via ctx.shell) ──────────────────

  const shellApi = {
    switchView,
    addTabFromSession,
    addTabFromAck,
    // The single name-auth path (the Name layer in front of the world). Views
    // reach it so e.g. the flat identity chip re-presents the Name Form / being
    // menu instead of any view-local auth overlay.
    presentNameGate: (c = activeCtx) => presentNameGate(c),
    get activeView() { return viewHost.activeName; },
  };

  // Primary tab in, chrome up.
  addTab(primaryCtx);
  activeCtx = primaryCtx;
  window.__state = primaryCtx.state.raw;
  repaintChrome();

  return {
    ...shellApi,
    viewHost,
    ensureBranchBar,
    get activeCtx() { return activeCtx; },
    async startPrimary() {
      await primaryCtx.start();
      await maybeShowNameForm();
      await ensureBranchBar();
      repaintChrome();
    },
    // Full shell teardown. The web page never calls this (the shell
    // lives as long as the document); the multi-window native shell
    // will. Removes every window listener, unmounts the active view,
    // the branch bar, and destroys every tab's context.
    destroy() {
      for (const [target, type, fn] of windowListeners.splice(0)) {
        try { target.removeEventListener(type, fn); } catch {}
      }
      try { branchBar?.destroy?.(); } catch {}
      branchBar = null;
      viewHost.destroy();
      for (const t of tabs.splice(0)) {
        for (const u of t.unsubs) { try { u(); } catch {} }
        try { t.ctx.destroy(); } catch {}
      }
      activeCtx = null;
      rootEl.innerHTML = "";
    },
  };
}
