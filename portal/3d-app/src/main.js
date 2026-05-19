// TreeOS Portal 3D — entry.
//
// Speaks IBP via the shared PortalClient. Renders the addressed Position
// as a 3D scene. See ../README.md (../../3d/README.md) for the full design.

import { PortalClient } from "./portal-client.js";
import { Scene } from "./scene.js";
import {
  setHud,
  initAddressBar,
  updateAddressBar,
  toggleIdentityChip,
  showAuthActions,
  hideAuthActions,
  showAuthSignInPanel,
  hideAuthSignInPanel,
  showTalkPanel,
  hideTalkPanel,
  resetTalkState,
  setHistoryButtonsEnabled,
  isAnyPanelOpen,
} from "./ui.js";

const SESSION_KEY = "treeos-portal-3d-session";

const state = {
  session: loadSession(),
  client: null,
  discovery: null,
  scene: null,
  descriptor: null,
  // Whichever non-auth being currently has the talk panel open.
  currentTalkBeing: null,
  // Correlation id -> being, for routing async ibp:summon
  // events back to the being whose bubble should be updated.
  pendingSummons: new Map(),
  // Navigation history. Linear; back/forward step through it without
  // re-visiting via see() until the user actually clicks back/forward.
  history: [],
  historyIndex: -1,
};

main().catch((err) => {
  console.error("[3D] fatal:", err);
  setHud(`fatal: ${err.message}`);
});

async function main() {
  setHud("bootstrapping...");

  const landUrl = state.session?.landUrl || defaultLandUrl();
  const useProxy = shouldUseProxy(landUrl);

  state.discovery = await PortalClient.bootstrap(landUrl, { useProxy });

  setHud(`connected to ${state.discovery.land}`);

  // Build the 3D scene.
  state.scene = new Scene({
    onGaze:  (target) => onGaze(target),
    onEnter: (target) => onEnter(target),
    onBeingProximity: (being, inRange, distance) => onBeingProximity(being, inRange, distance),
    onBeingActivate: (being) => onBeingActivate(being),
    isInputBlocked: isGameplayInputBlocked,
  });
  state.scene.setLandTimezone(state.discovery.timezone || null);
  state.scene.start();

  // Wire the address bar.
  initAddressBar({
    onNavigate: (raw) => navigate(raw),
    onIdentityClick: () => {
      const full = state.session?.username
        ? `${state.session.username}@${state.discovery.land}`
        : `arrival@${state.discovery.land}`;
      toggleIdentityChip(full);
      refreshAddressBar();
    },
    onBack: () => historyBack(),
    onForward: () => historyForward(),
  });

  // Open the IBP socket.
  if (state.session?.token) {
    await connectAndLand(state.session);
  } else {
    await connectAnonymous(landUrl, useProxy);
  }
}

async function connectAnonymous(landUrl, useProxy) {
  state.client = new PortalClient({
    landUrl,
    token: null,
    useProxy,
    onConnectionChange: (status) => setHud(`socket: ${status}`),
    onSummon: handleSummon,
    onDescriptorEvent: handleDescriptorEvent,
  });
  state.client.connect();
  await waitForConnect(state.client);
  await navigate("/");
}

async function connectAndLand(session) {
  state.client = new PortalClient({
    landUrl: session.landUrl,
    token: session.token,
    useProxy: session.landIsProxied,
    onConnectionChange: (status) => setHud(`${session.username} | ${status}`),
    onSummon: handleSummon,
    onDescriptorEvent: handleDescriptorEvent,
  });
  state.client.connect();
  await waitForConnect(state.client);
  await navigate("/");
}

// Live SEE events. For now we use a coarse path: any descriptor change
// triggers a debounced refetch and re-render. Patch-based diffing comes
// later as an optimization.
let _refetchTimer = null;
function handleDescriptorEvent(_event) {
  if (!state.currentAddress) return;
  if (_refetchTimer) return; // already scheduled
  _refetchTimer = setTimeout(async () => {
    _refetchTimer = null;
    try {
      const desc = await state.client.see(state.currentAddress);
      state.descriptor = desc;
      state.scene.renderDescriptor(desc, {
        isAuthenticated: !!state.session?.token,
      });
      refreshAddressBar();
    } catch (err) {
      console.warn("[3D] live refetch failed:", err);
    }
  }, 100); // debounce a touch so a flurry of patches collapses into one render
}

// Async SUMMON reply arrives via `ibp:summon`. Look up which being
// the reply belongs to (by correlation id) and swap the thinking bubble
// for the real content.
function handleSummon(entry) {
  const correlation = entry?.inReplyTo;
  if (!correlation) return;
  const being = state.pendingSummons.get(correlation);
  if (!being) return;
  state.pendingSummons.delete(correlation);
  const text = entry.content || "(no reply)";
  state.scene.showBeingMessage(being, text);
}

async function navigate(address, { fromHistory = false } = {}) {
  if (!state.client) return;
  try {
    // Subscribe live: every change to this position (placements, beings
    // appearing/disappearing, queue state, activity) lands as a
    // descriptor event we can refetch on.
    const desc = await state.client.see(address, { live: true });
    state.descriptor = desc;
    state.currentAddress = address;
    state.scene.renderDescriptor(desc, {
      isAuthenticated: !!state.session?.token,
    });
    hideAuthActions();
    hideAuthSignInPanel();
    hideTalkPanel();
    resetTalkState();
    state.currentTalkBeing = null;
    refreshAddressBar();
    setHud(formatLocation(desc, state.session));

    // Push to history unless we're navigating via back/forward.
    if (!fromHistory) {
      const canonical = desc?.address?.pathByNames || address;
      // If the same as current, do not duplicate.
      if (state.history[state.historyIndex] !== canonical) {
        // Drop any "forward" history beyond the current index.
        state.history = state.history.slice(0, state.historyIndex + 1);
        state.history.push(canonical);
        state.historyIndex = state.history.length - 1;
      }
    }
    updateHistoryButtons();
  } catch (err) {
    setHud(`see failed: ${err.code || ""} ${err.message || ""}`);
  }
}

function historyBack() {
  if (state.historyIndex <= 0) return;
  state.historyIndex--;
  const addr = state.history[state.historyIndex];
  navigate(addr, { fromHistory: true });
}

function historyForward() {
  if (state.historyIndex >= state.history.length - 1) return;
  state.historyIndex++;
  const addr = state.history[state.historyIndex];
  navigate(addr, { fromHistory: true });
}

function updateHistoryButtons() {
  setHistoryButtonsEnabled({
    back:    state.historyIndex > 0,
    forward: state.historyIndex < state.history.length - 1,
  });
}

function refreshAddressBar() {
  updateAddressBar({
    username: state.session?.username,
    landDomain: state.discovery?.land,
    pathByNames: state.descriptor?.address?.pathByNames,
    chain: state.descriptor?.address?.chain,
    isAuthenticated: !!state.session?.token,
  });
}

// Gaze handler: tree-zone labels and child entry happen inside scene.js.
// All being interaction (auth + talk) is driven by proximity+gaze in
// onBeingProximity below.
function onGaze(_target, _info) {
  // no-op for now
}

// Proximity dispatcher: fires from scene.js whenever any being's
// proximity+gaze state flips. Auth-being opens sign-in/logout; every
// other being opens the talk panel.
function onBeingProximity(b, inRange, _distance) {
  if (b.being === "auth") {
    return onAuthProximity(inRange);
  }
  return onChatBeingProximity(b, inRange);
}

// Proximity only CLOSES panels now (when the player walks away or looks
// away). Opening requires an explicit click on the being so the user
// doesn't trigger panels by brushing past.
function onAuthProximity(inRange) {
  if (!inRange) {
    hideAuthActions();
    hideAuthSignInPanel();
  }
}

function onChatBeingProximity(b, inRange) {
  if (!inRange) {
    if (state.currentTalkBeing === b.being) {
      hideTalkPanel();
      state.currentTalkBeing = null;
    }
  }
}

// Click-to-activate dispatcher. Fires from scene.js when the player
// clicks while gazing at a being within INTERACT_RANGE.
function onBeingActivate(b) {
  if (b.being === "auth") {
    openAuthPanel();
  } else {
    openTalkPanel(b);
  }
}

function openAuthPanel() {
  if (state.session?.token) {
    hideAuthSignInPanel();
    showAuthActions({
      username: state.session.username,
      onLogout: async () => { await logout(); },
    });
  } else {
    hideAuthActions();
    showAuthSignInPanel({
      land: state.discovery.land,
      onSubmit: async (mode, username, password) => {
        const result = await state.client.be(mode, state.discovery.land, {
          payload: { username, password },
        });
        const newSession = {
          landUrl: state.session?.landUrl || defaultLandUrl(),
          landIsProxied: shouldUseProxy(state.session?.landUrl || defaultLandUrl()),
          token: result.identityToken,
          username,
          beingAddress: result.beingAddress,
        };
        saveSession(newSession);
        state.session = newSession;
        state.client.disconnect();
        await connectAndLand(newSession);
      },
    });
  }
}

function openTalkPanel(b) {
  state.currentTalkBeing = b.being;
  showTalkPanel({
    being: b,
    onSubmit: (text) => sendSummon(b, text),
  });
}

// Build the SUMMON envelope and dispatch via ibp:summon. Sync beings
// return their response on the ack; async beings ACK accepted and
// later push a `ibp:summon` event handled by handleSummon().
// While we wait for an async reply, we show an animated thinking bubble
// above the being's head.
async function sendSummon(b, text) {
  if (!state.descriptor || !state.client) return;
  // Drop the chat panel as soon as the user hits send. The thinking
  // bubble (or final reply) lives in the world above the being's head;
  // the panel stays out of the way until the user activates again.
  hideTalkPanel();
  state.currentTalkBeing = null;
  const land = state.discovery.land;
  const path = state.descriptor.address?.pathByNames || "/";
  // Stance form: `<land>/<path>@<being>`. When path is "/" the slash
  // is already present, so `${land}${path}@...` collapses to `<land>/@...`
  // (the canonical form for land/home-root beings).
  const stance = `${land}${path}@${b.being}`.replace(/\/+@/, "/@");
  const fromStance = state.session?.username
    ? `${land}/@${state.session.username}`
    : `${land}/@arrival`;
  const correlation = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const message = {
    from: fromStance,
    content: text,
    intent: "chat",
    correlation,
  };
  try {
    const reply = await state.client.summon(stance, message);
    if (reply?.status === "accepted") {
      // Async path: server kicked off summoning; show thinking dots and
      // wait for `ibp:summon` to swap them for real content.
      state.pendingSummons.set(correlation, b.being);
      state.scene.showBeingThinking(b.being);
      return;
    }
    const replyText = reply?.content || "(no reply)";
    state.scene.showBeingMessage(b.being, replyText);
  } catch (err) {
    state.scene.showBeingMessage(
      b.being,
      `[${err.code || "error"}] ${err.message || "summon failed"}`,
    );
    throw err;
  }
}

// Gameplay key bundle. Escape, B (back), N (next) all live here so the
// app has one place to gate them on/off. Escape always works (it closes
// open panels). B/N navigate history and are suppressed while panels
// are open or the user is typing in a UI input. WASD movement uses the
// same isGameplayInputBlocked() check (passed into the Scene), so the
// whole gameplay input surface turns off together while interacting.
addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    hideAuthActions();
    hideAuthSignInPanel();
    if (state.currentTalkBeing) {
      hideTalkPanel();
      state.currentTalkBeing = null;
    }
    return;
  }
  if (isGameplayInputBlocked()) return;
  if (e.code === "KeyB") { e.preventDefault(); historyBack();    return; }
  if (e.code === "KeyN") { e.preventDefault(); historyForward(); return; }
});

// True while the user is typing in a UI input OR a modal panel is open.
// Single source of truth for whether gameplay keys (WASD/B/N) fire.
function isGameplayInputBlocked() {
  if (isAnyPanelOpen()) return true;
  const el = document.activeElement;
  if (!el || el === document.body) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if (el.isContentEditable) return true;
  return false;
}

async function logout() {
  if (!state.session?.token) return;
  const stance = state.session.beingAddress
    || `${state.discovery.land}/@${state.session.username}`;
  try {
    await state.client.be("release", stance, { identity: state.session.token });
  } catch (err) {
    // Even if the server says no, drop the client-side session.
    console.warn("[3D] release returned", err?.code || err?.message);
  }
  clearSession();
  state.session = null;
  state.client.disconnect();
  await connectAnonymous(defaultLandUrl(), shouldUseProxy(defaultLandUrl()));
}

async function onEnter(target) {
  if (!target?.address) return;
  setHud(`entering ${target.address}...`);
  await navigate(target.address);
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(s) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function defaultLandUrl() {
  return "http://localhost:3000";
}

function shouldUseProxy(landUrl) {
  if (!landUrl) return true;
  return landUrl.includes("localhost") || landUrl.includes("127.0.0.1");
}

function waitForConnect(client, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (client.connected) return resolve();
    const t = setTimeout(() => reject(new Error("connect timeout")), timeoutMs);
    client.socket.once("connect", () => {
      clearTimeout(t);
      resolve();
    });
    client.socket.once("connect_error", (err) => {
      clearTimeout(t);
      reject(new Error(err?.message || "connect error"));
    });
  });
}

function formatLocation(desc, session) {
  const where = desc?.address?.pathByNames || "/";
  const who = session?.username || "arrival";
  return `${who} | ${desc?.address?.land || ""}${where}`;
}

window.__portal3d = state;
