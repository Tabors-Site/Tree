// TreeOS Portal Shared — flat-view host.
//
// Mounts the flat (text-mode) renderer into a host container provided
// by a parent app (today: the 3D portal toggleable overlay; earlier:
// the standalone flat-app). The renderer / chat / being-timeline /
// identity modules import `flat` from this file; host populates it
// before each render so they read live state.
//
// Public surface:
//
//   flat                   — mutable singleton: { state, navigate,
//                            signIn, signOut, sendSummon,
//                            cancelByRootCorrelation, doOp, beOp,
//                            operationsForTarget }
//   mountFlatView(root, ctx) → { dispose(), update(descriptor) }
//
// ctx = {
//   client, descriptor, selectedBeing, session, discovery,
//   onNavigate(address), onSignedIn(session), onSignedOut(),
//   onClose(),
// }

import "./style.css";
import {
  renderDescriptor,
  setStatus,
  clearDetail,
  setConnectionStatus,
  setLoading,
} from "./renderer.js";
import { showAuthOverlay, hideAuthOverlay } from "./identity.js";
import { closeChat, openChatFor } from "./chat.js";

// ──────────────────────────────────────────────────────────────────
// Mutable singleton. Renderer / chat / being-timeline / identity
// import `flat` from this module and read flat.state / call flat.X.
// mountFlatView writes through these fields on every mount.
// ──────────────────────────────────────────────────────────────────

const _state = {
  client:         null,
  discovery:      null,
  descriptor:     null,
  session:        null,
  currentAddress: null,
  operations:     [],
  selectedBeing:  null,
};

export const flat = {
  get state() { return _state; },
  navigate:                () => {},
  signIn:                  async () => {},
  signOut:                 async () => {},
  sendSummon:              async () => {},
  cancelByRootCorrelation: async () => {},
  doOp:                    async () => {},
  beOp:                    async () => {},
  operationsForTarget:     () => [],
  // Interacting with a being selects it portal-wide (the IBPA's right
  // stance gains @<being>). Bound by mountFlatView from ctx.
  selectBeing:             () => {},
};

// ──────────────────────────────────────────────────────────────────
// DOM template. Mirrors the standalone flat-app's index.html #app
// structure. The renderer expects these element IDs to exist; we
// inject the same tree into the host container.
// ──────────────────────────────────────────────────────────────────

// The text view is the ACTION CENTER: not a desktop, not a browser —
// the place work gets done fast, graphically. The task menubar is the
// main feature (window-menu style, context keyed off the IBPA right
// stance); choosing an action opens it in the work area. Navigation
// furniture (breadcrumb, quick-nav, children footer) retired — the
// shell IBPA, explorer, and console own movement.
const FLAT_DOM = `
<div id="flat-app" class="flat-root">
  <header id="top-bar">
    <div id="brand">
      <span class="brand-dot"></span>
      <span class="brand-name">treeos</span>
      <span class="brand-tag dim">. text</span>
    </div>
    <div style="flex:1; min-width:0;"></div>
    <div id="identity-chip" title="signed-in identity"></div>
  </header>
  <div id="task-menubar"></div>
  <main id="middle">
    <section id="position-pane">
      <div class="pane-head">
        <h3 class="pane-title">beings</h3>
        <span id="beings-count" class="pane-count dim"></span>
      </div>
      <ul id="beings-list" class="list"></ul>
      <div class="pane-head">
        <h3 class="pane-title">matter</h3>
        <span id="matter-count" class="pane-count dim"></span>
      </div>
      <ul id="matter-list" class="list"></ul>
      <div id="lineage-section" class="hidden">
        <div class="pane-head">
          <h3 class="pane-title">lineage</h3>
          <span id="lineage-count" class="pane-count dim"></span>
        </div>
        <ul id="lineage-list" class="list"></ul>
      </div>
    </section>
    <section id="detail-pane">
      <div id="empty-detail" class="empty">
        <div class="empty-title">pick an action</div>
        <div class="empty-hint">the menu bar above is the work surface: <code>Story</code> / <code>History</code> / <code>Place</code> menus act on where you are; select a being (here or in any view) and its <code>@being</code> menu appears. Forms open in this pane.</div>
        <div class="empty-shortcuts">
          <kbd>/</kbd> focus address . <kbd>g h</kbd> home
        </div>
      </div>
      <div id="inspector" class="hidden"></div>
      <div id="chat-panel" class="hidden"></div>
    </section>
  </main>
  <div id="status-line"></div>
  <div id="loading-bar" class="hidden"></div>
  <div id="auth-overlay" class="hidden"></div>
</div>
`.trim();

// ──────────────────────────────────────────────────────────────────
// mountFlatView
// ──────────────────────────────────────────────────────────────────

export function mountFlatView(rootContainer, ctx) {
  if (!rootContainer) throw new Error("mountFlatView: rootContainer required");
  if (!ctx?.client) throw new Error("mountFlatView: ctx.client required");

  // Inject DOM. The stance bar (IBPA) is shell chrome now — always
  // visible above every view — so the flat header no longer hosts it.
  rootContainer.innerHTML = FLAT_DOM;
  const root = rootContainer.querySelector("#flat-app");

  // Populate singleton state.
  _state.client         = ctx.client;
  _state.discovery      = ctx.discovery || null;
  _state.descriptor     = ctx.descriptor || null;
  _state.session        = ctx.session || null;
  _state.currentAddress = ctx.descriptor?.address
    ? buildAddressString(ctx.descriptor, ctx.discovery)
    : null;
  _state.operations     = [];
  _state.selectedBeing  = ctx.selectedBeing || null;

  // Bind callbacks.
  flat.navigate = (address) => {
    if (typeof ctx.onNavigate === "function") ctx.onNavigate(address);
  };
  flat.signIn  = async (op, name, password, opts = {}) => {
    if (typeof ctx.onSignIn === "function") return ctx.onSignIn(op, name, password, opts);
  };
  flat.signOut = async () => {
    if (typeof ctx.onSignOut === "function") return ctx.onSignOut();
  };
  // Re-present the name layer (the shell's Name Form / being menu) — the single
  // auth path. The flat identity chip uses this instead of a local overlay.
  flat.presentNameAuth = () => {
    if (typeof ctx.onNameAuth === "function") return ctx.onNameAuth();
  };
  flat.sendSummon = async (stance, content, opts = {}) => {
    if (!ctx.client) throw new Error("flat.sendSummon: no client");
    const story   = ctx.discovery?.story;
    const username  = ctx.session?.username || "arrival";
    const from      = `${story}/@${username}`;
    const correlation = `c-${randomToken()}`;
    // Envelope intent rides at the top of the message per seed/SUMMON.md.
    // Callers that previously stuffed intent inside content should pass
    // it via opts.intent instead so the substrate's auth gate and the
    // inbox renderer registry can see it.
    const message = {
      from,
      content,
      correlation,
      ...(opts.intent    ? { intent:    opts.intent    } : {}),
      ...(opts.inReplyTo ? { inReplyTo: opts.inReplyTo } : {}),
    };
    const extra = opts.rootCorrelation ? { rootCorrelation: opts.rootCorrelation } : {};
    const reply = await ctx.client.call(stance, message, extra);
    return { correlation, reply };
  };
  flat.cancelByRootCorrelation = async (rootCorrelation) => {
    if (!ctx.client || !rootCorrelation) return;
    const story  = ctx.discovery?.story;
    const username = ctx.session?.username || "arrival";
    const stance   = `${story}/./threads/${rootCorrelation}`;
    const from     = `${story}/@${username}`;
    try {
      await ctx.client.call(
        stance,
        { from, content: "(cancel)", correlation: `cancel-${randomToken()}` },
        { priority: "HUMAN", rootCorrelation },
      );
    } catch (err) {
      console.warn("[flat] cancel failed:", err?.code || err?.message || err);
    }
  };
  flat.doOp = async (address, name, args = {}) => {
    if (!ctx.client) throw new Error("flat.doOp: no client");
    return ctx.client.do(address, name, args);
  };
  // Raw SEE without moving the portal (panels reading synthetic
  // addresses like .discovery; navigation stays the mover).
  flat.see = async (address, opts = {}) => {
    if (!ctx.client) throw new Error("flat.see: no client");
    return ctx.client.see(address, opts);
  };
  flat.beOp = async (op, address, payload = {}) => {
    if (!ctx.client) throw new Error("flat.beOp: no client");
    if ((op === "birth" || op === "connect") && typeof ctx.onSignIn === "function") {
      return ctx.onSignIn(op, payload.name, payload.password || "");
    }
    return ctx.client.be(op, address, payload);
  };
  flat.operationsForTarget = (kind) => {
    if (!kind) return [];
    return _state.operations.filter((op) => Array.isArray(op.targets) && op.targets.includes(kind));
  };
  flat.selectBeing = (beingId, name) => {
    _state.selectedBeing = beingId
      ? { beingId: String(beingId), name: name || null }
      : null;
    if (typeof ctx.onSelectBeing === "function") ctx.onSelectBeing(beingId, name);
  };

  // Wire local UI: the inbox count poll + keyboard shortcuts. (Quick-nav
  // chips, close button, breadcrumb, children footer all retired — the
  // shell IBPA / explorer / console own movement; the menubar is the
  // work surface and carries the inbox.)
  wireInboxPoll();
  const detachKeys = wireKeyboardShortcuts(ctx);

  // Initial render. Operations load async (a SEE on .operations); the
  // first paint may run before that resolves, so the task bar + inspector
  // DO surfaces re-render once the catalog arrives (below).
  if (_state.descriptor) {
    renderDescriptor(_state.descriptor, {
      session:   _state.session,
      discovery: _state.discovery,
    });
  }

  // Load operations, then re-render so every DO surface (task bar tabs,
  // being inspector) populates with the full set rather than the few
  // entries that don't depend on the catalog.
  refreshOperations(ctx).then(() => {
    if (_state.descriptor) {
      renderDescriptor(_state.descriptor, {
        session:   _state.session,
        discovery: _state.discovery,
      });
    }
  });

  return {
    update(descriptor) {
      if (!descriptor) return;
      _state.descriptor     = descriptor;
      _state.currentAddress = buildAddressString(descriptor, _state.discovery);
      renderDescriptor(descriptor, {
        session:   _state.session,
        discovery: _state.discovery,
      });
    },
    // Cross-view selection sync (the IBPA's @being). Writes the local
    // mirror WITHOUT echoing back through ctx.onSelectBeing — the
    // shared model already changed; an echo would loop.
    setSelection(sel) {
      _state.selectedBeing = sel || null;
    },
    dispose() {
      detachKeys();
      closeChat?.();
      hideAuthOverlay?.();
      if (_inboxPollHandle) { clearInterval(_inboxPollHandle); _inboxPollHandle = null; }
      rootContainer.innerHTML = "";
      _state.client         = null;
      _state.descriptor     = null;
      _state.currentAddress = null;
      _state.operations     = [];
      _state.selectedBeing  = null;
    },
  };
}

// ──────────────────────────────────────────────────────────────────
// Local wiring helpers
// ──────────────────────────────────────────────────────────────────

// wireAddressForm retired: the shell's stance bar owns address input
// + navigation for every view. wireQuickNav / wireCloseButton retired
// with the action-center pass — movement belongs to the shell IBPA,
// explorer, and console; the menubar is the work surface.

// The inbox lives IN the menubar (task-bar.js renders the button +
// count badge — the work queue belongs on the work surface). The poll
// keeps the badge fresh; elements are looked up per tick because the
// menubar re-renders on every SEE. Polled rather than push-driven
// because the inbox is per-being and not subscribed via the descriptor.
let _inboxPollHandle = null;
function wireInboxPoll() {
  if (_inboxPollHandle) clearInterval(_inboxPollHandle);
  _inboxPollHandle = setInterval(refreshInboxCount, 15000);
  refreshInboxCount();
}

export async function refreshInboxCount() {
  const chip = document.querySelector("#inbox-chip");
  const badge = document.querySelector("#inbox-count");
  if (!chip || !badge) return;
  if (!_state.session?.token || !_state.client?.see) {
    chip.style.display = "none";
    return;
  }
  chip.style.display = "";
  try {
    const result = await _state.client.see("my-inbox");
    const n = Array.isArray(result?.pending) ? result.pending.length : 0;
    badge.textContent = n === 0 ? "·" : String(n);
    badge.style.color = n > 0 ? "#e8b762" : "#6b7d72";
    chip.style.borderColor = n > 0 ? "#6b5320" : "#2c3a32";
  } catch (err) {
    // Surface to console so we notice if inbox SEE breaks; chip stays
    // visible with no count rather than vanishing silently.
    console.warn("[inbox-chip] count fetch failed:", err?.message || err);
  }
}

function wireKeyboardShortcuts(ctx) {
  let gFollow = false;
  let gTimer  = null;
  const handler = (ev) => {
    const target = ev.target;
    const inForm = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
    // (Esc-to-3D retired: views are peers behind the shell switcher,
    // and Esc should never yank the user out of the work surface.)
    if (inForm) return;
    if (ev.key === "/") {
      ev.preventDefault();
      const input = document.getElementById("address-input");
      if (input) { input.focus(); input.select(); }
      return;
    }
    if (ev.key === "g") {
      gFollow = true;
      if (gTimer) clearTimeout(gTimer);
      gTimer = setTimeout(() => { gFollow = false; }, 600);
      return;
    }
    if (gFollow) {
      gFollow = false;
      if (gTimer) { clearTimeout(gTimer); gTimer = null; }
      const story = _state.discovery?.story;
      if (!story) return;
      const history = _state.descriptor?.address?.history || "0";
      const bq = history === "0" ? "" : `#${history}`;
      if      (ev.key === "h") { ev.preventDefault(); flat.navigate(`${story}${bq}/`); }
      else if (ev.key === "b") { ev.preventDefault(); flat.navigate(`${story}${bq}/./beings`); }
      else if (ev.key === "o") { ev.preventDefault(); flat.navigate(`${story}${bq}/./operations`); }
      else if (ev.key === "r") { ev.preventDefault(); flat.navigate(`${story}${bq}/./ables`); }
      else if (ev.key === "t") { ev.preventDefault(); flat.navigate(`${story}${bq}/./threads`); }
      else if (ev.key === "i" && _state.session?.username) {
        ev.preventDefault();
        flat.navigate(`${story}${bq}/~`);
      }
    }
  };
  window.addEventListener("keydown", handler);
  return () => {
    window.removeEventListener("keydown", handler);
    if (gTimer) clearTimeout(gTimer);
  };
}

async function refreshOperations(ctx) {
  if (!ctx?.client || !_state.discovery?.story) return;
  try {
    const desc = await ctx.client.see(`${_state.discovery.story}/./operations`);
    const children = Array.isArray(desc.children) ? desc.children : [];
    _state.operations = children.map((s) => {
      const op = s.qualities?.operation || {};
      return {
        name:           s.name,
        targets:        Array.isArray(op.targets) ? op.targets : [],
        factAction:     op.factAction || null,
        ownerExtension: op.ownerExtension || "seed",
        skipAudit:      !!op.skipAudit,
        // The field schema (when the op declares one) drives the
        // directed forms the task bar + being inspector render.
        args:           op.args || null,
      };
    });
  } catch (err) {
    console.warn("[flat] operations load failed:", err?.code || err?.message);
    _state.operations = [];
  }
}

function buildAddressString(descriptor, discovery) {
  const story = discovery?.story || descriptor?.address?.place || "";
  const history = descriptor?.address?.history || "0";
  const path    = descriptor?.address?.pathByNames || "/";
  const bq      = history === "0" ? "" : `#${history}`;
  return `${story}${bq}${path}`;
}

function randomToken() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Re-exports so consumers in /portal/flat/ (chat.js, identity.js,
// being-timeline.js) can `import { flat } from "./host.js"` and reach
// the same shape they used to read from main.js.
export { setStatus, clearDetail, setConnectionStatus, setLoading };
export { showAuthOverlay, hideAuthOverlay };
export { closeChat, openChatFor };
