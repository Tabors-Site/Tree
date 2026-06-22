// TreeOS Portal — the 3D view.
//
// Implements the view contract (core/views.js): mount / onDescriptor /
// onSelection / destroy. Renders the addressed Position as a spatial
// scene — spaces as rooms, children as doorways and trees, beings as
// figures, matter as objects. Everything 3D-specific lives behind
// this module: Three.js, the hotbar, the planter, action menus, the
// summon panel, the self-position loop. Session, navigation, and the
// state model belong to the PortalContext; this view only reads them.
//
// This module loads lazily (it is the only path that imports
// Three.js); a text-first session never pays for it.

import "../styles/scene-hud.css";
import { Scene } from "./scene.js";
import { mountIbpConsole } from "./ibp-console.js";
import { initHotbar, destroyHotbar } from "./hotbar.js";
import { promptForName, plantGraft as runPlantSeed, isPlanterOpen, closePrompt } from "./planter.js";
import {
  setHud,
  showSummonPanel,
  hideSummonPanel,
  resetSummonState,
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
import { assetUrl } from "../core/assets.js";

const VIEW_DOM = `
<canvas id="scene"></canvas>
<div id="reticle"></div>
<div id="hud">
  <div id="hud-top" style="display:none"></div>
  <div id="hud-bottom"></div>
</div>
`.trim();

const SELF_EMIT_TICK_MS = 100;

export function createView() {
  let ctx = null;
  let root = null;
  let scene = null;
  let factDispatcher = null;
  let hotbar = null;
  let ibpConsole = null;
  let currentSummonBeing = null;
  let renderSeq = 0;            // latest-wins guard for async preload+render
  let selfPositionTimer = null;
  let lastEmittedCoord = null;
  let selfEmitInflight = false;
  const teardowns = [];

  // ── Small helpers over ctx ──────────────────────────────────────

  const state = () => ctx.state.get();
  const client = () => ctx.client;
  const isAuthed = () => !!ctx.state.get("session")?.token;
  // EMBODIED = actually driving a being (has a beingId), distinct from merely
  // having a NAME (a token). A name with no being is signed in but bodiless:
  // it lands on the ARRIVAL FLOOR (the cherub gate), not the full world. The
  // SCENE keys off embodiment; the action gates still key off the token (a
  // name CAN summon:mate cherub to birth its first being from the floor).
  const isEmbodied = () => !!ctx.state.get("session")?.beingId;

  function setSelectedBeing(beingId, name) {
    // Selection rides the shared model: the IBPA's right stance gains
    // @<name>, every other view sees the same focus.
    ctx.navigation.selectBeing(beingId, name);
  }

  function formatLocation(desc) {
    const where = desc?.address?.pathByNames || "/";
    const who = state().session?.username || "arrival";
    return `${who} | ${desc?.address?.place || ""}${where}`;
  }

  // Bounce an unauthenticated user to a sign-in surface: cherub's
  // action menu when cherub is present, else the text view (its
  // identity chip owns the auth overlay).
  function bounceToAuth() {
    const cherub = (state().descriptor?.beings || []).find((bb) => bb.being === "cherub");
    if (cherub) { openActionMenu(cherub); return; }
    ctx.shell?.switchView("GUI");
  }

  // ── Mount ───────────────────────────────────────────────────────

  function mount(rootEl, portalCtx) {
    ctx = portalCtx;
    root = rootEl;
    root.innerHTML = VIEW_DOM;

    scene = new Scene({
      onGaze:  () => {},
      onEnter: (target) => onEnter(target),
      onBeingProximity: (being, inRange) => onBeingProximity(being, inRange),
      onBeingActivate: (being) => onBeingActivate(being),
      onMatterActivate: (matter) => onMatterActivate(matter),
      isInputBlocked: isGameplayInputBlocked,
    });
    scene.onMove = (intent) => fireMove(intent);
    scene.onMoveModeChange = (on, carrying) => updateMoveHud(on, carrying);
    scene.setPlaceTimezone(state().discovery?.timezone || null);
    scene.setClient?.(client());

    // Rung-3 sensory dispatch: fact-arrival pushes trigger per-entity
    // AnimationMixer clips + Web Audio. The unlock overlay satisfies
    // browser autoplay policy on first load.
    factDispatcher = createFactDispatcher({ scene });
    ensureUnlockOverlay();
    scene.start();

    // Best-effort playback flush on tab close.
    const onBeforeUnload = () => scene?.flushPlaybackTicks?.();
    window.addEventListener("beforeunload", onBeforeUnload);
    teardowns.push(() => window.removeEventListener("beforeunload", onBeforeUnload));

    // Cloud drift follows timeline playback (history bar dispatches).
    const onCloudScale = (ev) => {
      const f = Number(ev?.detail?.factor);
      scene?.setCloudTimeScale?.(Number.isFinite(f) ? f : 1);
    };
    window.addEventListener("historybar:cloud-scale", onCloudScale);
    teardowns.push(() => window.removeEventListener("historybar:cloud-scale", onCloudScale));

    // Gameplay key bundle. Esc closes popups; M opens the text view;
    // B/N step history; E uses the selected hotbar item.
    const onKeydown = (e) => {
      if (e.key === "Escape") {
        if (currentSummonBeing) {
          hideSummonPanel();
          currentSummonBeing = null;
        }
        if (isPlanterOpen()) closePrompt();
        return;
      }
      if (isGameplayInputBlocked()) return;
      if (e.code === "KeyM") { e.preventDefault(); ctx.shell?.switchView("GUI"); return; }
      if (e.code === "KeyB") { e.preventDefault(); ctx.navigation.back();    return; }
      if (e.code === "KeyN") { e.preventDefault(); ctx.navigation.forward(); return; }
      if (e.code === "KeyE") { e.preventDefault(); attemptPlant();           return; }
    };
    window.addEventListener("keydown", onKeydown);
    teardowns.push(() => window.removeEventListener("keydown", onKeydown));

    // Live deltas ride past the descriptor refetch: positions animate
    // meshes directly, facts fire animation/sound dispatch.
    teardowns.push(ctx.events.on("live-position", (event) => {
      scene?.applyPositionDelta(event.payload);
    }));
    teardowns.push(ctx.events.on("live-fact", (event) => {
      factDispatcher?.({ payload: { data: event.payload } });
    }));
    // Sign-in / sign-out swaps the client under us.
    teardowns.push(ctx.events.on("client", (c) => {
      scene?.setClient?.(c);
    }));
    teardowns.push(ctx.events.on("connected", () => {
      scene?.setPlaceTimezone(state().discovery?.timezone || null);
      refreshSeedCatalog();
    }));

    // The IBP console (backtick) — the raw debug panel. The console
    // VIEW is the user-facing surface; this stays as the wire-level
    // inspector inside the 3D view.
    ibpConsole = mountIbpConsole({
      root: document.getElementById("overlays") || document.body,
      getClient: () => client(),
      getPlace: () => state().discovery?.story || "treeos.ai",
    });

    hotbar = initHotbar(root.querySelector("#hud") || root, {
      onSelectionChange: (item) => {
        const isMoveTool = item?.kind === "tool" && item?.name === "move";
        scene?.setMoveMode?.(isMoveTool);
      },
      isInputBlocked: isGameplayInputBlocked,
    });
    refreshSeedCatalog();

    // No address adjustment on mount. The IBP address is shared truth
    // across all four views — switching views NEVER moves you. If the
    // current position is a heaven catalog the scene renders what the
    // descriptor gives it; the user walks out the same way they walked
    // in. (The old flat-panel overlay used to "restore" to the last
    // non-heaven address here; retired with the view-switcher model.)
  }

  // ── Descriptor rendering ────────────────────────────────────────

  async function onDescriptor(desc, meta = {}) {
    if (!scene) return;
    const seq = ++renderSeq;
    scene.setCurrentSpaceId?.(desc?.address?.spaceId || null);

    if (meta.reason === "navigate") {
      // A real move: close interaction panels (they were contextual
      // to the previous position), preload assets so the scene never
      // paints a sea of placeholders, reset the camera to the spawn
      // vantage, restart the position-emit loop.
      hideActionPanel();
      hideSummonPanel();
      resetSummonState();
      currentSummonBeing = null;
      setHud("loading scene...");
      try {
        const { collectSoundIds } = await import("./assetResolver.js");
        await Promise.all([
          scene.preloadDescriptor(desc),
          preloadSounds(collectSoundIds(desc)),
        ]);
      } catch (err) {
        console.warn("[3D] preload failed:", err?.message);
      }
      if (seq !== renderSeq || !scene) return; // superseded mid-preload
      // Pass EMBODIMENT (driving a being), not the token: a name with no being
      // sees the arrival floor (cherub gate), not the full world.
      scene.renderDescriptor(desc, { isAuthenticated: isEmbodied() });
      setHud(formatLocation(desc));
      lastEmittedCoord = null;
      startSelfPositionLoop();
      return;
    }

    // live / rewind / now: same place, new state — keep the camera.
    scene.renderDescriptor(desc, {
      isAuthenticated: isEmbodied(),
      resetCamera: meta.resetCamera === true,
    });
  }

  function onSelection() { /* the 3D scene shows selection via panels */ }

  // ── Destroy ─────────────────────────────────────────────────────

  function destroy() {
    renderSeq++;
    stopSelfPositionLoop();
    for (const fn of teardowns.splice(0)) { try { fn(); } catch {} }
    hideActionPanel();
    hideSummonPanel();
    resetSummonState();
    hideRoleManagerPanel();
    hideBeingFlowPanel();
    hideLlmAssignerPanel();
    if (isPlanterOpen()) closePrompt();
    try { ibpConsole?.destroy(); } catch {}
    ibpConsole = null;
    destroyHotbar();
    hotbar = null;
    try { scene?.dispose(); } catch {}
    scene = null;
    factDispatcher = null;
    currentSummonBeing = null;
    if (root) root.innerHTML = "";
    root = null;
  }

  // ── Seed catalog → hotbar ───────────────────────────────────────

  async function refreshSeedCatalog() {
    if (!client() || !state().discovery?.story) return;
    const full = await ctx.refreshDiscovery();
    if (!hotbar) return;
    const clones = Array.isArray(full?.clones) ? full.clones : [];

    // Slot 0 is the built-in Move tool; 1 the Portal tool (one matter,
    // one target IBPA — window/portal/walk-through are emergent per-
    // viewer from foreign-side stance auth); 2+ are extension clones.
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
    hotbar.setSlots(slots);
  }

  // ── Self-position emit loop ─────────────────────────────────────
  //
  // Polls the camera's grid coord; whenever the integer (x, y)
  // changes, fires set-being:coord so other sessions see the walk.
  // The server clamps coord to space.size.

  function startSelfPositionLoop() {
    if (selfPositionTimer) return;
    selfPositionTimer = setInterval(tickSelfPosition, SELF_EMIT_TICK_MS);
  }

  function stopSelfPositionLoop() {
    if (selfPositionTimer) { clearInterval(selfPositionTimer); selfPositionTimer = null; }
  }

  async function tickSelfPosition() {
    if (selfEmitInflight || !scene) return;
    const desc = state().descriptor;
    if (!desc) return;
    // Historical mode is observer-only — no position writes from a
    // user reviewing their past.
    if (desc.isHistorical) return;
    const grid = scene.getCurrentGridCoord();
    if (!grid) return;
    if (lastEmittedCoord && lastEmittedCoord.x === grid.x && lastEmittedCoord.y === grid.y) return;
    if (!desc?.identity?.name || !desc?.address?.pathByNames) return;
    const stance = `${desc.address.pathByNames}@${desc.identity.name}`;
    selfEmitInflight = true;
    // Record the attempt BEFORE the await so a refused emit doesn't
    // retry every tick while the user stands still.
    lastEmittedCoord = { x: grid.x, y: grid.y };
    try {
      await client().do(stance, "set-being", {
        field: "coord",
        value: { x: grid.x, y: grid.y },
      });
    } catch (err) {
      console.warn("[3D] self set-being:coord failed:", err?.message);
    } finally {
      selfEmitInflight = false;
    }
  }

  // ── Move tool ───────────────────────────────────────────────────

  async function fireMove(intent) {
    if (!intent || !state().descriptor || !client()) return;
    if (!isAuthed()) {
      setHud("sign in to move things.");
      return;
    }
    const desc = state().descriptor;
    const stance = `${desc.address.pathByNames}@${desc.identity?.name || ""}`;
    const args = { target: { kind: intent.kind, id: intent.id } };
    if (intent.mode === "coord" && intent.coord) args.coord = intent.coord;
    else if (intent.mode === "container" && intent.to) args.to = intent.to;
    else return;
    try {
      await client().do(stance, "move", args);
      setHud(`moved "${intent.label || intent.id.slice(0, 8)}" to ${intent.destLabel || ""}.`);
    } catch (err) {
      console.warn("[3D] move failed:", err?.message || err);
      setHud(`move failed: ${err?.message || "denied"}`);
    }
  }

  function updateMoveHud(on, carrying) {
    if (!on) { setHud(""); return; }
    if (carrying) {
      setHud(`carrying ${carrying.label || carrying.id.slice(0, 8)}. click destination, or Esc to cancel.`);
    } else {
      setHud("Move tool: click a tree or matter to pick it up.");
    }
  }

  // ── Navigation hooks from the scene ─────────────────────────────

  async function onEnter(target) {
    if (!target?.address) return;
    setHud(`entering ${target.address}...`);
    await ctx.navigation.navigate(target.address).catch(() => {});
  }

  // Proximity only CLOSES surfaces when the player walks/looks away;
  // opening requires an explicit click on the being.
  function onBeingProximity(b, inRange) {
    if (b.being === "cherub") { if (!inRange) hideActionPanel(); return; }
    if (b.being === "llm-assigner") { if (!inRange) hideLlmAssignerPanel(); return; }
    if (!inRange && currentSummonBeing === b.being) {
      hideSummonPanel();
      currentSummonBeing = null;
    }
  }

  function onBeingActivate(b) {
    if (b.being === "cherub" || b.being === "birther") {
      openActionMenu(b);
    } else if (b.being === "role-manager") {
      openRoleManagerPanel(b);
    } else if (b.being === "llm-assigner") {
      openLlmAssignerPanel();
    } else {
      openBeingActionMenu(b);
    }
  }

  // ── Being action menus ──────────────────────────────────────────

  function beingAddress(b, { rootDelegate = false } = {}) {
    // Story-root identity delegates address as `<story>/@<name>`
    // (bare-place stance); everyone else dispatches against the IBPA
    // stance — the same string the right side of the bar shows.
    if (!rootDelegate) return ctx.navigation.stanceFor(b.being);
    const story = state().discovery?.story;
    // History qualifier matters: acting on a being from a non-main
    // history must carry `#<history>` or the server's cross-history gate
    // refuses (expand() defaults a bare typed story to #main).
    const history = state().descriptor?.address?.history || "0";
    const bq = history === "0" ? "" : `#${history}`;
    return `${story}${bq}/@${b.being}`;
  }

  function openBeingActionMenu(b) {
    const address = beingAddress(b);
    const fullBeing = state().descriptor?.beings?.find((bb) => bb.being === b.being) || b;
    const roleActions = Array.isArray(fullBeing.actions) ? fullBeing.actions.slice() : [];

    const inhabitAction = {
      verb: "be",
      action: "connect",
      label: "Inhabit (new tab)",
      description: "Open a new being tab driving this being. Only allowed when this being is in your lineage.",
      args: {},
      __synthetic: "inhabit",
    };
    const summonAction = {
      verb: "call",
      action: "call",
      label: "Summon",
      description: "Open a chat with this being.",
      args: {},
      __synthetic: "call",
    };
    const flowAction = {
      verb: "do",
      action: "set-being",
      label: "Edit Role Flow",
      description: "Author this being's roleFlow (conditional role stack evaluated per moment).",
      args: {},
      __synthetic: "edit-flow",
    };

    const composed = [...roleActions, inhabitAction, flowAction, summonAction];
    setSelectedBeing(fullBeing.beingId, fullBeing.being);
    showActionMenu({ ...fullBeing, actions: composed }, {
      onActionPicked: (action) => {
        if (action.__synthetic === "inhabit")   return doInhabit(b, address);
        if (action.__synthetic === "call")    { openCallPanel(b); return; }
        if (action.__synthetic === "edit-flow") { openBeingFlowPanel(fullBeing); return; }
        openActionForm({ ...fullBeing, actions: composed }, action, address);
      },
      onClose: () => {},
    });
  }

  // The panels read state.client alongside the model fields; the
  // model itself never holds the client (it lives on the context),
  // so the adapter recombines them.
  function panelState() {
    return { ...state(), client: client() };
  }

  function openBeingFlowPanel(beingEntry) {
    if (!isAuthed()) { bounceToAuth(); return; }
    showBeingFlowPanel({ state: panelState(), beingEntry, onClose: () => {} });
  }

  // Inhabit: BE:connect via the cherub Mode-3 descendant-only auth
  // path. On success the borrowed body opens as a new BEING TAB in
  // this shell (the user space is tabbed per being); without a shell,
  // fall back to the legacy browser-tab handoff.
  async function doInhabit(b, address) {
    hideActionPanel();
    setHud(`inheriting @${b.being}...`);
    try {
      const ack = await client().be("connect", address, {});
      if (!ack?.identityToken) {
        setHud("inhabit failed: no token returned");
        return;
      }
      const spawnerName = state().session?.username || null;
      if (ctx.shell?.addTabFromAck) {
        await ctx.shell.addTabFromAck({ ...ack, name: ack.name || b.being }, { spawnerName });
        setHud(`opened being tab for @${ack.name || b.being}`);
        return;
      }
      // Legacy: hand the session to a fresh browser tab via the hash.
      const blob = encodeURIComponent(JSON.stringify({
        placeUrl:       state().session?.placeUrl || ctx.config.placeUrl,
        placeIsProxied: ctx.config.useProxy,
        token:          ack.identityToken,
        username:       ack.name || b.being,
        beingAddress:   ack.beingAddress || `${state().discovery.story}/@${ack.name || b.being}`,
        inherited:      true,
        spawnerName,
      }));
      window.open(`${window.location.pathname}#inhabit=${blob}`, "_blank");
      setHud(`opened new tab for @${ack.name || b.being}`);
    } catch (err) {
      setHud(`inhabit failed: ${err.code || ""} ${err.message || err}`);
    }
  }

  // ── Matter interaction ──────────────────────────────────────────

  function onMatterActivate(m) {
    const full = (state().descriptor?.matters || []).find(
      (x) => String(x.matterId) === String(m.matterId),
    );
    openMatterActionMenu(full ? { ...m, ...full } : m);
  }

  function openMatterActionMenu(mt) {
    const address = ctx.navigation.currentPositionAddress();
    const serverActions = Array.isArray(mt.actions) ? mt.actions.slice() : [];

    const entries = [...serverActions];
    if ((mt.type || mt.matterType || "generic") === "model" && isAuthed()) {
      entries.unshift({
        verb: "do",
        action: "set-model",
        label: "Wear this model",
        description: "Set this model as your being's 3D body.",
        args: {},
        __synthetic: "wear-model",
      });
    }
    entries.push({
      verb: "do",
      action: "set-model",
      label: "Set model…",
      description: "Give this matter a 3D body. Pass a model matter id (browse /skins, Copy id).",
      args: {
        modelMatterId: { type: "text", label: "Model matter id", required: false },
        clear:         { type: "bool", label: "Remove the model", default: false, required: false },
      },
    });
    // http matter navigation: the page is shared state
    // (qualities.http.currentUrl, a normal set-matter fact) so beings
    // navigate the web TOGETHER and the chain records where they went.
    if ((mt.type || "generic") === "http") {
      entries.push({
        verb: "do",
        action: "set-matter",
        label: "Navigate page…",
        description: "Move this screen to a different page (a fact — every being sees the same page).",
        args: {
          url: { type: "text", label: "https:// link to show", required: true },
        },
        __synthetic: "http-navigate",
      });
      if (mt.qualities?.http?.currentUrl) {
        entries.push({
          verb: "do",
          action: "set-matter",
          label: "Reset page",
          description: `Back to the default: ${mt.external?.url || "the original link"}`,
          args: {},
          __synthetic: "http-reset",
        });
      }
    }
    // Presentation fallbacks: frame-refusing sites and non-embeddable
    // files still open in a tab, or download.
    const openUrl = mt.external?.url || mt.contentUrl || null;
    if (openUrl) {
      entries.push({
        verb: "do",
        action: "open-tab",
        label: "Open in new tab",
        description: openUrl.length > 64 ? `${openUrl.slice(0, 64)}…` : openUrl,
        args: {},
        __synthetic: "open-tab",
      });
    }
    if (mt.contentUrl && String(mt.contentUrl).startsWith("/api/")) {
      entries.push({
        verb: "do",
        action: "download",
        label: "Download",
        description: "Save this matter's bytes to your device.",
        args: {},
        __synthetic: "download",
      });
    }
    entries.push({
      verb: "do",
      action: "copy-id",
      label: "Copy id",
      description: "Copy this matter's id to the clipboard (use it with set-model anywhere).",
      args: {},
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
              await client().do(address, "set-matter",
                { field: "qualities.http.currentUrl", value: null },
                { matterId: String(mt.matterId) });
              setHud("page reset to default");
              await ctx.navigation.navigate(address);
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
            if (!isAuthed()) { setHud("sign in first."); bounceToAuth(); return; }
            setHud("wearing model…");
            try {
              await client().do(ctx.navigation.selfStance(), "set-model", { modelMatterId: String(mt.matterId) });
              setHud(`now wearing "${mt.name || "model"}"`);
              await ctx.navigation.navigate(address);
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

  // Form + dispatch for matter-targeted DO ops. Every dispatch carries
  // opts.matterId so the wire DO handler retargets from the space to
  // this matter. An action may carry __submitShape(values) to reshape
  // the form's values into the op's real args.
  function openMatterActionForm(mt, action, address, { error = null } = {}) {
    showActionForm(action, {
      error,
      onCancel: () => openMatterActionMenu(mt),
      onSubmit: async (values) => {
        showActionForm(action, { busy: true, error: null });
        try {
          if (action.verb !== "do") throw new Error(`matter actions are DO ops (got "${action.verb}")`);
          const args = typeof action.__submitShape === "function" ? action.__submitShape(values) : values;
          await client().do(address, action.action, args, { matterId: String(mt.matterId) });
          hideActionPanel();
          setHud(`${action.action} ok`);
          await ctx.navigation.navigate(address);
        } catch (err) {
          openMatterActionForm(mt, action, address, {
            error: `${err.code || "error"}: ${err.message || "submit failed"}`,
          });
        }
      },
    });
  }

  // ── Upload model ────────────────────────────────────────────────
  //
  // Bytes → POST /api/v1/content (the byte carrier, no facts);
  // ref → DO create-matter {type:"model"} into /skins; then set-model
  // on your own being so the upload IS the new body.

  let modelFileInput = null;
  function uploadModelFlow() {
    return new Promise((resolve) => {
      if (!modelFileInput) {
        modelFileInput = document.createElement("input");
        modelFileInput.type = "file";
        modelFileInput.accept = ".glb,.gltf,model/gltf-binary,model/gltf+json";
        modelFileInput.style.display = "none";
        document.body.appendChild(modelFileInput);
      }
      modelFileInput.onchange = async () => {
        const file = modelFileInput.files?.[0];
        modelFileInput.value = "";
        if (!file) return resolve(null);
        setHud(`uploading ${file.name}…`);
        try {
          const form = new FormData();
          form.append("file", file);
          // Through the asset seam: a native shell remaps the byte
          // carrier endpoint; the web bundle resolves it identity.
          const res = await fetch(assetUrl("/api/v1/content"), {
            method: "POST",
            headers: { Authorization: `Bearer ${state().session.token}` },
            body: form,
          });
          const body = await res.json().catch(() => null);
          if (!res.ok || !body?.content?.hash) {
            throw new Error(body?.error || `upload failed (${res.status})`);
          }

          const story = state().discovery.story;
          const history = state().descriptor?.address?.history || "0";
          const bq = history === "0" ? "" : `#${history}`;
          const made = await client().do(`${story}${bq}/skins`, "create-matter", {
            type:    "model",
            name:    file.name.replace(/\.(glb|gltf)$/i, ""),
            content: body.content,
          });
          const modelMatterId = made?.matterId || made?.matter?._id || made?.id;
          if (!modelMatterId) throw new Error("create-matter returned no matterId");

          setHud("upload stored — setting your body…");
          await client().do(ctx.navigation.selfStance(), "set-model", { modelMatterId: String(modelMatterId) });
          setHud(`now wearing "${file.name}" (saved in /skins)`);
          await ctx.navigation.navigate(ctx.navigation.currentPositionAddress());
          resolve(modelMatterId);
        } catch (err) {
          setHud(`upload model failed: ${err.code || ""} ${err.message || err}`);
          resolve(null);
        }
      };
      modelFileInput.click();
    });
  }

  // ── Generic action menu + form ──────────────────────────────────
  //
  // World-driven: the portal doesn't know what cherub is or what
  // `birth` does — it renders the actions[] the descriptor declares.

  function openActionMenu(b) {
    const isRootDelegate = b.being === "cherub" || b.being === "birther";
    const address = beingAddress(b, { rootDelegate: isRootDelegate });
    const fullBeing = state().descriptor?.beings?.find((bb) => bb.being === b.being) || b;
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
        showActionForm(action, { busy: true, error: null });
        try {
          if (action.verb === "be") {
            const result = await client().be(action.action, address, values);
            // Cherub's BE flows swap the active session; self-births
            // (minting a child) keep the parent's session.
            const isCherubAuthFlow = b.being === "cherub";
            if (isCherubAuthFlow && (action.action === "birth" || action.action === "connect")) {
              hideActionPanel();
              await ctx.adoptSession(result, values.name);
              // Fresh birth = fresh keypair: surface the permanent id
              // + key backup (body-level, survives the remount).
              if (action.action === "birth" && result?.beingId) {
                import("../shared/identity-panel.js")
                  .then((m) => m.showBirthIdentityOverlay(ctx, result))
                  .catch(() => {});
              }
              return;
            }
            if (isCherubAuthFlow && action.action === "release") {
              hideActionPanel();
              await ctx.signOut();
              return;
            }
            if (!isCherubAuthFlow && action.action === "birth") {
              setHud(`minted @${result.name || values.name}`);
            }
            hideActionPanel();
          } else if (action.verb === "do") {
            await client().do(address, action.action, values);
            hideActionPanel();
          } else if (action.verb === "call") {
            await client().call(address, { content: values.content || "", from: address });
            hideActionPanel();
          } else {
            throw new Error(`unknown verb "${action.verb}"`);
          }
        } catch (err) {
          openActionForm(b, action, address, {
            error: `${err.code || "error"}: ${err.message || "submit failed"}`,
          });
        }
      },
    });
  }

  function openRoleManagerPanel(b) {
    if (!isAuthed()) { bounceToAuth(); return; }
    const rmEntry = (state().descriptor?.beings || []).find((bb) => bb.being === "role-manager") || b;
    setSelectedBeing(rmEntry.beingId, rmEntry.being);
    showRoleManagerPanel({ state: panelState(), beingEntry: rmEntry, onClose: () => {} });
  }

  function openLlmAssignerPanel() {
    if (!isAuthed()) { bounceToAuth(); return; }
    showLlmAssignerPanel({
      client:         client(),
      place:          state().discovery.story,
      currentSpaceId: state().descriptor?.address?.spaceId || null,
      onClose:        () => {},
    });
  }

  // ── Summon ──────────────────────────────────────────────────────

  function openCallPanel(b) {
    currentSummonBeing = b.being;
    setSelectedBeing(b.beingId, b.being);
    showSummonPanel({
      being: b,
      onSubmit: (text) => sendSummon(b, text),
    });
  }

  async function sendSummon(b, text) {
    if (!state().descriptor || !client()) return;
    // Drop the panel on send — the thinking bubble / final reply lives
    // in the world above the being's head, driven by the world's
    // per-being activity field, so every viewer sees the same thing.
    hideSummonPanel();
    currentSummonBeing = null;
    const stance = beingAddress(b);
    const story = state().discovery.story;
    const history = state().descriptor.address?.history || "0";
    const bq = history === "0" ? "" : `#${history}`;
    const fromStance = state().session?.username
      ? `${story}${bq}/@${state().session.username}`
      : `${story}${bq}/@arrival`;
    const correlation = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const reply = await client().call(stance, { from: fromStance, content: text, correlation });
    if (reply?.status === "accepted") {
      state().pendingSummons.set(correlation, b.being);
    }
  }

  // ── Hotbar use ──────────────────────────────────────────────────

  async function attemptPlant() {
    const item = hotbar?.getSelected();
    if (!item) {
      setHud("hotbar slot is empty. select a clone (1-9).");
      return;
    }
    if (item.kind === "tool" && item.name === "upload-model") {
      if (!isAuthed()) { setHud("sign in first."); bounceToAuth(); return; }
      await uploadModelFlow();
      return;
    }
    if (item.kind !== "clone" && item.kind !== "op") {
      setHud("selected slot is not usable here.");
      return;
    }
    if (!isAuthed()) { setHud("sign in first."); bounceToAuth(); return; }
    if (!state().descriptor || !client()) return;

    const parentAddress = ctx.navigation.currentPositionAddress();

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
        const result = await client().do(parentAddress, item.action, params);
        setHud(`${item.action} ok`);
        if (result?.matterId) {
          await ctx.navigation.navigate(parentAddress);
        }
      } catch (err) {
        setHud(`${item.action} failed: ${err.code || ""} ${err.message || ""}`);
      }
      return;
    }

    setHud(`grafting ${item.name}...`);
    try {
      const result = await runPlantSeed({
        client: client(),
        parentAddress,
        cloneName: item.name,
        params,
      });
      setHud(`grafted ${item.name}`);
      if (result.newRootAddress) await ctx.navigation.navigate(result.newRootAddress);
    } catch (err) {
      setHud(`graft failed: ${err.code || ""} ${err.message || ""}`);
    }
  }

  // True while the user is typing in a UI input OR a modal panel is
  // open. Single gate for gameplay keys (WASD/B/N/E) and hotbar input.
  function isGameplayInputBlocked() {
    if (isAnyPanelOpen()) return true;
    if (isActionPanelOpen()) return true;
    if (isRoleManagerPanelOpen()) return true;
    if (isBeingFlowPanelOpen()) return true;
    if (isPlanterOpen()) return true;
    const el = document.activeElement;
    if (!el || el === document.body) return false;
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return true;
    if (el.isContentEditable) return true;
    return false;
  }

  return { mount, onDescriptor, onSelection, destroy };
}
