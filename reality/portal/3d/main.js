// TreeOS Portal 3D — entry.
//
// Speaks IBP via the shared PortalClient. Renders the addressed Position
// as a 3D scene. See ../README.md (../../3d/README.md) for the full design.

import { PortalClient } from "./portal-client.js";
import { Scene } from "./scene.js";
import { mountIbpConsole } from "./ibp-console.js";
import { mountBranchBar } from "./branch-bar.js";
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
import {
  showBeingFlowPanel,
  hideBeingFlowPanel,
  isBeingFlowPanelOpen,
} from "./being-flow-panel.js";
import { ensureUnlockOverlay, preloadSounds } from "./audioPlayer.js";
import { createFactDispatcher } from "./factDispatcher.js";
import {
  openFlatPanel,
  closeFlatPanel,
  toggleFlatPanel,
  isFlatPanelOpen,
  mountFlatPanelButton,
} from "./flat-panel.js";

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
  // Active being from interaction: set when the summon panel opens
  // on a being, when the action menu opens on a being, or when the
  // flat-panel inspector focuses on one. Carries `{ beingId, name,
  // lastSetAt }`. Cleared on navigate() (new space, new context).
  // Persists across flat-panel toggle — that's how text mode opens
  // pre-focused on the same being the user was acting with.
  selectedBeing: null,
  // Last navigated address that wasn't a heaven child (`./beings`,
  // `./operations`, etc.). Updated by navigate() whenever the target
  // is a "real" place — somewhere the 3D scene can render meaningfully.
  // Read by closeFlatPanel: if the flat view is closing on a heaven
  // child (e.g. the user opened text mode to browse the operations
  // catalog), the 3D restores to this address rather than landing on
  // the heaven catalog (which 3D has no scene for).
  lastNonHeavenAddress: null,
  // Set of descriptor-update subscribers. Anyone (the flat panel
  // today, more later) can subscribe via subscribeDescriptor(fn);
  // every navigate / descriptor refresh fans out to all listeners.
  _descriptorListeners: new Set(),
  // Verbose console logging for live event arrivals. Set true from
  // devtools (state.debugLiveEvents = true) when investigating "the
  // timeline isn't updating live" issues — every push the server
  // sends gets logged with its kind + spaceId so we can tell if the
  // wire is even delivering, vs. the refresh handler dropping it.
  debugLiveEvents: true,
};

// Expose for browser-console debugging. Access as window.__state from
// devtools to inspect descriptor, scene meshes, current address, etc.
// Safe to ship . the same data is available over the IBP socket the
// portal is already using, and the user can already see the rendered
// version.
if (typeof window !== "undefined") {
  window.__state = state;
}

// Fan-out helper. Anyone (flat panel today) who needs descriptor
// updates calls subscribeDescriptor(fn) and is added to the listener
// set; navigate() and the live-refetch path call _fireDescriptorListeners
// after updating state.descriptor. Errors in a listener are swallowed
// so one buggy subscriber can't break the others.
function _fireDescriptorListeners(desc) {
  if (!desc) return;
  for (const fn of state._descriptorListeners) {
    try { fn(desc); } catch (err) {
      console.warn("[3D] descriptor listener error:", err?.message);
    }
  }
}

export function subscribeDescriptor(fn) {
  if (typeof fn !== "function") return () => {};
  state._descriptorListeners.add(fn);
  return () => state._descriptorListeners.delete(fn);
}

// Set the active being (the one the user is interacting with). Called
// from summon-panel open, action-menu open, and from the flat
// panel's inspector. Persists across flat-panel toggle so text mode
// opens pre-focused on the same being the user was acting with.
// Cleared on navigate() to a different space (see navigate()).
export function setSelectedBeing(beingId, name) {
  if (!beingId) {
    state.selectedBeing = null;
    return;
  }
  state.selectedBeing = {
    beingId: String(beingId),
    name:    name || null,
    lastSetAt: new Date().toISOString(),
  };
}

// Heaven children — the catalog / registry spaces (`./beings`,
// `./operations`, `./roles`, `./threads`, `./extensions`, plus the
// system-set `./identity` / `./config` / `./peers` / `./tools` /
// `./source`) — are text-mode-only views. The 3D scene has nothing
// meaningful to render at them. navigate() still lets the address
// bar / flat panel walk there (they're real substrate spaces with
// real descriptors), but the 3D portal tracks the "last real place"
// so closing the flat panel can restore the user there instead of
// landing on an empty catalog scene.
//
// Heaven is the `.` space; its children live at `/./<name>`. The
// detector also catches per-being synthetic views (`/.acts/<id>`,
// `/.reel/...`, `/.branches`) which similarly can't render in 3D —
// the 3D portal "real place" we restore to is always a navigable
// position, not a catalog of any kind.
export function isHeavenChildAddress(address) {
  if (typeof address !== "string" || address.length === 0) return false;
  // Strip any branch qualifier (`<reality>#<branch>/...`) and reality
  // prefix before checking the path.
  const noBranch = address.replace(/#[^/]+/, "");
  const slash = noBranch.indexOf("/");
  const path = slash >= 0 ? noBranch.slice(slash) : noBranch;
  // Any path starting with `/.` is heaven, a heaven child, or a
  // dot-prefixed synthetic catalog — none of which the 3D scene can
  // meaningfully render. Covers `/.`, `/./X`, and `/.X` forms.
  return path.startsWith("/.");
}

// Adapter object the flat panel uses to reach state, scene, and
// navigation without main.js exporting a wide surface. Built once
// and reused; flat-panel reads through it.
const L = {
  get state()  { return state; },
  get scene()  { return state.scene; },
  navigate,
  signIn:  (op, name, password) => _flatSignIn(op, name, password),
  signOut: () => _flatSignOut(),
  subscribeDescriptor,
  isHeavenChildAddress,
};

async function _flatSignIn(op, name, password) {
  if (op !== "birth" && op !== "connect") {
    throw new Error(`flat signIn: unsupported op "${op}"`);
  }
  if (!state.client) throw new Error("flat signIn: no client");
  const reality = state.discovery?.reality;
  if (!reality) throw new Error("flat signIn: no reality");
  const result = await state.client.be(op, reality, { name, password });
  const session = {
    placeUrl:       state.session?.placeUrl || defaultPlaceUrl(),
    placeIsProxied: shouldUseProxy(state.session?.placeUrl || defaultPlaceUrl()),
    token:          result.identityToken,
    username:       result.name || name,
    beingAddress:   result.beingAddress,
    // Home space the new being was placed in. Used to land the camera at
    // home right after register, before identity.position/homeSpace fold
    // into the descriptor (the race that stranded new beings at root).
    homeSpaceId:    result.homeSpaceId || null,
  };
  saveSession(session);
  state.session = session;
  state.client.disconnect();
  await connectAndPlace(session);
  return result;
}

async function _flatSignOut() {
  if (!state.session?.token) return;
  const stance = state.session.beingAddress
    || `${state.discovery?.reality}/@${state.session.username}`;
  try {
    await state.client.be("release", stance, {});
  } catch (err) {
    console.warn("[3D] flat signOut release failed:", err?.code || err?.message);
  }
  clearSession();
  state.session = null;
  try { state.client.disconnect(); } catch {}
  await connectAnonymous(defaultPlaceUrl(), shouldUseProxy(defaultPlaceUrl()));
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
    onMatterActivate: (matter) => onMatterActivate(matter),
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
    onToggleFlatPanel: () => toggleFlatPanel(L),
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

  // Mount the branch-and-timeline bar at the bottom of the screen.
  // navigate() pings .update(desc) on every refresh; the bar renders
  // the branch graph + time-anchored timeline and dispatches custom
  // events for rewind / return-to-now / branch-here that we wire below.
  state.branchBar = mountBranchBar({
    client:  state.client,
    reality: state.discovery?.reality || "treeos.ai",
  });

  // Standalone letters-mode toggle, below the "Branches" button. The address
  // bar previously hid this as a 4-letter "text" button at the far
  // right edge; making it a fixed-position button gives it air and
  // a clearer label. Both buttons share the same left column; flat-
  // panel.js hides them while the panel is up.
  mountFlatPanelButton(L);

  // Rewind / return / branch-here events flow back through navigate().
  // Rewinding means re-SEEing the current position with an at:
  // qualifier; the descriptor builder threads `until` through every
  // internal fold call so the whole world rewinds together.
  window.addEventListener("branchbar:rewind", async (ev) => {
    if (!state.currentAddress) return;
    const atTimestamp = ev?.detail?.atTimestamp;
    if (!atTimestamp) return;
    try {
      const desc = await state.client.see(state.currentAddress, {
        at: { atTimestamp },
      });
      state.descriptor = desc;
      state.scene.setCurrentSpaceId?.(desc?.address?.spaceId || null);
      // resetCamera:false — rewinding is "same place, different
      // time," not a navigate. Snapping the camera back to the
      // self-spawn point every scrub would lose the angle the user
      // set up; they're studying the past, not moving.
      state.scene.renderDescriptor(desc, {
        isAuthenticated: !!state.session?.token,
        resetCamera: false,
      });
      state.branchBar?.update(desc);
      // Address bar + scene visual cue follow rewind — the chip should
      // reflect "you are looking at the past on #<branch>" and the
      // canvas should desaturate so the user can never miss it.
      refreshAddressBar();
      _setHistoricalVisualCue(true);
      // Sun + moon stay pinned to wall-clock real time even during
      // rewind (per user request). The cloud drift handles the
      // "we're in the past" visual cue — winds flow backward when
      // rewinding and stop when paused in past — via
      // branchbar:cloud-scale below. So no setFrozenTime call here.
      setHud(`rewound to ${atTimestamp}`);
    } catch (err) {
      console.warn("[3D] rewind failed:", err?.message);
    }
  });
  window.addEventListener("branchbar:now", async (ev) => {
    // Same address, no at-qualifier → live again. `preserveCamera`
    // distinguishes "user clicked return-to-now" (default — camera
    // resets to the spawn vantage) from "fast-forward playback caught
    // up to present" (preserveCamera:true — keep the user's current
    // angle since they were just continuously watching the scene).
    const preserveCamera = ev?.detail?.preserveCamera === true;
    if (state.currentAddress) {
      if (preserveCamera) {
        try {
          const desc = await state.client.see(state.currentAddress);
          state.descriptor = desc;
          state.scene.setCurrentSpaceId?.(desc?.address?.spaceId || null);
          state.scene.renderDescriptor(desc, {
            isAuthenticated: !!state.session?.token,
            resetCamera: false,
          });
          state.branchBar?.update(desc);
          refreshAddressBar();
        } catch (err) {
          console.warn("[3D] resume-live (preserveCamera) failed:", err?.message);
        }
      } else {
        navigate(state.currentAddress);
      }
    }
    _setHistoricalVisualCue(false);
    // (Sun + moon were never pinned — they already follow wall-clock.
    // Clouds reset to forward 1× via branchbar:cloud-scale.)
  });

  // Cloud-drift scale follows playback. The branchbar dispatches
  // branchbar:cloud-scale whenever playbackSpeed or atTimestamp
  // changes; the scene reads the factor and applies it in
  // _driftClouds. Mapping (from branch-bar.js _emitCloudFactor):
  //   live, no playback       → 1   (normal forward drift)
  //   paused in past          → 0   (frozen world, frozen clouds)
  //   playing forward 2x/4x/8x → 2/4/8
  //   rewinding 1x/2x/4x/8x   → -1/-2/-4/-8 (winds blow backward)
  window.addEventListener("branchbar:cloud-scale", (ev) => {
    const f = Number(ev?.detail?.factor);
    state.scene?.setCloudTimeScale?.(Number.isFinite(f) ? f : 1);
  });

  // Optimistic pause-state sync. When the branch tree's pause button
  // gets clicked, it dispatches this event BEFORE the DO round-trips
  // so the chrome flips immediately. The subsequent navigate (or the
  // next branchBar.update fetching the catalog) confirms the
  // persisted state.
  window.addEventListener("branchbar:paused-self", (ev) => {
    _setPausedVisualCue(!!ev?.detail?.paused);
  });

  // Branch-tree clicks set `location.hash` to the target branch's
  // address; this listener turns that into a real navigate. Without
  // this the URL changes silently and the descriptor stays put.
  // Inhabit-hash and inheriter flows have their own consume paths
  // earlier in boot, so by the time this runs only branch-switch
  // hashes flow through.
  window.addEventListener("hashchange", () => {
    const raw = location.hash.replace(/^#/, "");
    if (!raw) return;
    // Inhabit / inheriter hashes carry an "=" payload; ignore them.
    if (raw.startsWith("inhabit=")) return;
    navigate(raw);
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
    // Share the same panel-aware predicate the scene uses so wheel /
    // key events that fire over any open overlay (flat panel, action
    // menu, role manager, summon dialog, etc.) don't rotate the
    // hotbar selection in the background.
    isInputBlocked: isGameplayInputBlocked,
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
    // The discovery payload (unauthenticated SEE on .discovery) carries
    // the list of clone bundles registered by extensions. Reading from
    // discovery (not the list-clones DO op) lets the hotbar populate
    // before the operator signs in — DO requires auth, SEE doesn't.
    const full = await state.client.see(`${state.discovery.reality}/.discovery`);
    state.discovery = { ...state.discovery, ...full };

    const clones = Array.isArray(full?.clones) ? full.clones : [];
    console.log(`[3D] ${clones.length} clone bundle(s) available:`, clones.map((c) => c.name));

    // Slot 0 is the built-in Move tool — intrinsic to the portal.
    // Slot 1 is the built-in Portal tool — forms a portal Matter at
    // the current position pointing at a foreign IBPA (cross-reality
    // OR cross-branch). The viewer's experience through the portal is
    // emergent per-being from foreign-side stance auth: SEE → render
    // through, +DO → reach through, +BE → walk through. Black window
    // if SEE refused. See seed/CROSS-WORLD.md + materials/portalOp.js.
    // Slot 2+ are clones registered by extensions.
    const slots = [
      {
        kind: "tool",
        name: "move",
        label: "Move",
        description: "Click an object to pick it up. Click a destination to put it down. Esc to cancel.",
      },
      {
        kind: "op",
        name: "form-portal",
        label: "Portal",
        action: "form-portal",
        description: "Form a portal at the current position. Prompts for a foreign IBPA target (e.g. \"localhost#1a/<spaceId>\" or \"bing.com/library\").",
        parameters: [
          { name: "target", description: "Foreign IBPA (e.g. \"bing.com#0/library\")" },
          { name: "name",   description: "Portal name (optional)" },
        ],
      },
      {
        kind: "op",
        name: "set-model",
        label: "Space model",
        action: "set-model",
        description: "Set this space's 3D model (its body in the parent scene), or a default model for all matter of one type here. Pass a model matter id (browse /skins).",
        parameters: [
          { name: "modelMatterId", description: "Model matter id (copy one from /skins)" },
          { name: "forMatterType", description: "Optional: apply as the default for all matter of this TYPE in the space (leave empty to set the space's own model)" },
        ],
      },
      {
        kind: "tool",
        name: "upload-model",
        label: "Upload model",
        description: "Upload a .glb and wear it: the file lands in the /skins catalog as model matter, then sets your being's body.",
      },
      ...clones.map((c) => ({
        kind:        "clone",
        name:        c.name,
        label:       c.name.split(":").pop(),
        description: c.sourceScopeName
          ? `Graft "${c.sourceScopeName}" from ${c.ownerExtension} (${c.counts.spaces}s/${c.counts.beings}b/${c.counts.matter}m).`
          : `Graft a clone from ${c.ownerExtension}.`,
        parameters:  c.parameters || [],
      })),
    ];
    state.hotbar?.setSlots(slots);
    if (clones.length === 0) {
      setHud("no graftable clones registered on this place");
    }
  } catch (err) {
    console.warn("[3D] discovery fetch failed:", err?.message || err);
  }
}

// Ghost-mode guard. When the user is looking at a past moment
// (state.descriptor.isHistorical === true), every DO/SUMMON/BE is
// blocked at the client boundary. The camera still moves locally
// (scene.js owns that), but no facts get stamped — the past is
// observation only. Returning to "now" makes the guard fall through.
//
// One exception. `create-branch` IS the legitimate past-time DO —
// branching is how the past stays causally accessible without
// retconning the existing reel. The button in the timeline strip
// must reach the substrate even when the view is historical.
const GHOST_ALLOWED_DO_ACTIONS = new Set(["create-branch"]);
function _ghostGuard(client) {
  for (const verb of ["do", "summon", "be"]) {
    const original = client[verb].bind(client);
    client[verb] = async (...args) => {
      if (state.descriptor?.isHistorical) {
        if (verb === "do" && GHOST_ALLOWED_DO_ACTIONS.has(args[1])) {
          return await original(...args);
        }
        setHud(`ghost view — ${verb.toUpperCase()} suspended. return to now to act.`);
        const err = new Error(`${verb.toUpperCase()} blocked: viewing the past`);
        err.code = "GHOST_VIEW";
        throw err;
      }
      return await original(...args);
    };
  }
  return client;
}

async function connectAnonymous(placeUrl, useProxy) {
  state.client = _ghostGuard(new PortalClient({
    placeUrl,
    token: null,
    useProxy,
    onConnectionChange: (status) => setHud(`socket: ${status}`),
    onSummon: handleSummon,
    onDescriptorEvent: handleDescriptorEvent,
    // Server "branch" pushes (handshake + every BE switch) keep the
    // full-address chip's LEFT stance truthful.
    onBranchChange: () => state.branchBar?.refreshAddress?.(),
  }));
  state.scene?.setClient?.(state.client);
  state.client.connect();
  await waitForConnect(state.client);
  // Point the branch bar at the live socket (it may have been mounted
  // with a previous client). No-op at first boot — the bar mounts after
  // this connect — but load-bearing on sign-out's reconnect.
  state.branchBar?.setClient(state.client, state.discovery?.reality);
  // Restore last view from URL hash if present; else land at "/".
  // Anonymous SEE on a non-existent space still throws SPACE_NOT_FOUND,
  // so wrap the navigate and fall back to "/" on substrate-gone errors.
  // FORBIDDEN/UNAUTHORIZED also fall back — a stale hash pointing at a
  // private tree (e.g., the user's own home from a prior session) would
  // otherwise leave arrival stuck on a deny screen with no way out.
  const ANON_HASH_FALLBACK_CODES = new Set([
    ...STALE_SESSION_CODES,
    "FORBIDDEN",
  ]);
  const restored = _restoreAddressFromHash() || "/";
  try {
    await navigate(restored);
  } catch (err) {
    if (ANON_HASH_FALLBACK_CODES.has(err?.code) && restored !== "/") {
      try { history.replaceState(null, "", location.pathname); } catch {}
      try { await navigate("/"); } catch {}
    }
  }
}

// Error codes that mean "this saved session no longer corresponds to
// real substrate" — typically because the operator reset the DB, but
// also covers a deleted being, a tombstoned home, or a JWT secret
// rotation. Anything in this set drops the stored session and reconnects
// anonymously instead of leaving a "ghost user" chip in the address bar.
const STALE_SESSION_CODES = new Set([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NODE_NOT_FOUND",
  "BEING_NOT_FOUND",
  "SPACE_NOT_FOUND",
  // A hash/session pinned to a branch that no longer exists (e.g. the DB
  // was reset, or the branch was deleted). Treat like a stale pointer:
  // clear the bad address and fall back to main instead of looping SEEs
  // and storming set-being:position retries against the gone branch.
  "BRANCH_NOT_FOUND",
  // A stale branch qualifier in the hash can surface as cross-branch
  // (the freshly-connected socket is on #0 while the address still
  // carries #N) BEFORE existence is even checked. Same recovery: clear
  // the address and drop to main rather than leaving the user wedged on
  // a branch they can't act on (register/DO bounce with this code).
  "CROSS_BRANCH_FORBIDDEN",
]);

async function _dropStaleSessionAndReconnect(session) {
  console.warn("[3D] stored session is no longer valid; dropping it.");
  clearSession();
  state.session = null;
  try { state.client.disconnect(); } catch {}
  const placeUrl = session.placeUrl || defaultPlaceUrl();
  // Clear the URL hash too — it may point at a space that no longer
  // exists on the fresh DB, and the anonymous landing should start
  // clean at "/", not retry the dead address.
  try { history.replaceState(null, "", location.pathname); } catch {}
  await connectAnonymous(placeUrl, shouldUseProxy(placeUrl));
}

async function connectAndPlace(session) {
  state.client = _ghostGuard(new PortalClient({
    placeUrl: session.placeUrl,
    token: session.token,
    useProxy: session.placeIsProxied,
    onConnectionChange: (status) => setHud(`${session.username} | ${status}`),
    onSummon: handleSummon,
    onDescriptorEvent: handleDescriptorEvent,
    // Server "branch" pushes (handshake + every BE switch) keep the
    // full-address chip's LEFT stance truthful.
    onBranchChange: () => state.branchBar?.refreshAddress?.(),
  }));
  state.scene?.setClient?.(state.client);
  state.client.connect();
  await waitForConnect(state.client);
  // Point the branch bar at the freshly-authenticated socket. Without
  // this, a first-time register (anonymous boot → mount bar → register →
  // new auth client) leaves the bar querying the dead pre-auth socket,
  // so the branch tree is empty until a page reload.
  state.branchBar?.setClient(state.client, state.discovery?.reality);

  // The token may be stale (expired, signed under a previous JWT_SECRET,
  // or for a being that no longer exists — the common case being the
  // operator reset the DB). The socket accepts the connection regardless;
  // auth-only happens at verb dispatch. Verify explicitly with one SEE
  // on the being's own stance. If the server refuses, drop the local
  // session and reconnect anonymously rather than lie to the user with
  // a stale "tabor" chip.
  const beingAddress = session.beingAddress
    || (session.username && state.discovery?.reality
        ? `${state.discovery.reality}/@${session.username}`
        : null);
  // The being's last-known position (server-side state) is surfaced
  // on the descriptor's identity block. Reuse it to land the camera
  // where the being actually IS, instead of teleporting to / on
  // every login / reconnect.
  //
  // Priority for landing:
  //   1. location.hash (if user refreshed mid-session — restore the
  //      exact view they were on, including branch qualifier)
  //   2. Being's saved position (server-side state)
  //   3. Being's stance address (resolves to home)
  //   4. "/" (place root)
  let landingAddress = _restoreAddressFromHash() || "/";
  let landingFromHash = !!landingAddress && landingAddress !== "/";
  if (beingAddress) {
    try {
      const desc = await state.client.see(beingAddress);
      // Stale-token check. The SEE itself succeeds because the wire
      // can decode the JWT, but the substrate has no row for that
      // beingId (operator dropped the DB, ended the being, etc.).
      // identityBlock surfaces this via `stale: true` so we can
      // drop the cached session BEFORE the navigate path fires
      // set-being:position and bounces with BEING_NOT_FOUND.
      if (desc?.identity?.stale === true) {
        await _dropStaleSessionAndReconnect(session);
        return;
      }
      if (!landingFromHash) {
        // Landing priority for an authenticated being:
        //   1. identity.position — the server-tracked current location
        //      (the being's last set-being:position).
        //   2. identity.homeSpace — fallback when position is null
        //      (most commonly: a being who just registered and whose
        //      projection slot hasn't quite caught up to the be:birth
        //      Fact yet, OR a never-moved being). Without this fallback,
        //      the portal would land at the reality root and render the
        //      being's home-grid coord against the root's grid — putting
        //      the avatar far outside the visible area.
        //   3. beingAddress stance — last-resort; resolves to the
        //      reality root via the @qualifier surface. Only reached
        //      if neither position nor homeSpace is known.
        const pos = desc?.identity?.position || null;
        const home = desc?.identity?.homeSpace || null;
        // session.homeSpaceId is the race-proof fallback for a being who
        // JUST registered: cherub returns it synchronously, so even if the
        // be:birth projection hasn't folded into identity.position/homeSpace
        // yet, we still land at the home grid instead of the reality root.
        const targetSpace = pos || home || session.homeSpaceId || null;
        if (targetSpace && state.discovery?.reality) {
          // Space id is a UUID — the resolver accepts UUID paths.
          landingAddress = `${state.discovery.reality}/${targetSpace}`;
        } else {
          landingAddress = beingAddress;
        }
      }
    } catch (err) {
      if (STALE_SESSION_CODES.has(err?.code)) {
        await _dropStaleSessionAndReconnect(session);
        return;
      }
      // Other errors (network, TIMEOUT) — fall through to landing.
    }
  }

  try {
    await navigate(landingAddress);
  } catch (err) {
    // Landing address pointed at substrate that no longer exists
    // (DB reset; tombstoned position; renamed branch). Don't strand
    // the user on a black screen — drop the dead pointer and retry
    // from a known-good fallback.
    if (STALE_SESSION_CODES.has(err?.code)) {
      try { history.replaceState(null, "", location.pathname); } catch {}
      try { await navigate(beingAddress || "/"); }
      catch (err2) {
        if (STALE_SESSION_CODES.has(err2?.code)) {
          await _dropStaleSessionAndReconnect(session);
          return;
        }
      }
    }
  }
  // The hotbar may have mounted before the socket reconnected (auth flow
  // disconnects + reconnects). Refresh the seed list against the new socket.
  if (state.hotbar) await refreshSeedCatalog();
}

// Extract a navigable address from location.hash, ignoring the inhabit
// and inheriter payloads that ride the same channel. Returns null when
// the hash isn't a plain address (or is empty).
function _restoreAddressFromHash() {
  const raw = (typeof location !== "undefined" ? location.hash : "").replace(/^#/, "");
  if (!raw) return null;
  if (raw.startsWith("inhabit=")) return null;
  return raw;
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
// Guard against re-entrant branch-gone recovery in navigate()'s catch.
let _recoveringBranch = false;

function _startSelfPositionLoop() {
  if (_selfPositionTimer) return;
  _selfPositionTimer = setInterval(_tickSelfPosition, SELF_EMIT_TICK_MS);
}

async function _tickSelfPosition() {
  if (_selfEmitInflight) return;
  if (!state.scene || !state.descriptor) return;
  // Historical mode is observer-only. Acting on the world while
  // looking at the past would pollute the present's reel with moves
  // the user didn't intend ("I was reviewing my path when WASD
  // shifted me in the live world"). Freeze emits until they return
  // to now.
  if (state.descriptor.isHistorical) return;
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
  if (state.debugLiveEvents) {
    console.log("[3D] live event:", event?.kind, event?.spaceId?.slice(0, 8));
  }
  // Ghost-view guard: while the user is rewound (state.descriptor.
  // isHistorical === true), live events MUST NOT touch the scene or
  // replace the descriptor. The user is observing a frozen past
  // moment; new facts coming in are present-time noise. Without this
  // guard:
  //   - position events animated avatars to their LIVE coords on top
  //     of the historical scene
  //   - fact events fired animations / sounds tied to facts that
  //     hadn't yet happened at the rewound moment
  //   - the generic refetch did `client.see(addr)` WITHOUT the `at:`
  //     qualifier, replacing state.descriptor with the live one and
  //     dropping the user out of ghost view entirely (the symptom:
  //     "I pause, a new act comes in, and I'm back in the present")
  //
  // What we DO let through is the timeline strip refresh — the strip's
  // "now" line should still slide forward as wall-clock advances and
  // new marks should land on the right edge so the user sees the
  // history accumulating beyond their cursor. The strip is metadata
  // about acts, not the world; updating it doesn't disturb the
  // historical view.
  if (state.descriptor?.isHistorical) {
    _scheduleBranchBarRefresh();
    return;
  }
  if (event?.kind === "position") {
    state.scene.applyPositionDelta(event.payload);
    _scheduleBranchBarRefresh();
    return;
  }
  if (event?.kind === "fact") {
    state.factDispatcher?.({ payload: { data: event.payload } });
    _scheduleBranchBarRefresh();
    return;
  }
  if (_refetchTimer) return; // already scheduled
  _refetchTimer = setTimeout(async () => {
    _refetchTimer = null;
    // Re-check the guard at fire-time — the user could have started
    // rewinding during the debounce window. If state.descriptor is
    // now historical, drop the refetch silently; the rewind owns the
    // descriptor.
    if (state.descriptor?.isHistorical) {
      _scheduleBranchBarRefresh();
      return;
    }
    try {
      const desc = await state.client.see(state.currentAddress);
      state.descriptor = desc;
      _fireDescriptorListeners(desc);
      state.scene.renderDescriptor(desc, {
        isAuthenticated: !!state.session?.token,
        resetCamera: false,
      });
      refreshAddressBar();
      state.branchBar?.update(desc);
    } catch (err) {
      console.warn("[3D] live refetch failed:", err);
    }
  }, 100);
}

// Timeline strip refresh — debounced so a flurry of fact-arrival
// pushes (e.g. a harmony dance floor ticking) collapses into one
// SEE on the acts catalog rather than one per tick.
let _branchBarRefreshTimer = null;
function _scheduleBranchBarRefresh() {
  if (_branchBarRefreshTimer) return;
  _branchBarRefreshTimer = setTimeout(() => {
    _branchBarRefreshTimer = null;
    if (state.descriptor) {
      if (state.debugLiveEvents) console.log("[3D] branchBar.update from live");
      state.branchBar?.update(state.descriptor);
    } else if (state.debugLiveEvents) {
      console.log("[3D] live refresh skipped — no descriptor");
    }
  }, 500);
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
  if (!state.discovery?.reality) return;
  try {
    await state.client.do("/", "llm-assigner:complete-tutorial", { matterId });
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
  if (!state.discovery?.reality) return;
  try {
    await state.client.do("/", "llm-assigner:save-playback",
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
  if (!state.discovery?.reality) throw new Error("Reality not yet discovered");

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

  const result = await state.client.do("/", "llm-assigner:start-tutorial", {});

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
    // Branch-stickiness: if the user is currently on a non-main branch
    // and the target address doesn't already specify one, inject the
    // active branch as a `#<path>` qualifier so walking into a child
    // doesn't silently drop them back to main. Address shapes covered:
    //   "/foo/bar"           → "<reality>#<branch>/foo/bar"
    //   "<reality>/foo"      → "<reality>#<branch>/foo"
    //   "<reality>#X/foo"    → untouched (explicit branch wins)
    address = _withActiveBranch(address);
    // Subscribe live: every change to this position (placements, beings
    // appearing/disappearing, queue state, activity) places as a
    // descriptor event we can refetch on. "/~" goes on the wire as
    // "/~"; the server resolver swaps it for the caller's Being.homeSpace.
    const desc = await state.client.see(address, { live: true });
    // Stale-session mid-flight: the operator dropped the DB while
    // the page was open. The wire still has our JWT but the substrate
    // has no row for the beingId. Drop the session and reconnect
    // anonymously before any DO fires and bounces with BEING_NOT_FOUND.
    if (desc?.identity?.stale === true && state.session) {
      const droppedSession = state.session;
      try { state.client.disconnect(); } catch {}
      clearSession();
      state.session = null;
      try { history.replaceState(null, "", location.pathname); } catch {}
      await connectAnonymous(
        droppedSession.placeUrl || defaultPlaceUrl(),
        shouldUseProxy(droppedSession.placeUrl || defaultPlaceUrl()),
      );
      return;
    }
    // Clear selectedBeing when navigating to a different space — the
    // active being was contextual to the previous position; in a new
    // space the user has no active selection until they pick one. We
    // preserve it across a same-space refresh so a refetch (live
    // event, branch update) doesn't blow away the focus.
    const priorSpaceId = state.descriptor?.address?.spaceId || null;
    const nextSpaceId  = desc?.address?.spaceId || null;
    if (priorSpaceId && nextSpaceId && priorSpaceId !== nextSpaceId) {
      state.selectedBeing = null;
    }
    state.descriptor = desc;
    state.currentAddress = address;
    // Track last navigated address that wasn't a heaven child so the
    // flat panel can restore the user there on close (rather than
    // landing on a heaven catalog the 3D has no scene for).
    if (!isHeavenChildAddress(address)) {
      state.lastNonHeavenAddress = address;
    }
    _fireDescriptorListeners(desc);
    // Live navigate clears the historical visual cue — a rewind that
    // landed here via timeline:rewind sets it; any plain navigate
    // (address bar, child doorway, branch click) takes us to the
    // present and the desaturation must drop.
    _setHistoricalVisualCue(!!desc?.isHistorical);
    // Same idea for the sky pin: a live navigate lifts the frozen
    // sun and resumes wall-clock; a historical SEE keeps any pin
    // the rewind handler set (it owns this state).
    // (setFrozenTime call retired — sun + moon always follow wall-clock,
    // even when viewing the past. The cloud factor handles the past-mode
    // visual via branchbar:cloud-scale.)
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
    // Refresh the branch+timeline bar with this descriptor so the
    // chips reflect the active branch and the slider shows the right
    // time-axis for it.
    state.branchBar?.update(desc);
    hideActionPanel();
    hideSummonPanel();
    resetSummonState();
    state.currentSummonBeing = null;
    refreshAddressBar();
    setHud(formatLocation(desc, state.session));

    // Two-humans-walking: mark this space as my current position so
    // I appear in other tabs' descriptors. Skip in historical mode —
    // a navigate that landed here via a timeline rewind/space-redirect
    // shouldn't write our LIVE position to the past space we're just
    // observing. Live navigation only.
    //
    // The size requirement was wrong: it gated on whether the space
    // has a 2D grid, but a being's position should follow them through
    // every space, sized or not. Without this, walking from a sized
    // space (root) into an unsized one (a synthetic catalog, a tree
    // without size) silently kept position pinned at the prior space,
    // and the user's tree-in-home write never landed because position
    // never advanced past root.
    if (
      !desc?.isHistorical &&
      desc?.identity?.beingId && desc?.address?.spaceId
    ) {
      const selfStance = `${desc.address.pathByNames}@${desc.identity.name}`;
      state.client.do(selfStance, "set-being", {
        field: "position",
        value: desc.address.spaceId,
      }).catch((err) => {
        // Surface the failure to the HUD so silent rejections (auth,
        // cross-branch, malformed stance) don't masquerade as "the
        // portal isn't tracking my walks." This is the seam where
        // every navigate stamps a position fact; if it's not landing
        // on the reel the user reads "no timeline entries for home"
        // and assumes the portal is broken — usually it's the DO
        // bouncing here without anybody seeing the reason.
        const msg = `${err?.code || ""} ${err?.message || err}`.trim();
        console.warn("[3D] set-being:position failed:", msg);
        setHud(`position write failed: ${msg}`);
      });
    }
    _lastEmittedCoord = null;
    _startSelfPositionLoop();

    // Push to history unless we're navigating via back/forward. Store
    // the FULL IBP-form address (reality + branch qualifier + path) so
    // back/forward restores the exact view we were on. The earlier
    // pathByNames-only shape lost the branch and let _withActiveBranch
    // re-inject whatever branch the user is CURRENTLY on, which moved
    // back-navigation to the wrong branch when the user had hopped
    // branches in between.
    if (!fromHistory) {
      const reality = desc?.address?.place || state.discovery?.reality || "";
      const branch = desc?.address?.branch || "0";
      const path = desc?.address?.pathByNames || "/";
      const bq = branch === "0" ? "" : `#${branch}`;
      const canonical = reality
        ? `${reality}${bq}${path === "/" ? "/" : path}`
        : (desc?.address?.pathByNames || address);
      if (state.history[state.historyIndex] !== canonical) {
        // Drop any "forward" history beyond the current index.
        state.history = state.history.slice(0, state.historyIndex + 1);
        state.history.push(canonical);
        state.historyIndex = state.history.length - 1;
      }
    }
    updateHistoryButtons();
    // Mirror the canonical address into location.hash so a page
    // refresh restores the view (and the branch qualifier), and so
    // the browser back/forward + bookmarks act on the actual position.
    // Skip when an inhabit/inheriter payload still owns the hash
    // (those carry "=" + base64 and would corrupt on overwrite).
    _syncLocationHash(desc);
    // Hand the descriptor to the branch-bar so the strip + chrome
    // reflect the just-landed state without waiting for a live event
    // to arrive. Without this, opening the page on a paused branch
    // never fires the paused chrome (no events flow there), and the
    // timeline strip stays blank until something else nudges it.
    state.branchBar?.update(desc);
  } catch (err) {
    setHud(`see failed: ${err.code || ""} ${err.message || ""}`);
    // A navigate to a branch that no longer exists (DB reset, deleted
    // branch, stale hash) self-heals to main rather than stranding the
    // client on the previous descriptor — where the self-position loop
    // keeps firing set-being against the gone branch (the snapshot
    // storm). Clear the bad hash and drop to main once; the re-entry
    // guard stops a loop if main itself somehow fails.
    if ((err?.code === "BRANCH_NOT_FOUND" || err?.code === "CROSS_BRANCH_FORBIDDEN") && !_recoveringBranch) {
      _recoveringBranch = true;
      _lastEmittedCoord = null;
      try { history.replaceState(null, "", location.pathname); } catch {}
      try {
        await navigate(`${state.discovery?.reality || ""}/`);
        return;
      } catch (err2) {
        console.warn("[3D] branch-gone recovery to main failed:", err2?.message || err2);
      } finally {
        _recoveringBranch = false;
      }
    }
    // Re-throw so connect-time handlers (connectAndPlace,
    // connectAnonymous) can fall back when the landing address points
    // at substrate that no longer exists (DB reset, tombstone, etc.).
    throw err;
  }
}

// Frozen-world visual indicators. Two channels — past view (ghost)
// and paused-branch — both desaturate the canvas and pin a chip; the
// chip's text differs by class so the user knows WHY the world is
// frozen. Both apply via <body> classes; index.html styles them.
function _setHistoricalVisualCue(on) {
  if (typeof document === "undefined") return;
  const cls = "ghost-view";
  if (on) document.body.classList.add(cls);
  else    document.body.classList.remove(cls);
}
function _setPausedVisualCue(on) {
  if (typeof document === "undefined") return;
  const cls = "paused-branch";
  if (on) document.body.classList.add(cls);
  else    document.body.classList.remove(cls);
}

function _syncLocationHash(desc) {
  if (typeof location === "undefined") return;
  const existing = location.hash.replace(/^#/, "");
  if (existing.startsWith("inhabit=")) return;
  const reality = desc?.address?.place || state.discovery?.reality || "";
  if (!reality) return;
  const branch = desc?.address?.branch || "0";
  const path = desc?.address?.pathByNames || "/";
  const bq = branch === "0" ? "" : `#${branch}`;
  const next = `${reality}${bq}${path === "/" ? "/" : path}`;
  // Use replaceState so we don't pollute the browser's back-button
  // stack — internal navigation history already tracks that. Only
  // location.hash mutations from branch-tree clicks should add to
  // the browser stack (those already use location.hash = ...).
  if (existing !== next) {
    try { history.replaceState(null, "", `${location.pathname}#${next}`); } catch {}
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

// Inject the user's active branch (#<path>) into an address that
// doesn't already carry one. Returns the original string when the
// active branch is main, when the address already has a `#`, or when
// we have no descriptor yet.
function _withActiveBranch(address) {
  // Doctrine (2026-06-04): the address bar IS the source of truth.
  // When the user types a full address (starts with the reality), the
  // absence of `#` MEANS main, not "inherit my current branch." The
  // server-side expand respects this too — see expandStance in
  // seed/ibp/address.js. Only RELATIVE shorthands (no reality prefix)
  // inherit the active branch, so walking into a child via "/foo" or
  // clicking "~" stays on the current branch without forcing the user
  // to retype #X every time.
  if (typeof address !== "string" || !address) return address;
  if (address.includes("#")) return address;
  const activeBranch = state.descriptor?.address?.branch || "0";
  if (activeBranch === "0") return address;
  const reality = state.discovery?.reality;
  if (!reality) return address;
  // Full typed address: leave it alone. User said "go to <reality>/foo"
  // explicitly — that's main.
  if (address.startsWith(reality)) return address;
  if (address.startsWith("/") || address.startsWith("~")) {
    // Relative shorthand: prepend "<reality>#<branch>" and keep the path.
    return `${reality}#${activeBranch}${address === "/" ? "/" : address}`;
  }
  // Foreign reality or shape we don't recognize — leave untouched.
  return address;
}

function refreshAddressBar() {
  updateAddressBar({
    username: state.session?.username,
    placeDomain: state.discovery?.reality,
    pathByNames: state.descriptor?.address?.pathByNames,
    chain: state.descriptor?.address?.chain,
    isAuthenticated: !!state.session?.token,
    branch: state.descriptor?.address?.branch || "0",
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
  // Branch qualifier matters: when the operator is on a non-main
  // branch and clicks a being, the dispatched address must carry
  // `#<branch>` so the server's cross-branch gate matches the socket's
  // currentBranch. Without it, expand() defaults to the `#main`
  // pointer (typed-reality rule) and the BE/DO/SUMMON wire-layer
  // refuses with CROSS_BRANCH_FORBIDDEN even though the caller is
  // acting on the being from its own branch's view.
  const branch = state.descriptor?.address?.branch || "0";
  const bq = branch === "0" ? "" : `#${branch}`;
  const address = `${reality}${bq}${path}@${b.being}`.replace(/\/+@/, "/@");
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
  const flowAction = {
    verb:        "do",
    action:      "set-being",
    label:       "Edit Role Flow",
    description: "Author this being's roleFlow (conditional role stack evaluated per moment).",
    args:        {},
    __synthetic: "edit-flow",
  };

  const composed = [...roleActions, inhabitAction, flowAction, summonAction];
  // Set this being as the active interaction target. Carries across
  // flat-panel toggle so text mode opens on this being's inspector.
  setSelectedBeing(fullBeing.beingId, fullBeing.being);
  showActionMenu({ ...fullBeing, actions: composed }, {
    onActionPicked: (action) => {
      if (action.__synthetic === "inhabit")   return doInhabit(b, address);
      if (action.__synthetic === "summon")    { openSummonPanel(b); return; }
      if (action.__synthetic === "edit-flow") { openBeingFlowPanel(fullBeing); return; }
      openActionForm({ ...fullBeing, actions: composed }, action, address);
    },
    onClose: () => {},
  });
}

function openBeingFlowPanel(beingEntry) {
  if (!state.session?.token) {
    const cherub = (state.descriptor?.beings || []).find((bb) => bb.being === "cherub");
    if (cherub) openActionMenu(cherub);
    return;
  }
  showBeingFlowPanel({
    state,
    beingEntry,
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

// ── Matter interaction ─────────────────────────────────────────────
//
// Clicking matter opens its action menu — the server-provided
// actions[] (built from the matter's TYPE registry) plus three
// synthetic entries:
//   "Wear this model" — type=model matter only; set-model on your
//                       own being (the skins-catalog click-to-wear).
//   "Set model…"      — point THIS matter at a model matter id
//                       (copy one from /skins).
//   "Copy id"         — the matter's id to the clipboard, for
//                       set-model on spaces/other matter.
// Same renderer the being menus use; matter-targeted DOs ride the
// space address with the reserved matterId payload key.

function currentPositionAddress() {
  const reality = state.discovery?.reality;
  const path = state.descriptor?.address?.pathByNames || "/";
  const branch = state.descriptor?.address?.branch || "0";
  const bq = branch === "0" ? "" : `#${branch}`;
  return `${reality}${bq}${path}`.replace(/\/+$/, "") || `${reality}${bq}`;
}

function selfBeingStance() {
  if (state.session?.beingAddress) return state.session.beingAddress;
  const reality = state.discovery?.reality;
  const branch = state.descriptor?.address?.branch || "0";
  const bq = branch === "0" ? "" : `#${branch}`;
  return `${reality}${bq}/@${state.session?.username}`;
}

function onMatterActivate(m) {
  const full = (state.descriptor?.matters || []).find(
    (x) => String(x.matterId) === String(m.matterId),
  );
  openMatterActionMenu(full ? { ...m, ...full } : m);
}

function openMatterActionMenu(mt) {
  const address = currentPositionAddress();
  const serverActions = Array.isArray(mt.actions) ? mt.actions.slice() : [];

  const entries = [...serverActions];
  if ((mt.type || mt.matterType || "generic") === "model" && state.session?.token) {
    entries.unshift({
      verb:        "do",
      action:      "set-model",
      label:       "Wear this model",
      description: "Set this model as your being's 3D body.",
      args:        {},
      __synthetic: "wear-model",
    });
  }
  entries.push({
    verb:        "do",
    action:      "set-model",
    label:       "Set model…",
    description: "Give this matter a 3D body. Pass a model matter id (browse /skins, Copy id).",
    args: {
      modelMatterId: { type: "text", label: "Model matter id", required: false },
      clear:         { type: "bool", label: "Remove the model", default: false, required: false },
    },
  });
  // http matter navigation. The page on the walk-up screen is shared
  // state: qualities.http.currentUrl, written as a normal set-matter
  // fact, so beings navigate the web TOGETHER and the chain records
  // where they went. content.url stays the immutable default; Reset
  // clears the quality back to it.
  if ((mt.type || "generic") === "http") {
    entries.push({
      verb:        "do",
      action:      "set-matter",
      label:       "Navigate page…",
      description: "Move this screen to a different page (a fact — every being sees the same page).",
      args: {
        url: { type: "text", label: "https:// link to show", required: true },
      },
      __synthetic: "http-navigate",
    });
    if (mt.qualities?.http?.currentUrl) {
      entries.push({
        verb:        "do",
        action:      "set-matter",
        label:       "Reset page",
        description: `Back to the default: ${mt.external?.url || "the original link"}`,
        args:        {},
        __synthetic: "http-reset",
      });
    }
  }

  // Presentation fallbacks. Frame-refusing sites and non-embeddable
  // files (zips, binaries) still open: in a tab, or as a download.
  const openUrl = mt.external?.url || mt.contentUrl || null;
  if (openUrl) {
    entries.push({
      verb:        "do",
      action:      "open-tab",
      label:       "Open in new tab",
      description: openUrl.length > 64 ? `${openUrl.slice(0, 64)}…` : openUrl,
      args:        {},
      __synthetic: "open-tab",
    });
  }
  if (mt.contentUrl && String(mt.contentUrl).startsWith("/api/")) {
    entries.push({
      verb:        "do",
      action:      "download",
      label:       "Download",
      description: "Save this matter's bytes to your device.",
      args:        {},
      __synthetic: "download",
    });
  }
  entries.push({
    verb:        "do",
    action:      "copy-id",
    label:       "Copy id",
    description: "Copy this matter's id to the clipboard (use it with set-model anywhere).",
    args:        {},
    __synthetic: "copy-id",
  });

  showActionMenu(
    { name: mt.name || mt.label || mt.type || "matter", actions: entries },
    {
      onActionPicked: async (action) => {
        if (action.__synthetic === "copy-id") {
          hideActionPanel();
          try {
            await navigator.clipboard.writeText(String(mt.matterId));
            setHud(`copied ${String(mt.matterId).slice(0, 8)}… to clipboard`);
          } catch {
            setHud(`matter id: ${mt.matterId}`);
          }
          return;
        }
        if (action.__synthetic === "open-tab") {
          hideActionPanel();
          window.open(openUrl, "_blank", "noopener");
          return;
        }
        if (action.__synthetic === "http-navigate") {
          openMatterActionForm(mt, {
            ...action,
            __submitShape: (values) => ({
              field: "qualities.http.currentUrl",
              value: /^https?:\/\//i.test(values.url || "") ? values.url : `https://${values.url}`,
            }),
          }, address);
          return;
        }
        if (action.__synthetic === "http-reset") {
          hideActionPanel();
          setHud("resetting page…");
          try {
            await state.client.do(address, "set-matter",
              { field: "qualities.http.currentUrl", value: null },
              { matterId: String(mt.matterId) });
            setHud("page reset to default");
            await navigate(address);
          } catch (err) {
            setHud(`reset failed: ${err.code || ""} ${err.message || ""}`);
          }
          return;
        }
        if (action.__synthetic === "download") {
          hideActionPanel();
          const a = document.createElement("a");
          a.href = mt.contentUrl;
          a.download = mt.name || "";
          document.body.appendChild(a);
          a.click();
          a.remove();
          return;
        }
        if (action.__synthetic === "wear-model") {
          hideActionPanel();
          if (!state.session?.token) { setHud("sign in first."); openAuthPanel(); return; }
          setHud("wearing model…");
          try {
            await state.client.do(selfBeingStance(), "set-model", { modelMatterId: String(mt.matterId) });
            setHud(`now wearing "${mt.name || "model"}"`);
            await navigate(address);
          } catch (err) {
            setHud(`set-model failed: ${err.code || ""} ${err.message || ""}`);
          }
          return;
        }
        openMatterActionForm(mt, action, address);
      },
      onClose: () => {},
    },
  );
}

// Form + dispatch for matter-targeted DO ops. Mirrors openActionForm
// but every dispatch carries opts.matterId so the wire DO handler
// retargets from the space to this matter. An action may carry
// __submitShape(values) to reshape the form's values into the op's
// real args (the http Navigate form asks for a url, the set-matter
// op wants field/value).
function openMatterActionForm(mt, action, address, { error = null } = {}) {
  showActionForm(action, {
    error,
    onCancel: () => openMatterActionMenu(mt),
    onSubmit: async (values) => {
      showActionForm(action, { busy: true, error: null });
      try {
        if (action.verb !== "do") throw new Error(`matter actions are DO ops (got "${action.verb}")`);
        const args = typeof action.__submitShape === "function" ? action.__submitShape(values) : values;
        await state.client.do(address, action.action, args, { matterId: String(mt.matterId) });
        hideActionPanel();
        setHud(`${action.action} ok`);
        await navigate(address);
      } catch (err) {
        openMatterActionForm(mt, action, address, {
          error: `${err.code || "error"}: ${err.message || "submit failed"}`,
        });
      }
    },
  });
}

// ── Upload model ───────────────────────────────────────────────────
//
// The hotbar's "Upload model" tool. Three steps, all existing
// surfaces: bytes → POST /api/v1/content (the byte carrier, no
// facts); ref → DO create-matter {type:"model"} into the /skins
// catalog; then set-model on your own being so the upload IS the
// new body. The model stays in /skins for anyone to wear.
let _modelFileInput = null;
function uploadModelFlow() {
  return new Promise((resolve) => {
    if (!_modelFileInput) {
      _modelFileInput = document.createElement("input");
      _modelFileInput.type = "file";
      _modelFileInput.accept = ".glb,.gltf,model/gltf-binary,model/gltf+json";
      _modelFileInput.style.display = "none";
      document.body.appendChild(_modelFileInput);
    }
    _modelFileInput.onchange = async () => {
      const file = _modelFileInput.files?.[0];
      _modelFileInput.value = "";
      if (!file) return resolve(null);
      setHud(`uploading ${file.name}…`);
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/v1/content", {
          method: "POST",
          headers: { Authorization: `Bearer ${state.session.token}` },
          body: form,
        });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.content?.hash) {
          throw new Error(body?.error || `upload failed (${res.status})`);
        }

        // Mint the model matter into the /skins catalog (reality root).
        const reality = state.discovery.reality;
        const branch = state.descriptor?.address?.branch || "0";
        const bq = branch === "0" ? "" : `#${branch}`;
        const skinsAddress = `${reality}${bq}/skins`;
        const made = await state.client.do(skinsAddress, "create-matter", {
          type:    "model",
          name:    file.name.replace(/\.(glb|gltf)$/i, ""),
          content: body.content,
        });
        const modelMatterId = made?.matterId || made?.matter?._id || made?.id;
        if (!modelMatterId) throw new Error("create-matter returned no matterId");

        // Wear it.
        setHud("upload stored — setting your body…");
        await state.client.do(selfBeingStance(), "set-model", { modelMatterId: String(modelMatterId) });
        setHud(`now wearing "${file.name}" (saved in /skins)`);
        await navigate(currentPositionAddress());
        resolve(modelMatterId);
      } catch (err) {
        setHud(`upload model failed: ${err.code || ""} ${err.message || err}`);
        resolve(null);
      }
    };
    _modelFileInput.click();
  });
}

// Generic action menu + form. Reads the being's `actions[]` from the
// descriptor; user picks one, fills the form, submit dispatches the
// verb. Substrate-driven . the portal doesn't know what cherub is or
// what `birth` does, just renders what the server says is available.
function openActionMenu(b) {
  const reality = state.discovery?.reality;
  const path = state.descriptor?.address?.pathByNames || "/";
  // Branch qualifier matters: see openBeingActionMenu for the cross-
  // branch gate doctrine. Same fix.
  const branch = state.descriptor?.address?.branch || "0";
  const bq = branch === "0" ? "" : `#${branch}`;
  // Reality-root identity delegates address as <reality>/@<name>
  // (bare-place stance). Other beings address against the current path.
  // role-manager is also a root delegate but has its own panel and
  // never reaches openActionMenu — kept off this list.
  const isRootDelegate =
    b.being === "cherub" || b.being === "birther";
  const address = isRootDelegate
    ? `${reality}${bq}/@${b.being}`
    : `${reality}${bq}${path}@${b.being}`.replace(/\/+@/, "/@");
  // The scene's mesh.userData carries a trimmed being shape (no actions).
  // Pull the full descriptor entry so the renderer sees actions[].
  const fullBeing = state.descriptor?.beings?.find((bb) => bb.being === b.being) || b;
  // Carry selectedBeing across flat-panel toggle.
  setSelectedBeing(fullBeing.beingId, fullBeing.being);
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
              // Land at home post-register without waiting for the fold
              // (see _flatSignIn / connectAndPlace). Only register returns
              // this; connect (existing being) relies on identity.position.
              homeSpaceId:     result.homeSpaceId || null,
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
        } else {
          // SEE retired as an LLM-dispatchable verb on 2026-06-03.
          // canSee preloads face content at moment-open; the being
          // has no see-tool. Action menus surface do / summon / be only.
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
  // The active being for the moment. Persists across flat-panel
  // toggle so text mode opens pre-focused on whoever the user was
  // chatting with. setSelectedBeing also fires the active-position
  // hook (currently a stub) so the future reconciler can move the
  // being adjacent to the user.
  setSelectedBeing(b.beingId, b.being);
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
  // Branch qualifier matters: same cross-branch gate doctrine as
  // openBeingActionMenu. Summoning a being from branch #1 requires the
  // address to carry `#1`; otherwise the server expand() defaults to
  // `#main` and the wire layer refuses with CROSS_BRANCH_FORBIDDEN.
  const branch = state.descriptor.address?.branch || "0";
  const bq = branch === "0" ? "" : `#${branch}`;
  // Stance form: `<reality>[#<branch>]/<path>@<being>`. When path is
  // "/" the slash is already present, so `${reality}${bq}${path}@...`
  // collapses to `<reality>[#<branch>]/@...` (the canonical form for
  // reality/home-root beings).
  const stance = `${reality}${bq}${path}@${b.being}`.replace(/\/+@/, "/@");
  const fromStance = state.session?.username
    ? `${reality}${bq}/@${state.session.username}`
    : `${reality}${bq}/@arrival`;
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
    // Esc closes whichever popup surface is up. The flat panel
    // handles its own Esc internally (closes itself), so we ignore
    // Esc when it's open. Menu OPEN uses M (below) so Esc stays
    // available for its normal "close whatever is on top" role.
    if (isFlatPanelOpen()) return;
    hideAuthActions();
    hideAuthSignInPanel();
    if (state.currentSummonBeing) {
      hideSummonPanel();
      state.currentSummonBeing = null;
    }
    if (isPlanterOpen()) closePrompt();
    return;
  }
  // Text-mode toggle. Backslash (\) sits next to Enter and reads as
  // "swap render modes." Backtick is already wired to the IBP
  // console. Active even when other panels are open (mid-summon,
  // mid-action-menu) so the user can flip without dismissing —
  // closing text mode returns to whatever was open.
  if (e.code === "Backslash") {
    e.preventDefault();
    toggleFlatPanel(L);
    return;
  }
  if (isGameplayInputBlocked()) return;
  // M opens the menu (the flat panel). Gated behind isGameplayInputBlocked
  // so typing "m" in a text field doesn't trigger it. Backslash (above)
  // is the bypass-the-gate alternative.
  if (e.code === "KeyM") { e.preventDefault(); toggleFlatPanel(L);  return; }
  if (e.code === "KeyB") { e.preventDefault(); historyBack();    return; }
  if (e.code === "KeyN") { e.preventDefault(); historyForward(); return; }
  if (e.code === "KeyE") { e.preventDefault(); attemptPlant();   return; }
});

// Try to use the selected hotbar item at the current position.
// Branches on item.kind:
//   "clone" — graft the clone bundle (the original behavior)
//   "op"    — dispatch the named DO op (form-portal, ...)
// Bounces the user to auth first if unauthenticated.
async function attemptPlant() {
  const item = state.hotbar?.getSelected();
  if (!item) {
    setHud("hotbar slot is empty. select a clone (1-9).");
    return;
  }
  // Upload-model tool: file picker → bytes to the content store →
  // create-matter (type model) into /skins → set-model on self.
  if (item.kind === "tool" && item.name === "upload-model") {
    if (!state.session?.token) {
      setHud("sign in first.");
      openAuthPanel();
      return;
    }
    await uploadModelFlow();
    return;
  }
  if (item.kind !== "clone" && item.kind !== "op") {
    setHud("selected slot is not usable here.");
    return;
  }
  if (!state.session?.token) {
    setHud("sign in first.");
    openAuthPanel();
    return;
  }
  if (!state.descriptor || !state.client) return;

  const reality = state.discovery.reality;
  const path = state.descriptor.address?.pathByNames || "/";
  const branch = state.descriptor.address?.branch || "0";
  const bq = branch === "0" ? "" : `#${branch}`;
  const parentAddress =
    `${reality}${bq}${path}`.replace(/\/+$/, "") || `${reality}${bq}`;

  // Prompt for parameters when declared (both clones and ops use the
  // same shape: an array of { name, description, default? }).
  let params = {};
  if (Array.isArray(item.parameters) && item.parameters.length > 0) {
    try {
      params = await promptForName({ item, parentLabel: parentAddress });
    } catch {
      return; // user cancelled
    }
  }

  if (item.kind === "op") {
    setHud(`${item.action} at ${parentAddress}...`);
    try {
      const result = await state.client.do(parentAddress, item.action, params);
      setHud(`${item.action} ok`);
      if (result?.matterId) {
        // form-portal returns a matterId; the new matter materializes
        // on the next live-SEE patch. Trigger a navigate-refresh so
        // the user sees the portal appear immediately.
        await navigate(parentAddress);
      }
    } catch (err) {
      setHud(`${item.action} failed: ${err.code || ""} ${err.message || ""}`);
    }
    return;
  }

  setHud(`grafting ${item.name}...`);
  try {
    const result = await runPlantSeed({
      client:        state.client,
      parentAddress,
      cloneName:     item.name,
      params,
    });
    setHud(`grafted ${item.name}`);
    if (result.newRootAddress) await navigate(result.newRootAddress);
  } catch (err) {
    setHud(`graft failed: ${err.code || ""} ${err.message || ""}`);
  }
}

// True while the user is typing in a UI input OR a modal panel is open.
// Single source of truth for whether gameplay keys (WASD/B/N/E) fire.
function isGameplayInputBlocked() {
  if (isAnyPanelOpen()) return true;
  if (isActionPanelOpen()) return true;
  if (isRoleManagerPanelOpen()) return true;
  if (isBeingFlowPanelOpen()) return true;
  if (isPlanterOpen())  return true;
  if (isFlatPanelOpen()) return true;
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
