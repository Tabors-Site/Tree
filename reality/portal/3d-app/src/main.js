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
  showSummonPanel,
  hideSummonPanel,
  resetSummonState,
  setHistoryButtonsEnabled,
  isAnyPanelOpen,
  showLlmAssignerPanel,
  hideLlmAssignerPanel,
} from "./ui.js";
import {
  showActionMenu,
  showActionForm,
  hideActionPanel,
  isActionPanelOpen,
} from "./actionRenderer.js";
import {
  showRoleManagerPanel,
  hideRoleManagerPanel,
  isRoleManagerPanelOpen,
} from "./role-manager-panel.js";
import { ensureUnlockOverlay, preloadSounds } from "./audioPlayer.js";
import { createFactDispatcher } from "./factDispatcher.js";

const SESSION_KEY = "treeos-portal-3d-session";

// Inheriter-tab handoff constants — declared above the `state`
// initializer because loadSession() (called during state init below)
// reads `_isInheriterTab`, and a `let` declared later is in the
// temporal dead zone at that point.
const INHABIT_HASH   = "inhabit=";
const INHERITER_FLAG = "treeos-portal-3d-inheriter";
let _isInheriterTab  = sessionStorage.getItem(INHERITER_FLAG) === "1";

const state = {
  session: loadSession(),
  client: null,
  discovery: null,
  scene: null,
  descriptor: null,
  // Whichever non-cherub being currently has the summon panel open.
  currentSummonBeing: null,
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

// Expose for browser-console debugging. Access as window.__state from
// devtools to inspect descriptor, scene meshes, current address, etc.
// Safe to ship . the same data is available over the IBP socket the
// portal is already using, and the user can already see the rendered
// version.
if (typeof window !== "undefined") {
  window.__state = state;
}

main().catch((err) => {
  console.error("[3D] fatal:", err);
  setHud(`fatal: ${err.message}`);
});

async function main() {
  setHud("bootstrapping...");

  const placeUrl = state.session?.placeUrl || defaultPlaceUrl();
  const useProxy = shouldUseProxy(placeUrl);

  state.discovery = await PortalClient.bootstrap(placeUrl, { useProxy });

  setHud(`connected to ${state.discovery.reality}`);

  // Build the 3D scene.
  state.scene = new Scene({
    onGaze:  (target) => onGaze(target),
    onEnter: (target) => onEnter(target),
    onBeingProximity: (being, inRange, distance) => onBeingProximity(being, inRange, distance),
    onBeingActivate: (being) => onBeingActivate(being),
    onMatterEnded: (info) => onMatterEnded(info),
    onMatterPlaybackTick: (info) => onMatterPlaybackTick(info),
    isInputBlocked: isGameplayInputBlocked,
  });
  // Move tool wiring. Scene runs the pick-up state machine and fires
  // onMove only when the user commits a put-down. The HUD reflects
  // mode/carry state so the player sees what they're holding.
  state.scene.onMove = (intent) => fireMove(intent);
  state.scene.onMoveModeChange = (on, carrying) => updateMoveHud(on, carrying);
  state.scene.setPlaceTimezone(state.discovery.timezone || null);

  // Rung-3 sensory dispatch. factDispatcher consumes the new SEE/fact
  // envelopes (kind:"fact") and triggers per-entity AnimationMixer
  // clips + Web Audio playback. ensureUnlockOverlay() injects a small
  // "tap to enable sound" prompt the first time the page loads;
  // browser autoplay policy refuses audio without a user gesture.
  state.factDispatcher = createFactDispatcher({ scene: state.scene });
  ensureUnlockOverlay();
  state.scene.start();

  // Best-effort flush on tab close: walk any live video meshes, grab
  // their current time, and ship a save-playback via sendBeacon-style
  // synchronous emit. The scene already flushes on _clearWorld() during
  // navigations; this catches the close case.
  window.addEventListener("beforeunload", () => {
    state.scene?.flushPlaybackTicks?.();
  });

  // Wire the address bar.
  initAddressBar({
    onNavigate: (raw) => navigate(raw),
    onIdentityClick: () => {
      const full = state.session?.username
        ? `${state.session.username}@${state.discovery.reality}`
        : `arrival@${state.discovery.reality}`;
      toggleIdentityChip(full);
      refreshAddressBar();
    },
    onBack: () => historyBack(),
    onForward: () => historyForward(),
  });

  // Open the IBP socket.
  if (state.session?.token) {
    await connectAndPlace(state.session);
  } else {
    await connectAnonymous(placeUrl, useProxy);
  }

  // Mount the IBP console (toggle with backtick). Reuses the live
  // PortalClient — calls go over the same socket as the scene.
  mountIbpConsole({
    root:    document.getElementById("overlays") || document.body,
    client:  state.client,
    getPlace: () => state.discovery?.reality || "treeos.ai",
  });

  // Mount the hotbar. Populated from the place's discovery payload
  // (refreshed on every connect — see refreshSeedCatalog). Selecting
  // the built-in Move tool toggles the scene's pick-up mode; any
  // other selection turns it off.
  state.hotbar = initHotbar(document.getElementById("hud") || document.body, {
    onSelectionChange: (item) => {
      const isMoveTool = item?.kind === "tool" && item?.name === "move";
      state.scene?.setMoveMode?.(isMoveTool);
    },
  });
  await refreshSeedCatalog();
}

// Pull `<place>/.discovery` over the live IBP socket and hand the seed
// catalog to the hotbar. The HTTP bootstrap is intentionally minimal
// (just enough to open the socket); the full capability surface lives
// on the socket-side discovery.
async function refreshSeedCatalog() {
  if (!state.client || !state.discovery?.reality) return;
  try {
    const full = await state.client.see(`${state.discovery.reality}/.discovery`);
    // Merge into state.discovery so other consumers see the rich form too.
    state.discovery = { ...state.discovery, ...full };
    const seeds = Array.isArray(full?.seeds) ? full.seeds : [];
    console.log(`[3D] discovery: ${seeds.length} seed(s)`, seeds.map((s) => s.name));
    // Slot 0 is always the built-in Move tool. Seeds populate after.
    // The tool is intrinsic to the portal — not provided by the
    // place — so it doesn't ride on discovery.
    const slots = [
      {
        kind: "tool",
        name: "move",
        label: "Move",
        description: "Click an object to pick it up. Click a destination to put it down. Esc to cancel.",
      },
      ...seeds.map((s) => ({
        kind:        "seed",
        name:        s.name,
        label:       s.name.split(":").pop(),
        description: s.description,
      })),
    ];
    state.hotbar?.setSlots(slots);
    if (seeds.length === 0) {
      setHud("no plantable seeds registered on this place");
    }
  } catch (err) {
    console.warn("[3D] discovery fetch failed:", err?.message || err);
  }
}

async function connectAnonymous(placeUrl, useProxy) {
  state.client = new PortalClient({
    placeUrl,
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

async function connectAndPlace(session) {
  state.client = new PortalClient({
    placeUrl: session.placeUrl,
    token: session.token,
    useProxy: session.placeIsProxied,
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
    || (session.username && state.discovery?.reality
        ? `${state.discovery.reality}/@${session.username}`
        : null);
  // The being's last-known position (server-side state) is surfaced
  // on the descriptor's identity block. Reuse it to land the camera
  // where the being actually IS, instead of teleporting to / on
  // every login / reconnect. Falls back to the being's stance (home),
  // then to / if even that fails.
  let landingAddress = "/";
  if (beingAddress) {
    try {
      const desc = await state.client.see(beingAddress);
      const pos = desc?.identity?.position || null;
      if (pos && state.discovery?.reality) {
        // Position is a spaceId — the resolver accepts UUID paths.
        landingAddress = `${state.discovery.reality}/${pos}`;
      } else {
        // No saved position yet — fall back to the being's stance
        // address (which resolves to their home).
        landingAddress = beingAddress;
      }
    } catch (err) {
      if (err?.code === "UNAUTHORIZED" || err?.code === "NODE_NOT_FOUND") {
        console.warn("[3D] stored session is no longer valid; dropping it.");
        clearSession();
        state.session = null;
        state.client.disconnect();
        const placeUrl = session.placeUrl || defaultPlaceUrl();
        await connectAnonymous(placeUrl, shouldUseProxy(placeUrl));
        return;
      }
      // Other errors (network, TIMEOUT) — fall through to landing.
    }
  }

  await navigate(landingAddress);
  // The hotbar may have mounted before the socket reconnected (auth flow
  // disconnects + reconnects). Refresh the seed list against the new socket.
  if (state.hotbar) await refreshSeedCatalog();
}

// Self-position emit loop. Polls the camera's grid coord at a
// throttled cadence; whenever the integer (x, y) changes, fires a
// set-being:coord for the signed-in being so other tabs see them
// move. The server clamps coord to space.size, so walking off the
// grid edge is safe. The loop runs idempotently across navigations.
let _selfPositionTimer = null;
let _lastEmittedCoord = null;
let _selfEmitInflight = false;
const SELF_EMIT_TICK_MS = 100;

function _startSelfPositionLoop() {
  if (_selfPositionTimer) return;
  _selfPositionTimer = setInterval(_tickSelfPosition, SELF_EMIT_TICK_MS);
}

async function _tickSelfPosition() {
  if (_selfEmitInflight) return;
  if (!state.scene || !state.descriptor) return;
  const grid = state.scene.getCurrentGridCoord();
  if (!grid) return;
  if (_lastEmittedCoord &&
      _lastEmittedCoord.x === grid.x &&
      _lastEmittedCoord.y === grid.y) return;
  const desc = state.descriptor;
  if (!desc?.identity?.name || !desc?.address?.pathByNames) return;
  const stance = `${desc.address.pathByNames}@${desc.identity.name}`;
  _selfEmitInflight = true;
  // Record the attempted coord BEFORE the await so a failure path
  // doesn't leave _lastEmittedCoord null — that would make the 100ms
  // poll retry every tick forever while you're standing still on a
  // grid cell the server refuses to accept (auth deny, clamp, etc).
  // The next real movement to a different cell will retry; meanwhile
  // we stop hammering the wire with the same failing emit.
  _lastEmittedCoord = { x: grid.x, y: grid.y };
  try {
    await state.client.do(stance, "set-being", {
      field: "coord",
      value: { x: grid.x, y: grid.y },
    });
  } catch (err) {
    console.warn("[3D] self set-being:coord failed:", err?.message);
  } finally {
    _selfEmitInflight = false;
  }
}

// Move tool. Scene tracks pick-up state and fires onMove only when
// the user commits a put-down (second click). This callback turns
// that commit into the actual `do move` fact. Esc cancels client-
// side; nothing is written.
async function fireMove(intent) {
  if (!intent || !state.descriptor || !state.client) return;
  if (!state.session?.token) {
    setHud("sign in to move things.");
    return;
  }
  const desc = state.descriptor;
  const stance = `${desc.address.pathByNames}@${desc.identity?.name || ""}`;
  // Two modes from the scene's pick-up state machine. coord mode is
  // the everyday case (within the current container); container mode
  // is the "carry it through a doorway" case.
  const args = {
    target: { kind: intent.kind, id: intent.id },
  };
  if (intent.mode === "coord" && intent.coord) {
    args.coord = intent.coord;
  } else if (intent.mode === "container" && intent.to) {
    args.to = intent.to;
  } else {
    return;
  }
  try {
    await state.client.do(stance, "move", args);
    setHud(`moved "${intent.label || intent.id.slice(0,8)}" to ${intent.destLabel || ""}.`);
  } catch (err) {
    console.warn("[3D] move failed:", err?.message || err);
    setHud(`move failed: ${err?.message || "denied"}`);
  }
}

function updateMoveHud(on, carrying) {
  if (!on) {
    setHud("");
    return;
  }
  if (carrying) {
    setHud(`carrying ${carrying.label || carrying.id.slice(0,8)}. click destination, or Esc to cancel.`);
  } else {
    setHud("Move tool: click a tree or matter to pick it up.");
  }
}

// Live SEE events.
//
// "position" delta: skinny per-being movement update from the
// PositionProjection fold. Apply directly to the mesh, no refetch.
// Lower latency than the descriptor round-trip.
//
// Everything else: debounced full-descriptor refetch (the fat
// fallback). Covers create/delete, qualities writes, ownership
// changes, anything the projection delta doesn't carry.
let _refetchTimer = null;
function handleDescriptorEvent(event) {
  if (!state.currentAddress) return;
  if (event?.kind === "position") {
    state.scene.applyPositionDelta(event.payload);
    return;
  }
  // Rung-3 fact-arrival push. Wraps the unwrapped portal-client event
  // back into the {payload:{data}} shape the dispatcher expects . the
  // dispatcher was authored against the raw envelope (so the same
  // module could be reused over a different wire). Don't trigger a
  // descriptor refetch . fact arrivals don't change descriptor shape,
  // only fire animations / sounds on entities already loaded.
  if (event?.kind === "fact") {
    state.factDispatcher?.({ payload: { data: event.payload } });
    return;
  }
  if (_refetchTimer) return; // already scheduled
  _refetchTimer = setTimeout(async () => {
    _refetchTimer = null;
    try {
      const desc = await state.client.see(state.currentAddress);
      state.descriptor = desc;
      state.scene.renderDescriptor(desc, {
        isAuthenticated: !!state.session?.token,
        resetCamera: false,
      });
      refreshAddressBar();
    } catch (err) {
      console.warn("[3D] live refetch failed:", err);
    }
  }, 100); // debounce a touch so a flurry of patches collapses into one render
}

// Async SUMMON reply arrives via `ibp:summon`. Bookkeeping only . the
// activity bubble above the replying being's avatar (driven by the
// server's per-being activity field) shows their reply. Every viewer
// sees the same thing because the source is the substrate, not local
// UI state.
function handleSummon(entry) {
  const correlation = entry?.inReplyTo;
  if (!correlation) return;
  state.pendingSummons.delete(correlation);
}

// In-world video matter reached its end. Fire the role-owned consume
// op; the descriptor refetch will drop the mesh. Currently only the
// llm-assigner tutorial uses this — the op verifies the matter carries
// its marker before deleting.
async function onMatterEnded({ matterId }) {
  if (!state.client || !matterId) return;
  const place = state.discovery?.reality;
  if (!place) return;
  try {
    await state.client.do(`${place}/`, "llm-assigner:complete-tutorial", { matterId });
  } catch (err) {
    console.warn("[3D] llm-assigner:complete-tutorial failed:", err?.code || err?.message || err);
  }
}

// Periodic playback-position update from the in-world video screen.
// Fires every 5s while playing, on pause, and at unmount/navigate.
// Persists to matter.qualities.tutorial.playbackSeconds via a DO op
// so revisits resume at the saved point across browsers and devices.
async function onMatterPlaybackTick({ matterId, currentTime }) {
  if (!state.client?.connected || !matterId) return;
  const place = state.discovery?.reality;
  if (!place) return;
  try {
    await state.client.do(`${place}/`, "llm-assigner:save-playback",
      { matterId, currentTime });
  } catch (err) {
    console.warn("[3D] save-playback failed:",
      err?.code || "", err?.message || err);
  }
}

// Spawn the llm-assigner intro tutorial matter at the place root.
// The DO op is idempotent server-side (marker on qualities.tutorial.purpose)
// so calling it twice returns the existing matter instead of creating
// a duplicate. We ALWAYS re-render after the call — even when `created`
// is false, the descriptor needs to refresh so the mesh shows for the
// current session (a fresh tab won't have rendered it yet).
async function spawnLlmAssignerTutorial() {
  if (!state.client) throw new Error("Not connected");
  if (!state.session?.token) throw new Error("Not authenticated. Sign in via @cherub first.");
  const place = state.discovery?.reality;
  if (!place) throw new Error("No place");

  // After an HMR reload (or any transient disconnect) the panel may
  // open before the socket is back. Give it a short window to reconnect
  // before failing the click.
  if (!state.client.connected) {
    const deadline = Date.now() + 3000;
    while (!state.client.connected && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 100));
    }
    if (!state.client.connected) throw new Error("Portal socket not connected (after 3s)");
  }

  const result = await state.client.do(`${place}/`, "llm-assigner:start-tutorial", {});

  // Always re-fetch — even when created:false, the live descriptor
  // for this client may not have the matter yet.
  if (state.currentAddress) {
    const desc = await state.client.see(state.currentAddress);
    state.descriptor = desc;
    state.scene.renderDescriptor(desc, {
      isAuthenticated: !!state.session?.token,
    });
  }
  return result;
}

async function navigate(address, { fromHistory = false } = {}) {
  if (!state.client) return;
  try {
    // Subscribe live: every change to this position (placements, beings
    // appearing/disappearing, queue state, activity) places as a
    // descriptor event we can refetch on. "/~" goes on the wire as
    // "/~"; the server resolver swaps it for the caller's Being.homeSpace.
    const desc = await state.client.see(address, { live: true });
    state.descriptor = desc;
    state.currentAddress = address;
    // Hand the current spaceId to the scene so the Move tool can
    // resolve "put down here in this space" without an extra
    // descriptor lookup.
    state.scene.setCurrentSpaceId?.(desc?.address?.spaceId || null);
    // Preload every glTF model + sound referenced in the descriptor
    // before the first paint. Models stream over HTTP; on a fresh
    // navigate (or replay start) this prevents the scene from
    // rendering as a sea of placeholder primitives that swap to their
    // gltf piecemeal. Sounds preload in parallel so the first fact
    // arrival doesn't lag. 3 s timeout means even a slow asset never
    // blocks the paint.
    setHud("loading scene...");
    const { collectSoundIds } = await import("./assetResolver.js");
    const soundIds = collectSoundIds(desc);
    await Promise.all([
      state.scene.preloadDescriptor(desc),
      preloadSounds(soundIds),
    ]);
    state.scene.renderDescriptor(desc, {
      isAuthenticated: !!state.session?.token,
    });
    hideActionPanel();
    hideSummonPanel();
    resetSummonState();
    state.currentSummonBeing = null;
    refreshAddressBar();
    setHud(formatLocation(desc, state.session));

    // Two-humans-walking: mark this space as my current position so
    // I appear in other tabs' descriptors (occupantsByPosition scans
    // Being.position == spaceId). Best-effort; ignore failure (the
    // descriptor will refetch on the next live event and pick up
    // whatever coord state landed).
    if (desc?.size && desc?.identity?.beingId && desc?.address?.spaceId) {
      const selfStance = `${desc.address.pathByNames}@${desc.identity.name}`;
      state.client.do(selfStance, "set-being", {
        field: "position",
        value: desc.address.spaceId,
      }).catch((err) => console.warn("[3D] set-being:position failed:", err?.message));
    }
    _lastEmittedCoord = null;
    _startSelfPositionLoop();

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
    placeDomain: state.discovery?.reality,
    pathByNames: state.descriptor?.address?.pathByNames,
    chain: state.descriptor?.address?.chain,
    isAuthenticated: !!state.session?.token,
  });
}

// Gaze handler: child-zone labels and child entry happen inside scene.js.
// All being interaction (cherub + summon) is driven by proximity+gaze in
// onBeingProximity below.
function onGaze(_target, _info) {
  // no-op for now
}

// Proximity dispatcher: fires from scene.js whenever any being's
// proximity+gaze state flips. Cherub opens its action menu (rendered
// generically from the descriptor's actions[]); every other being
// uses its own panel today. Other migrations follow the cherub model.
function onBeingProximity(b, inRange, _distance) {
  if (b.being === "cherub")       return onActionBeingProximity(b, inRange);
  if (b.being === "llm-assigner") return onLlmAssignerProximity(inRange);
  return onChatBeingProximity(b, inRange);
}

// Proximity only CLOSES the action menu when the player walks away or
// looks away. Opening requires an explicit click on the being.
function onActionBeingProximity(b, inRange) {
  if (!inRange) hideActionPanel();
}

function onLlmAssignerProximity(inRange) {
  // The form state (typed values) is preserved across re-opens by the
  // panel module, so dropping the DOM on look-away is non-destructive.
  if (!inRange) hideLlmAssignerPanel();
}

function onChatBeingProximity(b, inRange) {
  if (!inRange) {
    if (state.currentSummonBeing === b.being) {
      hideSummonPanel();
      state.currentSummonBeing = null;
    }
  }
}

// Click-to-activate dispatcher. Fires from scene.js when the player
// clicks while gazing at a being within INTERACT_RANGE.
function onBeingActivate(b) {
  if (b.being === "cherub" || b.being === "birther") {
    // Reality-root identity delegates. Cherub: register/log-in.
    // Birther: mint child. Both carry a `canBe` list; the descriptor
    // turns each entry into an action with its args schema and the
    // form renders it generically.
    openActionMenu(b);
  } else if (b.being === "role-manager") {
    // role-manager opens the dedicated authoring panel — same shared
    // surface the flat-app uses. The panel reads catalogs from
    // b.catalogs (descriptor.js#buildRoleManagerCatalogs) and writes
    // through DO set-role / DO set-being.
    openRoleManagerPanel(b);
  } else if (b.being === "llm-assigner") {
    openLlmAssignerPanel();
  } else {
    // Any other being: the action menu now includes a synthetic
    // "Inhabit (new tab)" entry alongside the role's actions[] and
    // a fallback summon entry. Substrate's cherub Mode-3 enforces
    // descendant-only auth, so non-descendants get a clean 403.
    openBeingActionMenu(b);
  }
}

// Action menu for non-cherub, non-self beings. Composes the role's
// descriptor-provided actions[] PLUS two synthetic entries:
//   - "Inhabit (new tab)" — calls BE:connect via the cherub Mode-3
//     ancestor-relation auth path. The substrate rejects if the
//     target isn't a descendant of the caller; on success it returns
//     a fresh token and we open a new browser tab driving the target.
//   - "Summon" — open the SUMMON panel for free-form chat (the prior
//     default behavior when no actions surfaced).
function openBeingActionMenu(b) {
  const reality = state.discovery?.reality;
  const path = state.descriptor?.address?.pathByNames || "/";
  const address = `${reality}${path}@${b.being}`.replace(/\/+@/, "/@");
  const fullBeing = state.descriptor?.beings?.find((bb) => bb.being === b.being) || b;
  const roleActions = Array.isArray(fullBeing.actions) ? fullBeing.actions.slice() : [];

  // Synthetic entries. Tagged with __synthetic so the action-form
  // dispatch can fork; the rest of the action shape (verb/action/
  // label/args) matches the on-the-wire form.
  const inhabitAction = {
    verb:        "be",
    action:      "connect",
    label:       "Inhabit (new tab)",
    description: "Open a new tab driving this being. Only allowed when this being is in your lineage.",
    args:        {},  // no inputs — auth carries via lineage
    __synthetic: "inhabit",
  };
  const summonAction = {
    verb:        "summon",
    action:      "summon",
    label:       "Summon",
    description: "Open a chat with this being.",
    args:        {},
    __synthetic: "summon",
  };

  const composed = [...roleActions, inhabitAction, summonAction];
  showActionMenu({ ...fullBeing, actions: composed }, {
    onActionPicked: (action) => {
      if (action.__synthetic === "inhabit") return doInhabit(b, address);
      if (action.__synthetic === "summon")  { openSummonPanel(b); return; }
      openActionForm({ ...fullBeing, actions: composed }, action, address);
    },
    onClose: () => {},
  });
}

async function doInhabit(b, address) {
  hideActionPanel();
  setHud(`inheriting @${b.being}...`);
  try {
    const ack = await state.client.be("connect", address, {});
    const token = ack?.identityToken;
    const name  = ack?.name || b.being;
    if (!token) {
      setHud(`inhabit failed: no token returned`);
      return;
    }
    const blob = encodeURIComponent(JSON.stringify({
      placeUrl:        state.session?.placeUrl || defaultPlaceUrl(),
      placeIsProxied:  shouldUseProxy(state.session?.placeUrl || defaultPlaceUrl()),
      token,
      username:        name,
      beingAddress:    ack.beingAddress || `${state.discovery.reality}/@${name}`,
      inherited:       true,
      // Who authorized the inhabit. The new tab listens on a
      // BroadcastChannel for the spawner's pagehide announcement;
      // when the spawner tab closes, the inheriter releases itself
      // (inhabit is a borrowed presence — closing the lender ends
      // the lease).
      spawnerName:     state.session?.username || null,
    }));
    const url = `${window.location.pathname}#inhabit=${blob}`;
    window.open(url, "_blank");
    setHud(`opened new tab for @${name}`);
  } catch (err) {
    setHud(`inhabit failed: ${err.code || ""} ${err.message || err}`);
  }
}

// Generic action menu + form. Reads the being's `actions[]` from the
// descriptor; user picks one, fills the form, submit dispatches the
// verb. Substrate-driven . the portal doesn't know what cherub is or
// what `birth` does, just renders what the server says is available.
function openActionMenu(b) {
  const reality = state.discovery?.reality;
  const path = state.descriptor?.address?.pathByNames || "/";
  // Reality-root identity delegates address as <reality>/@<name>
  // (bare-place stance). Other beings address against the current path.
  // role-manager is also a root delegate but has its own panel and
  // never reaches openActionMenu — kept off this list.
  const isRootDelegate =
    b.being === "cherub" || b.being === "birther";
  const address = isRootDelegate
    ? `${reality}/@${b.being}`
    : `${reality}${path}@${b.being}`.replace(/\/+@/, "/@");
  // The scene's mesh.userData carries a trimmed being shape (no actions).
  // Pull the full descriptor entry so the renderer sees actions[].
  const fullBeing = state.descriptor?.beings?.find((bb) => bb.being === b.being) || b;
  showActionMenu(fullBeing, {
    onActionPicked: (action) => openActionForm(fullBeing, action, address),
    onClose: () => {},
  });
}

function openActionForm(b, action, address, { error = null } = {}) {
  showActionForm(action, {
    error,
    onCancel: () => openActionMenu(b),
    onSubmit: async (values) => {
      // Show busy state while the verb dispatches.
      showActionForm(action, { busy: true, error: null });
      try {
        if (action.verb === "be") {
          const result = await state.client.be(action.action, address, values);
          // Cherub's BE flows swap the active session — birth from
          // arrival becomes the new identity, connect with credentials
          // becomes the bound being, release drops the binding.
          // Self-births (clicking your own avatar to mint a child) do
          // NOT replace your session — the child is a new being but
          // the parent stays the parent. Branch on b.being.
          const isCherubAuthFlow = b.being === "cherub";
          if (isCherubAuthFlow && (action.action === "birth" || action.action === "connect")) {
            const newSession = {
              placeUrl:        state.session?.placeUrl || defaultPlaceUrl(),
              placeIsProxied:  shouldUseProxy(state.session?.placeUrl || defaultPlaceUrl()),
              token:           result.identityToken,
              username:        result.name || values.name,
              beingAddress:    result.beingAddress,
            };
            saveSession(newSession);
            state.session = newSession;
            state.client.disconnect();
            hideActionPanel();
            await connectAndPlace(newSession);
            return;
          }
          if (isCherubAuthFlow && action.action === "release") {
            await logout();
            hideActionPanel();
            return;
          }
          // Self-birth (or any non-cherub BE): the moment seals, the
          // child being row materializes, the descriptor will refresh
          // on the next navigate. Close the panel and tell the user.
          if (!isCherubAuthFlow && action.action === "birth") {
            setHud(`minted @${result.name || values.name}`);
          }
          hideActionPanel();
        } else if (action.verb === "do") {
          await state.client.do(address, action.action, values);
          hideActionPanel();
        } else if (action.verb === "summon") {
          await state.client.summon(address, { content: values.content || "", from: address });
          hideActionPanel();
        } else if (action.verb === "see") {
          await state.client.see(address);
          hideActionPanel();
        } else {
          throw new Error(`unknown verb "${action.verb}"`);
        }
      } catch (err) {
        // Re-render the form with the error; user fixes inputs and retries.
        openActionForm(b, action, address, {
          error: `${err.code || "error"}: ${err.message || "submit failed"}`,
        });
      }
    },
  });
}

function openRoleManagerPanel(b) {
  // The shared panel needs an authenticated caller (it writes through
  // DO set-role / DO set-being). If unauthenticated, route to the
  // cherub menu so the user can register first.
  if (!state.session?.token) {
    const cherub = (state.descriptor?.beings || []).find((bb) => bb.being === "cherub");
    if (cherub) openActionMenu(cherub);
    return;
  }
  // Pull the freshest role-manager entry from the descriptor — the
  // scene's userData carries a trimmed shape without `catalogs`.
  const rmEntry = (state.descriptor?.beings || []).find((bb) => bb.being === "role-manager") || b;
  showRoleManagerPanel({
    state,
    beingEntry: rmEntry,
    onClose:    () => {},
  });
}

function openLlmAssignerPanel() {
  // Requires an authenticated being (the server enforces this on every
  // op). If unauthenticated, bounce the user to the cherub action
  // menu (where they pick birth / use).
  if (!state.session?.token) {
    const cherub = (state.descriptor?.beings || []).find((bb) => bb.being === "cherub");
    if (cherub) openActionMenu(cherub);
    return;
  }
  // The Space tab needs a concrete spaceId. We pull it from the live
  // descriptor — when the user is at a tree position, descriptor.address.spaceId
  // is set. Place-root / arrival has spaceId: null and the panel disables
  // the Space tab.
  showLlmAssignerPanel({
    client:         state.client,
    place:           state.discovery.reality,
    currentSpaceId: state.descriptor?.address?.spaceId || null,
    onClose:       () => {},
    // Link in the panel: fires the llm-assigner:start-tutorial DO,
    // then re-fetches the descriptor so the new matter's 3D video
    // screen appears in the scene. Server-side marker enforces
    // one-at-a-time (idempotent).
    onSpawnTutorial: spawnLlmAssignerTutorial,
  });
}

function openSummonPanel(b) {
  state.currentSummonBeing = b.being;
  showSummonPanel({
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
  hideSummonPanel();
  state.currentSummonBeing = null;
  const reality = state.discovery.reality;
  const path = state.descriptor.address?.pathByNames || "/";
  // Stance form: `<reality>/<path>@<being>`. When path is "/" the slash
  // is already present, so `${reality}${path}@...` collapses to
  // `<reality>/@...` (the canonical form for reality/home-root beings).
  const stance = `${reality}${path}@${b.being}`.replace(/\/+@/, "/@");
  const fromStance = state.session?.username
    ? `${reality}/@${state.session.username}`
    : `${reality}/@arrival`;
  const correlation = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const message = {
    from: fromStance,
    content: text,
    correlation,
  };
  try {
    const reply = await state.client.summon(stance, message);
    if (reply?.status === "accepted") {
      // Async path: the server kicked off the receiving being's moment.
      // The activity bubble above YOUR avatar (driven by your server-
      // side activity field, which now reflects "summoning <target> with
      // this content") shows other players what you just said. The
      // reply, when it lands, shows above the responder's avatar. No
      // local UI state needed.
      state.pendingSummons.set(correlation, b.being);
      return;
    }
    // Sync responses are still rare . the activity refresh on the
    // recipient's mesh will surface the reply prose. Nothing else to do.
  } catch (err) {
    // Errors surface in the summon panel's error display; the activity
    // bubble path stays substrate-driven.
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
    if (state.currentSummonBeing) {
      hideSummonPanel();
      state.currentSummonBeing = null;
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
// position. Bounces the user to auth if unauthenticated (the seed
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

  const reality = state.discovery.reality;
  const path = state.descriptor.address?.pathByNames || "/";
  const parentAddress = `${reality}${path}`.replace(/\/+$/, "") || reality;

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
  if (isActionPanelOpen()) return true;
  if (isRoleManagerPanelOpen()) return true;
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
    || `${state.discovery.reality}/@${state.session.username}`;
  try {
    await state.client.be("release", stance, { identity: state.session.token });
  } catch (err) {
    // Even if the server says no, drop the client-side session.
    console.warn("[3D] release returned", err?.code || err?.message);
  }
  clearSession();
  state.session = null;
  state.client.disconnect();
  await connectAnonymous(defaultPlaceUrl(), shouldUseProxy(defaultPlaceUrl()));
}

async function onEnter(target) {
  if (!target?.address) return;
  setHud(`entering ${target.address}...`);
  await navigate(target.address);
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

// One-shot inhabit handoff. When the flat-app or this app opens a
// new tab via the lineage panel's "inhabit" action, it stashes the
// child's session blob in the URL hash as `#inhabit=<json>`. The new
// tab consumes the hash on boot, copies into sessionStorage (per-tab,
// not shared), clears the hash, and runs as the inheriter without
// clobbering the parent tab's localStorage session. The constants
// INHABIT_HASH / INHERITER_FLAG and the `_isInheriterTab` flag are
// declared above the `state` initializer earlier in this file — they
// must exist before loadSession runs.
function consumeInhabitHash() {
  const hash = location.hash.replace(/^#/, "");
  if (!hash.startsWith(INHABIT_HASH)) return null;
  let parsed = null;
  try {
    const raw = decodeURIComponent(hash.slice(INHABIT_HASH.length));
    parsed = JSON.parse(raw);
  } catch { parsed = null; }
  history.replaceState(null, "", location.pathname);
  if (!parsed?.token) return null;
  sessionStorage.setItem(INHERITER_FLAG, "1");
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(parsed));
  _isInheriterTab = true;
  return parsed;
}

function loadSession() {
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

// Inheriter tabs release their connect when the tab closes. Best-
// effort — pagehide gives ~milliseconds; the BE goes out fire-and-
// forget. The next inhabit of the same child will overwrite
// inhabitedBy via its own connect reducer, so a dropped release
// repairs itself.
window.addEventListener("pagehide", () => {
  if (!_isInheriterTab) return;
  try {
    if (!state.client || !state.discovery?.reality || !state.session?.username) return;
    const stance = `${state.discovery.reality}/@${state.session.username}`;
    state.client.be("release", stance, {}).catch(() => {});
  } catch { /* defensive */ }
});

// ── Parent-presence channel. ──────────────────────────────────────
// Inhabit is a borrowed presence: the inheriter tab runs on a token
// authorized by the parent tab's session. When the parent closes,
// the borrowed body should release — the lender went home, the
// lease ends. BroadcastChannel lets the parent broadcast "leaving"
// on pagehide and inheriter tabs on the same origin receive it.
//
// Sender (any non-inheriter tab):
//   pagehide → broadcast { type: "parent-leaving", username }
//
// Receiver (inheriter tab):
//   listen → if msg.username === sessionStorage.spawnerName,
//             fire BE:release on self + clearSession + reload.
const PRESENCE_CHANNEL = "treeos-portal-3d-presence";
const SPAWNER_KEY      = "treeos-portal-3d-spawner";
let _presence = null;
try { _presence = new BroadcastChannel(PRESENCE_CHANNEL); }
catch { /* old browser; fall through with no cross-tab cascade */ }

// Inheriter tab side: persist the spawner name on first boot, then
// listen for the parent's leaving broadcast.
if (_isInheriterTab) {
  // The inhabit blob carried spawnerName; loadSession stashed it in
  // sessionStorage. Persist a tab-local copy under SPAWNER_KEY so
  // subsequent reloads of the inheriter tab keep the binding.
  const stashed = (() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw)?.spawnerName || null : null;
    } catch { return null; }
  })();
  if (stashed) sessionStorage.setItem(SPAWNER_KEY, String(stashed));
  if (_presence) {
    _presence.addEventListener("message", async (ev) => {
      const msg = ev?.data;
      if (!msg || msg.type !== "parent-leaving") return;
      const mySpawner = sessionStorage.getItem(SPAWNER_KEY);
      if (!mySpawner || msg.username !== mySpawner) return;
      // Lender went home. Release the borrowed body and reload as
      // anonymous so the user re-enters through cherub.
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
}

// Parent (non-inheriter) tab side: broadcast on close so any
// inheriter tabs spawned from this session release themselves.
window.addEventListener("pagehide", () => {
  if (_isInheriterTab) return;
  if (!_presence)      return;
  const username = state.session?.username || null;
  if (!username)       return;
  try { _presence.postMessage({ type: "parent-leaving", username }); } catch {}
});

function defaultPlaceUrl() {
  return "http://localhost:3000";
}

function shouldUseProxy(placeUrl) {
  if (!placeUrl) return true;
  return placeUrl.includes("localhost") || placeUrl.includes("127.0.0.1");
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
  return `${who} | ${desc?.address?.place || ""}${where}`;
}

window.__portal3d = state;
