// TreeOS Portal Flat — entry.
//
// Speaks IBP via the shared PortalClient (Socket.IO unified envelope).
// Renders one position as flat HTML. Sibling to 3d-app; same protocol,
// no Three.js.

import { PortalClient } from "./portal-client.js";
import { renderDescriptor, setStatus, clearDetail } from "./renderer.js";
import { showAuthOverlay, hideAuthOverlay } from "./identity.js";
import { openChatFor, handleIncomingSummon, closeChat, isChatOpen } from "./chat.js";

const SESSION_KEY = "treeos-portal-flat-session";

const state = {
  session:        loadSession(),
  client:         null,
  discovery:      null,
  descriptor:     null,
  currentAddress: null,
  // Registered DO operations, fetched once at connect from
  // <reality>/.operations. Each entry: { name, targets, factAction,
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
}

// Fetch the DO registry by SEEing <reality>/.operations. The seed syncs
// the live registry into that space at boot end (operations.js
// syncOperationsToSubstrate), so each child is one op with
// qualities.operation.{ targets, factAction, ownerExtension, skipAudit }.
async function refreshOperations() {
  if (!state.client || !state.discovery?.reality) return;
  try {
    const desc = await state.client.see(`${state.discovery.reality}/.operations`);
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
    onConnectionChange: (status, reason) => setStatus(`socket: ${status}${reason ? " — " + reason : ""}`),
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
    onConnectionChange: (status) => setStatus(`${session.username} | ${status}`),
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
  setStatus(`see ${target}...`);
  try {
    const desc = await state.client.see(target, { live: true });
    state.descriptor     = desc;
    state.currentAddress = target;
    if (location.hash !== "#" + target) {
      // Update hash without triggering hashchange.
      history.replaceState(null, "", "#" + target);
    }
    if (!state.session?.token && !isChatOpen()) {
      showAuthOverlay(state.discovery.reality);
    } else {
      hideAuthOverlay();
    }
    renderDescriptor(desc, { session: state.session, discovery: state.discovery });
    setStatus(`at ${desc.address?.pathByNames || "/"} | ${state.session?.username || "arrival"}`);
  } catch (err) {
    setStatus(`see failed: ${err.code || ""} ${err.message || ""}`);
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

// BE.claim or BE.register. Stores the session and reconnects the socket
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
// "<reality>/<path>@<name>"); op is "claim" | "register" | "release" | "switch".
// For claim/register, this routes through signIn() so the session and
// socket get rebuilt correctly.
async function beOp(op, address, credentials = {}) {
  if (!state.client) throw new Error("Not connected");
  if (op === "claim" || op === "register") {
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
  const threadAddress = `${reality}/.threads/${rootCorrelation}`;
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

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveSession(s)  { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
function clearSession()  { localStorage.removeItem(SESSION_KEY); }

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
