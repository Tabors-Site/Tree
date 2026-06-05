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
    <form id="address-form">
      <input
        id="address-input"
        type="text"
        placeholder="address: <reality>/<path>@<being>  .  press / to focus"
        autocomplete="off"
        spellcheck="false"
      />
    </form>
    <nav id="quick-nav">
      <a class="qn-chip" data-tag="home" title="reality root">/</a>
      <a class="qn-chip" data-tag="beings" title=".beings . every being">. beings</a>
      <a class="qn-chip" data-tag="operations" title="./operations . DO registry">ops</a>
      <a class="qn-chip" data-tag="roles" title="./roles . role registry">roles</a>
      <a class="qn-chip" data-tag="threads" title="./threads . live coordination chains">threads</a>
      <a class="qn-chip" data-tag="extensions" title="./extensions . installed extensions">ext</a>
    </nav>
    <div id="branch-chip" title="active branch"></div>
    <div id="identity-chip" title="signed-in identity"></div>
    <button id="flat-timeline-btn" type="button" title="branches and timeline">🌿 timeline</button>
    <button id="flat-close-btn" type="button" title="close text mode (Esc)">close</button>
  </header>
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
      <div id="space-actions" class="pane-section"></div>
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
    const message = { from, content, correlation, ...(opts.inReplyTo ? { inReplyTo: opts.inReplyTo } : {}) };
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
  wireAddressForm(root);
  wireQuickNav(root, ctx);
  wireCloseButton(root, ctx);
  wireTimelineButton(root);
  const detachKeys = wireKeyboardShortcuts(ctx);

  // Refresh operations once so the inspector has its DO surface.
  refreshOperations(ctx);

  // Initial render.
  if (_state.descriptor) {
    renderDescriptor(_state.descriptor, {
      session:   _state.session,
      discovery: _state.discovery,
    });
  }

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

function wireAddressForm(root) {
  const form  = root.querySelector("#address-form");
  const input = root.querySelector("#address-input");
  if (!form || !input) return;
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const raw = input.value.trim();
    if (!raw) return;
    let target = raw;
    const reality = _state.discovery?.reality;
    if (reality && !raw.startsWith(reality) && (raw.startsWith("/") || raw.startsWith("~"))) {
      target = `${reality}${raw === "/" ? "/" : raw}`;
    }
    flat.navigate(target);
    input.blur();
  });
}

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

// Re-exports so consumers in /shared/flat/ (chat.js, identity.js,
// being-timeline.js) can `import { flat } from "./host.js"` and reach
// the same shape they used to read from main.js.
export { setStatus, clearDetail, setConnectionStatus, setLoading };
export { showAuthOverlay, hideAuthOverlay };
export { closeChat, openChatFor };
