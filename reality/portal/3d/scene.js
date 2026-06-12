// TreeOS Portal 3D — scene.
//
// Builds a Three.js scene with first-person camera, ground plane, lights,
// WASD + mouse-look controls, gaze raycasting, and a renderDescriptor()
// method that lays out children-as-objects and beings-as-figures based
// on the addressed Position's descriptor.

import * as THREE from "three";
import { CSS3DRenderer, CSS3DObject } from "three/addons/renderers/CSS3DRenderer.js";
import "../styles/scene.css";
import { showLabel, hideLabel, setSkyClock, hideSkyClock, setHud } from "./ui.js";
import { loadModel, preloadModels, collectModelIds } from "./assetResolver.js";

// Per-frame gaze raycast against the world's children walks every
// triangle of every mesh by default. With six Mixamo skinned characters
// at ~50k triangles each, that's 18M triangle tests per second . the
// dominant per-frame cost while moving. Override the loaded glTF
// meshes' raycast to a no-op and put a single bbox check on the
// outer group so hover labels still work . per-entity raycast cost
// drops from O(N tris) to O(1).
const NOOP_RAYCAST = function () {};
const _bboxRaycastTmpBox = new THREE.Box3();
const _bboxRaycastTmpCenter = new THREE.Vector3();
function groupBoxRaycast(raycaster, intersects) {
  const local = this.userData?._localBBox;
  if (!local) return;
  _bboxRaycastTmpBox.copy(local).applyMatrix4(this.matrixWorld);
  if (raycaster.ray.intersectsBox(_bboxRaycastTmpBox)) {
    _bboxRaycastTmpBox.getCenter(_bboxRaycastTmpCenter);
    intersects.push({
      object: this,
      distance: raycaster.ray.origin.distanceTo(_bboxRaycastTmpCenter),
      point: _bboxRaycastTmpCenter.clone(),
    });
  }
}

// Reusable temp vectors for the portal render pass. Hoisted so each
// frame doesn't allocate — the parallax math touches several vec3s
// per portal and N portals × 30fps × 5 vecs each is GC pressure we
// don't need.
const _portalTmpA = new THREE.Vector3();
const _portalTmpB = new THREE.Vector3();
const _portalTmpC = new THREE.Vector3();
const _portalTmpV = new THREE.Vector3();
const _portalTmpQ = new THREE.Quaternion();
const _portalTmpQInv = new THREE.Quaternion();

// Deterministic small hash for ground colors / portal accent — same
// input always yields same hue so two viewers see the same branch as
// the same color.
function hashString(s) {
  let h = 0;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

const MOVE_SPEED = 6.0;       // units / second
const SPRINT_MULT = 1.9;      // Shift multiplier
const LOOK_SENSITIVITY = 0.0025;
const GAZE_RANGE = 18;
const ENTER_RANGE = 1.6;
const GROUND_Y = 1.7;         // eye height when standing on the ground
const GRAVITY  = -22;         // units / second^2
const JUMP_V   = 8.0;         // initial vertical velocity on jump
const NOCLIP_VERT_SPEED = 6.0; // up/down speed in noclip mode

// Proximity threshold (meters) for "close enough to interact" with a
// being. Roughly arm's-length plus a step. Labels can still appear from
// further away (gaze recognition); panels only open within this range.
export const INTERACT_RANGE = 3.5;

// ── Portal + sky tuning ─────────────────────────────────────────────
// Render-to-texture portals + cloud drift. One block, one place to
// tune. Anything magic-looking elsewhere in this file should land here.
const PORTAL_CONFIG = Object.freeze({
  // Render-target dimensions for portal mini-scene FBO. 512×768
  // matches the portal opening aspect ratio (rotated PlaneGeometry).
  RT_WIDTH:  512,
  RT_HEIGHT: 768,
  // Update cadence: render every Nth main-loop frame. 2 = effective
  // 30Hz at a 60Hz main loop. Halves GPU cost; parallax still reads
  // smooth because the camera + main scene update at full rate.
  RENDER_EVERY_N_FRAMES: 2,
  // Distance cull. Skip portals further than this many world units
  // from the player. Stored as squared to skip a sqrt per check.
  MAX_DISTANCE_SQ: 25 * 25,
  // Direction cull. Skip portals significantly behind the camera.
  // Player forward · (portal − player) must exceed this threshold.
  // Negative because we still render portals slightly behind (the
  // player can spin around quickly and we don't want pop-in).
  BEHIND_CAMERA_DOT: -3,
  // Parallax camera positioning inside the mini-scene.
  DEFAULT_CAMERA_RADIUS: 12,           // depth when no descriptor size info yet
  MIN_CAMERA_HEIGHT:    1,             // min Y for the mini-camera
  CAMERA_HEIGHT_OFFSET: 2.5,           // additional height above offsetY
  DEPTH_OFFSET_SCALE:   0.5,           // how much player distance contributes to depth
  DEPTH_OFFSET_MAX:     8,             // clamp on depth contribution
});

// ── Cloud drift ─────────────────────────────────────────────────────
// Base wind-rotation rate (radians per second). Multiplied by the
// playback-aware cloudTimeScale in _driftClouds, so timeline rewind
// flows winds backward and fast-forward speeds them up.
const CLOUD_BASE_DRIFT_RAD_PER_SEC = 0.02;

const COLOR_BG          = 0x0a0d0c;
const COLOR_TREE        = 0x6fa982;
const COLOR_HOME        = 0x8fbf9f;
const COLOR_BEING_AUTH  = 0xb39ddb;
const COLOR_BEING_OTHER = 0xa3c3b1;

// Visual modes for the place scene.
const VISUAL_ARRIVAL = {
  // Pure black void. Arrival is the threshold . the player faces the
  // cherub at the gate and nothing else exists yet. No ground, no
  // grid, no sky, no fog gradient . the cherub stands lit against
  // the dark.
  bgColor:    0x000000,
  fogNear:    8,
  fogFar:     35,
  groundColor: 0x000000,
  gridColor:   0x000000,
  ambientI:    0.25,
  sunI:        0.4,
};

const VISUAL_DEFAULT = {
  bgColor:    0x87ceeb,
  fogNear:    60,
  fogFar:     220,
  groundColor: 0x4a8c3c,
  gridColor:   0x3d7530,
  ambientI:    0.7,
  sunI:        1.0,
};

// Pyramid interior: warm sandstone ground, low ceiling-fog, golden ambient.
// Selected when the position's resolved sceneType is "pyramid-interior".
const VISUAL_PYRAMID = {
  bgColor:    0x1a1208,
  fogNear:    10,
  fogFar:     55,
  groundColor: 0x4a3a1f,
  gridColor:   0x6e5530,
  ambientI:    0.45,
  sunI:        0.6,
};

// Heaven: the I-Am's white room. Full-white background, near-white
// ground, soft full-spectrum ambient (no directional sun); doors to
// children render as black-framed white planes the user can gaze at
// to enter. Selected when desc.heavenSpace === "heaven".
const VISUAL_HEAVEN = {
  bgColor:    0xffffff,
  fogNear:    20,
  fogFar:     90,
  groundColor: 0xf2f2f2,
  gridColor:   0xe0e0e0,
  ambientI:    1.0,
  sunI:        0.0,
};

export class Scene {
  constructor({ onGaze, onEnter, onBeingProximity, onBeingActivate, onMatterActivate, onMatterEnded, onMatterPlaybackTick, isInputBlocked } = {}) {
    this.onGaze = onGaze || (() => {});
    this.onEnter = onEnter || (() => {});
    this.onBeingProximity = onBeingProximity || (() => {});
    this.onBeingActivate = onBeingActivate || (() => {});
    this.onMatterActivate = onMatterActivate || (() => {});
    this.onMatterEnded = onMatterEnded || (() => {});
    this.onMatterPlaybackTick = onMatterPlaybackTick || (() => {});
    this.isInputBlocked = isInputBlocked || isTypingInUI;
    // PortalClient for live SEE/DO calls — set after construction via
    // setClient(). Currently used by portal-matter rendering to issue
    // live SEE into the foreign target; the descriptor returned paints
    // onto the portal's canvas texture. Cross-world dispatch happens
    // through the standard client — no portal-specific transport.
    this._client = null;
    // Every being mesh by being. Proximity fires per-being; speech
    // bubbles anchor to the mesh for that being.
    this._beingMeshes = new Map();
    // Parallel index keyed by beingId so the live PositionProjection
    // delta (which carries beingId, not name) can find its mesh in
    // O(1). Populated alongside _beingMeshes during renderDescriptor.
    this._beingMeshesById = new Map();
    // Per-render grid metadata cached so live deltas can map a coord
    // back into world units without re-reading the descriptor.
    this._gridSize = null;
    this._gridCell = null;
    // Rung-3 sensory state. Per-entity AnimationMixer registry keyed
    // by `${kind}:${id}` (e.g. "being:abc123", "matter:def456"). Each
    // entry: { mixer, actions: Map<clipName,AnimationAction>, idleAction,
    // renderBlock }. Populated by _swapToModel when a glTF loads with
    // animations; consumed by getEntityMixerState() (called from
    // factDispatcher on fact-arrival pushes) and swept every frame
    // by _tick via mixer.update(deltaTime).
    this._entityMixers = new Map();
    // Track the latest seq applied per being so stale or out-of-order
    // deliveries get dropped.
    this._beingLastMoveSeq = new Map();
    // Move tool. The "Move" hotbar slot toggles _moveMode. While on,
    // click on a child (tree) or matter mesh to pick it up, then
    // click again on a destination (a child mesh, or any non-target
    // surface to mean "current space") to commit the move. Esc
    // cancels with no fact written. State lives on the scene because
    // the pick-up is purely client-side until the put-down emits.
    this._moveMode = false;
    this._carrying = null; // { kind: "space"|"matter", id, label, mesh }
    this._lastBeingInRange = new Map();

    this.canvas = document.getElementById("scene");
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: true,
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    // CSS3DRenderer sits behind the WebGL canvas (pointer-events:none
    // so it doesn't block the 3D gaze raycast) and renders DOM elements
    // — iframes for video matter, anchors for web pages — at real
    // 3D positions. Two renderers, one scene/camera. The CSS renderer's
    // DOM elements (CSS3DObject) live in the scene tree alongside
    // meshes; we resize + render them in lockstep.
    this.cssRenderer = new CSS3DRenderer();
    this.cssRenderer.setSize(window.innerWidth, window.innerHeight);
    const cssEl = this.cssRenderer.domElement;
    cssEl.style.position      = "fixed";
    cssEl.style.inset         = "0";
    cssEl.style.pointerEvents = "none";
    cssEl.style.zIndex        = "1"; // behind the HUD (10) and the canvas (auto)
    document.body.appendChild(cssEl);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLOR_BG);
    this.scene.fog = new THREE.Fog(COLOR_BG, 8, 35);

    this.camera = new THREE.PerspectiveCamera(
      70, window.innerWidth / window.innerHeight, 0.1, 500,
    );
    this.camera.position.set(0, 1.7, 8);

    this._buildLights();
    this._buildGround();
    this._buildSky();
    this._skyMode = "arrival";
    this._placeTimezone = null;
    this._applyVisualMode(VISUAL_ARRIVAL);

    // Container for descriptor-rendered objects so we can clear/rebuild
    // on each SEE without disturbing the ground/lights.
    this.world = new THREE.Group();
    this.scene.add(this.world);

    // Active portal meshes — render-to-texture passes their mini-scenes
    // to their FBOs before the main scene renders each frame, so the
    // opening surface shows a live 3D view of the foreign side instead
    // of static canvas text. See _makePortalMesh + _renderActivePortals.
    this._activePortals = new Set();

    // Player state.
    this.keys = new Set();
    this.yaw = 0;
    this.pitch = 0;
    this.pointerLocked = false;
    this.velocityY = 0;       // vertical velocity (gravity + jump)
    this.noclip = false;      // toggled with KeyV; bypasses gravity/ground

    // Gaze state.
    this.raycaster = new THREE.Raycaster();
    this.gazeForward = new THREE.Vector3();
    this.currentGazeTarget = null;

    this._bindInput();

    this.clock = new THREE.Clock();
    this._ytApiReady = null;     // lazy-loaded promise
    this._ytPlayers  = new Map(); // iframe-id → YT.Player
  }

  start() {
    this._paused = false;
    const loop = () => {
      this._rafId = requestAnimationFrame(loop);
      if (this._paused) return;
      this._tick(this.clock.getDelta());
      // Render each open portal's mini-scene into its render target so
      // the opening surface shows a live 3D view of the foreign side.
      // Must run BEFORE the main render or the textures will be one
      // frame stale.
      this._renderActivePortals();
      this.renderer.render(this.scene, this.camera);
      this.cssRenderer.render(this.scene, this.camera);
    };
    loop();
    window.addEventListener("resize", () => this._onResize());
  }

  // Render-to-texture pass for open portals. Each portal renders its
  // foreign-side mini-scene from a parallax camera that mirrors the
  // player's offset from the portal frame, so walking around the
  // portal moves what's visible through the opening — true-window
  // effect rather than a static TV.
  //
  // Efficiency knobs:
  //   - 256×384 render target (down from 512×768) → 1/4 the fill cost
  //   - throttle: render at half the main FPS (every other frame)
  //   - distance cull: skip portals > ~25 units away
  //   - direction cull: skip portals significantly behind the camera
  // Together these keep N portals visible cheap; the next step
  // (walk-through portals) reuses the same textures, no new cost.
  _renderActivePortals() {
    if (!this._activePortals || this._activePortals.size === 0) return;

    // Throttle to PORTAL_CONFIG.RENDER_EVERY_N_FRAMES (= 2 → 30Hz).
    this._portalFrameCounter = (this._portalFrameCounter || 0) + 1;
    if ((this._portalFrameCounter % PORTAL_CONFIG.RENDER_EVERY_N_FRAMES) !== 0) return;

    const tmpA = _portalTmpA;
    const tmpB = _portalTmpB;
    const tmpC = _portalTmpC;
    const tmpQ = _portalTmpQ;

    const playerPos = this.camera.position;
    const playerFwd = this.camera.getWorldDirection(tmpA);

    let rendered = false;
    for (const group of this._activePortals) {
      const p = group.userData?.portal;
      if (!p || p.state !== "open" || !p.renderTarget || !p.miniScene || !p.miniCamera) continue;

      const portalPos = group.getWorldPosition(tmpB);

      // Distance + direction culling per PORTAL_CONFIG.
      const distSq = portalPos.distanceToSquared(playerPos);
      if (distSq > PORTAL_CONFIG.MAX_DISTANCE_SQ) continue;
      const toPortal = tmpC.subVectors(portalPos, playerPos);
      if (toPortal.dot(playerFwd) < PORTAL_CONFIG.BEHIND_CAMERA_DOT) continue;

      // Parallax: place the mini-camera at the player's offset from
      // the portal expressed in the portal's LOCAL frame. As you walk
      // left, the camera in the mini-scene moves left, and the view
      // through the opening shifts accordingly.
      const portalQuat = group.getWorldQuaternion(tmpQ);
      const offsetX = toPortal.x; // already computed
      const offsetY = toPortal.y;
      const offsetZ = toPortal.z;
      // Project offset onto portal's local axes via inverse quaternion.
      const inv = _portalTmpQInv.copy(portalQuat).invert();
      const localOffset = _portalTmpV.set(-offsetX, -offsetY, -offsetZ).applyQuaternion(inv);
      // localOffset.x = left/right of frame, .y = up/down of frame,
      //  .z = in front of frame (positive in the player's direction).

      // Walk-through attempt. When the player's body is inside the
      // doorway volume (within the width, within the height, within a
      // thin slab of the portal plane), fire a DO to set their position
      // to the portal's foreign target IBPA. The substrate's role-walk
      // decides if the walk-through is permitted; FORBIDDEN just no-ops
      // (soft barrier — no physical wall, the player just doesn't
      // transit). Per-portal cooldown prevents firing every frame while
      // the player stands inside.
      //
      // Doorway volume:
      //   |localOffset.x| < doorway half-width  (~1.6 for W=3.2 portals)
      //   localOffset.y in [-1, doorway height) (player feet at ground,
      //     camera ~1.7 up; clamp generously to include either)
      //   |localOffset.z| < 0.5  (thin slab on the portal plane)
      this._tryWalkThroughPortal(p, localOffset);

      const baseDepth = p.cameraRadius || PORTAL_CONFIG.DEFAULT_CAMERA_RADIUS;
      // Mini-camera: x/y mirror the player's offset (so motion creates
      // parallax); z is the natural viewing depth, slightly increased
      // when the player is far away. Tuning lives in PORTAL_CONFIG.
      p.miniCamera.position.set(
        localOffset.x,
        Math.max(PORTAL_CONFIG.MIN_CAMERA_HEIGHT,
                 localOffset.y + PORTAL_CONFIG.CAMERA_HEIGHT_OFFSET),
        baseDepth + Math.max(0,
                             Math.min(PORTAL_CONFIG.DEPTH_OFFSET_MAX,
                                      localOffset.z * PORTAL_CONFIG.DEPTH_OFFSET_SCALE)),
      );
      p.miniCamera.lookAt(0, 1, 0);

      this.renderer.setRenderTarget(p.renderTarget);
      this.renderer.clear();
      this.renderer.render(p.miniScene, p.miniCamera);
      rendered = true;
    }
    if (rendered) this.renderer.setRenderTarget(null);
  }

  // Walk-through trigger. Called per-frame by _renderActivePortals
  // with the player's offset in the portal's local frame. When the
  // player's body is inside the doorway volume, fire a DO to set
  // their position to the portal's foreign target IBPA. The substrate
  // role-walk decides if the walk-through is permitted; FORBIDDEN
  // just no-ops (soft barrier).
  //
  // Cooldown: 3s per portal so we don't fire repeatedly while the
  // player stands inside. Reset when the player leaves the volume,
  // so re-entering counts as a fresh attempt.
  _tryWalkThroughPortal(p, localOffset) {
    if (!this._client || !this._selfName) return;
    if (!p?.target) return;
    const inside =
      Math.abs(localOffset.x) < 1.6 &&
      localOffset.y > -1 && localOffset.y < 4.8 &&
      Math.abs(localOffset.z) < 0.5;
    if (!this._walkPortalState) this._walkPortalState = new Map();
    const prev = this._walkPortalState.get(p.matterId) || { inside: false, lastFire: 0 };
    const now = performance.now();
    if (inside && !prev.inside && now - prev.lastFire > 3000) {
      // Fresh entry into the doorway volume — attempt the walk.
      const selfStance = "@" + this._selfName;
      const target = p.target;
      this._client.do(selfStance, "set-being", { field: "position", value: target })
        .then(() => {
          // Successful transit . the next descriptor SEE will reposition
          // the player at the foreign side; no further action here.
        })
        .catch((err) => {
          // FORBIDDEN or other refusal. Two pieces of feedback so the
          // player knows the portal didn't transit them (rather than
          // wondering "did it work? did I just walk through nothing?"):
          //   1. HUD toast with the substrate's reason string
          //   2. Brief red tint on the portal frame as a visual cue
          const reason = err?.message || String(err);
          setHud(`portal denied: ${reason}`);
          this._flashPortalDenied(p);
          // eslint-disable-next-line no-console
          console.warn("[portal-walk] denied:", reason);
        });
      prev.lastFire = now;
    }
    prev.inside = inside;
    this._walkPortalState.set(p.matterId, prev);
  }

  // Brief red tint on the portal's frame as a visual "denied" cue.
  // Restores the original emissive after ~700ms so the portal returns
  // to its normal appearance for the next attempt.
  _flashPortalDenied(p) {
    if (!p || !p.openingMat) return;
    if (p._flashTimer) return; // already flashing
    const mat = p.openingMat;
    const origColor    = mat.color?.getHex?.();
    const origEmissive = mat.emissive?.getHex?.();
    const origIntensity = mat.emissiveIntensity;
    try {
      mat.color?.setHex?.(0x8a2424);
      mat.emissive?.setHex?.(0x8a2424);
      mat.emissiveIntensity = 0.9;
    } catch { /* material kind may not expose all props */ }
    p._flashTimer = setTimeout(() => {
      try {
        if (origColor != null)    mat.color?.setHex?.(origColor);
        if (origEmissive != null) mat.emissive?.setHex?.(origEmissive);
        if (origIntensity != null) mat.emissiveIntensity = origIntensity;
      } catch { /* same */ }
      p._flashTimer = null;
    }, 700);
  }

  // Stop the render loop without disposing scene graph + GPU assets.
  // WebSocket / descriptor subscription stays live (driven externally);
  // only the visual update halts. Cheap toggle for "I'm showing text
  // mode, don't burn the GPU." Resume snaps back to the latest state
  // because renderDescriptor keeps running into the off-screen graph.
  pause() {
    this._paused = true;
    this.clock.getDelta(); // drain accumulated delta so resume doesn't lurch
  }

  resume() {
    this._paused = false;
    this.clock.getDelta(); // same drain on the resume side
  }

  // Full teardown for view unmount (the shell swapping to another
  // view). Stops the render loop, releases the GL context, removes
  // the CSS renderer's body-level element. The scene object is dead
  // after this; mounting the 3D view again constructs a fresh Scene.
  dispose() {
    this._disposed = true;
    this._paused = true;
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    try { this.flushPlaybackTicks?.(); } catch {}
    try { this.cssRenderer?.domElement?.remove(); } catch {}
    try { this.renderer?.dispose(); } catch {}
  }

  // Glide camera over a being's current cell. Called on text-mode
  // close so the user lands where the interaction was. beingId comes
  // from L.state.selectedBeing.
  recenterCamera(beingId) {
    if (!beingId) return false;
    const id = String(beingId);
    let target = null;
    if (typeof this.getAllEntityMixerStates === "function") {
      const states = this.getAllEntityMixerStates();
      for (const s of states) {
        if (String(s?.beingId) === id || String(s?.id) === id) {
          target = s.mesh || s.group || null;
          break;
        }
      }
    }
    if (!target && this.scene) {
      this.scene.traverse((obj) => {
        if (target) return;
        const data = obj.userData;
        if (data && (String(data.beingId) === id || String(data.id) === id)) {
          target = obj;
        }
      });
    }
    if (!target) return false;
    try {
      const v = target.position;
      if (v && typeof v.x === "number") {
        if (this.controls?.target) {
          this.controls.target.set(v.x, v.y, v.z);
          this.controls.update?.();
        } else if (this.camera) {
          this.camera.lookAt(v.x, v.y, v.z);
        }
        return true;
      }
    } catch { /* fall through */ }
    return false;
  }

  _onResize() {
    if (this._disposed) return; // stale listener from a prior mount
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.cssRenderer.setSize(w, h);
  }

  // Replace the world with what's described by the given descriptor.
  // Two visual modes for the place zone:
  //   - arrival: matrix-dark ground, only the cherub visible.
  //     Movement locked. Player faces the cherub.
  //   - default: grassy field, all beings and children rendered.
  //     Movement unlocked.
  renderDescriptor(desc, { isAuthenticated, resetCamera = true } = {}) {
    // Bail when the visible-scene signature is identical to the last
    // render. The substrate fires afterFieldWrite-driven invalidates
    // for every qualities.* write (harmony's per-tick tracking, the
    // dancers' per-step counters, etc.), and the portal-client routes
    // them through here as a descriptor refetch. Without this guard
    // every drum-tick reloads all six Mixamo characters and rebuilds
    // the AnimationMixer registry, which is 200-500 ms of latency
    // for no visible change.
    //
    // Signature covers the surface the renderer actually consumes:
    // each entity's identity + render-block model, plus space size
    // and the self being. Camera resets and arrival mode also flip
    // it so an auth state change still re-renders.
    const sig = this._renderSignature(desc, { isAuthenticated, resetCamera });
    if (sig === this._lastRenderSig) {
      // Skip the expensive re-render (clearWorld + SkeletonUtils.clone
      // per entity), but still refresh the lightweight per-being
      // activity bubbles . those track the descriptor's `activity`
      // field which changes every fact (drummer tick label, dancer
      // step content, etc.) and isn't in the signature. Without this,
      // the "tick N" label above the drummer freezes at whatever
      // count was current when the signature last flipped, even though
      // the substrate keeps ticking.
      this._applyBeingActivity(desc?.beings || []);
      return;
    }
    this._lastRenderSig = sig;

    this._clearWorld();
    const isPlaceRoot = !!desc?.isPlaceRoot;
    const arrival    = isPlaceRoot && !isAuthenticated;

    // Coord mapping. When the space declares a size (e.g. the harmony
    // dance-floor with size:{x:10,y:10}), render beings and matter at
    // their reported coord positions. cellSize world units per grid
    // cell, centered on the origin. Without a size the grid mapping
    // is skipped and the legacy arc/hash fallbacks render instead.
    const gridSize = desc?.size && Number.isFinite(desc.size.x) && Number.isFinite(desc.size.y)
      ? { x: desc.size.x, y: desc.size.y }
      : null;
    const CELL = 1.5;
    const coordToWorld = (c) => {
      if (!gridSize || !c || !Number.isFinite(c.x) || !Number.isFinite(c.y)) return null;
      return {
        x: (c.x - (gridSize.x - 1) / 2) * CELL,
        z: (c.y - (gridSize.y - 1) / 2) * CELL,
      };
    };
    // Cache for live deltas. applyPositionDelta runs outside the
    // renderDescriptor scope and needs the same mapping.
    this._gridSize = gridSize;
    this._gridCell = CELL;
    this._beingMeshesById.clear();
    this._beingLastMoveSeq.clear();

    // Pick the visual mode. Arrival overrides everything. Otherwise the
    // descriptor's resolved scene.sceneType picks a preset; unknown or
    // missing sceneTypes fall back to the default outdoor scene. Heaven
    // overrides the default with its own all-white preset.
    const isHeaven = desc?.heavenSpace === "heaven";
    let visualMode = VISUAL_DEFAULT;
    if (arrival) {
      visualMode = VISUAL_ARRIVAL;
    } else if (isHeaven) {
      visualMode = VISUAL_HEAVEN;
    } else if (desc?.scene?.sceneType === "pyramid-interior") {
      visualMode = VISUAL_PYRAMID;
    }
    this._applyVisualMode(visualMode);

    const beings = desc?.beings || [];
    const children = desc?.children || [];

    // In arrival mode, render only cherub directly in front of the
    // player. Other beings and all children are hidden.
    const beingsToRender = arrival
      ? beings.filter((b) => b.being === "cherub")
      : beings;
    const childrenToRender = arrival ? [] : children;

    // Self identity. The signed-in user is the camera in first-person;
    // we never render their own avatar mesh in their tab. Their coord
    // anchors the camera on initial navigation and on resetCamera.
    // Other tabs see their mesh moving through the same position
    // deltas any other being would emit. Computed AFTER beingsToRender
    // because we look up the self entry in that list.
    this._selfBeingId = desc?.identity?.beingId || null;
    this._selfBeing = this._selfBeingId
      ? beingsToRender.find((b) => b.beingId === this._selfBeingId) || null
      : null;
    // Self stance address for portal walk-through DO calls. Bare
    // `@<name>` resolves to this being's own stance regardless of
    // the current SEE branch, so the DO targets the actor's home reel.
    this._selfName = desc?.identity?.name
      || this._selfBeing?.name
      || null;

    // Place beings: in arrival mode, cherub stands directly ahead.
    // In default mode, beings spread in an arc.
    this._beingMeshes.clear();
    this._lastBeingInRange.clear();
    if (arrival) {
      const cherubBeing = beingsToRender[0];
      if (cherubBeing) {
        const mesh = this._makeBeingMesh(cherubBeing);
        mesh.position.set(0, 0.7, -4);
        mesh.userData = beingUserData(cherubBeing);
        this.world.add(mesh);
        this._beingMeshes.set(cherubBeing.being, mesh);
        this._swapToModel(
          mesh,
          cherubBeing.qualities?.render,
          cherubBeing.beingId ? { kind: "being", id: cherubBeing.beingId } : null,
        );
      }
    } else {
      const beingRadius = 6;
      beingsToRender.forEach((b, i) => {
        // First-person: skip your own avatar in your own tab. You
        // ARE the camera; the mesh would clip the lens and double-
        // render whatever the other tabs see for you.
        if (this._selfBeingId && b.beingId === this._selfBeingId) return;
        // Prefer the being's coord field (the seed's spatial schema
        // field, written through set-being:coord and clamped to
        // space.size). When the space has a declared size, map the
        // grid coord into world units. Fall back to an arc spread for
        // beings outside a sized space.
        let x, z;
        const world = coordToWorld(b.coord);
        if (world) {
          x = world.x;
          z = world.z;
        } else {
          const angle = (i / Math.max(1, beingsToRender.length)) * Math.PI - Math.PI / 2;
          x = Math.cos(angle) * beingRadius;
          z = -Math.sin(angle) * beingRadius;
        }
        const mesh = this._makeBeingMesh(b);
        mesh.position.set(x, 0.7, z);
        // Stash the default coord. Activity-driven movement (Phase D in
        // the plan) will animate the mesh between this default and a
        // target coord while a chainstep is active; on release it
        // returns to default.
        mesh.userData = { ...beingUserData(b), defaultCoord: { x, z } };
        this.world.add(mesh);
        this._beingMeshes.set(b.being, mesh);
        if (b.beingId) this._beingMeshesById.set(b.beingId, mesh);
        this._swapToModel(
          mesh,
          b.qualities?.render,
          b.beingId ? { kind: "being", id: b.beingId } : null,
        );
      });
    }

    // At the place root, when authenticated, drop the signed-in being's
    // home as a small house object you can walk up to and enter.
    if (isPlaceRoot && isAuthenticated) {
      const home = this._makeHomeMesh();
      home.position.set(-8, 0, 6);
      home.userData = {
        kind: "child",
        label: "home",
        address: "/~",
        type: "home",
        isDoorway: true,
      };
      this.world.add(home);
    }

    // Place children. Heaven gets a dedicated door-ring layout; every
    // other space uses the three-tier coord/legacy/hash fallback.
    if (isHeaven) {
      // Heaven children become doors in a ring around the I-Am.
      // Doors face inward toward the origin so the camera sees them
      // as walls of the room. Skinned to the all-white aesthetic:
      // pale frame, light fill, black label text.
      const DOOR_RADIUS = 7;
      const total = Math.max(1, childrenToRender.length);
      childrenToRender.forEach((child, i) => {
        const angle = (i / total) * Math.PI * 2;
        const x = Math.cos(angle) * DOOR_RADIUS;
        const z = Math.sin(angle) * DOOR_RADIUS;
        const mesh = this._makeHeavenDoor(child);
        mesh.position.set(x, 0, z);
        // Face the door toward the origin so the camera reads its
        // front face on approach.
        mesh.lookAt(0, mesh.position.y, 0);
        mesh.userData = {
          kind: "child",
          label: child.name,
          address: child.path,
          spaceId: child.spaceId || null,
          type: child.type,
          isDoorway: true,
        };
        this.world.add(mesh);
      });
    } else {
      // Three layouts, in priority order:
      //   1. If the parent space has a declared size AND the child has
      //      a coord, render at coord mapped into world units.
      //   2. Legacy position.coords (pre-coord-schema callers).
      //   3. Hash-derived position so children without a coord (never
      //      moved, parent unsized) get a stable layout instead of
      //      stacking at the origin.
      childrenToRender.forEach((child) => {
        const key = child.id || child.path || child.name;
        const h = hashKey(key);
        let x, z;
        const childCoordWorld = coordToWorld(child.coord);
        const legacyCoords = child.position?.coords;
        if (childCoordWorld) {
          x = childCoordWorld.x;
          z = childCoordWorld.z;
        } else if (legacyCoords && typeof legacyCoords.x === "number") {
          x = legacyCoords.x;
          z = legacyCoords.y;
        } else {
          const angle = (h % 360) * (Math.PI / 180);
          const radius = 22 + ((h >> 9) % 120) * 0.45; // 22..76
          x = Math.cos(angle) * radius;
          z = Math.sin(angle) * radius;
        }
        const sizeHint = estimateSizeHint(child, h);
        const mesh = this._makeChildMesh(child, sizeHint);
        mesh.position.set(x, 0, z);
        mesh.userData = {
          kind: "child",
          label: child.name,
          address: child.path,
          spaceId: child.spaceId || null,
          type: child.type,
          isDoorway: true,
        };
        this.world.add(mesh);
        this._swapToModel(
          mesh,
          child.qualities?.render,
          child.spaceId ? { kind: "space", id: child.spaceId } : null,
        );
      });
    }

    // Place matter (notes, plan emissions, etc.) at their server
    // coords, falling back to a tight ring around the player when no
    // placement is set. Each matter is a small glowing cube whose
    // userData carries a preview the gaze label can show on hover.
    this._matterMeshes = new Map();
    const matters = desc?.matters || [];
    if (!arrival) {
      matters.forEach((mt, i) => {
        const id = mt.matterId || `mt-${i}`;
        const isVideo = mt?.content?.contentType === "video/youtube";
        // Screens (video, web embeds, embeddable files) share the
        // video mesh's placement + model-swap exemptions: the CSS3D
        // iframe IS the presentation; a glTF would clobber it.
        const isScreen = isVideo || !!this._embedUrlFor(mt);
        let x, z;
        const world = coordToWorld(mt.coord);
        if (world) {
          x = world.x;
          z = world.z;
        } else if (isScreen) {
          // Screens get a stable, prominent spot in front of the
          // arrival camera — close enough to read, far enough to walk
          // around. Z is negative so the screen faces -Z (camera looks
          // toward -Z at arrival). Multiple screens fan out along X.
          x = (i % 5) * 7 - 14;
          z = -6;
        } else {
          const h = hashKey(id);
          const angle = (h % 360) * (Math.PI / 180);
          const radius = 5 + ((h >> 9) % 80) * 0.08;
          x = Math.cos(angle) * radius;
          z = Math.sin(angle) * radius;
        }
        const mesh = this._makeMatterMesh(mt);
        mesh.position.set(x, 0, z);
        // Preserve existing userData (the video mesh has iframe + ids).
        mesh.userData = Object.assign({
          kind: "matter",
          matterKind: isVideo ? "video" : (mt.kind || "ibp"),
          matterType: mt.type || "generic",
          ref: id,
          matterId: id,
          label: matterLabel(mt),
          preview: mt.preview || "",
          fullContentRef: mt.fullContentRef || null,
        }, mesh.userData || {});
        this.world.add(mesh);
        this._matterMeshes.set(id, mesh);
        // Skip the model swap for screen matter (video / web embed /
        // embeddable file) . its CSS3DObject placement is intrinsic
        // to the iframe wrapper and a glTF would clobber the live
        // surface. Other matter kinds receive their declared model
        // normally. The model ref is the SERVER-RESOLVED `mt.model`
        // (per-matter override → space per-type default → matter-type
        // extension default), with the raw render block's model as
        // the legacy fallback; scale/rotation still ride the matter's
        // own render block.
        if (!isScreen) {
          const renderBlock = {
            ...(mt.qualities?.render || {}),
            model: mt.model || mt.qualities?.render?.model || null,
          };
          this._swapToModel(
            mesh,
            renderBlock.model ? renderBlock : mt.qualities?.render,
            id ? { kind: "matter", id } : null,
          );
        }
      });
    }

    // Sized-space land. When the descriptor declares a size, the
    // visible land IS that size: no infinite ground stretching past
    // the bounds, no infinite background grid. The space's declared
    // box (gridSize × CELL world units) is the entire walkable area,
    // and the rest is void (the sky/dome stays as backdrop).
    //
    // When no size is declared the infinite ground/grid come back as
    // the default outdoor scene.
    const sized = gridSize && !arrival;
    if (this._ground) this._ground.visible = !sized;
    if (this._grid)   this._grid.visible   = !sized;
    if (sized) {
      const w = gridSize.x * CELL;
      const h = gridSize.y * CELL;
      // Sized ground plane — the land itself, exactly the space's size.
      const landGeom = new THREE.PlaneGeometry(w, h);
      const landMat = new THREE.MeshStandardMaterial({
        color: VISUAL_DEFAULT.groundColor,
        roughness: 0.9,
        side: THREE.DoubleSide,
      });
      const land = new THREE.Mesh(landGeom, landMat);
      land.rotation.x = -Math.PI / 2;
      land.position.y = 0;
      // Tag so the move tool can detect "click hit empty floor" and
      // resolve the click point into a grid coord for put-down.
      land.userData = { kind: "land" };
      this.world.add(land);
      this._land = land;
      // Overlay cell grid on top of the land for motion legibility.
      const overlayGrid = new THREE.GridHelper(
        Math.max(w, h),
        Math.max(gridSize.x, gridSize.y),
        0x88aaff,
        0x445577,
      );
      overlayGrid.position.y = 0.02;
      this.world.add(overlayGrid);
      // Thin boundary frame at the edge so the player sees where the
      // land ends instead of inferring it from missing geometry.
      const frameMat = new THREE.LineBasicMaterial({ color: 0x88aaff });
      const halfW = w / 2;
      const halfH = h / 2;
      const framePts = [
        new THREE.Vector3(-halfW, 0.03, -halfH),
        new THREE.Vector3( halfW, 0.03, -halfH),
        new THREE.Vector3( halfW, 0.03,  halfH),
        new THREE.Vector3(-halfW, 0.03,  halfH),
        new THREE.Vector3(-halfW, 0.03, -halfH),
      ];
      const frameGeom = new THREE.BufferGeometry().setFromPoints(framePts);
      const frame = new THREE.Line(frameGeom, frameMat);
      this.world.add(frame);
    }

    // Wire per-being activity: bubbles for current thoughts/tool calls,
    // and movement targets so beings walk to whoever/whatever they're
    // acting on while their chainstep is active.
    this._applyBeingActivity(beingsToRender);

    // Drop the player at origin on navigation. Live-data refreshes
    // (subscriptions, in-place re-fetches) pass resetCamera:false so
    // we don't yank the player back to spawn every tick.
    //
    // When the descriptor declared a size AND your own being has a
    // coord at this space, anchor the camera there instead of
    // generic spawn — your first-person view starts at your
    // server-side position so the world matches what other tabs see
    // of you.
    //
    // Two paths into camera placement here:
    //   resetCamera:true  — navigate / spawn. Snap camera to self
    //     coord (or default spawn if no coord) AND reset yaw/pitch
    //     so the user starts looking forward.
    //   isHistorical:true — rewind / playback. Place the camera at
    //     the historical self coord so coord-only changes in the
    //     same space are actually visible. PRESERVE yaw / pitch so
    //     the user's angle survives the scrub (the doctrine from
    //     the rewind handler is "same place, different time").
    // Live re-fetch (neither flag) leaves the camera alone — the
    // user is driving via WASD and the live PositionProjection delta
    // path handles their own movement.
    const isHistorical = !!desc?.isHistorical;
    if (resetCamera || isHistorical) {
      // Self coord precedence: identity.coord (the substrate's first-
      // person source of truth — present on every authed SEE, including
      // historical) over the beings-list entry (which may not list self
      // if self wasn't AT this position at the queried time).
      const selfCoord = desc?.identity?.coord || this._selfBeing?.coord || null;
      const selfWorld = selfCoord ? coordToWorld(selfCoord) : null;
      if (selfWorld) {
        this.camera.position.set(selfWorld.x, 1.7, selfWorld.z);
      } else if (resetCamera) {
        // No self coord — only fall back to default spawn on an
        // explicit navigate / reset. A rewind that lands somewhere
        // with no coord leaves the camera alone rather than yanking
        // it to a synthetic spawn point.
        this.camera.position.set(0, 1.7, arrival ? 2 : 8);
      }
      if (resetCamera) {
        // Yaw / pitch only reset on a full navigate. Rewind keeps the
        // user's vantage.
        this.yaw = 0;
        this.pitch = 0;
        this.velocityY = 0;
      }
    }
    this._applyLook();
  }

  // Apply one PositionProjection delta from the live SEE channel.
  // Payload shape from positionProjectionFold.js:
  //   { spaceId, beingId, x, y, z?, lastMoveSeq }
  //
  // Three filters:
  //   - mesh present for this beingId (the delta is for a being
  //     currently visible in this scene)
  //   - gridSize known for the space (no-op otherwise; coords have
  //     no world mapping until the descriptor declared a size)
  //   - lastMoveSeq strictly greater than the last applied for this
  //     being (drop stale / out-of-order deliveries; the projection
  //     guarantees the truth state, the wire doesn't guarantee order)
  applyPositionDelta(delta) {
    if (!delta || !delta.beingId) return;
    // Self deltas are echoes of our own emit; the camera is
    // authoritative for self and snapping a mesh under the camera
    // would just fight the player's input.
    if (this._selfBeingId && delta.beingId === this._selfBeingId) return;
    const mesh = this._beingMeshesById.get(delta.beingId);
    if (!mesh) return;
    const gridSize = this._gridSize;
    const cell = this._gridCell;
    if (!gridSize || !cell) return;
    if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) return;

    const lastSeq = this._beingLastMoveSeq.get(delta.beingId);
    if (Number.isFinite(delta.lastMoveSeq) && Number.isFinite(lastSeq) && delta.lastMoveSeq <= lastSeq) {
      return; // stale; the wire delivered out of order
    }
    if (Number.isFinite(delta.lastMoveSeq)) {
      this._beingLastMoveSeq.set(delta.beingId, delta.lastMoveSeq);
    }

    const x = (delta.x - (gridSize.x - 1) / 2) * cell;
    const z = (delta.y - (gridSize.y - 1) / 2) * cell;
    // Don't teleport. Update defaultCoord — the per-frame
    // _updateBeingMovement lerp drives the mesh toward this goal at
    // a fixed walking speed. Movement reads as continuous even
    // though deltas arrive at the moment cadence (one per sealed
    // Act) rather than per-frame. With cell size 1.5 world units
    // and walk speed 3.5/s, one cell takes ~0.43s — visibly walking
    // rather than jumping.
    if (mesh.userData) {
      mesh.userData.defaultCoord = { x, z };
    }
  }

  // Inverse of coordToWorld: read the camera's world position, return
  // the grid coord, clamped to the declared size. The emit loop in
  // main.js polls this each tick and stamps a set-being:coord fact
  // whenever the result changes — that's how your camera in this tab
  // becomes your avatar's coord in every other tab.
  //
  // Returns null when the descriptor hasn't declared a size (no
  // mapping exists) OR there's no self being to attribute the
  // emit to.
  getCurrentGridCoord() {
    if (!this._selfBeingId) return null;
    const gridSize = this._gridSize;
    const cell = this._gridCell;
    if (!gridSize || !cell) return null;
    const wx = this.camera.position.x;
    const wz = this.camera.position.z;
    const gx = Math.round(wx / cell + (gridSize.x - 1) / 2);
    const gy = Math.round(wz / cell + (gridSize.y - 1) / 2);
    return {
      x: Math.max(0, Math.min(gridSize.x - 1, gx)),
      y: Math.max(0, Math.min(gridSize.y - 1, gy)),
    };
  }

  // The signed-in being's id, if any. main.js needs it to construct
  // the set-being:coord emit address.
  getSelfBeingId() { return this._selfBeingId; }

  // Apply activity state across all currently-rendered beings. For each
  // being entry: stash an `activeTargetCoord` on its mesh when activity
  // has a being-target with a known mesh, so per-frame movement can
  // interpolate; ensure an HTML activity bubble exists for any being
  // that's currently doing something; remove bubbles for idle beings.
  _applyBeingActivity(beings) {
    if (!this._activityBubbles) this._activityBubbles = new Map();
    const seen = new Set();

    for (const b of beings || []) {
      const mesh = this._beingMeshes.get(b.being);
      if (!mesh) continue;
      const activity = b.activity || null;

      // Movement target: look up the target being's mesh by modeKey and
      // use its default coord. Falls back to no movement when target
      // isn't a being or isn't rendered here.
      let targetCoord = null;
      const t = activity?.target;
      if (t && t.kind === "being" && t.modeKey) {
        for (const [, otherMesh] of this._beingMeshes) {
          const otherMode = otherMesh.userData?.modeKey;
          if (otherMode && otherMode === t.modeKey) {
            const d = otherMesh.userData?.defaultCoord;
            if (d) {
              // Stand a short offset from the target so beings don't overlap.
              const dx = d.x - (mesh.userData.defaultCoord?.x || 0);
              const dz = d.z - (mesh.userData.defaultCoord?.z || 0);
              const len = Math.hypot(dx, dz) || 1;
              const back = 1.2;
              targetCoord = { x: d.x - (dx / len) * back, z: d.z - (dz / len) * back };
            }
            break;
          }
        }
      }
      mesh.userData.activeTargetCoord = targetCoord;

      // ONE bubble per being, server-driven. Every act a being takes .
      // outbound summon, mid-act tool call, inbound summon, sealed reply
      // . is captured in the server's activity field and rendered above
      // THEIR head with a per-kind visual treatment. Multiplayer-visible:
      // every viewer sees the same bubbles because the source is the
      // descriptor's activity field, not a local UI side-channel.
      if (activity?.content || activity?.target) {
        seen.add(b.being);
        let entry = this._activityBubbles.get(b.being);
        if (!entry) {
          const el = document.createElement("div");
          el.className = "being-activity";
          document.body.appendChild(el);
          entry = { mesh, el };
          this._activityBubbles.set(b.being, entry);
        } else {
          entry.mesh = mesh;
        }
        _renderActivity(entry.el, activity);
      }
    }

    // Remove bubbles for beings no longer doing anything.
    for (const [emb, entry] of this._activityBubbles) {
      if (!seen.has(emb)) {
        entry.el.remove();
        this._activityBubbles.delete(emb);
      }
    }
  }

  _applyVisualMode(mode) {
    this._skyMode = mode === VISUAL_DEFAULT ? "default" : "arrival";
    const isArrival = mode === VISUAL_ARRIVAL;
    this.scene.background = new THREE.Color(mode.bgColor);
    this.scene.fog = new THREE.Fog(mode.bgColor, mode.fogNear, mode.fogFar);
    if (this._ambient)  this._ambient.intensity = mode.ambientI;
    if (this._sun)      this._sun.intensity     = mode.sunI;
    if (this._ground)   this._ground.material.color.set(mode.groundColor);
    if (this._grid) {
      this._grid.material.color = new THREE.Color(mode.gridColor);
    }
    // Arrival mode is pure void. Hide ground and grid so the cherub
    // stands alone against the dark; later modes show them again,
    // subject to the sized-space override in renderDescriptor.
    if (this._ground) this._ground.visible = !isArrival;
    if (this._grid)   this._grid.visible   = !isArrival;
    if (this._sky) this._sky.visible = this._skyMode === "default";
    if (this._skyMode === "default") {
      this._updateTimeOfDay();
    } else {
      hideSkyClock();
      this._lastClockMinute = -1;
    }
  }

  // ────────────────────────────────────────────────────────────────

  _buildLights() {
    this._ambient = new THREE.AmbientLight(0xffffff, 0.35);
    this.scene.add(this._ambient);
    this._sun = new THREE.DirectionalLight(0xffffff, 0.7);
    this._sun.position.set(8, 20, 6);
    this.scene.add(this._sun);
  }

  _buildGround() {
    const geom = new THREE.PlaneGeometry(300, 300, 30, 30);
    const mat = new THREE.MeshStandardMaterial({
      color: VISUAL_ARRIVAL.groundColor, roughness: 0.95,
    });
    this._ground = new THREE.Mesh(geom, mat);
    this._ground.rotation.x = -Math.PI / 2;
    this.scene.add(this._ground);
    this._grid = new THREE.GridHelper(300, 60, VISUAL_ARRIVAL.gridColor, VISUAL_ARRIVAL.gridColor);
    this._grid.position.y = 0.01;
    this.scene.add(this._grid);
  }

  _buildSky() {
    this._sky = new THREE.Group();

    // Inverted sphere with per-vertex colors. Gives a vertical gradient
    // (horizon → zenith) that we update each frame to match the palette.
    // Rendered first (renderOrder -1) so everything else draws on top.
    const domeGeom = new THREE.SphereGeometry(450, 32, 16);
    const domeColors = new Float32Array(domeGeom.attributes.position.count * 3);
    domeGeom.setAttribute("color", new THREE.BufferAttribute(domeColors, 3));
    this._skyDome = new THREE.Mesh(
      domeGeom,
      new THREE.MeshBasicMaterial({
        side: THREE.BackSide, vertexColors: true,
        fog: false, depthWrite: false,
      }),
    );
    this._skyDome.renderOrder = -1;
    this._sky.add(this._skyDome);

    this._sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(6, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xfff3a8 }),
    );
    this._sky.add(this._sunMesh);

    this._sunHalo = new THREE.Mesh(
      new THREE.SphereGeometry(11, 24, 16),
      new THREE.MeshBasicMaterial({
        color: 0xfff3a8, transparent: true, opacity: 0.18,
      }),
    );
    this._sky.add(this._sunHalo);

    // Cloud cover: a huge inside-out sphere wrapping the whole space.
    // BackSide rendering so we see the inside of the dome; depthWrite
    // off and renderOrder -1 so it draws first and the rest of the
    // world paints on top regardless of distance. Texture tiles a few
    // times around so no single seam ever stands out, and the sphere
    // rotates slowly so the cover appears to move with the wind.
    // Cloud cover: cube with a custom ShaderMaterial. Texture is
    // sampled via TRIPLANAR projection — the same 2D Perlin tile is
    // projected onto XY, YZ, XZ planes and blended by the surface
    // normal — so adjacent cube faces share a continuous cloud field
    // and the edge seams disappear. A horizon fade tween blends the
    // cloud color toward the current sky horizon color as the view
    // angle dips toward y=0, and drops alpha to zero below the
    // horizon. uCloudColor and uHorizonColor are updated each frame
    // by _updateTimeOfDay so the fade brightens at day, darkens at
    // night, and always matches the sky.
    const cloudTex = this._makeCloudTexture(1024);
    cloudTex.wrapS = THREE.RepeatWrapping;
    cloudTex.wrapT = THREE.RepeatWrapping;
    this._cloudTex = cloudTex;
    this._cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        uMap:          { value: cloudTex },
        uCloudColor:   { value: new THREE.Color(0xffffff) },
        uHorizonColor: { value: new THREE.Color(0x6fb4e6) },
        uTileScale:    { value: 1.2 },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform sampler2D uMap;
        uniform vec3 uCloudColor;
        uniform vec3 uHorizonColor;
        uniform float uTileScale;
        varying vec3 vDir;
        void main() {
          vec3 n = normalize(vDir);
          vec3 absN = abs(n);
          float sum = absN.x + absN.y + absN.z;
          vec3 blend = absN / max(sum, 0.0001);
          vec4 cx = texture2D(uMap, n.zy * uTileScale + 0.5);
          vec4 cy = texture2D(uMap, n.xz * uTileScale + 0.5);
          vec4 cz = texture2D(uMap, n.xy * uTileScale + 0.5);
          vec4 sampled = cx * blend.x + cy * blend.y + cz * blend.z;
          float coverage = sampled.a;
          float fade = smoothstep(-0.05, 0.3, n.y);
          vec3 col = mix(uHorizonColor, uCloudColor, fade);
          col *= mix(0.85, 1.0, fade);
          float a = coverage * fade;
          gl_FragColor = vec4(col, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.BackSide,
    });
    // Skybox semantics for a TRANSPARENT shell:
    //   - depthTest:  true  → the world's depth buffer hides the dome
    //                         wherever opaque geometry was drawn first
    //                         (trees, buildings, etc.). Without this,
    //                         the dome paints over them — transparent
    //                         materials render in their own queue
    //                         AFTER opaque ones regardless of renderOrder.
    //   - depthWrite: false → the dome itself doesn't fill the depth
    //                         buffer, so other transparent objects
    //                         can still blend correctly against the
    //                         world behind it.
    //   - renderOrder -1    → among transparent siblings, the dome
    //                         sorts to the back of the painter pass.
    // Icosahedron at detail 3: 1280 evenly-distributed triangular
    // faces, no UV poles, no big quad faces. Combined with the
    // triplanar shader (which samples by world direction, not UVs)
    // the cover reads as a smooth sphere with no seams at all.
    const cloudCube = new THREE.Mesh(
      new THREE.IcosahedronGeometry(200, 3),
      this._cloudMat,
    );
    cloudCube.renderOrder = -1;
    // Group wraps the cube so we can pin the whole assembly to the
    // camera each frame and rotate around world Y for the wind drift.
    // Lives directly in the scene (not in _sky) so the camera pin
    // doesn't compound with _sky's own position.
    const cloudGroup = new THREE.Group();
    cloudGroup.add(cloudCube);
    this._clouds = cloudGroup;
    this.scene.add(cloudGroup);

    // Star layer: same triplanar trick as the clouds but with a
    // sparse pinpoint texture, sitting on a larger icosahedron so
    // stars read as farther out than the cloud cover. renderOrder -2
    // ensures stars draw before clouds, so cloud gaps reveal stars
    // behind them. uOpacity is driven by _updateTimeOfDay: full at
    // night, fading through dawn/dusk, zero at midday. uTime drives
    // per-star twinkle in the fragment shader.
    const starTex = this._makeStarTexture(2048);
    starTex.wrapS = THREE.RepeatWrapping;
    starTex.wrapT = THREE.RepeatWrapping;
    this._starTex = starTex;
    this._starMat = new THREE.ShaderMaterial({
      uniforms: {
        uMap:       { value: starTex },
        uOpacity:   { value: 0.0 },
        uTime:      { value: 0.0 },
        uTileScale: { value: 1.5 },
      },
      vertexShader: `
        varying vec3 vLocalDir;
        varying vec3 vWorldDir;
        void main() {
          // Local direction rotates with the sphere → drives triplanar
          // sampling, so the texture turns with the rotation.
          vLocalDir = normalize(position);
          // World direction stays absolute → drives the horizon mask,
          // so "below horizon" is always real-world below regardless
          // of how the celestial sphere is tilted.
          vWorldDir = normalize(mat3(modelMatrix) * position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform sampler2D uMap;
        uniform float uOpacity;
        uniform float uTime;
        uniform float uTileScale;
        varying vec3 vLocalDir;
        varying vec3 vWorldDir;
        float hash(vec3 p) {
          p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        void main() {
          if (uOpacity <= 0.001) discard;
          vec3 n = normalize(vLocalDir);
          vec3 wn = normalize(vWorldDir);
          vec3 absN = abs(n);
          float sum = absN.x + absN.y + absN.z;
          vec3 blend = absN / max(sum, 0.0001);
          vec4 cx = texture2D(uMap, n.zy * uTileScale + 0.5);
          vec4 cy = texture2D(uMap, n.xz * uTileScale + 0.5);
          vec4 cz = texture2D(uMap, n.xy * uTileScale + 0.5);
          vec4 sampled = cx * blend.x + cy * blend.y + cz * blend.z;
          float brightness = sampled.r;
          // Per-star twinkle: hash direction into a phase so each star
          // pulses on its own clock; mix range keeps stars always at
          // least 60% visible so they don't disappear entirely.
          float phase = hash(floor(n * 80.0)) * 6.283;
          float twinkle = 0.5 + 0.5 * sin(uTime * 2.0 + phase);
          brightness *= mix(0.6, 1.0, twinkle);
          // Horizon mask uses WORLD direction so it stays anchored to
          // the real horizon line regardless of the sphere's rotation.
          float horizonMask = smoothstep(0.0, 0.25, wn.y);
          float a = brightness * uOpacity * horizonMask;
          gl_FragColor = vec4(vec3(brightness), a);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
    });
    const starShell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(400, 3),
      this._starMat,
    );
    starShell.renderOrder = -2;
    const starGroup = new THREE.Group();
    starGroup.add(starShell);
    this._stars = starGroup;
    this.scene.add(starGroup);

    this.scene.add(this._sky);
    this._sky.visible = false;
  }

  // Procedural starfield: randomly placed Gaussian-ish bright spots on
  // a black canvas. The same texture is sampled three ways by the
  // triplanar shader to wrap a sphere with no UV pole.
  _makeStarTexture(size) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, size, size);
    const starCount = 800;
    for (let i = 0; i < starCount; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const brightness = 0.4 + Math.random() * 0.6;
      const radius = 0.5 + Math.random() * Math.random() * 3.5;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, radius * 4);
      const v = Math.floor(255 * brightness);
      grad.addColorStop(0,   `rgba(${v},${v},${v},1)`);
      grad.addColorStop(0.3, `rgba(${v},${v},${v},0.5)`);
      grad.addColorStop(1,   "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(x - radius * 4, y - radius * 4, radius * 8, radius * 8);
    }
    return new THREE.CanvasTexture(canvas);
  }

  // Procedural Perlin noise texture, fBm over 5 octaves, shaped into a
  // cloud-cover alpha. Returned as a CanvasTexture set to repeat.
  _makeCloudTexture(size) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(size, size);

    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
    }
    const perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    const lerp = (a, b, t) => a + t * (b - a);
    const grad = (hash, x, y) => {
      const h = hash & 3;
      const u = h < 2 ? x : y;
      const v = h < 2 ? y : x;
      return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
    };
    const noise2d = (x, y) => {
      const X = Math.floor(x) & 255;
      const Y = Math.floor(y) & 255;
      x -= Math.floor(x);
      y -= Math.floor(y);
      const u = fade(x);
      const v = fade(y);
      const A = perm[X] + Y;
      const B = perm[X + 1] + Y;
      return lerp(
        lerp(grad(perm[A], x, y),         grad(perm[B], x - 1, y),         u),
        lerp(grad(perm[A + 1], x, y - 1), grad(perm[B + 1], x - 1, y - 1), u),
        v,
      );
    };
    // Straight fBm over 5 octaves. No toroidal tricks — those bent the
    // noise into visible banded projections. Seams at the texture edge
    // are hidden by the giant plane (one tile, no repeat) and by the
    // two layers drifting against each other.
    const fbm = (x, y) => {
      let sum = 0, amp = 1, freq = 1, max = 0;
      for (let o = 0; o < 5; o++) {
        sum += amp * noise2d(x * freq, y * freq);
        max += amp;
        amp *= 0.5;
        freq *= 2;
      }
      return sum / max;
    };
    // Domain warp: feed fbm's input through another low-amplitude fbm
    // so the iso-lines curve and braid instead of running in straight
    // bands. This is what kills the "grid feel" — the eye reads it as
    // wind-shaped cloud cover rather than a procedural pattern.
    const warped = (x, y) => {
      const wx = fbm(x + 5.2, y + 1.3) * 0.9;
      const wy = fbm(x + 8.1, y + 2.7) * 0.9;
      return fbm(x + wx, y + wy);
    };

    // Scale: 4 across the tile means ~4 blobs end-to-end inside one
    // texture period. Lower = blobbier.
    const SCALE = 4;
    // Seamless wrap via 4-corner cross-fade. At u=0 and u=1 the result
    // is identical (same for v), so tiling around the dome leaves no
    // visible seam meridian. The cost is a softer pattern near the
    // boundaries, but with domain warping the eye reads it as just
    // more cloud variety.
    const tile = (u, v) => {
      const a = warped(u * SCALE,             v * SCALE);
      const b = warped((u - 1) * SCALE,       v * SCALE);
      const c = warped(u * SCALE,             (v - 1) * SCALE);
      const d = warped((u - 1) * SCALE,       (v - 1) * SCALE);
      return (1 - u) * (1 - v) * a
           + u       * (1 - v) * b
           + (1 - u) * v       * c
           + u       * v       * d;
    };

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = tile(x / size, y / size);
        // Shape: threshold and stretch so most of the plane is gappy
        // with thick clusters. v in 0..1. Black (low) is transparent
        // and dim, white (high) is opaque and bright. RGB carries the
        // shading, alpha carries the coverage; the material multiplies
        // both so thin wisps fade out softly.
        const v = Math.max(0, Math.min(1, (n + 0.15) * 1.6));
        const c = Math.floor(v * 255);
        const i = (y * size + x) * 4;
        img.data[i]     = c;
        img.data[i + 1] = c;
        img.data[i + 2] = c;
        img.data[i + 3] = c;
      }
    }
    ctx.putImageData(img, 0, 0);

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  // Set the timezone used to compute time-of-day. null = browser local time.
  setPlaceTimezone(tz) {
    this._placeTimezone = tz || null;
    this._lastClockMinute = -1;
    if (this._skyMode === "default") this._updateTimeOfDay();
  }

  // Wire the PortalClient into the scene for cross-world SEE calls.
  // Portal matters need to issue live SEE into their foreign target
  // address; cross-reality routes through canopy automatically. Call
  // once after construction.
  setClient(client) {
    this._client = client || null;
  }

  // Pin the sky/sun to a specific past instant. Used by the rewind
  // path so the dome reflects what the world LOOKED like at that
  // moment — noon yesterday paints a noon sky, not the current 4am.
  // Passing null lifts the pin and the sky resumes following wall-
  // clock now.
  setFrozenTime(iso) {
    this._frozenTime = iso ? new Date(iso) : null;
    this._lastClockMinute = -1;
    if (this._skyMode === "default") this._updateTimeOfDay();
  }

  _getLocalHour() {
    const tz = this._placeTimezone || undefined;
    // Frozen time wins when a rewind has pinned the dome to a past
    // moment; otherwise the clock follows wall-clock now.
    const when = this._frozenTime instanceof Date ? this._frozenTime : new Date();
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hour: "numeric", minute: "numeric", hour12: false,
      }).formatToParts(when);
      let hour = 0, min = 0;
      for (const p of parts) {
        if (p.type === "hour")   hour = parseInt(p.value, 10);
        if (p.type === "minute") min  = parseInt(p.value, 10);
      }
      // "24" can appear at midnight in some locales; clamp.
      if (hour === 24) hour = 0;
      return hour + min / 60;
    } catch {
      const d = this._frozenTime instanceof Date ? this._frozenTime : new Date();
      return d.getHours() + d.getMinutes() / 60;
    }
  }

  // Drive sun position, sky color, and light intensity from the place's
  // local clock. Sunrise ~6, noon overhead at 12, sunset ~18, night at 0/24.
  _updateTimeOfDay() {
    if (this._skyMode !== "default") return;

    // Sky follows the camera fully so jumps and noclip-flight don't
    // produce parallax. Cardinal directions stay anchored because the
    // group is only translated (never rotated): a sun positioned at
    // local +X is always east in world space.
    this._sky.position.copy(this.camera.position);

    const h = this._getLocalHour();

    // Cardinal directions: north = -Z, south = +Z, east = +X, west = -X.
    // Sun rises in the east (+X), arcs through the southern sky (+Z bulge),
    // sets in the west (-X). Below the horizon at night.
    const t = (h - 6) / 12;            // 0..1 from sunrise to sunset
    const above = t >= 0 && t <= 1;
    const angle = t * Math.PI;         // 0 = east, π/2 = south overhead, π = west
    const R = 140;
    const SOUTH_TILT = 35;             // northern-hemisphere-style southerly arc
    if (above) {
      const x = Math.cos(angle) * R;
      const y = Math.sin(angle) * R;
      const z = Math.sin(angle) * SOUTH_TILT;
      this._sunMesh.position.set(x, y, z);
      this._sunHalo.position.set(x, y, z);
      this._sun.position.set(x, y, z).normalize().multiplyScalar(50);
    } else {
      // Below the horizon. Park the meshes far below so they don't render.
      this._sunMesh.position.set(0, -400, 0);
      this._sunHalo.position.set(0, -400, 0);
      // Faint moonlight: a soft direction from the north for night ambience.
      this._sun.position.set(0, 0.5, -1).normalize().multiplyScalar(50);
    }

    const sky = _skyPalette(h);
    // Fog matches the horizon so distant trees fade into the sky line.
    this.scene.background.setHex(sky.horizon);
    this.scene.fog.color.setHex(sky.horizon);
    this._sun.intensity = sky.sunI;
    this._ambient.intensity = sky.ambientI;
    this._sunMesh.material.color.setHex(sky.sunColor);
    this._sunHalo.material.color.setHex(sky.sunColor);
    // Halo expands and warms during dawn/dusk for the gradient feel near
    // the sun. Compute "warmth" as 1.0 at low sun, 0.0 at high sun.
    const warmth = above ? (1 - Math.sin(angle)) : 0;
    this._sunHalo.material.opacity = 0.18 + warmth * 0.35;
    this._sunHalo.scale.setScalar(1 + warmth * 1.6);
    // Push current sky tints into the cloud shader. Cloud color is
    // the "thick cluster" color; horizon color is what the bottom of
    // the dome fades toward — together they keep the cover matched
    // to the sky's day/night progression.
    this._cloudMat.uniforms.uCloudColor.value.setHex(sky.cloudColor);
    this._cloudMat.uniforms.uHorizonColor.value.setHex(sky.horizon);

    // Star opacity: full at night (h<5 or h>19), fading across the
    // sunrise window (5..7) and the sunset window (17..19). Lets the
    // starfield bleed in/out smoothly alongside the sky color shift.
    let starOp;
    if (h < 5 || h >= 19) starOp = 1;
    else if (h < 7)       starOp = 1 - (h - 5) / 2;
    else if (h > 17)      starOp = (h - 17) / 2;
    else                  starOp = 0;
    if (this._starMat) this._starMat.uniforms.uOpacity.value = starOp;

    // Star rotation locked to the hour and the SUN'S axis exactly.
    // Sun moves in a plane through east (R,0,0), high south
    // (0, R, SOUTH_TILT), and west (-R,0,0); the normal to that plane
    // (0, -SOUTH_TILT, R) is the south-tilted "polar axis" the sun
    // appears to rotate around. The celestial sphere rotates the same
    // direction (positive right-hand rule about that axis) so the
    // stars track the sun's arc precisely, one full turn per 24h.
    if (this._stars) {
      if (!this._sunAxis) {
        this._sunAxis = new THREE.Vector3(0, -SOUTH_TILT, R).normalize();
      }
      const starAngle = ((h - 6) / 12) * Math.PI;
      this._stars.quaternion.setFromAxisAngle(this._sunAxis, starAngle);
    }
    this._updateSkyDomeColors(sky.horizon, sky.zenith);

    // Clock display: only when minute changes to avoid DOM churn.
    const minute = Math.floor(h * 60);
    if (this._lastClockMinute !== minute) {
      this._lastClockMinute = minute;
      setSkyClock(this._formatLocalTime());
    }
  }

  _updateSkyDomeColors(horizon, zenith) {
    const geom = this._skyDome.geometry;
    const pos = geom.attributes.position;
    const col = geom.attributes.color;
    const hr = (horizon >> 16) & 0xff, hg = (horizon >> 8) & 0xff, hb = horizon & 0xff;
    const zr = (zenith  >> 16) & 0xff, zg = (zenith  >> 8) & 0xff, zb = zenith  & 0xff;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      // y ranges roughly [-450, 450]. Horizon band sits near ground
      // level then blends smoothly into the zenith — full horizon
      // below y=10, full zenith by y=160.
      const t = Math.max(0, Math.min(1, (y - 10) / 150));
      const r = (hr + (zr - hr) * t) / 255;
      const g = (hg + (zg - hg) * t) / 255;
      const b = (hb + (zb - hb) * t) / 255;
      col.setXYZ(i, r, g, b);
    }
    col.needsUpdate = true;
  }

  _formatLocalTime() {
    const tz = this._placeTimezone || undefined;
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true,
      }).format(new Date());
    } catch {
      const d = new Date();
      const h24 = d.getHours();
      const suffix = h24 >= 12 ? "PM" : "AM";
      const h12 = ((h24 + 11) % 12) + 1;
      return `${h12}:${String(d.getMinutes()).padStart(2,"0")} ${suffix}`;
    }
  }

  _clearWorld() {
    // Detach any CSS3D iframes before tearing down the scene graph.
    // CSS3DRenderer attaches DOM elements on first render but doesn't
    // auto-remove them when objects leave the scene — without this step,
    // iframes from the previous position linger on screen. Also flush
    // a final playback tick + stop the tick interval + destroy the
    // YT.Player so we don't leak timers or sockets.
    this.world.traverse((obj) => {
      const iframe = obj.userData?.iframe;
      if (iframe) {
        const player = obj.userData?.ytPlayer;
        if (player) this._emitPlaybackTick(obj, player);
        this._stopPlaybackTick(obj);
        iframe.remove();
        const id = obj.userData?.iframeId;
        if (id && this._ytPlayers.has(id)) {
          try { this._ytPlayers.get(id)?.destroy?.(); } catch {}
          this._ytPlayers.delete(id);
        }
      }
    });
    while (this.world.children.length) {
      const obj = this.world.children[0];
      this.world.remove(obj);
      // Portal mesh — drop from the active-portal set + dispose the
      // FBO and the mini-scene's owned resources so we don't leak GPU
      // textures when the descriptor refreshes.
      this._disposePortalGroup(obj);
      obj.geometry?.dispose?.();
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
      else obj.material?.dispose?.();
    }
    // Drop every per-entity AnimationMixer for the scene we just
    // tore down. New meshes get fresh mixers when renderDescriptor
    // walks the next descriptor and calls _swapToModel again.
    this._entityMixers.clear();
  }

  /**
   * Preload every glTF the descriptor references. Called before the
   * first paint (and before replay starts) so the scene resolves with
   * loaded models in one frame instead of a sea of placeholder
   * primitives that swap in piecemeal. Returns when every load settles
   * or the 3 s timeout elapses; partial loads fall back to primitives
   * for any model that didn't return in time.
   */
  async preloadDescriptor(desc) {
    const ids = collectModelIds(desc);
    if (ids.length === 0) return;
    await preloadModels(ids, { timeoutMs: 3000 });
  }

  /**
   * Replace a placeholder mesh's children with a loaded glTF clone and
   * apply the render block's scale + rotation. The placeholder group
   * stays so position, userData, and any registered proximity / click
   * handlers keep working unchanged; only the visible mesh contents
   * swap.
   *
   * Async. When `loadModel` returns null (missing asset, network
   * failure, etc.) the placeholder is left in place . the primitive
   * fallback is the correct rendering for an unresolvable model.
   */
  async _swapToModel(group, render, entity = null) {
    if (!group || !render?.model) return;
    const result = await loadModel(render.model);
    if (!result) return;
    const { scene: loadedScene, animations } = result;
    // Dispose and remove the placeholder primitives so they don't leak
    // GPU memory once they're invisible.
    while (group.children.length) {
      const child = group.children[0];
      group.remove(child);
      child.geometry?.dispose?.();
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose?.());
      else child.material?.dispose?.();
    }
    if (render.rotation) {
      const r = render.rotation;
      loadedScene.rotation.set(
        Number.isFinite(r.x) ? r.x : 0,
        Number.isFinite(r.y) ? r.y : 0,
        Number.isFinite(r.z) ? r.z : 0,
      );
    }

    // Compute the loaded scene's bbox in GEOMETRY-LOCAL space BEFORE
    // attaching to the group. At this point loadedScene has no parent,
    // so its world matrix equals its own matrix (identity). The bbox
    // captures the pure geometry extents we'll transform through the
    // group's world matrix at raycast time.
    loadedScene.updateMatrixWorld(true);
    const localBBox = new THREE.Box3().setFromObject(loadedScene);

    group.add(loadedScene);

    // Disable per-triangle raycast on every mesh inside the loaded
    // glTF and put a single bbox check on the outer group instead.
    // This is the dominant per-frame cost for the gaze hover system
    // when characters have ~50k triangles each; the bbox swap drops
    // raycast per entity from O(N tris) to O(1). The hover label
    // logic (which walks up to userData.kind) still finds the right
    // entity because the group carries the kind.
    loadedScene.traverse((node) => {
      if (node.isMesh || node.isSkinnedMesh) {
        node.raycast = NOOP_RAYCAST;
      }
    });

    // Apply scale to the OUTER group, not the inner loaded scene.
    // glTFs from FBX-derived pipelines (Mixamo et al.) often carry
    // baked transforms on intermediate nodes that don't compose
    // predictably with a scale on the scene root. Scaling the outer
    // group cascades over everything inside the parent transform . a
    // value that should be 0.01 actually renders at 0.01x.
    if (typeof render.scale === "number" && Number.isFinite(render.scale) && render.scale > 0) {
      group.scale.setScalar(render.scale);

      // Ground the loaded model. The outer `group` was positioned by
      // the renderer at the primitive placeholder's height (y=0.7 for
      // beings . the placeholder cube was 1.4 tall, centered on the
      // position so its bottom landed at y=0; or y=0 for child / matter
      // entities). Mixamo characters pivot at the feet so the loaded
      // scene's bbox.min.y is near 0 . meaning feet end up at world
      // y=0.7 (floating 0.7 above the floor). Shift the loaded scene
      // downward in group-local space so its bbox bottom lands at
      // world y=0 regardless of pivot location. Sketchfab models with
      // origin at the hip get the same correction.
      const shiftY = -group.position.y / render.scale - localBBox.min.y;
      // Center the model horizontally on its coord. glTFs from
      // pipelines that pivot off-center (corner-pivoted props, asset
      // packs with origin at the bbox edge) otherwise render visibly
      // offset from the cell they're at. Mixamo-style feet-centered
      // characters have bbox center already ~0 on X/Z, so this is a
      // no-op for them.
      const shiftX = -((localBBox.min.x + localBBox.max.x) / 2);
      const shiftZ = -((localBBox.min.z + localBBox.max.z) / 2);
      loadedScene.position.x += shiftX;
      loadedScene.position.y += shiftY;
      loadedScene.position.z += shiftZ;
      // Translate the stored bbox by the same shifts so the proxy
      // raycast (which applies group.matrixWorld to localBBox) sees
      // the correct world bbox after correction.
      localBBox.translate(new THREE.Vector3(shiftX, shiftY, shiftZ));
    }

    // Wire the proxy raycast for the gaze-hover system.
    group.userData._localBBox = localBBox;
    group.raycast = groupBoxRaycast;

    // (bbox diagnostic removed: the per-load log fired on every
    // descriptor re-render, which is many times per minute when the
    // drummer ticks and dancers step. If you need it for scale
    // tuning, uncomment temporarily.)

    // Rung-3 sensory wiring. If the loaded glTF carries animations and
    // the caller passed an entity identifier, instantiate a per-mesh
    // AnimationMixer, build a clip-name → AnimationAction map, find
    // the idle clip (case-insensitive match on "idle"), and start it
    // looping. factDispatcher looks the entity up via
    // getEntityMixerState(kind, id) on every fact-arrival push.
    if (entity?.kind && entity?.id && Array.isArray(animations) && animations.length > 0) {
      const mixer = new THREE.AnimationMixer(loadedScene);
      const actions = new Map();
      let idleAction = null;
      for (const clip of animations) {
        if (!clip || typeof clip.name !== "string") continue;
        const action = mixer.clipAction(clip);
        actions.set(clip.name, action);
        // Strict match: only treat clips actually named "idle" as the
        // looping default. Mixamo's per-animation exports don't ship
        // a real idle, so most characters land here with idleAction
        // null . the dispatcher will play each fact's clip once and
        // clamp at the last frame, which reads as "only animates on
        // fact arrival" (the user's expectation). Authors who want a
        // breathing rest pose should download Mixamo's "Standing Idle"
        // and merge it into the character file as a clip named "idle".
        if (/(^|\W)idle(\W|$)/i.test(clip.name)) idleAction = action;
      }
      if (idleAction) {
        idleAction.setLoop(THREE.LoopRepeat, Infinity).play();
      }
      const key = `${entity.kind}:${entity.id}`;
      this._entityMixers.set(key, {
        mixer,
        actions,
        idleAction,
        renderBlock: render,
      });
    }
  }

  /**
   * Public lookup for factDispatcher. Returns the mixer state for the
   * entity identified by (kind, id), or null if the entity isn't
   * loaded in the current scene (different space, descriptor stale,
   * or the model failed to load and the entity is still a primitive).
   */
  getEntityMixerState(kind, id) {
    if (!kind || !id) return null;
    return this._entityMixers.get(`${kind}:${id}`) || null;
  }

  /**
   * Iterate every entity currently carrying an AnimationMixer in
   * the scene. factDispatcher uses this for population-level fact
   * dispatch: when a fact lands, every entity whose render block
   * names the fact's action reacts, regardless of whether the fact
   * targeted that entity directly. That's how dancers sway when
   * the drum ticks . the chain is the world; each entity declares
   * what events it cares about via its render block.
   */
  getAllEntityMixerStates() {
    return this._entityMixers.values();
  }

  /**
   * Build a stable fingerprint of what renderDescriptor would actually
   * paint. Used to short-circuit repeat renders when the substrate
   * fires invalidates for writes that don't change anything the scene
   * surfaces (per-tick tracking, per-step counters, etc.). Keep it
   * cheap . a JSON string of the consumed fields is fast for typical
   * descriptors and avoids the cost of running renderDescriptor on
   * every qualities.* write.
   */
  _renderSignature(desc, { isAuthenticated, resetCamera }) {
    if (!desc) return null;
    // Beings have a lightweight per-coord delta path (applyPositionDelta
    // fires off `kind:"position"` envelopes and lerps the mesh without
    // a full re-render), so coord is intentionally NOT in the beings
    // signature . including it was the lag root, flipping the sig 10x
    // per walking second.
    const sigBeing = (e) => [
      e?.beingId || e?.name || null,
      e?.qualities?.render?.model || null,
      e?.qualities?.render?.scale ?? null,
    ];
    // Children (spaces) and matter have NO skinny delta path. Their
    // coord changes land only through descriptor refetch + re-render,
    // so coord MUST be in the signature . without it, moving a tree
    // or a drum succeeds at the substrate but the portal repaints to
    // the same old position.
    const coordKey = (c) => c && Number.isFinite(c.x) && Number.isFinite(c.y)
      ? `${c.x},${c.y}${c.z !== undefined ? `,${c.z}` : ""}`
      : null;
    const sigPositional = (e) => [
      e?.matterId || e?.spaceId || e?.name || null,
      coordKey(e?.coord),
      e?.qualities?.render?.model || null,
      e?.qualities?.render?.scale ?? null,
    ];
    const selfId = desc?.identity?.beingId || null;
    // Self being doesn't render (camera IS self). Skip it from the
    // signature so its coord/activity churn never triggers re-render.
    const isSelf = (e) => selfId && e?.beingId && String(e.beingId) === String(selfId);
    const block = {
      addr: desc?.address?.pathByNames || null,
      sid:  desc?.address?.spaceId    || null,
      auth: !!isAuthenticated,
      cam:  !!resetCamera,
      size: desc?.size || null,
      self: selfId,
      // Historical anchor + self coord are part of the signature so
      // every rewind click triggers a fresh render (cam reposition).
      // For live navigation self coord is already excluded from the
      // delta path; the camera is authoritative, no churn risk.
      hist: desc?.isHistorical ? (desc?.asOf?.atTimestamp || desc?.asOf?.atSeq || true) : false,
      selfCoord: coordKey(desc?.identity?.coord),
      branch: desc?.address?.branch || "0",
      beings:   (desc.beings   || []).filter((e) => !isSelf(e)).map(sigBeing),
      matter:   (desc.matter   || []).map(sigPositional),
      children: (desc.children || []).map(sigPositional),
    };
    try {
      return JSON.stringify(block);
    } catch {
      return null;
    }
  }

  _makeBeingMesh(b) {
    // A floating cube with a softer top sphere. Distinct color for
    // cherub so users can find the gate on arrival.
    const isAuth = b.being === "cherub";
    const color = isAuth ? COLOR_BEING_AUTH : COLOR_BEING_OTHER;
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 1.4, 0.9),
      new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: isAuth ? 0.35 : 0.15,
        roughness: 0.6,
      }),
    );
    body.position.y = 0;
    group.add(body);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 16, 12),
      new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: isAuth ? 0.5 : 0.2,
        roughness: 0.5,
      }),
    );
    head.position.y = 1.0;
    group.add(head);
    return group;
  }

  _makeHomeMesh() {
    // A small cottage: cube body + pyramidal roof. Glows softly so
    // it reads as "go home" from a distance.
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 1.8, 2.2),
      new THREE.MeshStandardMaterial({
        color: COLOR_HOME, emissive: COLOR_HOME,
        emissiveIntensity: 0.22, roughness: 0.7,
      }),
    );
    body.position.y = 0.9;
    group.add(body);

    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(1.7, 1.3, 4),
      new THREE.MeshStandardMaterial({
        color: 0x6fa982, emissive: 0x6fa982,
        emissiveIntensity: 0.15, roughness: 0.75,
      }),
    );
    roof.position.y = 2.45;
    roof.rotation.y = Math.PI / 4; // align the flat faces
    group.add(roof);

    // Small door indication so the player can tell which face is front.
    const door = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.9),
      new THREE.MeshStandardMaterial({
        color: 0x2a3a2f, roughness: 0.9, side: 2,
      }),
    );
    door.position.set(0, 0.45, 1.11);
    group.add(door);

    return group;
  }

  // Heaven-door mesh. A tall white panel with a black frame and the
  // child space's name floating in front. Doors ring the room around
  // the I-Am; gazing at one and pressing enter walks the user through
  // to the child space. No glTF . heaven is purely seed-rendered, so
  // it works with no asset bundle installed.
  _makeHeavenDoor(child) {
    const W = 1.6, H = 2.4, T = 0.04;
    const group = new THREE.Group();

    // Frame (a slightly bigger black panel behind the white fill).
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(W + 0.14, H + 0.14, T),
      new THREE.MeshStandardMaterial({
        color: 0x111111, roughness: 0.6, metalness: 0.0,
      }),
    );
    frame.position.set(0, H / 2 + 0.05, 0);
    group.add(frame);

    // Fill (the white interior the player gazes "into").
    const fill = new THREE.Mesh(
      new THREE.BoxGeometry(W, H, T + 0.02),
      new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.4,
        emissive: 0xffffff, emissiveIntensity: 0.15,
      }),
    );
    fill.position.set(0, H / 2 + 0.05, 0.01);
    group.add(fill);

    // Threshold strip at the floor so it reads as standing on the ground.
    const sill = new THREE.Mesh(
      new THREE.BoxGeometry(W + 0.14, 0.05, 0.18),
      new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.7 }),
    );
    sill.position.set(0, 0.025, 0.08);
    group.add(sill);

    // Label plate (a thin black bar above the door fill). The space
    // name renders in the gaze-label UI when you target it; this plate
    // just gives the door a top accent so the user reads "door".
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(W * 0.6, 0.18, T + 0.03),
      new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 }),
    );
    plate.position.set(0, H + 0.05, 0.015);
    group.add(plate);

    // Keep the child reference handy for the label / hover UI without
    // recomputing it from userData every frame.
    group.userData = { ...(group.userData || {}), heavenDoorChildName: child?.name || "" };

    return group;
  }

  // Pyramid mesh used for rulership spaces (and any other space marked
  // with qualities.models.model === "pyramid"). 4-sided cone, sandstone
  // color, base + height grow with sizeHint so larger trees still feel
  // bigger. Rotated so an edge faces the player, not a face.
  _makePyramidMesh(sizeHint = 1) {
    const scale = 1 + Math.log2(Math.max(1, sizeHint)) * 0.55;
    const base = 2.0 * scale;
    const height = 3.2 * scale;
    const group = new THREE.Group();
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(base, height, 4),
      new THREE.MeshStandardMaterial({
        color: 0xc9a87a, emissive: 0x7a5a30, emissiveIntensity: 0.08,
        roughness: 0.85, flatShading: true,
      }),
    );
    // Lift the cone so its base sits on the ground when the group is
    // positioned at (x, 0, z) by the renderer.
    cone.position.y = height / 2;
    cone.rotation.y = Math.PI / 4;
    group.add(cone);
    return group;
  }

  // Dispatch on matter content type. Web/video matter gets a real
  // 3D screen (CSS3DObject wrapping an iframe); everything else falls
  // back to the default glowing cube. Gaze hover shows the matter's
  // preview / label.
  // Which served-from-the-content-store mimes a browser renders
  // natively inside an iframe. Everything else presents as a cube /
  // model with Open / Download in the click menu.
  static EMBEDDABLE_MIME = [
    "application/pdf",
    "image/*",
    "video/*",
    "audio/*",
    "text/plain",
    "text/markdown",
    "text/html",
  ];

  _isEmbeddableMime(mimeType) {
    if (typeof mimeType !== "string" || !mimeType) return false;
    const bare = mimeType.split(";")[0].trim().toLowerCase();
    return Scene.EMBEDDABLE_MIME.some((p) =>
      p === bare || (p.endsWith("/*") && bare.startsWith(p.slice(0, -1))));
  }

  // Resolve what URL (if any) this matter's walk-up screen shows.
  // Returns { url, sandbox } or null (no screen — cube/model form).
  _embedUrlFor(matter) {
    // YouTube rides its own mesh (_makeVideoScreenMesh) for the
    // Player API; not handled here.
    const mime = matter?.mimeType || matter?.content?.mimeType || null;
    const contentUrl = matter?.contentUrl || null;
    const externalUrl = matter?.external?.url || null;
    const mode = matter?.render?.mode || null;

    // http matter (render mode embed): the screen shows the CURRENT
    // page — navigation is a fact (qualities.http.currentUrl, written
    // via set-matter), so every being sees the same page; the
    // content's own url is the DEFAULT the reset action returns to.
    if (mode === "embed" && (externalUrl || contentUrl)) {
      const current = matter?.qualities?.http?.currentUrl;
      const url = (typeof current === "string" && /^https?:\/\//i.test(current))
        ? current
        : (externalUrl || contentUrl);
      return { url, sandbox: null };
    }
    // Files with browser-renderable bytes: the content store serves
    // the right Content-Type; the screen shows the document itself.
    if (contentUrl && this._isEmbeddableMime(mime)) {
      const bare = mime.split(";")[0].trim().toLowerCase();
      const isCasServed = contentUrl.startsWith("/api/");
      return {
        url: contentUrl,
        // Stored HTML must not script against the portal origin.
        sandbox: isCasServed && bare === "text/html" ? "allow-scripts" : null,
      };
    }
    return null;
  }

  _makeMatterMesh(matter) {
    // Portal matter — type "portal" with content { target } (the
    // canonical shape; external surfaces it on descriptor entries),
    // or the legacy qualities.portal.target mirror. Render as a
    // free-standing doorway with a live SEE into the target world
    // painted on the opening. Each viewer's experience is emergent:
    // SEE refused → black opening, SEE accepted → live descriptor
    // rendered on the surface. See seed/CROSS-WORLD.md +
    // materials/portalOp.js for the substrate side.
    if (this._portalTargetOf(matter)) {
      return this._makePortalMesh(matter);
    }
    const contentType = matter?.content?.contentType || null;
    if (contentType === "video/youtube" && matter?.content?.videoId) {
      return this._makeVideoScreenMesh(matter);
    }
    // Walk-up screens: web matter iframes its URL; embeddable files
    // (pdf / image / video / audio / text) iframe their content-store
    // bytes. See _embedUrlFor for the resolution + sandbox rules.
    const embed = this._embedUrlFor(matter);
    if (embed) {
      return this._makeEmbedScreenMesh(matter, embed.url, { sandbox: embed.sandbox });
    }
    const color = 0xb0e0c0;
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 0.5),
      new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 0.35, roughness: 0.55,
      }),
    );
    cube.position.y = 0.9;
    return cube;
  }

  // Portal mesh — a doorway whose opening reflects what the viewer
  // can see at the foreign address. Two display modes share one
  // opening surface:
  //   - canvas texture: loading / refused / unreachable status text
  //   - render-target texture: live 3D view of a mini-scene built from
  //     the foreign descriptor (the "open" state)
  // The render-to-texture pass runs each frame for portals in the
  // "open" state via _renderActivePortals in the main loop.
  // Where this matter's doorway leads, from any of its shapes:
  // type "portal" content {target} (canonical, surfaced as external),
  // or the qualities.portal.target mirror (also what legacy portals
  // carried). Null = not a portal.
  _portalTargetOf(matter) {
    return matter?.external?.target
      || matter?.content?.target
      || matter?.qualities?.portal?.target
      || null;
  }

  _makePortalMesh(matter) {
    const target = this._portalTargetOf(matter);
    const W = 3.2;
    const H = 4.8;
    const group = new THREE.Group();

    // Stone-arch frame around the opening.
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x4a5e51,
      emissive: 0x1a2a20,
      emissiveIntensity: 0.15,
      roughness: 0.85,
    });
    const postGeom = new THREE.BoxGeometry(0.32, H + 0.4, 0.4);
    const lintelGeom = new THREE.BoxGeometry(W + 0.64, 0.32, 0.4);
    const leftPost = new THREE.Mesh(postGeom, frameMat);
    leftPost.position.set(-W / 2 - 0.16, (H + 0.4) / 2, 0);
    group.add(leftPost);
    const rightPost = new THREE.Mesh(postGeom, frameMat);
    rightPost.position.set(W / 2 + 0.16, (H + 0.4) / 2, 0);
    group.add(rightPost);
    const lintel = new THREE.Mesh(lintelGeom, frameMat);
    lintel.position.set(0, H + 0.4 - 0.16, 0);
    group.add(lintel);

    // Canvas texture for status states (loading / refused / unreachable).
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 768;
    const ctx = canvas.getContext("2d");
    this._paintPortalCanvas(ctx, canvas, { state: "loading", target });
    const canvasTex = new THREE.CanvasTexture(canvas);
    canvasTex.minFilter = THREE.LinearFilter;

    // Render target for the live 3D view. Dimensions in PORTAL_CONFIG.
    // The heavy lifting on cost comes from the throttle + distance/
    // direction culling, not pixel count, so we use generous dims for
    // sharpness.
    const renderTarget = new THREE.WebGLRenderTarget(
      PORTAL_CONFIG.RT_WIDTH,
      PORTAL_CONFIG.RT_HEIGHT,
      {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: true,
        stencilBuffer: false,
      },
    );

    // Mini-scene that gets rendered into the FBO. Populated from the
    // foreign descriptor in _populatePortalMiniScene.
    const miniScene = new THREE.Scene();
    // Twilight-blue sky matching the main scene's tone — once
    // populated, the ground hue overrides nothing but sits against
    // this color, giving the portal a "world under sky" feel.
    miniScene.background = new THREE.Color(0x1a2a3a);
    // Push the fog far back so the scene reads as open space, not a
    // claustrophobic box. Fog still hides the horizon but doesn't eat
    // the foreground content.
    miniScene.fog = new THREE.Fog(0x1a2a3a, 25, 80);
    // Brighter lighting so the objects pop — the main scene is dark,
    // so the portal looking BRIGHTER reads as "another world."
    miniScene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(8, 14, 6);
    miniScene.add(sun);
    // Rim light from below to lift the bottoms of objects so they
    // don't look pasted on the ground.
    const fill = new THREE.DirectionalLight(0x88aacc, 0.35);
    fill.position.set(-4, 2, -3);
    miniScene.add(fill);

    // Camera for the mini-scene. Position is updated each frame in
    // _renderActivePortals for a gentle orbit until parallax-from-
    // viewer-position lands.
    const miniCamera = new THREE.PerspectiveCamera(
      60,
      PORTAL_CONFIG.RT_WIDTH / PORTAL_CONFIG.RT_HEIGHT,
      0.1,
      100,
    );
    miniCamera.position.set(0, 5, 12);
    miniCamera.lookAt(0, 0, 0);

    // Opening — starts on the canvas texture (loading state). When the
    // descriptor arrives, we swap the map to renderTarget.texture and
    // the render-to-texture pass takes over.
    const openingMat = new THREE.MeshBasicMaterial({
      map: canvasTex,
      side: THREE.DoubleSide,
    });
    const opening = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      openingMat,
    );
    opening.position.set(0, H / 2, 0);
    group.add(opening);

    // Container for descriptor-driven mini-scene content (so we can
    // clear and rebuild on refresh without disturbing lights).
    const miniWorld = new THREE.Group();
    miniScene.add(miniWorld);

    group.userData = {
      ...(group.userData || {}),
      portal: {
        target,
        // Matter id keys the per-portal walk-through cooldown so two
        // portals at different positions track independent timers.
        matterId: matter?.id || matter?._id || target,
        state: "loading",
        // Status-text canvas (loading / refused / unreachable).
        canvas, ctx, canvasTexture: canvasTex,
        // Live 3D view.
        openingMat,
        renderTarget,
        miniScene,
        miniCamera,
        miniWorld,
        cameraRadius: 12,
      },
    };

    this._activePortals.add(group);
    this._fetchPortalDescriptor(target, group);

    return group;
  }

  // Build the foreign-side mini-scene from a descriptor. Called once
  // when the SEE response arrives (and again on each subsequent
  // refresh). Renders:
  //   - a ground plane sized by descriptor.space.size
  //   - a marker cylinder for each child space (coord placement)
  //   - a glowing sphere for each being
  //   - a small cube for each matter
  _populatePortalMiniScene(group, descriptor) {
    const p = group.userData?.portal;
    if (!p) return;

    // Clear previous content (but keep lights).
    while (p.miniWorld.children.length) {
      const c = p.miniWorld.children.pop();
      if (c.geometry) c.geometry.dispose?.();
      if (c.material) {
        const m = c.material;
        if (Array.isArray(m)) m.forEach((mm) => mm.dispose?.());
        else m.dispose?.();
      }
    }

    const size = descriptor?.space?.size || descriptor?.size || { x: 20, y: 20 };
    const sx = Math.max(4, Math.min(40, Number(size.x) || 20));
    const sz = Math.max(4, Math.min(40, Number(size.y) || 20));

    // Ground plane — color modulated by branch id so different
    // branches read as visibly different worlds. Higher saturation
    // + lightness than before so the world isn't dim soup.
    const branchHash = hashString(p.target);
    const groundColor = new THREE.Color().setHSL((branchHash % 360) / 360, 0.45, 0.42);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(sx, sz),
      new THREE.MeshStandardMaterial({ color: groundColor, roughness: 0.85 }),
    );
    ground.rotation.x = -Math.PI / 2;
    p.miniWorld.add(ground);
    // Match the main scene's fog/sky color so the ground edge fades
    // into the sky rather than ending in a hard line.
    p.miniScene.background = new THREE.Color().setHSL((branchHash % 360) / 360, 0.3, 0.18);
    p.miniScene.fog.color = p.miniScene.background;
    p.cameraRadius = Math.max(sx, sz) * 0.7;

    const placeAt = (coord, fallback = { x: 0, y: 0 }) => {
      const c = coord || fallback;
      const x = (Number(c.x) || 0) - sx / 2;
      const z = (Number(c.y) || 0) - sz / 2;
      return { x, z };
    };

    // Children — beige cylinders.
    const childMat = new THREE.MeshStandardMaterial({ color: 0xc0b090, roughness: 0.7 });
    for (const child of (descriptor.children || []).slice(0, 32)) {
      const { x, z } = placeAt(child.coord);
      const cy = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.6, 12), childMat);
      cy.position.set(x, 0.8, z);
      p.miniWorld.add(cy);
    }

    // Beings — emissive spheres (light blue, glowing).
    const beingMat = new THREE.MeshStandardMaterial({
      color: 0xffe4a8, emissive: 0xffc060, emissiveIntensity: 0.5, roughness: 0.4,
    });
    for (const being of (descriptor.beings || []).slice(0, 32)) {
      const { x, z } = placeAt(being.coord);
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 12), beingMat);
      sphere.position.set(x, 1.2, z);
      p.miniWorld.add(sphere);
    }

    // Matter — small purple cubes.
    const matterMat = new THREE.MeshStandardMaterial({ color: 0x9070d0, roughness: 0.6 });
    for (const m of (descriptor.matter || descriptor.matters || []).slice(0, 32)) {
      const { x, z } = placeAt(m.coord);
      const cube = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), matterMat);
      cube.position.set(x, 0.5, z);
      p.miniWorld.add(cube);
    }

    // Swap the opening material to the render target texture so the
    // live 3D view takes over from the canvas text.
    p.openingMat.map = p.renderTarget.texture;
    p.openingMat.needsUpdate = true;
    p.state = "open";
  }

  _paintPortalCanvas(ctx, canvas, { state, target, descriptor, errorMessage }) {
    const W = canvas.width;
    const H = canvas.height;
    if (state === "loading") {
      // Deep blue gradient while we wait for the SEE response.
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#0a0d2c");
      g.addColorStop(1, "#000010");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#6a8aff";
      ctx.font = "20px monospace";
      ctx.textAlign = "center";
      ctx.fillText("opening…", W / 2, H / 2);
      ctx.font = "14px monospace";
      ctx.fillStyle = "#8aa8dd";
      ctx.fillText(target, W / 2, H / 2 + 28);
    } else if (state === "refused" || state === "error") {
      // Black window — viewer doesn't have SEE permission, or the
      // foreign side is unreachable. Same visual either way; the
      // tooltip (label) names which.
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "#1a1a1a";
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, W - 4, H - 4);
      ctx.fillStyle = "#4a4a4a";
      ctx.font = "14px monospace";
      ctx.textAlign = "center";
      ctx.fillText(state === "refused" ? "no access" : "unreachable", W / 2, H / 2);
      if (errorMessage) {
        ctx.fillText(errorMessage.slice(0, 60), W / 2, H / 2 + 24);
      }
    } else if (state === "open") {
      // Open portal — paint a summary of the foreign descriptor.
      // Future: render-to-texture from a foreign 3D scene; for now,
      // a textual snapshot showing what's in the target space.
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#1a3424");
      g.addColorStop(1, "#0a1a14");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#8fbf9f";
      ctx.font = "20px monospace";
      ctx.textAlign = "center";
      const name = descriptor?.address?.leafName || descriptor?.address?.pathByNames || target;
      ctx.fillText(name, W / 2, 50);
      ctx.font = "13px monospace";
      ctx.fillStyle = "#c8d3cb";
      ctx.fillText(target, W / 2, 78);

      const children = Array.isArray(descriptor?.children) ? descriptor.children : [];
      const matters  = Array.isArray(descriptor?.matters)  ? descriptor.matters  : [];
      ctx.textAlign = "left";
      let y = 130;
      if (children.length > 0) {
        ctx.fillStyle = "#c8d3cb";
        ctx.font = "15px monospace";
        ctx.fillText("children:", 32, y);
        y += 22;
        ctx.fillStyle = "#9ab0a3";
        ctx.font = "13px monospace";
        for (const c of children.slice(0, 8)) {
          ctx.fillText(`  • ${c.name || c.id || ""}`.slice(0, 40), 32, y);
          y += 18;
        }
        y += 8;
      }
      if (matters.length > 0) {
        ctx.fillStyle = "#c8d3cb";
        ctx.font = "15px monospace";
        ctx.fillText(`matter (${matters.length}):`, 32, y);
        y += 22;
        ctx.fillStyle = "#9ab0a3";
        ctx.font = "13px monospace";
        for (const m of matters.slice(0, 10)) {
          const label = m.name || m.id || m.matterId || "";
          ctx.fillText(`  • ${label}`.slice(0, 40), 32, y);
          y += 18;
        }
      }
      if (children.length === 0 && matters.length === 0) {
        ctx.fillStyle = "#8aa898";
        ctx.font = "14px monospace";
        ctx.textAlign = "center";
        ctx.fillText("(empty)", W / 2, H / 2);
      }
    }
  }

  // Walk a removed object (and its descendants) for portal groups;
  // when found, drop from the active set and dispose owned resources.
  _disposePortalGroup(obj) {
    const visit = (node) => {
      const p = node.userData?.portal;
      if (p && this._activePortals?.has(node)) {
        this._activePortals.delete(node);
        p.renderTarget?.dispose?.();
        p.canvasTexture?.dispose?.();
        // Dispose mini-scene meshes (the GroundPlane + child cylinders
        // + being spheres + matter cubes).
        if (p.miniWorld) {
          for (const c of p.miniWorld.children) {
            c.geometry?.dispose?.();
            const mm = c.material;
            if (Array.isArray(mm)) mm.forEach((x) => x.dispose?.());
            else mm?.dispose?.();
          }
        }
      }
      for (const child of (node.children || [])) visit(child);
    };
    visit(obj);
  }

  // Async fetch of the foreign descriptor. Issues a live SEE through
  // the standard client — canopy detects the foreign reality and
  // forwards automatically. On success, populates the mini-scene and
  // swaps the opening's material to the render target texture so the
  // live 3D view takes over. On refused/error, the opening stays on
  // the canvas texture and we paint the status text on it.
  async _fetchPortalDescriptor(target, group) {
    if (!this._client?.see) return;
    try {
      const descriptor = await this._client.see(target);
      if (!group.userData?.portal) return;
      this._populatePortalMiniScene(group, descriptor || {});
    } catch (err) {
      const u = group.userData?.portal;
      if (!u) return;
      const isAuth = err?.code === "FORBIDDEN" || err?.code === "UNAUTHORIZED";
      u.state = isAuth ? "refused" : "error";
      // Re-paint canvas with the status text and make sure the opening
      // is showing the canvas texture (in case it was previously open).
      this._paintPortalCanvas(u.ctx, u.canvas, {
        state: u.state,
        target,
        errorMessage: err?.message || "",
      });
      u.canvasTexture.needsUpdate = true;
      u.openingMat.map = u.canvasTexture;
      u.openingMat.needsUpdate = true;
    }
  }

  // A free-standing video screen — flat WebGL backing + a CSS3D iframe
  // running the YouTube IFrame Player API. Sized in world units; sits
  // on a thin frame so it reads as "a thing sitting on the ground".
  // Generic walk-up screen — the shared shell every embedded surface
  // uses: a grounded 16:9 panel whose face is a CSS3D iframe at
  // 1920×1080 (crisp when the player walks close). Web matter shows
  // its URL; embeddable FILES (pdf / image / video / audio / text)
  // show their content-store bytes via contentUrl (the carrier serves
  // the right Content-Type, browsers render natively); YouTube is one
  // URL-derivation case that additionally wires the Player API.
  //
  // Security: bytes served from the content store share the portal's
  // origin, so a stored text/html document gets sandbox="allow-scripts"
  // WITHOUT allow-same-origin — uploaded markup must never script
  // against the portal origin (JWT cookie). External sites get
  // referrerpolicy=no-referrer and no sandbox (players need scripts;
  // they're already a foreign origin). Frame-refusing sites
  // (X-Frame-Options) show the browser's refusal page — undetectable
  // cross-origin; the matter menu's "Open in new tab" is the fallback.
  _makeEmbedScreenMesh(matter, url, { sandbox = null, allow = null, idPrefix = "embed" } = {}) {
    const W = 6.4; // ~16:9 at 6.4 × 3.6 world units
    const H = 3.6;

    const group = new THREE.Group();

    // WebGL backing plane — silhouette behind the iframe.
    const backing = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide }),
    );
    backing.position.y = H / 2 + 0.4;
    group.add(backing);

    // Stand frame so the screen reads as grounded.
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(W + 0.4, 0.4, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x1a3424, emissive: 0x0e1f15, roughness: 0.6 }),
    );
    frame.position.y = 0.2;
    group.add(frame);

    const iframeId = `${idPrefix}-${matter.matterId || Math.random().toString(36).slice(2)}`;
    const iframe = document.createElement("iframe");
    iframe.id     = iframeId;
    iframe.width  = "1920";
    iframe.height = "1080";
    if (allow) iframe.allow = allow;
    if (sandbox != null) iframe.setAttribute("sandbox", sandbox);
    if (/^https?:\/\//i.test(url)) iframe.referrerPolicy = "no-referrer";
    iframe.allowFullscreen = true;
    iframe.style.border        = "0";
    iframe.style.pointerEvents = "auto";
    iframe.style.background    = "#fff";
    iframe.src = url;

    const css = new CSS3DObject(iframe);
    const scale = W / 1920;
    css.scale.set(scale, scale, scale);
    css.position.y = H / 2 + 0.4;
    css.position.z = 0.01;
    group.add(css);

    group.userData.iframe   = iframe;
    group.userData.iframeId = iframeId;
    group.userData.matterId = matter.matterId;
    group.userData.isScreenMesh = true;

    return group;
  }

  _makeVideoScreenMesh(matter) {
    // The YouTube specialization: same screen shell, plus the Player
    // API wiring (resume position, ENDED → onMatterEnded, playback
    // ticks back to the substrate via save-playback).
    const url =
      `https://www.youtube.com/embed/${encodeURIComponent(matter.content.videoId)}` +
      `?enablejsapi=1&autoplay=1&mute=1&modestbranding=1&rel=0`;
    const group = this._makeEmbedScreenMesh(matter, url, {
      allow: "autoplay; encrypted-media",
      idPrefix: "yt",
    });
    const iframeId = group.userData.iframeId;
    group.userData.videoId     = matter.content.videoId;
    group.userData.isVideoMesh = true;

    // Resume position lives in the matter's qualities so it survives
    // across browsers/devices. Persisted by emitPlaybackTick →
    // llm-assigner:save-playback DO.
    const resumeAt = Number(matter?.qualities?.tutorial?.playbackSeconds);

    // Attach the Player API once it's ready so we can listen for ENDED
    // and tick the current time back to the substrate.
    this._loadYouTubeApi().then(() => {
      // eslint-disable-next-line no-undef
      const player = new YT.Player(iframeId, {
        events: {
          onReady: () => {
            if (Number.isFinite(resumeAt) && resumeAt > 0) {
              try { player.seekTo(resumeAt, true); } catch { /* defensive */ }
            }
            // Autoplay may have already kicked PLAYING before the listener
            // attached, so the state-change event got missed. Check the
            // current state and start ticking if we're already playing.
            try {
              // eslint-disable-next-line no-undef
              if (player.getPlayerState?.() === YT.PlayerState.PLAYING) {
                this._startPlaybackTick(group, player);
              }
            } catch { /* defensive */ }
          },
          onStateChange: (e) => {
            // eslint-disable-next-line no-undef
            const S = YT.PlayerState;
            if (e.data === S.ENDED) {
              this._stopPlaybackTick(group);
              try {
                this.onMatterEnded({
                  matterId: group.userData.matterId,
                  videoId:  group.userData.videoId,
                });
              } catch (err) {
                console.warn("[3D] onMatterEnded handler threw:", err);
              }
              return;
            }
            if (e.data === S.PLAYING) {
              this._startPlaybackTick(group, player);
            }
            if (e.data === S.PAUSED) {
              // Capture the exact pause point, then stop ticking.
              this._emitPlaybackTick(group, player);
              this._stopPlaybackTick(group);
            }
          },
        },
      });
      this._ytPlayers.set(iframeId, player);
      group.userData.ytPlayer = player;
    }).catch((err) => {
      console.warn("[3D] YouTube IFrame API failed to load:", err);
    });

    return group;
  }

  // Save the current playback position to substrate. Idempotent on the
  // server side; safe to call as often as we like.
  _emitPlaybackTick(group, player) {
    try {
      const t = player?.getCurrentTime?.();
      if (!Number.isFinite(t) || t < 0) return;
      this.onMatterPlaybackTick({
        matterId:    group.userData.matterId,
        currentTime: t,
      });
    } catch (err) {
      console.warn("[3D] playback tick failed:", err);
    }
  }

  _startPlaybackTick(group, player) {
    if (group.userData.tickTimer) return; // already ticking
    group.userData.tickTimer = setInterval(
      () => this._emitPlaybackTick(group, player),
      5000,
    );
  }

  _stopPlaybackTick(group) {
    if (group.userData.tickTimer) {
      clearInterval(group.userData.tickTimer);
      group.userData.tickTimer = null;
    }
  }

  // Public: flush a playback position for every live video mesh.
  // Called from main.js on beforeunload; the DO call goes out best-effort
  // and the browser may cut it short, but we try.
  flushPlaybackTicks() {
    this.world.traverse((obj) => {
      const player = obj.userData?.ytPlayer;
      if (player) this._emitPlaybackTick(obj, player);
    });
  }

  _loadYouTubeApi() {
    if (this._ytApiReady) return this._ytApiReady;
    this._ytApiReady = new Promise((resolve) => {
      if (window.YT && window.YT.Player) return resolve();
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof prev === "function") { try { prev(); } catch {} }
        resolve();
      };
    });
    return this._ytApiReady;
  }

  _makeChildMesh(child, sizeHint = 1) {
    // Heaven door at the place root. When the place-root descriptor
    // surfaces heaven as a child, render it as the white-paneled door
    // a reigning being can walk through. Non-reigning beings see the
    // same door but the SEE on the other side denies.
    if (child.heavenSpace === "heaven") return this._makeHeavenDoor(child);

    // Dispatch by the models extension hint. Unknown / missing models
    // fall through to the default tree mesh below.
    const modelName = child.model?.model || null;
    if (modelName === "pyramid") return this._makePyramidMesh(sizeHint);

    // Tree shape grows from "sapling" (sizeHint <= 1) up to a thick
    // multi-branch tree. Trunk radius and tree height scale with
    // sizeHint; leaves cluster at the tips of branches.
    //
    //   sizeHint 1     → sapling: thin stem + one small leaf
    //   sizeHint 2-3   → small tree: thin trunk, a few leaves
    //   sizeHint 4-9   → medium tree: noticeable trunk, several branches
    //   sizeHint 10+   → large tree: thick trunk, full canopy
    const isHome = (child.name || "").startsWith("~");
    const leafColor = isHome ? COLOR_HOME : COLOR_TREE;
    const trunkColor = 0x4a3a2a;
    const group = new THREE.Group();

    if (sizeHint <= 1) {
      // Sapling.
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.09, 0.8, 6),
        new THREE.MeshStandardMaterial({ color: trunkColor, roughness: 0.9 }),
      );
      stem.position.y = 0.4;
      group.add(stem);
      const leaf = new THREE.Mesh(
        new THREE.SphereGeometry(0.35, 10, 8),
        new THREE.MeshStandardMaterial({
          color: leafColor, emissive: leafColor, emissiveIntensity: 0.22,
          roughness: 0.7,
        }),
      );
      leaf.position.y = 0.95;
      group.add(leaf);
      return group;
    }

    // Trunk dimensions scale with size.
    const trunkRadius = 0.12 + Math.min(sizeHint, 30) * 0.04;
    const trunkHeight = 1.2 + Math.min(sizeHint, 30) * 0.12;
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(trunkRadius * 0.7, trunkRadius, trunkHeight, 8),
      new THREE.MeshStandardMaterial({ color: trunkColor, roughness: 0.9 }),
    );
    trunk.position.y = trunkHeight / 2;
    group.add(trunk);

    // Branches + leaves. Branch count grows with size, capped.
    const branchCount = Math.min(2 + Math.floor(Math.sqrt(sizeHint)), 8);
    const canopyBase = trunkHeight - 0.2;
    const leafMat = new THREE.MeshStandardMaterial({
      color: leafColor, emissive: leafColor, emissiveIntensity: 0.18,
      roughness: 0.7,
    });

    // Central crown leaf at the top of the trunk.
    const crown = new THREE.Mesh(
      new THREE.SphereGeometry(0.55 + trunkRadius * 1.4, 12, 10),
      leafMat,
    );
    crown.position.y = trunkHeight + 0.15;
    group.add(crown);

    // Branches spreading outward, each with a leaf cluster at the tip.
    for (let i = 0; i < branchCount; i++) {
      const theta = (i / branchCount) * Math.PI * 2;
      const branchLen = 0.6 + trunkRadius * 1.5;
      const tipX = Math.cos(theta) * branchLen;
      const tipZ = Math.sin(theta) * branchLen;
      const tipY = canopyBase + 0.2;

      // Branch (thin cylinder rotated to point at the tip).
      const branchGeom = new THREE.CylinderGeometry(0.04, 0.07, branchLen, 5);
      const branchMesh = new THREE.Mesh(
        branchGeom,
        new THREE.MeshStandardMaterial({ color: trunkColor, roughness: 0.9 }),
      );
      // Place midway, rotated outward.
      branchMesh.position.set(tipX / 2, canopyBase, tipZ / 2);
      branchMesh.rotation.z = -theta + Math.PI / 2;
      branchMesh.rotation.x = Math.PI / 2;
      branchMesh.rotation.y = theta;
      // Simpler approach: just orient via lookAt
      branchMesh.position.set(tipX / 2, canopyBase + 0.05, tipZ / 2);
      const orient = new THREE.Vector3(tipX, canopyBase + 0.15, tipZ);
      branchMesh.lookAt(orient);
      branchMesh.rotateX(Math.PI / 2);
      group.add(branchMesh);

      // Leaf cluster at the tip.
      const leafRadius = 0.3 + Math.min(sizeHint, 30) * 0.015;
      const leaf = new THREE.Mesh(
        new THREE.SphereGeometry(leafRadius, 10, 8),
        leafMat,
      );
      leaf.position.set(tipX, tipY, tipZ);
      group.add(leaf);
    }

    return group;
  }

  _bindInput() {
    addEventListener("resize", () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });

    addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      // One-shot gameplay actions that should fire on press, not while held.
      if (this.isInputBlocked()) return;
      if (e.code === "KeyV" && !e.repeat) {
        this.noclip = !this.noclip;
        this.velocityY = 0;
        return;
      }
      // Escape cancels an in-flight pick-up. Nothing is written.
      if (e.code === "Escape" && !e.repeat && this._carrying) {
        this._cancelCarry();
        return;
      }
      if (e.code === "Space") {
        // Stop the page from scrolling when Space is consumed by the scene.
        e.preventDefault();
        if (!e.repeat && !this.noclip && this._grounded()) {
          this.velocityY = JUMP_V;
        }
      }
    });
    addEventListener("keyup",   (e) => this.keys.delete(e.code));

    this.canvas.addEventListener("click", () => {
      if (!this.pointerLocked) this.canvas.requestPointerLock?.();
      else this._tryActivate();
    });

    document.addEventListener("pointerlockchange", () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });

    addEventListener("mousemove", (e) => {
      if (!this.pointerLocked) return;
      this.yaw -= e.movementX * LOOK_SENSITIVITY;
      this.pitch -= e.movementY * LOOK_SENSITIVITY;
      this.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, this.pitch));
      this._applyLook();
    });
  }

  _applyLook() {
    const euler = new THREE.Euler(this.pitch, this.yaw, 0, "YXZ");
    this.camera.quaternion.setFromEuler(euler);
  }

  _tick(dt) {
    this._move(dt);
    this._checkGaze();
    this._checkBeingProximity();
    this._updateBeingMovement(dt);
    this._updateActivityBubbles();
    // Rung-3 sensory loop. Advance every per-entity AnimationMixer
    // by this frame's delta. Mixers are populated by _swapToModel
    // when a glTF with animations loads on an entity that came with
    // a render block; the registry is cleared by _clearWorld on
    // navigation. Cost is O(n) over loaded characters per frame.
    if (this._entityMixers.size > 0) {
      for (const state of this._entityMixers.values()) {
        state.mixer.update(dt);
      }
    }
    if (this._skyMode === "default") {
      this._updateTimeOfDay();
      this._driftClouds(dt);
    }
  }

  // Animate each being between its default coord and any active target.
  // Lerp at a fixed rate so the motion reads as "walking up" / "walking
  // back". The server's `activity.target` decides which way; absence of
  // a target means return-to-default.
  _updateBeingMovement(dt) {
    if (!this._beingMeshes) return;
    const speed = 3.5;          // units per second toward target
    const eps = 0.05;            // snap threshold
    for (const [, mesh] of this._beingMeshes) {
      const data = mesh.userData;
      if (!data?.defaultCoord) continue;
      const goal = data.activeTargetCoord || data.defaultCoord;
      const dx = goal.x - mesh.position.x;
      const dz = goal.z - mesh.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= eps) {
        mesh.position.x = goal.x;
        mesh.position.z = goal.z;
        continue;
      }
      const step = Math.min(dist, speed * dt);
      mesh.position.x += (dx / dist) * step;
      mesh.position.z += (dz / dist) * step;
    }
  }

  _updateActivityBubbles() {
    if (!this._activityBubbles || this._activityBubbles.size === 0) return;
    for (const [, entry] of this._activityBubbles) {
      const pos = entry.mesh.position.clone();
      pos.y += 2.2;
      const v = pos.project(this.camera);
      const x = (v.x * 0.5 + 0.5) * this.renderer.domElement.clientWidth;
      const y = (-v.y * 0.5 + 0.5) * this.renderer.domElement.clientHeight;
      const behind = v.z > 1;
      entry.el.style.left = `${x}px`;
      entry.el.style.top  = `${y}px`;
      entry.el.style.display = behind ? "none" : "block";
    }
  }

  _driftClouds(dt) {
    if (!this._clouds) return;
    // Pin the cloud dome to the camera so it always wraps the viewer
    // no matter where they walk. Slow Y-axis rotation reads as wind
    // drift across the sky.
    this._clouds.position.copy(this.camera.position);
    // Time-scale multiplier from the timeline strip's playback state.
    //   1   = live (default drift forward)
    //   0   = paused (in past, no movement)
    //   2/4/8 = fast-forward (matching playback tier)
    //   -1/-2/-4/-8 = rewind (winds blow backward)
    // Set via setCloudTimeScale from main.js on branchbar:cloud-scale.
    const scale = (typeof this._cloudTimeScale === "number")
      ? this._cloudTimeScale
      : 1;
    this._clouds.rotation.y += dt * CLOUD_BASE_DRIFT_RAD_PER_SEC * scale;
    if (this._stars) {
      // Stars pin to the camera. Rotation is owned by _updateTimeOfDay
      // (locked to hour); here we only advance the twinkle clock.
      this._stars.position.copy(this.camera.position);
      if (this._starMat) this._starMat.uniforms.uTime.value += dt;
    }
  }

  // Set the cloud drift multiplier. See _driftClouds for the table of
  // factors. Called from main.js on branchbar:cloud-scale events.
  setCloudTimeScale(factor) {
    this._cloudTimeScale = Number.isFinite(factor) ? factor : 1;
  }

  // Proximity check per being. Fires onBeingProximity when the in-range
  // boolean flips for any being. "In range" means BOTH conditions hold:
  // (1) player is within INTERACT_RANGE of that being's mesh, AND
  // (2) the gaze raycaster is currently on that being. Either condition
  // leaving makes the consumer panel close, so looking away or stepping
  // back frees movement again.
  _checkBeingProximity() {
    const gaze = this.currentGazeTarget;
    const gazingBeing =
      gaze?.userData?.kind === "being" ? gaze.userData.being : null;

    for (const [being, mesh] of this._beingMeshes) {
      const d = this.camera.position.distanceTo(mesh.position);
      const close = d <= INTERACT_RANGE;
      const inRange = close && gazingBeing === being;
      const last = this._lastBeingInRange.get(being) ?? false;
      if (inRange !== last) {
        this._lastBeingInRange.set(being, inRange);
        if (being === "cherub") this._setGlare(mesh, inRange);
        this.onBeingProximity(
          { being, ...(mesh.userData || {}) },
          inRange,
          d,
        );
      }
    }
  }

  // The per-being bubble + the activity-bubble pair retired in favor of
  // ONE display path: _applyBeingActivity reads the server-pushed
  // activity field and renders it above each being's head with per-kind
  // styling (see _renderActivity at the bottom of this file). The local
  // user's own outbound summons are server-derived activity too .
  // multiplayer-visible from every viewer's perspective.

  _move(dt) {
    const blocked = this.isInputBlocked();

    // Horizontal direction from WASD/arrows. Skipped while input is
    // blocked, but gravity / vertical motion still applies so the
    // player doesn't hang in mid-air if a panel opens mid-jump.
    if (!blocked) {
      const dir = new THREE.Vector3();
      if (this.keys.has("KeyW") || this.keys.has("ArrowUp"))    dir.z -= 1;
      if (this.keys.has("KeyS") || this.keys.has("ArrowDown"))  dir.z += 1;
      if (this.keys.has("KeyA") || this.keys.has("ArrowLeft"))  dir.x -= 1;
      if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) dir.x += 1;

      const sprinting = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
      const speed = MOVE_SPEED * (sprinting ? SPRINT_MULT : 1);

      if (dir.lengthSq() > 0) {
        dir.normalize();
        const cos = Math.cos(this.yaw);
        const sin = Math.sin(this.yaw);
        const wx = dir.x * cos + dir.z * sin;
        const wz = -dir.x * sin + dir.z * cos;
        this.camera.position.x += wx * speed * dt;
        this.camera.position.z += wz * speed * dt;
      }

      // Noclip vertical: Space = up, Ctrl/KeyC = down. Sprint also scales it.
      if (this.noclip) {
        const vSpeed = NOCLIP_VERT_SPEED * (sprinting ? SPRINT_MULT : 1);
        if (this.keys.has("Space")) this.camera.position.y += vSpeed * dt;
        if (this.keys.has("KeyC") ||
            this.keys.has("ControlLeft") ||
            this.keys.has("ControlRight")) {
          this.camera.position.y -= vSpeed * dt;
        }
      }
    }

    if (!this.noclip) this._applyGravity(dt);
  }

  _applyGravity(dt) {
    this.velocityY += GRAVITY * dt;
    this.camera.position.y += this.velocityY * dt;
    if (this.camera.position.y <= GROUND_Y) {
      this.camera.position.y = GROUND_Y;
      this.velocityY = 0;
    }
  }

  _grounded() {
    return this.camera.position.y <= GROUND_Y + 0.001;
  }

  _checkGaze() {
    this.gazeForward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.raycaster.set(this.camera.position, this.gazeForward);
    this.raycaster.far = GAZE_RANGE;
    const hits = this.raycaster.intersectObjects(this.world.children, true);
    let target = null;
    let distance = Infinity;
    if (hits.length > 0) {
      let obj = hits[0].object;
      while (obj && !obj.userData?.kind && obj.parent) obj = obj.parent;
      if (obj?.userData?.kind) {
        target = obj;
        distance = this.camera.position.distanceTo(obj.position);
      }
    }
    const withinInteract = !!(target && distance <= INTERACT_RANGE);

    // Glare transitions only on target change (so we clear the old one).
    if (target !== this.currentGazeTarget) {
      this._setGlare(this.currentGazeTarget, false);
      this.currentGazeTarget = target;
    }
    // Update glare every frame based on current proximity.
    this._setGlare(target, withinInteract);

    // Update label every frame so it follows the target. Move mode
    // rewrites the hint text so a click on a tree reads as "pick up"
    // (not "enter"); when carrying, the hint flips to "drop here".
    if (target?.userData?.label) {
      let text = target.userData.label;
      const kind = target.userData.kind;
      if (this._moveMode) {
        if (this._carrying) {
          if (kind === "child" && target.userData.spaceId && target.userData.spaceId !== this._carrying.id) {
            text += "  ·  drop into";
          } else if (kind === "land") {
            text = `drop "${this._carrying.label || ""}" here`;
          } else {
            text += "  ·  drop here";
          }
        } else if ((kind === "child" && target.userData.spaceId) || (kind === "matter" && target.userData.matterId)) {
          text += "  ·  pick up";
        }
      } else if (kind === "being" && withinInteract) {
        text += "  ·  click";
      } else if (kind === "matter" && target.userData.matterId && withinInteract) {
        text += "  ·  click";
      }
      const screen = worldToScreen(target.position, this.camera, this.renderer);
      showLabel(text, screen.x, screen.y);
    } else {
      hideLabel();
    }

    // Notify main.js EVERY frame with the latest target and proximity.
    // The consumer is idempotent (show on already-shown panel is a no-op
    // via internal early-return), so this avoids missed transitions
    // when the user walks slowly across the proximity boundary.
    this.onGaze(target?.userData || null, { withinInteract, distance });

    this._tickGlare();
  }

  // Hazy glare on cherub when gazed at. Pulses emissive intensity and
  // shows a subtle screen-space haze vignette. Cleared on gaze-away.
  _setGlare(target, active) {
    const data = target?.userData;
    const isAuth = data?.kind === "being" && data.being === "cherub";
    if (active && isAuth) {
      this._glare = { target, t: 0 };
      _showGlareVignette(true);
    } else if (this._glare && !active) {
      // Restore the previous emissive intensity.
      _setEmissive(this._glare.target, 0.35);
      this._glare = null;
      _showGlareVignette(false);
    }
  }

  _tickGlare() {
    if (!this._glare) return;
    this._glare.t += 0.05;
    const intensity = 0.6 + Math.sin(this._glare.t) * 0.35;
    _setEmissive(this._glare.target, intensity);
  }

  _tryActivate() {
    // Move mode hijacks click behavior entirely. First click picks
    // up; second click puts down. Esc (handled elsewhere) cancels.
    if (this._moveMode) {
      this._moveClick();
      return;
    }
    const target = this.currentGazeTarget;
    if (!target) return;
    const data = target.userData;
    if (!data) return;
    const d = this.camera.position.distanceTo(target.position);
    // Beings: a click while gazing within INTERACT_RANGE opens their
    // panel (sign-in/logout for cherub, summon panel for everyone else).
    if (data.kind === "being" && d <= INTERACT_RANGE) {
      this.onBeingActivate({ being: data.being, ...data });
      return;
    }
    // Matter: a click opens its action menu (descriptor actions[],
    // Copy id, Wear-this-model for type=model, Set model). Portal
    // matter handles its own walk-through; video screens own their
    // iframe clicks — both carry their own userData kinds, so only
    // plain matter lands here.
    if (data.kind === "matter" && data.matterId && d <= INTERACT_RANGE * 2) {
      this.onMatterActivate({ ...data });
      return;
    }
    // Doorways (trees, home, etc): enter on click.
    if (data.kind === "child" && data.isDoorway && data.address && d <= ENTER_RANGE * 6) {
      this.onEnter({ address: data.address, label: data.label });
    }
  }

  // ── Move tool ──────────────────────────────────────────────────
  //
  // Public surface for the hotbar's "Move" slot. Toggling mode on
  // doesn't change anything on the server. Clicks while the mode is
  // on go through _moveClick; the actual `do move` fact only fires
  // at put-down (a second click on a destination).

  setMoveMode(on) {
    this._moveMode = !!on;
    if (!this._moveMode) this._cancelCarry();
    this._updateMoveBanner();
    this.onMoveModeChange?.(this._moveMode, this._carrying);
  }

  // Top-center banner so the player always knows whether move mode is
  // active. Without it, the same click reads ambiguously — pick up vs
  // enter — and there's no visible state distinguishing the two.
  _updateMoveBanner() {
    if (!this._moveBannerEl) {
      const el = document.createElement("div");
      el.id = "move-banner";
      el.style.cssText = [
        "position: fixed",
        "top: 12px",
        "left: 50%",
        "transform: translateX(-50%)",
        "padding: 6px 14px",
        "background: rgba(100, 140, 220, 0.85)",
        "color: white",
        "font: 600 13px/1.2 system-ui, sans-serif",
        "letter-spacing: 0.06em",
        "text-transform: uppercase",
        "border-radius: 4px",
        "pointer-events: none",
        "z-index: 100",
        "display: none",
      ].join("; ");
      document.body.appendChild(el);
      this._moveBannerEl = el;
    }
    if (this._moveMode) {
      this._moveBannerEl.textContent = this._carrying
        ? `carrying "${this._carrying.label || ""}"`
        : "move tool — click to pick up";
      this._moveBannerEl.style.display = "block";
    } else {
      this._moveBannerEl.style.display = "none";
    }
  }

  isMoveMode() { return this._moveMode; }
  getCarrying() { return this._carrying ? { kind: this._carrying.kind, id: this._carrying.id, label: this._carrying.label } : null; }

  // Cancel any in-flight pick-up without writing a fact. Called by
  // Esc, by setMoveMode(false), and by the post-success cleanup
  // after a successful put-down.
  _cancelCarry() {
    if (this._carrying?.mesh) {
      this._carrying.mesh.position.y = this._carrying.originalY ?? 0;
    }
    this._carrying = null;
    this._updateMoveBanner();
    this.onMoveModeChange?.(this._moveMode, this._carrying);
  }

  _moveClick() {
    const target = this.currentGazeTarget;
    const data = target?.userData || null;
    // No pick-up yet: this click selects what to carry. Must hit a
    // child mesh (a space) or a matter mesh.
    if (!this._carrying) {
      if (!target || !data) return;
      let pickedKind = null;
      let pickedId   = null;
      let pickedLabel = data.label || "";
      if (data.kind === "child" && data.spaceId) {
        pickedKind = "space";
        pickedId   = String(data.spaceId);
      } else if (data.kind === "matter" && data.matterId) {
        pickedKind = "matter";
        pickedId   = String(data.matterId);
      }
      if (!pickedKind) return;
      // Visual cue: lift the mesh slightly so the player sees it's
      // selected. Nothing else changes; no server interaction.
      const originalY = target.position.y;
      target.position.y = originalY + 0.6;
      this._carrying = {
        kind: pickedKind,
        id: pickedId,
        label: pickedLabel,
        mesh: target,
        originalY,
      };
      this._updateMoveBanner();
      this.onMoveModeChange?.(this._moveMode, this._carrying);
      return;
    }
    // Carrying something: this click chooses what to do.
    //
    //   - Click a different child tree → container mode: move the
    //     subject INTO that tree (params.to = child.spaceId).
    //   - Click the land (or anywhere on the ground) inside a sized
    //     space → coord mode: move the subject to the cell under the
    //     click point (params.coord = {x,y}).
    //   - Click nothing useful → cancel via the caller; we no-op
    //     here so the player doesn't lose their carry on a stray
    //     click.
    let intent = null;
    if (data?.kind === "child" && data.spaceId && data.spaceId !== this._carrying.id) {
      intent = {
        kind: this._carrying.kind,
        id:   this._carrying.id,
        mode: "container",
        to:   String(data.spaceId),
        label: this._carrying.label,
        destLabel: data.label || data.spaceId,
      };
    } else if (this._gridSize && this._gridCell) {
      // Coord mode. Use the click point if the raycast hit the land;
      // otherwise fall back to the player's current grid cell.
      let coord = null;
      const hit = this._raycastLand();
      if (hit) {
        coord = this._worldPointToGridCoord(hit.point);
      } else {
        coord = this.getCurrentGridCoord();
      }
      if (coord) {
        intent = {
          kind: this._carrying.kind,
          id:   this._carrying.id,
          mode: "coord",
          coord,
          label: this._carrying.label,
          destLabel: `cell (${coord.x},${coord.y})`,
        };
      }
    }
    if (!intent) {
      // Nothing actionable; leave the carry in place and let the
      // player try again or hit Esc.
      return;
    }
    // Restore the lifted mesh; the descriptor refresh after a
    // successful move will reposition it.
    if (this._carrying.mesh) {
      this._carrying.mesh.position.y = this._carrying.originalY ?? 0;
    }
    this._carrying = null;
    this._updateMoveBanner();
    this.onMoveModeChange?.(this._moveMode, this._carrying);
    this.onMove?.(intent);
  }

  _raycastLand() {
    if (!this._land) return null;
    this.gazeForward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.raycaster.set(this.camera.position, this.gazeForward);
    this.raycaster.far = 200;
    const hits = this.raycaster.intersectObject(this._land, false);
    return hits.length ? hits[0] : null;
  }

  _worldPointToGridCoord(point) {
    if (!this._gridSize || !this._gridCell) return null;
    const cell = this._gridCell;
    const gx = Math.round(point.x / cell + (this._gridSize.x - 1) / 2);
    const gy = Math.round(point.z / cell + (this._gridSize.y - 1) / 2);
    return {
      x: Math.max(0, Math.min(this._gridSize.x - 1, gx)),
      y: Math.max(0, Math.min(this._gridSize.y - 1, gy)),
    };
  }

  getCurrentSpaceId() {
    return this._currentSpaceId || null;
  }

  setCurrentSpaceId(id) {
    this._currentSpaceId = id ? String(id) : null;
  }
}

// True when an input/textarea/contenteditable has focus. Used to gate
// keyboard input that would otherwise be eaten by the canvas listeners.
function isTypingInUI() {
  const el = document.activeElement;
  if (!el || el === document.body) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if (el.isContentEditable) return true;
  return false;
}

// Deterministic non-negative integer hash from a string. Used to scatter
// children at stable angles/radii without requiring server-side layout.
function hashKey(s) {
  const str = String(s || "");
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

// Size hint for tree rendering. Until the server includes a real
// descendant count on each child entry, fall back to noteCount as a
// soft proxy, and to the id hash for stability when neither is present.
// The hint is a small integer used to scale trunk thickness, height,
// and branch count.
function estimateSizeHint(child, hash) {
  if (typeof child.descendantCount === "number") return child.descendantCount;
  if (typeof child.noteCount === "number" && child.noteCount > 0) return child.noteCount;
  // Default fallback: a hash-derived value in 1..12 so most children
  // look like real trees (not all saplings) until the server fills in.
  return 1 + (hash % 12);
}

function beingUserData(b) {
  return {
    kind: "being",
    being: b.being,
    modeKey: b.modeKey || null,
    label: b.label || b.being,
    description: b.description || "",
    icon: b.icon || "",
  };
}

// Short, single-line label for matter's hover tag. Prefer the matter's
// own name (always set by the server), then a preview snippet, then a
// generic kind word. We truncate so a long preview doesn't fill the
// screen.
function matterLabel(mt) {
  const name = (mt.name || "").trim();
  if (name) return name;
  const preview = (mt.preview || "").replace(/\s+/g, " ").trim();
  if (preview) {
    const max = 80;
    return preview.length > max ? preview.slice(0, max) + "..." : preview;
  }
  if (mt?.content?.contentType === "video/youtube") return "video";
  return (mt.kind || "ibp").toLowerCase();
}

// Walk the group and apply an emissive intensity to all child materials.
function _setEmissive(target, intensity) {
  if (!target) return;
  target.traverse?.((obj) => {
    if (obj.material && "emissiveIntensity" in obj.material) {
      obj.material.emissiveIntensity = intensity;
    }
  });
}

// Toggle a screen-space haze vignette element.
let _glareVignette = null;
function _showGlareVignette(on) {
  if (on) {
    if (_glareVignette) return;
    const el = document.createElement("div");
    el.style.cssText = `
      position: fixed; inset: 0; pointer-events: none; z-index: 7;
      background: radial-gradient(ellipse at center,
        rgba(179, 157, 219, 0.15) 0%,
        rgba(179, 157, 219, 0.05) 35%,
        rgba(10, 13, 12, 0) 70%);
      animation: glare-pulse 2.4s ease-in-out infinite;
    `;
    document.body.appendChild(el);
    _glareVignette = el;
  } else {
    _glareVignette?.remove();
    _glareVignette = null;
  }
}

// Activity-bubble renderer. ONE shape per being, driven by the server's
// per-being `activity` field on the place descriptor. Every viewer sees
// the same bubbles because the source is the substrate-derived activity,
// not a per-tab UI side-channel.
//
// Four kinds the server emits:
//
//   summoning . the being is summoning someone. Rendered as
//               `→@<target> <content>` . the primary "what they just
//               said to whom" line. Most visible style.
//
//   acting    . the being is mid-act on a tool call (do/see/be).
//               Rendered as a compact `◇ <action>` pill. Transient.
//
//   summoned  . the being was just summoned. Rendered as
//               `← <content>` . the received message style.
//
//   said      . the being closed its act with a reply. Rendered as
//               the speech-bubble body of `<content>`.
function _renderActivity(el, activity) {
  el.className = "being-activity";
  const kind = activity?.kind || "acting";
  el.classList.add(`being-activity--${kind}`);
  el.innerHTML = "";

  const target = activity?.target;
  const targetName = target?.name || target?.role
    || (target?.beingId ? `${target.beingId.slice(0, 6)}` : null);

  if (kind === "summoning") {
    if (targetName) {
      const arrow = document.createElement("span");
      arrow.className = "being-activity-arrow";
      arrow.textContent = `→@${targetName}`;
      el.appendChild(arrow);
    }
    const body = document.createElement("span");
    body.className = "being-activity-body";
    body.textContent = activity.content || "";
    el.appendChild(body);
    return;
  }

  if (kind === "summoned") {
    const arrow = document.createElement("span");
    arrow.className = "being-activity-arrow being-activity-arrow--in";
    arrow.textContent = "←";
    el.appendChild(arrow);
    const body = document.createElement("span");
    body.className = "being-activity-body";
    body.textContent = activity.content || "";
    el.appendChild(body);
    return;
  }

  if (kind === "acting") {
    const dot = document.createElement("span");
    dot.className = "being-activity-dot";
    dot.textContent = "◇";
    el.appendChild(dot);
    const body = document.createElement("span");
    body.className = "being-activity-body";
    body.textContent = activity.content || "";
    el.appendChild(body);
    return;
  }

  // kind: "said" or anything else . plain prose bubble.
  el.textContent = activity?.content || "";
}


function worldToScreen(pos, camera, renderer) {
  const v = pos.clone();
  v.y += 1.8; // label floats above the object
  v.project(camera);
  const x = (v.x * 0.5 + 0.5) * renderer.domElement.clientWidth;
  const y = (-v.y * 0.5 + 0.5) * renderer.domElement.clientHeight;
  return { x, y };
}

// Sky palette keyframes by hour-of-day (0..24). Lerped between adjacent
// frames. `horizon` is the lower-sky band (where place meets sky), `zenith`
// is the top of the dome. fog uses `horizon` so distant geometry fades
// into the visible horizon line.
const SKY_KEYFRAMES = [
  { h: 0,  horizon: 0x0e121c, zenith: 0x030510, sunI: 0.0,  ambientI: 0.15, sunColor: 0xfff3a8, cloudColor: 0x2c3140, cloudEmissive: 0.02 },
  { h: 5,  horizon: 0x141828, zenith: 0x070a1a, sunI: 0.0,  ambientI: 0.2,  sunColor: 0xffaa66, cloudColor: 0x363b4e, cloudEmissive: 0.02 },
  { h: 6,  horizon: 0xff8855, zenith: 0x5a78a8, sunI: 0.4,  ambientI: 0.4,  sunColor: 0xffaa55, cloudColor: 0xffc890, cloudEmissive: 0.05 },
  { h: 8,  horizon: 0xa0d5f0, zenith: 0x5fa8e0, sunI: 0.85, ambientI: 0.6,  sunColor: 0xfff3a8, cloudColor: 0xffffff, cloudEmissive: 0.04 },
  { h: 12, horizon: 0xb5dcf0, zenith: 0x6fb4e6, sunI: 1.0,  ambientI: 0.7,  sunColor: 0xffffff, cloudColor: 0xffffff, cloudEmissive: 0.04 },
  { h: 17, horizon: 0xa5d0e8, zenith: 0x5fa0d8, sunI: 0.9,  ambientI: 0.65, sunColor: 0xfff3a8, cloudColor: 0xffffff, cloudEmissive: 0.04 },
  { h: 18, horizon: 0xff7040, zenith: 0x4a6890, sunI: 0.5,  ambientI: 0.45, sunColor: 0xffaa55, cloudColor: 0xffc890, cloudEmissive: 0.06 },
  { h: 20, horizon: 0x141828, zenith: 0x070a1a, sunI: 0.05, ambientI: 0.2,  sunColor: 0xff8855, cloudColor: 0x363b4e, cloudEmissive: 0.02 },
  { h: 24, horizon: 0x0e121c, zenith: 0x030510, sunI: 0.0,  ambientI: 0.15, sunColor: 0xfff3a8, cloudColor: 0x2c3140, cloudEmissive: 0.02 },
];

function _skyPalette(h) {
  let lo = SKY_KEYFRAMES[0];
  let hi = SKY_KEYFRAMES[SKY_KEYFRAMES.length - 1];
  for (let i = 0; i < SKY_KEYFRAMES.length - 1; i++) {
    if (h >= SKY_KEYFRAMES[i].h && h <= SKY_KEYFRAMES[i + 1].h) {
      lo = SKY_KEYFRAMES[i];
      hi = SKY_KEYFRAMES[i + 1];
      break;
    }
  }
  const span = hi.h - lo.h;
  const t = span > 0 ? (h - lo.h) / span : 0;
  return {
    horizon:       _lerpColor(lo.horizon, hi.horizon, t),
    zenith:        _lerpColor(lo.zenith,  hi.zenith,  t),
    sunI:          _lerp(lo.sunI, hi.sunI, t),
    ambientI:      _lerp(lo.ambientI, hi.ambientI, t),
    sunColor:      _lerpColor(lo.sunColor, hi.sunColor, t),
    cloudColor:    _lerpColor(lo.cloudColor, hi.cloudColor, t),
    cloudEmissive: _lerp(lo.cloudEmissive, hi.cloudEmissive, t),
  };
}

function _lerp(a, b, t) { return a + (b - a) * t; }

function _lerpColor(a, b, t) {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r  = Math.round(_lerp(ar, br, t));
  const g  = Math.round(_lerp(ag, bg, t));
  const bl = Math.round(_lerp(ab, bb, t));
  return (r << 16) | (g << 8) | bl;
}
