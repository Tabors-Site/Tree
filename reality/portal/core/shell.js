// TreeOS Portal . core/shell.js
//
// The portal shell — the chrome that stays up no matter which view is
// mounted. Three rows of responsibility:
//
//   1. Being tabs. The whole user space is tabbed per being: each tab
//      is one PortalContext (its own client, session, state). Switch
//      tabs and you switch beings; each tab remembers its own view.
//   2. The IBPA stance bar — always visible, on every view — plus
//      back/forward/reality/home/root and the four-view switcher.
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
    <button class="nav-btn" id="nav-place" title="Reality root">/</button>
    <button class="nav-btn" id="nav-home"  title="Your home" disabled>~</button>
    <span id="branch-button-slot" style="display:flex"></span>
    <nav id="view-switcher" title="views (Alt+1..5)"></nav>
    <span id="conn-dot" class="conn-idle" title="socket"></span>
  </header>
  <div id="portal-tabs"></div>
  <main id="view-root">
    <div class="view-boot"><span class="vb-pulse"></span>finding your place…</div>
  </main>
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
    viewRoot: rootEl.querySelector("#view-root"),
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

  function repaintChrome() {
    if (!activeCtx) return;
    const m = activeCtx.state.get();
    updateStanceBar({
      reality:    m.discovery?.reality || m.descriptor?.address?.place || "",
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
    // Ghost cue follows the active tab's descriptor.
    document.body.classList.toggle("ghost-view", !!m.descriptor?.isHistorical);
    repaintSwitcher();
  }

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
      reality: activeCtx.state.get("discovery")?.reality || "treeos.ai",
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
        branchBar?.setClient(client, ctx.state.get("discovery")?.reality);
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
    branchBar?.setClient(ctx.client, ctx.state.get("discovery")?.reality);
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
    // An inherited body releases when its tab closes (borrowed presence).
    if (ctx.state.get("session")?.inherited) {
      try {
        const reality = ctx.state.get("discovery")?.reality;
        const username = ctx.state.get("session")?.username;
        if (reality && username) {
          await ctx.client?.be("release", `${reality}/@${username}`, {});
        }
      } catch { /* best effort */ }
    }
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
  });
  placeStanceBar(rootEl.querySelector("#stance-slot"));

  els.back.addEventListener("click",    () => activeCtx?.navigation.back());
  els.forward.addEventListener("click", () => activeCtx?.navigation.forward());
  els.place.addEventListener("click",   () => activeCtx?.navigation.navigate("/").catch(() => {}));
  els.home.addEventListener("click",    () => activeCtx?.navigation.navigate("/~").catch(() => {}));
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
      switchView(viewHost.activeName === "text" ? "3d" : "text");
    }
  };
  listen(window, "keydown", onKeydown);

  // In-app inherited tabs release on page close, like browser-tab
  // inheriters do.
  listen(window, "pagehide", () => {
    for (const t of tabs.slice(1)) {
      const sess = t.ctx.state.get("session");
      if (!sess?.inherited) continue;
      const reality = t.ctx.state.get("discovery")?.reality;
      if (reality && sess.username) {
        try { t.ctx.client?.be("release", `${reality}/@${sess.username}`, {}).catch(() => {}); } catch {}
      }
    }
  });

  // ── Shell API (views reach this via ctx.shell) ──────────────────

  const shellApi = {
    switchView,
    addTabFromSession,
    addTabFromAck,
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
