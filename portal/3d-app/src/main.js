// TreeOS Portal 3D — entry.
//
// Speaks IBP via the shared PortalClient. Renders the addressed Position
// as a 3D scene. See ../README.md (../../3d/README.md) for the full design.

import { PortalClient } from "./portal-client.js";
import { Scene } from "./scene.js";
import { mountIbpConsole } from "./ibp-console.js";
import { initHotbar } from "./hotbar.js";
import { promptForName, plantSeed as runPlantSeed, isPlanterOpen, closePrompt } from "./planter.js";
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
  showLlmAssignerPanel,
  hideLlmAssignerPanel,
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
  // Hotbar API (returned by initHotbar). Holds plantable seeds.
  hotbar: null,
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
    onArtifactEnded: (info) => onArtifactEnded(info),
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

  // Mount the IBP console (toggle with backtick). Reuses the live
  // PortalClient — calls go over the same socket as the scene.
  mountIbpConsole({
    root:    document.getElementById("overlays") || document.body,
    client:  state.client,
    getLand: () => state.discovery?.land || "treeos.ai",
  });

  // Mount the hotbar. Populated from the land's discovery payload
  // (refreshed on every connect — see refreshSeedCatalog).
  state.hotbar = initHotbar(document.getElementById("hud") || document.body);
  await refreshSeedCatalog();
}

// Pull `<land>/.discovery` over the live IBP socket and hand the seed
// catalog to the hotbar. The HTTP bootstrap is intentionally minimal
// (just enough to open the socket); the full capability surface lives
// on the socket-side discovery.
async function refreshSeedCatalog() {
  if (!state.client || !state.discovery?.land) return;
  try {
    const full = await state.client.see(`${state.discovery.land}/.discovery`);
    // Merge into state.discovery so other consumers see the rich form too.
    state.discovery = { ...state.discovery, ...full };
    const seeds = Array.isArray(full?.seeds) ? full.seeds : [];
    console.log(`[3D] discovery: ${seeds.length} seed(s)`, seeds.map((s) => s.name));
    state.hotbar?.setSlots(seeds.map((s) => ({
      kind:        "seed",
      name:        s.name,
      label:       s.name.split(":").pop(),
      description: s.description,
    })));
    if (seeds.length === 0) {
      setHud("no plantable seeds registered on this land");
    }
  } catch (err) {
    console.warn("[3D] discovery fetch failed:", err?.message || err);
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

  // The token may be stale (expired, signed under a previous JWT_SECRET,
  // or for a being that no longer exists). The socket accepts the
  // connection regardless; auth-only happens at verb dispatch. Verify
  // explicitly with one SEE on the being's own stance. If the server
  // refuses, drop the local session and reconnect anonymously rather
  // than lie to the user with a stale "tabor" chip.
  const beingAddress = session.beingAddress
    || (session.username && state.discovery?.land
        ? `${state.discovery.land}/@${session.username}`
        : null);
  if (beingAddress) {
    try {
      await state.client.see(beingAddress);
    } catch (err) {
      if (err?.code === "UNAUTHORIZED" || err?.code === "NODE_NOT_FOUND") {
        console.warn("[3D] stored session is no longer valid; dropping it.");
        clearSession();
        state.session = null;
        state.client.disconnect();
        const landUrl = session.landUrl || defaultLandUrl();
        await connectAnonymous(landUrl, shouldUseProxy(landUrl));
        return;
      }
      // Other errors (network, TIMEOUT) — let navigation surface them.
    }
  }

  await navigate("/");
  // The hotbar may have mounted before the socket reconnected (auth flow
  // disconnects + reconnects). Refresh the seed list against the new socket.
  if (state.hotbar) await refreshSeedCatalog();
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

// An in-world video artifact reached its end. Fire the role-owned
// consume op; the descriptor refetch will drop the mesh. Currently
// only the llm-assigner tutorial uses this — the op verifies the
// artifact carries its marker before deleting.
async function onArtifactEnded({ artifactId }) {
  if (!state.client || !artifactId) return;
  const land = state.discovery?.land;
  if (!land) return;
  try {
    await state.client.do(`${land}/`, "llm-assigner:complete-tutorial", { artifactId });
  } catch (err) {
    console.warn("[3D] llm-assigner:complete-tutorial failed:", err?.code || err?.message || err);
  }
}

// Spawn the llm-assigner intro tutorial artifact at the land root.
// The DO op is idempotent server-side (marker on metadata.tutorial.purpose)
// so calling it twice returns the existing artifact instead of creating
// a duplicate. We ALWAYS re-render after the call — even when `created`
// is false, the descriptor needs to refresh so the mesh shows for the
// current session (a fresh tab won't have rendered it yet).
async function spawnLlmAssignerTutorial() {
  console.log("[3D] spawnLlmAssignerTutorial:",
    { hasClient: !!state.client, hasToken: !!state.session?.token,
      connected: !!state.client?.connected, land: state.discovery?.land });
  if (!state.client) throw new Error("Not connected");
  if (!state.session?.token) throw new Error("Not authenticated. Sign in via @auth first.");
  const land = state.discovery?.land;
  if (!land) throw new Error("No land");

  // After an HMR reload (or any transient disconnect) the panel may
  // open before the socket is back. Give it a short window to reconnect
  // before failing the click.
  if (!state.client.connected) {
    console.log("[3D] socket not connected — waiting up to 3s for reconnect");
    const deadline = Date.now() + 3000;
    while (!state.client.connected && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 100));
    }
    if (!state.client.connected) throw new Error("Portal socket not connected (after 3s)");
  }

  const addr = `${land}/`;
  console.log(`[3D] DO ${addr} llm-assigner:start-tutorial`);
  const result = await state.client.do(addr, "llm-assigner:start-tutorial", {});
  console.log("[3D] start-tutorial result:", result);

  // Always re-fetch — even when created:false, the live descriptor
  // for this client may not have the artifact yet.
  if (state.currentAddress) {
    const desc = await state.client.see(state.currentAddress);
    state.descriptor = desc;
    console.log("[3D] descriptor.artifacts:", desc?.artifacts?.length || 0,
      "isLandRoot:", desc?.isLandRoot);
    state.scene.renderDescriptor(desc, {
      isAuthenticated: !!state.session?.token,
    });
  }
  return result;
}

async function navigate(address, { fromHistory = false } = {}) {
  if (!state.client) return;
  try {
    const resolved = expandHomeShorthand(address);
    // Subscribe live: every change to this position (placements, beings
    // appearing/disappearing, queue state, activity) lands as a
    // descriptor event we can refetch on.
    const desc = await state.client.see(resolved, { live: true });
    state.descriptor = desc;
    state.currentAddress = resolved;
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
  if (b.being === "auth")         return onAuthProximity(inRange);
  if (b.being === "llm-assigner") return onLlmAssignerProximity(inRange);
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

function onLlmAssignerProximity(inRange) {
  // The form state (typed values) is preserved across re-opens by the
  // panel module, so dropping the DOM on look-away is non-destructive.
  if (!inRange) hideLlmAssignerPanel();
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
  } else if (b.being === "llm-assigner") {
    openLlmAssignerPanel();
  } else {
    openTalkPanel(b);
  }
}

function openLlmAssignerPanel() {
  console.log("[3D] openLlmAssignerPanel:",
    { hasToken: !!state.session?.token,
      land: state.discovery?.land,
      currentAddress: state.currentAddress });
  // Requires an authenticated being (the server enforces this on every
  // op). If unauthenticated, bounce the user to the auth flow first.
  if (!state.session?.token) {
    console.log("[3D] llm-assigner: not authenticated, opening auth instead");
    openAuthPanel();
    return;
  }
  // The Node tab needs a concrete nodeId. We pull it from the live
  // descriptor — when the user is at a tree position, descriptor.address.nodeId
  // is set. Land-root / arrival has nodeId: null and the panel disables
  // the Node tab.
  showLlmAssignerPanel({
    client:        state.client,
    land:          state.discovery.land,
    currentNodeId: state.descriptor?.address?.nodeId || null,
    onClose:       () => {},
    // Link in the panel: fires the llm-assigner:start-tutorial DO,
    // then re-fetches the descriptor so the new artifact's 3D video
    // screen appears in the scene. Server-side marker enforces
    // one-at-a-time (idempotent).
    onSpawnTutorial: spawnLlmAssignerTutorial,
  });
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
        // `name` is the canonical wire field; the server accepts
        // `username` as a legacy alias. Pass directly — `client.be`
        // already wraps these into the BE envelope's payload.
        const result = await state.client.be(mode, state.discovery.land, {
          name: username,
          password,
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
    if (isPlanterOpen()) closePrompt();
    return;
  }
  if (isGameplayInputBlocked()) return;
  if (e.code === "KeyB") { e.preventDefault(); historyBack();    return; }
  if (e.code === "KeyN") { e.preventDefault(); historyForward(); return; }
  if (e.code === "KeyE") { e.preventDefault(); attemptPlant();   return; }
});

// Try to plant whatever's in the selected hotbar slot at the current
// position. Bounces the user to auth if unauthenticated (the kernel
// would reject anyway; better to ask before the round-trip).
async function attemptPlant() {
  const item = state.hotbar?.getSelected();
  if (!item) {
    setHud("hotbar slot is empty. select a seed (1-9).");
    return;
  }
  if (!state.session?.token) {
    setHud("sign in first to plant.");
    openAuthPanel();
    return;
  }
  if (!state.descriptor || !state.client) return;

  const land = state.discovery.land;
  const path = state.descriptor.address?.pathByNames || "/";
  const parentAddress = `${land}${path}`.replace(/\/+$/, "") || land;

  let answer;
  try {
    answer = await promptForName({
      item,
      parentLabel: parentAddress,
    });
  } catch {
    return; // user cancelled
  }

  setHud(`planting ${item.name}...`);
  try {
    const result = await runPlantSeed({
      client:        state.client,
      parentAddress,
      seedName:      item.name,
      newNodeName:   answer.name,
    });
    setHud(`planted ${item.name} at ${result.newNodeAddress}`);
    // Navigate into the new tree so the operator sees what grew.
    await navigate(result.newNodeAddress);
  } catch (err) {
    setHud(`plant failed: ${err.code || ""} ${err.message || ""}`);
  }
}

// True while the user is typing in a UI input OR a modal panel is open.
// Single source of truth for whether gameplay keys (WASD/B/N/E) fire.
function isGameplayInputBlocked() {
  if (isAnyPanelOpen()) return true;
  if (isPlanterOpen())  return true;
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

// "~" and "/~" are home shorthands the server resolves with the
// authenticated socket's `currentUser`. Clicking "home" without a live
// auth on the socket triggers a parse error. Substitute locally when
// we know the username; the server's parser stops needing context.
function expandHomeShorthand(address) {
  if (typeof address !== "string") return address;
  const username = state.session?.username;
  if (!username) return address;
  if (address === "~" || address === "/~") return `/~${username}`;
  if (address.startsWith("/~/")) return `/~${username}${address.slice(2)}`;
  return address;
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
