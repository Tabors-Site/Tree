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
import { placeStanceBar } from "../shared/stance-bar.js";
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
};

// ──────────────────────────────────────────────────────────────────
// DOM template. Mirrors the standalone flat-app's index.html #app
// structure. The renderer expects these element IDs to exist; we
// inject the same tree into the host container.
// ──────────────────────────────────────────────────────────────────

const FLAT_DOM = `
<div id="flat-app" class="flat-root">
  <header id="top-bar">
    <div id="brand">
      <span class="brand-dot"></span>
      <span class="brand-name">treeos</span>
      <span class="brand-tag dim">. text</span>
    </div>
    <div id="connection-pill" title="socket">
      <span class="conn-dot conn-pending"></span>
      <span class="conn-text">live</span>
    </div>
    <nav id="breadcrumb"></nav>
    <div id="stance-slot-flat" style="display:flex; flex:1; min-width:0;"></div>
    <nav id="quick-nav">
      <a class="qn-chip" data-tag="home" title="reality root">/</a>
      <a class="qn-chip" data-tag="beings" title=".beings . every being">. beings</a>
      <a class="qn-chip" data-tag="operations" title="./operations . DO registry">ops</a>
      <a class="qn-chip" data-tag="roles" title="./roles . role registry">roles</a>
      <a class="qn-chip" data-tag="threads" title="./threads . live coordination chains">threads</a>
      <a class="qn-chip" data-tag="extensions" title="./extensions . installed extensions">ext</a>
    </nav>
    <button id="inbox-chip" type="button" title="your inbox — pending summons addressed to you" style="display:none;background:transparent;color:#c8d3cb;border:1px solid #2c3a32;border-radius:4px;padding:3px 8px;font-family:inherit;font-size:11px;cursor:pointer;margin-left:4px;">inbox <span id="inbox-count" class="dim">·</span></button>
    <div id="identity-chip" title="signed-in identity"></div>
    <button id="flat-timeline-btn" type="button" title="branches and timeline">🌿 timeline</button>
    <button id="flat-close-btn" type="button" title="close text mode (Esc)">close</button>
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
        <div class="empty-title">no selection</div>
        <div class="empty-hint">click <code>inspect</code> on a being or matter to see verbs + permissions, or <code>chat</code> on a being to summon it.</div>
        <div class="empty-shortcuts">
          <kbd>/</kbd> focus address . <kbd>Esc</kbd> close text mode . <kbd>g h</kbd> home
        </div>
      </div>
      <div id="inspector" class="hidden"></div>
      <div id="chat-panel" class="hidden"></div>
    </section>
  </main>
  <footer id="bottom-bar">
    <div class="bb-label dim">children</div>
    <ul id="children-list"></ul>
  </footer>
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

  // Inject DOM.
  rootContainer.innerHTML = FLAT_DOM;
  const root = rootContainer.querySelector("#flat-app");

  // THE address bar: re-parent the shared stance bar into the flat
  // header. Same DOM node as the 3D top bar — the two views cannot
  // disagree. dispose() hands it back.
  placeStanceBar(root.querySelector("#stance-slot-flat"));

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
  flat.signIn  = async (op, name, password) => {
    if (typeof ctx.onSignIn === "function") return ctx.onSignIn(op, name, password);
  };
  flat.signOut = async () => {
    if (typeof ctx.onSignOut === "function") return ctx.onSignOut();
  };
  flat.sendSummon = async (stance, content, opts = {}) => {
    if (!ctx.client) throw new Error("flat.sendSummon: no client");
    const reality   = ctx.discovery?.reality;
    const username  = ctx.session?.username || "arrival";
    const from      = `${reality}/@${username}`;
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
    const reply = await ctx.client.summon(stance, message, extra);
    return { correlation, reply };
  };
  flat.cancelByRootCorrelation = async (rootCorrelation) => {
    if (!ctx.client || !rootCorrelation) return;
    const reality  = ctx.discovery?.reality;
    const username = ctx.session?.username || "arrival";
    const stance   = `${reality}/./threads/${rootCorrelation}`;
    const from     = `${reality}/@${username}`;
    try {
      await ctx.client.summon(
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

  // Wire local UI: address form, quick-nav chips, close button,
  // keyboard shortcuts.
  wireQuickNav(root, ctx);
  wireCloseButton(root, ctx);
  wireTimelineButton(root);
  wireInboxChip(root);
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
    dispose() {
      detachKeys();
      closeChat?.();
      hideAuthOverlay?.();
      // Hand the shared stance bar back to the 3D top bar BEFORE the
      // flat DOM (its current parent) is torn down.
      placeStanceBar(document.getElementById("stance-slot"));
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

// wireAddressForm retired: the shared stance bar (placed into
// #stance-slot-flat above) owns address input + navigation.

function wireQuickNav(root, _ctx) {
  const reality = _state.discovery?.reality;
  if (!reality) return;
  root.querySelectorAll(".qn-chip").forEach((el) => {
    el.addEventListener("click", (ev) => {
      ev.preventDefault();
      const tag = el.getAttribute("data-tag");
      const branch = _state.descriptor?.address?.branch || "0";
      const bq = branch === "0" ? "" : `#${branch}`;
      let path = "/";
      if (tag === "beings")     path = "/./beings";
      else if (tag === "operations") path = "/./operations";
      else if (tag === "roles")      path = "/./roles";
      else if (tag === "threads")    path = "/./threads";
      else if (tag === "extensions") path = "/./extensions";
      flat.navigate(`${reality}${bq}${path}`);
    });
  });
}

// Inbox chip in the header — visible only when signed in. Click opens
// the inbox panel; a periodic SEE on `my-inbox` keeps the pending
// count fresh. Polled rather than push-driven because the inbox state
// is per-being and we don't subscribe to it via the descriptor.
let _inboxPollHandle = null;
function wireInboxChip(root) {
  const chip = root.querySelector("#inbox-chip");
  if (!chip) return;
  // Render visibility based on session state.
  const updateVisibility = () => {
    const signedIn = !!_state.session?.token;
    chip.style.display = signedIn ? "" : "none";
  };
  updateVisibility();
  chip.addEventListener("click", async (ev) => {
    ev.preventDefault();
    // Lazy-import to keep the host bundle lean.
    const { openInboxAction } = await import("./task-bar.js");
    openInboxAction();
  });
  // Update count periodically. The chip stays visible the whole time;
  // the badge just changes.
  if (_inboxPollHandle) clearInterval(_inboxPollHandle);
  _inboxPollHandle = setInterval(refreshInboxCount, 15000);
  refreshInboxCount();
}

async function refreshInboxCount() {
  const root = document;
  const chip = root.querySelector("#inbox-chip");
  const badge = root.querySelector("#inbox-count");
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

function wireCloseButton(root, ctx) {
  const btn = root.querySelector("#flat-close-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    if (typeof ctx.onClose === "function") ctx.onClose();
  });
}

// Timeline access from inside the flat panel. The 3D portal's
// floating 🌿 button is hidden while the flat panel is open (its
// position covered the address bar), so we surface the same toggle
// inside the top-bar here. Dispatches a click on the floating
// button's element so the branch-bar module stays the single source
// of truth for what the toggle does (open / close the branch panel).
function wireTimelineButton(root) {
  const btn = root.querySelector("#flat-timeline-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const target = document.getElementById("branch-tree-button");
    if (target) target.click();
  });
}

function wireKeyboardShortcuts(ctx) {
  let gFollow = false;
  let gTimer  = null;
  const handler = (ev) => {
    const target = ev.target;
    const inForm = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
    if (ev.key === "Escape") {
      if (typeof ctx.onClose === "function") ctx.onClose();
      return;
    }
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
      const reality = _state.discovery?.reality;
      if (!reality) return;
      const branch = _state.descriptor?.address?.branch || "0";
      const bq = branch === "0" ? "" : `#${branch}`;
      if      (ev.key === "h") { ev.preventDefault(); flat.navigate(`${reality}${bq}/`); }
      else if (ev.key === "b") { ev.preventDefault(); flat.navigate(`${reality}${bq}/./beings`); }
      else if (ev.key === "o") { ev.preventDefault(); flat.navigate(`${reality}${bq}/./operations`); }
      else if (ev.key === "r") { ev.preventDefault(); flat.navigate(`${reality}${bq}/./roles`); }
      else if (ev.key === "t") { ev.preventDefault(); flat.navigate(`${reality}${bq}/./threads`); }
      else if (ev.key === "i" && _state.session?.username) {
        ev.preventDefault();
        flat.navigate(`${reality}${bq}/~`);
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
  if (!ctx?.client || !_state.discovery?.reality) return;
  try {
    const desc = await ctx.client.see(`${_state.discovery.reality}/./operations`);
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
  const reality = discovery?.reality || descriptor?.address?.place || "";
  const branch  = descriptor?.address?.branch || "0";
  const path    = descriptor?.address?.pathByNames || "/";
  const bq      = branch === "0" ? "" : `#${branch}`;
  return `${reality}${bq}${path}`;
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
