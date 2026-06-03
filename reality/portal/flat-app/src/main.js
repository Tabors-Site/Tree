// TreeOS Portal Flat — entry.
//
// Speaks IBP via the shared PortalClient (Socket.IO unified envelope).
// Renders one position as flat HTML. Sibling to 3d-app; same protocol,
// no Three.js.

import { PortalClient } from "./portal-client.js";
import { renderDescriptor, setStatus, clearDetail, setConnectionStatus, setLoading } from "./renderer.js";
import { showAuthOverlay, hideAuthOverlay } from "./identity.js";
import { openChatFor, handleIncomingSummon, closeChat, isChatOpen } from "./chat.js";

const SESSION_KEY = "treeos-portal-flat-session";

// Inheriter-tab handoff constants — declared above `state` because
// loadSession() (called during state init) reads `_isInheriterTab`,
// and a `let` declared later is in the temporal dead zone there.
const INHABIT_HASH   = "inhabit=";
const INHERITER_FLAG = "treeos-portal-flat-inheriter";
let _isInheriterTab  = sessionStorage.getItem(INHERITER_FLAG) === "1";

const state = {
  session:        loadSession(),
  client:         null,
  discovery:      null,
  descriptor:     null,
  currentAddress: null,
  // Registered DO operations, fetched once at connect from
  // <reality>/./operations. Each entry: { name, targets, factAction,
  // ownerExtension, skipAudit }. Filter by targets for the inspector.
  operations:     [],
};

// Single source of truth for shared state. Components reach in for the
// session/identity but never mutate it directly — they call back into
// main.js (signIn / signOut / navigate) instead.
export const flat = {
  get state() { return state; },
  navigate,
  signIn,
  signOut,
  sendSummon,
  cancelByRootCorrelation,
  doOp,
  beOp,
  operationsForTarget,
};

main().catch((err) => {
  console.error("[flat] fatal:", err);
  setStatus(`fatal: ${err.message}`);
});

async function main() {
  setStatus("bootstrapping...");

  const placeUrl = state.session?.placeUrl || defaultPlaceUrl();
  const useProxy = shouldUseProxy(placeUrl);

  state.discovery = await PortalClient.bootstrap(placeUrl, { useProxy });
  setStatus(`bootstrapped — reality=${state.discovery.reality}`);

  if (state.session?.token) {
    await connectAuthed(state.session);
  } else {
    await connectAnonymous(placeUrl, useProxy);
  }

  // After the socket is up + an initial SEE has run, load the registered
  // DO operations so the inspector can render real action buttons.
  await refreshOperations();

  window.addEventListener("hashchange", () => {
    const addr = addressFromHash();
    if (addr !== state.currentAddress) navigate(addr);
  });

  wireAddressForm();
  wireKeyboardShortcuts();
  wireInheriterUnload();
}

// Inheriter tabs release their connect when the tab closes. The fact
// stream gets a BE:release naming the inheriter's token; the
// connection-tracking projection clears qualities.connection.inhabitedBy
// on the target being so the next moment-assign reads "no one inhabiting"
// and the being's defaultKind takes over again. Best-effort: the browser
// gives us very little time during unload, so the BE call goes out as
// fire-and-forget. If the network drops the message, the next inhabit
// of the same being overwrites inhabitedBy via the new connect's reducer.
//
// Plus the parent-presence channel: parent (non-inheriter) tabs
// broadcast "parent-leaving" on pagehide; inheriter tabs whose
// spawnerName matches release themselves. Inhabit is a borrowed
// presence — when the lender leaves, the lease ends.
const PRESENCE_CHANNEL = "treeos-portal-flat-presence";
const SPAWNER_KEY      = "treeos-portal-flat-spawner";
let _presence = null;
try { _presence = new BroadcastChannel(PRESENCE_CHANNEL); }
catch { /* old browser; no cross-tab cascade */ }

function wireInheriterUnload() {
  if (_isInheriterTab) {
    // Stash spawnerName from the inhabit blob so subsequent reloads
    // of this inheriter tab keep the binding.
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      const spawner = raw ? JSON.parse(raw)?.spawnerName || null : null;
      if (spawner) sessionStorage.setItem(SPAWNER_KEY, String(spawner));
    } catch { /* defensive */ }

    if (_presence) {
      _presence.addEventListener("message", async (ev) => {
        const msg = ev?.data;
        if (!msg || msg.type !== "parent-leaving") return;
        const mySpawner = sessionStorage.getItem(SPAWNER_KEY);
        if (!mySpawner || msg.username !== mySpawner) return;
        try {
          if (state.client && state.discovery?.reality && state.session?.username) {
            await state.client.be("release", `${state.discovery.reality}/@${state.session.username}`, {});
          }
        } catch { /* best effort */ }
        clearSession();
        sessionStorage.removeItem(SPAWNER_KEY);
        window.location.replace(window.location.pathname);
      });
    }

    window.addEventListener("pagehide", () => {
      try {
        const sess = state.session;
        if (!sess?.token || !state.client || !state.discovery?.reality) return;
        const stance = `${state.discovery.reality}/@${sess.username}`;
        // No await — unload doesn't wait for promises. Fire and forget.
        state.client.be("release", stance, {}).catch(() => {});
      } catch { /* defensive */ }
    });
    return;
  }

  // Parent (non-inheriter) tab: broadcast on close.
  window.addEventListener("pagehide", () => {
    if (!_presence) return;
    const username = state.session?.username || null;
    if (!username) return;
    try { _presence.postMessage({ type: "parent-leaving", username }); } catch {}
  });
}

// Address form — type any address and press Enter to navigate. Updates
// the URL hash; the hashchange listener picks it up. Accepts:
//   <reality>/<path>            — normal SEE
//   <reality>/<path>@<being>    — stance SEE
//   <reality>/.beings           — global being catalog
//   /<path>                     — current reality, alternate path
//   ~                            — caller's home shorthand
//   /~/<sub>                     — caller's home + child
//   /~@<being>                   — explicit being's home
function wireAddressForm() {
  const form  = document.getElementById("address-form");
  const input = document.getElementById("address-input");
  if (!form || !input) return;
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const raw = input.value.trim();
    if (!raw) return;
    // Allow shorthands that don't start with the reality.
    const reality = state.discovery?.reality;
    let addr = raw;
    if (reality && !raw.startsWith(reality)) {
      if (raw.startsWith("/") || raw.startsWith("~")) addr = `${reality}${raw === "/" ? "/" : raw}`;
    }
    location.hash = "#" + addr;
    input.blur();
  });
}

// Keyboard shortcuts:
//   /       — focus the address bar
//   Esc     — close the topmost panel (auth → chat → inspector)
//   g h     — go home (reality root)
//   g i     — go to inbox of current user (~user)
function wireKeyboardShortcuts() {
  let gPending = false;
  let gTimer   = null;
  window.addEventListener("keydown", (ev) => {
    const target = ev.target;
    const inField = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
    if (ev.key === "Escape") {
      // Layered close: auth overlay → chat → inspector. Most-recently-opened first.
      const auth = document.getElementById("auth-overlay");
      if (auth && !auth.classList.contains("hidden")) {
        hideAuthOverlay();
        return;
      }
      if (isChatOpen()) { closeChat(); return; }
      const insp = document.getElementById("inspector");
      if (insp && !insp.classList.contains("hidden")) {
        insp.classList.add("hidden");
        document.getElementById("empty-detail")?.classList.remove("hidden");
        return;
      }
      return;
    }
    if (inField) return;
    if (ev.key === "/") {
      ev.preventDefault();
      const input = document.getElementById("address-input");
      if (input) { input.focus(); input.select(); }
      return;
    }
    if (ev.key === "g") {
      gPending = true;
      if (gTimer) clearTimeout(gTimer);
      gTimer = setTimeout(() => { gPending = false; }, 600);
      return;
    }
    if (gPending) {
      gPending = false;
      if (gTimer) { clearTimeout(gTimer); gTimer = null; }
      const reality = state.discovery?.reality;
      if (!reality) return;
      // Keyboard shortcuts stay on the current branch — pressing g h on
      // #1 should land on #1's home, not silently flip back to main.
      const branch = state.descriptor?.address?.branch || "0";
      const bq = branch === "0" ? "" : `#${branch}`;
      if (ev.key === "h") {
        ev.preventDefault();
        location.hash = `#${reality}${bq}/`;
      } else if (ev.key === "b") {
        ev.preventDefault();
        location.hash = `#${reality}${bq}/.beings`;
      } else if (ev.key === "o") {
        ev.preventDefault();
        location.hash = `#${reality}${bq}/./operations`;
      } else if (ev.key === "r") {
        ev.preventDefault();
        location.hash = `#${reality}${bq}/./roles`;
      } else if (ev.key === "t") {
        ev.preventDefault();
        location.hash = `#${reality}${bq}/./threads`;
      } else if (ev.key === "i" && state.session?.username) {
        ev.preventDefault();
        location.hash = `#${reality}${bq}/~`;
      }
    }
  });
}


// Fetch the DO registry by SEEing <reality>/./operations. The seed
// syncs the live registry into that space at boot end (operations.js
// syncOperationsToSubstrate), so each child is one op with
// qualities.operation.{ targets, factAction, ownerExtension, skipAudit }.
async function refreshOperations() {
  if (!state.client || !state.discovery?.reality) return;
  try {
    const desc = await state.client.see(`${state.discovery.reality}/./operations`);
    const children = Array.isArray(desc.children) ? desc.children : [];
    state.operations = children.map((c) => {
      const op = c.qualities?.operation || {};
      return {
        name:           c.name,
        targets:        Array.isArray(op.targets) ? op.targets : [],
        factAction:     op.factAction || null,
        ownerExtension: op.ownerExtension || "seed",
        skipAudit:      !!op.skipAudit,
      };
    });
  } catch (err) {
    console.warn("[flat] operations load failed:", err?.code || err?.message);
    state.operations = [];
  }
}

// Filter to ops accepting a given target kind ("being" | "matter" | "space" | "stance").
function operationsForTarget(targetKind) {
  if (!targetKind) return [];
  return state.operations.filter((op) => op.targets.includes(targetKind));
}

async function connectAnonymous(placeUrl, useProxy) {
  state.client = new PortalClient({
    placeUrl,
    token:              null,
    useProxy,
    onConnectionChange: (status, reason) => setConnectionStatus(status, reason),
    onSummon:           handleIncomingSummon,
    onDescriptorEvent:  () => refreshCurrent(),
  });
  state.client.connect();
  await waitForConnect(state.client);
  await navigate(addressFromHash());
}

async function connectAuthed(session) {
  state.client = new PortalClient({
    placeUrl:           session.placeUrl,
    token:              session.token,
    useProxy:           session.placeIsProxied,
    onConnectionChange: (status, reason) => setConnectionStatus(status, reason),
    onSummon:           handleIncomingSummon,
    onDescriptorEvent:  () => refreshCurrent(),
  });
  state.client.connect();
  await waitForConnect(state.client);

  // Verify the stored token by SEEing the being's own stance. If the
  // server refuses, the session is stale — drop it and reconnect anonymously.
  const beingAddress = session.beingAddress
    || (session.username && state.discovery?.reality
        ? `${state.discovery.reality}/@${session.username}`
        : null);
  if (beingAddress) {
    try {
      await state.client.see(beingAddress);
    } catch (err) {
      if (err?.code === "UNAUTHORIZED" || err?.code === "NODE_NOT_FOUND") {
        console.warn("[flat] stored session is no longer valid; dropping it.");
        clearSession();
        state.session = null;
        state.client.disconnect();
        await connectAnonymous(session.placeUrl || defaultPlaceUrl(),
                               shouldUseProxy(session.placeUrl || defaultPlaceUrl()));
        return;
      }
    }
  }

  await navigate(addressFromHash());
}

async function navigate(address) {
  if (!state.client) return;
  const target = address || `${state.discovery.reality}/`;
  setStatus(`see ${target}…`);
  setLoading(true);
  try {
    const desc = await state.client.see(target, { live: true });
    state.descriptor     = desc;
    state.currentAddress = target;
    if (location.hash !== "#" + target) {
      // Update hash without triggering hashchange.
      history.replaceState(null, "", "#" + target);
    }
    // Show auth overlay on first load when not signed in — but only on
    // the home view, not when the user has navigated to a specific
    // synthetic catalog (they may want to browse first).
    const path = desc.address?.pathByNames || "/";
    const isHomeView = (path === "/" || path === "");
    if (!state.session?.token && isHomeView && !isChatOpen()) {
      showAuthOverlay(state.discovery.reality);
    } else {
      hideAuthOverlay();
    }
    renderDescriptor(desc, { session: state.session, discovery: state.discovery });
    setStatus(`at ${path} · ${state.session?.username || "arrival"}`);
  } catch (err) {
    setStatus(`see failed: ${err.code || ""} ${err.message || ""}`);
  } finally {
    setLoading(false);
  }
}

// Debounced live refetch — descriptor patches just trigger a full SEE
// for now. Patch-based diffing is a later optimization.
let _refetchTimer = null;
function refreshCurrent() {
  if (!state.currentAddress) return;
  if (_refetchTimer) return;
  _refetchTimer = setTimeout(async () => {
    _refetchTimer = null;
    try {
      const desc = await state.client.see(state.currentAddress);
      state.descriptor = desc;
      renderDescriptor(desc, { session: state.session, discovery: state.discovery });
    } catch (err) {
      console.warn("[flat] live refetch failed:", err);
    }
  }, 120);
}

// BE.connect or BE.birth. Stores the session and reconnects the socket
// so the new token rides the next handshake.
async function signIn(mode, name, password) {
  if (!state.client) throw new Error("Not connected");
  const result = await state.client.be(mode, state.discovery.reality, { name, password });
  const newSession = {
    placeUrl:       state.session?.placeUrl || defaultPlaceUrl(),
    placeIsProxied: shouldUseProxy(state.session?.placeUrl || defaultPlaceUrl()),
    token:          result.identityToken,
    username:       name,
    beingAddress:   result.beingAddress,
  };
  saveSession(newSession);
  state.session = newSession;
  state.client.disconnect();
  hideAuthOverlay();
  closeChat();
  await connectAuthed(newSession);
}

async function signOut() {
  if (!state.session?.token) return;
  const stance = state.session.beingAddress
    || `${state.discovery.reality}/@${state.session.username}`;
  try {
    await state.client.be("release", stance, { identity: state.session.token });
  } catch (err) {
    console.warn("[flat] release returned", err?.code || err?.message);
  }
  clearSession();
  state.session = null;
  state.client.disconnect();
  closeChat();
  await connectAnonymous(defaultPlaceUrl(), shouldUseProxy(defaultPlaceUrl()));
}

// Build the SUMMON envelope and emit. The reply (or async sub-summon
// pushes) lands via the onSummon handler routed to chat.js.
async function sendSummon(stance, text, { rootCorrelation, inReplyTo } = {}) {
  if (!state.client) throw new Error("Not connected");
  const reality = state.discovery.reality;
  const fromStance = state.session?.username
    ? `${reality}/@${state.session.username}`
    : `${reality}/@arrival`;
  const correlation = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const message = {
    from: fromStance,
    content: text,
    correlation,
    ...(inReplyTo ? { inReplyTo } : {}),
  };
  const threading = rootCorrelation ? { rootCorrelation } : {};
  const reply = await state.client.summon(stance, message, threading);
  return { correlation, reply };
}

// Invoke a DO operation from the inspector. Returns the verb's result
// (or throws). Address is the position the op targets (passed in by the
// inspector — usually state.currentAddress).
async function doOp(address, action, args = {}) {
  if (!state.client) throw new Error("Not connected");
  return state.client.do(address, action, args);
}

// Invoke a BE operation. address is a stance ("<reality>/@cherub" or
// "<reality>/<path>@<name>"); op is "birth" | "connect" | "release".
// For birth/connect, this routes through signIn() so the session and
// socket get rebuilt correctly.
async function beOp(op, address, credentials = {}) {
  if (!state.client) throw new Error("Not connected");
  if (op === "birth" || op === "connect") {
    // Re-use signIn so the new token replaces the session and the
    // socket reconnects auth'd.
    return signIn(op, credentials.name, credentials.password || "");
  }
  return state.client.be(op, address, credentials);
}

// Sever a thread by emitting a cancel SUMMON keyed on rootCorrelation.
// The kernel handles the cascade; per [[project-priority-cancel-interruption]]
// cancel is itself a normal SUMMON envelope.
async function cancelByRootCorrelation(rootCorrelation) {
  if (!state.client || !rootCorrelation) return;
  const reality = state.discovery.reality;
  const threadAddress = `${reality}/./threads/${rootCorrelation}`;
  // Server-side cut handler picks this up — see seed/materials/space/threads.js cutThread.
  const fromStance = state.session?.username
    ? `${reality}/@${state.session.username}`
    : `${reality}/@arrival`;
  try {
    await state.client.summon(threadAddress, {
      from:    fromStance,
      content: "(cancel)",
      correlation: `cancel-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    }, { priority: "HUMAN", rootCorrelation });
  } catch (err) {
    console.warn("[flat] cancel failed:", err?.code || err?.message);
  }
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

function addressFromHash() {
  const raw = decodeURIComponent(location.hash.replace(/^#/, ""));
  if (!raw) return state.discovery ? `${state.discovery.reality}/` : null;
  return raw;
}

// One-shot inhabit handoff. INHABIT_HASH / INHERITER_FLAG and the
// `_isInheriterTab` flag are declared near the top of the file (above
// the `state` initializer) so loadSession can read them during state
// init. This block holds the runtime functions that consume them.

function consumeInhabitHash() {
  // Hash can carry an inhabit blob; if so, decode and store. We
  // strip the hash whether decode succeeded or not so a malformed
  // hash never leaves the user stuck in inhabit-pending state.
  const hash = location.hash.replace(/^#/, "");
  if (!hash.startsWith(INHABIT_HASH)) return null;
  let parsed = null;
  try {
    const raw = decodeURIComponent(hash.slice(INHABIT_HASH.length));
    parsed = JSON.parse(raw);
  } catch { parsed = null; }
  // Clear the inhabit hash but keep the rest of the routing experience
  // intact (an empty hash will route to the reality root on first load).
  history.replaceState(null, "", location.pathname);
  if (!parsed?.token) return null;
  sessionStorage.setItem(INHERITER_FLAG, "1");
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(parsed));
  _isInheriterTab = true;
  return parsed;
}

function loadSession() {
  // Inheriter tabs first read any inhabit-handoff blob from the URL
  // hash. Whether or not the hash is present, an inheriter tab uses
  // sessionStorage; the original (parent) tab uses localStorage.
  const inherited = consumeInhabitHash();
  if (inherited) return inherited;
  try {
    if (_isInheriterTab) {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    }
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveSession(s) {
  if (_isInheriterTab) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else                 localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}
function clearSession() {
  if (_isInheriterTab) sessionStorage.removeItem(SESSION_KEY);
  else                 localStorage.removeItem(SESSION_KEY);
}

function defaultPlaceUrl() { return "http://localhost:3000"; }

function shouldUseProxy(placeUrl) {
  if (!placeUrl) return true;
  return placeUrl.includes("localhost") || placeUrl.includes("127.0.0.1");
}

function waitForConnect(client, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (client.connected) return resolve();
    const t = setTimeout(() => reject(new Error("connect timeout")), timeoutMs);
    client.socket.once("connect",       () => { clearTimeout(t); resolve(); });
    client.socket.once("connect_error", (err) => { clearTimeout(t); reject(new Error(err?.message || "connect error")); });
  });
}

// Debugging handle.
window.__portalFlat = state;
