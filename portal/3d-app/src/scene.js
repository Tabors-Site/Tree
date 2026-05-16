// TreeOS Portal 3D — scene.
//
// Builds a Three.js scene with first-person camera, ground plane, lights,
// WASD + mouse-look controls, gaze raycasting, and a renderDescriptor()
// method that lays out children-as-objects and beings-as-figures based
// on the addressed Position's descriptor.

import * as THREE from "three";
import { showLabel, hideLabel, setSkyClock, hideSkyClock } from "./ui.js";

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

const COLOR_BG          = 0x0a0d0c;
const COLOR_TREE        = 0x6fa982;
const COLOR_HOME        = 0x8fbf9f;
const COLOR_BEING_AUTH  = 0xb39ddb;
const COLOR_BEING_OTHER = 0xa3c3b1;

// Visual modes for the land scene.
const VISUAL_ARRIVAL = {
  bgColor:    0x0a0d0c,
  fogNear:    8,
  fogFar:     35,
  groundColor: 0x141a17,
  gridColor:   0x223028,
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

export class Scene {
  constructor({ onGaze, onEnter, onAuthProximity, isInputBlocked } = {}) {
    this.onGaze = onGaze || (() => {});
    this.onEnter = onEnter || (() => {});
    this.onAuthProximity = onAuthProximity || (() => {});
    this.isInputBlocked = isInputBlocked || isTypingInUI;
    this._authBeingMesh = null;
    this._lastAuthInRange = null;

    this.canvas = document.getElementById("scene");
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: true,
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);

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
    this._landTimezone = null;
    this._applyVisualMode(VISUAL_ARRIVAL);

    // Container for descriptor-rendered objects so we can clear/rebuild
    // on each SEE without disturbing the ground/lights.
    this.world = new THREE.Group();
    this.scene.add(this.world);

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
  }

  start() {
    const loop = () => {
      this._tick(this.clock.getDelta());
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    loop();
  }

  // Replace the world with what's described by the given descriptor.
  // Two visual modes for the land zone:
  //   - arrival: matrix-dark ground, only the auth-being visible.
  //     Movement locked. Player faces the auth-being.
  //   - default: grassy field, all beings and children rendered.
  //     Movement unlocked.
  renderDescriptor(desc, { isAuthenticated } = {}) {
    this._clearWorld();
    const isLandZone = desc?.zone === "land";
    const arrival = isLandZone && !isAuthenticated;

    this._applyVisualMode(arrival ? VISUAL_ARRIVAL : VISUAL_DEFAULT);

    const beings = desc?.beings || [];
    const children = desc?.children || [];

    // In arrival mode, render only the auth-being directly in front
    // of the player. Other beings and all children are hidden.
    const beingsToRender = arrival
      ? beings.filter((b) => b.embodiment === "auth")
      : beings;
    const childrenToRender = arrival ? [] : children;

    // Place beings: in arrival mode, the auth-being stands directly
    // ahead. In default mode, beings spread in an arc.
    this._authBeingMesh = null;
    this._lastAuthInRange = null;
    if (arrival) {
      const authBeing = beingsToRender[0];
      if (authBeing) {
        const mesh = this._makeBeingMesh(authBeing);
        mesh.position.set(0, 0.7, -4);
        mesh.userData = beingUserData(authBeing);
        this.world.add(mesh);
        if (authBeing.embodiment === "auth") this._authBeingMesh = mesh;
      }
    } else {
      const beingRadius = 6;
      beingsToRender.forEach((being, i) => {
        const angle = (i / Math.max(1, beingsToRender.length)) * Math.PI - Math.PI / 2;
        const x = Math.cos(angle) * beingRadius;
        const z = -Math.sin(angle) * beingRadius;
        const mesh = this._makeBeingMesh(being);
        mesh.position.set(x, 0.7, z);
        mesh.userData = beingUserData(being);
        this.world.add(mesh);
        if (being.embodiment === "auth") this._authBeingMesh = mesh;
      });
    }

    // In the land zone, when authenticated, drop the signed-in being's
    // home as a small house object you can walk up to and enter.
    if (isLandZone && isAuthenticated) {
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

    // Place children scattered around the player (default mode only).
    // Position from a deterministic hash of the child's id/path so the
    // layout is stable across re-renders. Trunk thickness scales with
    // how many descendants the child has (proxied from noteCount or
    // hash until the server returns real descendant counts).
    childrenToRender.forEach((child) => {
      const key = child.id || child.path || child.name;
      const h = hashKey(key);
      // Spread in a roughly annular ring with a hash-driven angle and
      // radius. Keeps trees far enough from spawn that the player can
      // see the lot of them.
      const angle = (h % 360) * (Math.PI / 180);
      const radius = 22 + ((h >> 9) % 120) * 0.45; // 22..76
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const sizeHint = estimateSizeHint(child, h);
      const mesh = this._makeChildMesh(child, sizeHint);
      mesh.position.set(x, 0, z);
      mesh.userData = {
        kind: "child",
        label: child.name,
        address: child.path,
        type: child.type,
        isDoorway: true,
      };
      this.world.add(mesh);
    });

    // Drop the player at origin. In arrival, face the auth-being (z negative).
    this.camera.position.set(0, 1.7, arrival ? 2 : 8);
    this.yaw = 0;
    this.pitch = 0;
    this.velocityY = 0; // reset any in-flight jump on navigation
    this._applyLook();
  }

  _applyVisualMode(mode) {
    this._skyMode = mode === VISUAL_DEFAULT ? "default" : "arrival";
    this.scene.background = new THREE.Color(mode.bgColor);
    this.scene.fog = new THREE.Fog(mode.bgColor, mode.fogNear, mode.fogFar);
    if (this._ambient)  this._ambient.intensity = mode.ambientI;
    if (this._sun)      this._sun.intensity     = mode.sunI;
    if (this._ground)   this._ground.material.color.set(mode.groundColor);
    if (this._grid) {
      this._grid.material.color = new THREE.Color(mode.gridColor);
    }
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

    this._cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.04,
      roughness: 1.0,
    });
    const cloudSeeds = [
      { x: -45, y: 25, z: -65, s: 0.65 },
      { x:  62, y: 48, z: -32, s: 1.7  },
      { x: -82, y: 36, z:  18, s: 1.0  },
      { x:  32, y: 62, z:  72, s: 2.2  },
      { x: -22, y: 42, z:  88, s: 0.85 },
      { x:  92, y: 55, z:  12, s: 1.4  },
      { x: -62, y: 70, z: -22, s: 1.1  },
      { x:  42, y: 30, z: -82, s: 0.9  },
      { x: -18, y: 78, z: -18, s: 1.9  },
      { x:  75, y: 38, z:  45, s: 0.6  },
      { x: -55, y: 50, z:  55, s: 1.3  },
      { x:  18, y: 22, z: -25, s: 0.75 },
    ];
    this._clouds = [];
    for (const c of cloudSeeds) {
      const cloud = this._makeCloud(c.s, this._cloudMat);
      cloud.position.set(c.x, c.y, c.z);
      // Random drift direction + speed per cloud. Slow enough that
      // motion is just barely perceptible. Y drifts a tiny bit so
      // clouds aren't pinned to a single height line.
      cloud.userData = {
        driftX: (Math.random() - 0.5) * 1.2,
        driftZ: (Math.random() - 0.5) * 1.2,
        driftY: (Math.random() - 0.5) * 0.08,
        baseY:  c.y,
      };
      this._sky.add(cloud);
      this._clouds.push(cloud);
    }

    this.scene.add(this._sky);
    this._sky.visible = false;
  }

  _makeCloud(scale, mat) {
    const g = new THREE.Group();
    const puffs = [
      [ 0,    0,    0,   4.0],
      [ 3.5, -0.5,  0,   3.5],
      [-3,    0.2,  0.5, 3.2],
      [ 1.5,  1.0, -1,   2.8],
      [-1.5, -0.5,  1,   3.0],
    ];
    for (const [x, y, z, r] of puffs) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r * scale, 12, 8), mat);
      m.position.set(x * scale, y * scale, z * scale);
      g.add(m);
    }
    return g;
  }

  // Set the timezone used to compute time-of-day. null = browser local time.
  setLandTimezone(tz) {
    this._landTimezone = tz || null;
    this._lastClockMinute = -1;
    if (this._skyMode === "default") this._updateTimeOfDay();
  }

  _getLocalHour() {
    const tz = this._landTimezone || undefined;
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hour: "numeric", minute: "numeric", hour12: false,
      }).formatToParts(new Date());
      let hour = 0, min = 0;
      for (const p of parts) {
        if (p.type === "hour")   hour = parseInt(p.value, 10);
        if (p.type === "minute") min  = parseInt(p.value, 10);
      }
      // "24" can appear at midnight in some locales; clamp.
      if (hour === 24) hour = 0;
      return hour + min / 60;
    } catch {
      const d = new Date();
      return d.getHours() + d.getMinutes() / 60;
    }
  }

  // Drive sun position, sky color, and light intensity from the land's
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
    this._cloudMat.color.setHex(sky.cloudColor);
    this._cloudMat.emissive.setHex(sky.cloudColor);
    this._cloudMat.emissiveIntensity = sky.cloudEmissive;
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
      // y ranges roughly [-450, 450]. Bias horizon up so the band where
      // ground meets sky is the most "horizon-y", with zenith taking the
      // upper dome.
      const t = Math.max(0, Math.min(1, (y + 50) / 380));
      const r = (hr + (zr - hr) * t) / 255;
      const g = (hg + (zg - hg) * t) / 255;
      const b = (hb + (zb - hb) * t) / 255;
      col.setXYZ(i, r, g, b);
    }
    col.needsUpdate = true;
  }

  _formatLocalTime() {
    const tz = this._landTimezone || undefined;
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
    while (this.world.children.length) {
      const obj = this.world.children[0];
      this.world.remove(obj);
      obj.geometry?.dispose?.();
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
      else obj.material?.dispose?.();
    }
  }

  _makeBeingMesh(being) {
    // A floating cube with a softer top sphere. Distinct color for the
    // auth-being so users can find it on arrival.
    const isAuth = being.embodiment === "auth";
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

  _makeChildMesh(child, sizeHint = 1) {
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
      else this._tryEnter();
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
    this._checkAuthProximity();
    if (this._skyMode === "default") {
      this._updateTimeOfDay();
      this._driftClouds(dt);
    }
  }

  _driftClouds(dt) {
    if (!this._clouds) return;
    for (const cloud of this._clouds) {
      const d = cloud.userData;
      cloud.position.x += d.driftX * dt;
      cloud.position.z += d.driftZ * dt;
      cloud.position.y += d.driftY * dt;
      // Wrap horizontally so clouds keep circling around the player
      // forever instead of drifting off into the void.
      if (cloud.position.x >  110) cloud.position.x = -110;
      if (cloud.position.x < -110) cloud.position.x =  110;
      if (cloud.position.z >  110) cloud.position.z = -110;
      if (cloud.position.z < -110) cloud.position.z =  110;
      // Keep vertical drift bounded around the cloud's base height.
      if (cloud.position.y > d.baseY + 6) d.driftY = -Math.abs(d.driftY);
      if (cloud.position.y < d.baseY - 6) d.driftY =  Math.abs(d.driftY);
    }
  }

  // Pure proximity check for the auth-being. Fires onAuthProximity when
  // the in-range boolean changes. Fires when BOTH conditions hold:
  // (1) the player is within INTERACT_RANGE of the auth-being, AND
  // (2) the gaze raycaster is currently on the auth-being. Either
  // condition leaving makes the panel close, so looking away frees
  // movement again.
  _checkAuthProximity() {
    if (!this._authBeingMesh) {
      if (this._lastAuthInRange) {
        this._lastAuthInRange = false;
        this.onAuthProximity(false, Infinity);
      }
      return;
    }
    const d = this.camera.position.distanceTo(this._authBeingMesh.position);
    const close = d <= INTERACT_RANGE;
    const gazingAtAuth =
      this.currentGazeTarget?.userData?.kind === "being" &&
      this.currentGazeTarget?.userData?.embodiment === "auth";
    const inRange = close && gazingAtAuth;
    if (inRange !== this._lastAuthInRange) {
      this._lastAuthInRange = inRange;
      this._setGlare(this._authBeingMesh, inRange);
      this.onAuthProximity(inRange, d);
    }
  }

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

    // Update label every frame so it follows the target.
    if (target?.userData?.label) {
      const screen = worldToScreen(target.position, this.camera, this.renderer);
      showLabel(target.userData.label, screen.x, screen.y);
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

  // Hazy glare on the auth-being when gazed at. Pulses emissive intensity
  // and shows a subtle screen-space haze vignette. Cleared on gaze-away.
  _setGlare(target, active) {
    const data = target?.userData;
    const isAuth = data?.kind === "being" && data.embodiment === "auth";
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

  _tryEnter() {
    if (!this.currentGazeTarget) return;
    const data = this.currentGazeTarget.userData;
    if (data?.kind !== "child" || !data.isDoorway || !data.address) return;
    const d = this.camera.position.distanceTo(this.currentGazeTarget.position);
    if (d > ENTER_RANGE * 6) return; // need to be at least somewhat close
    this.onEnter({ address: data.address, label: data.label });
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

function beingUserData(being) {
  return {
    kind: "being",
    embodiment: being.embodiment,
    label: being.label || being.embodiment,
    description: being.description || "",
    icon: being.icon || "",
  };
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
    if (!document.getElementById("glare-style")) {
      const style = document.createElement("style");
      style.id = "glare-style";
      style.textContent = `
        @keyframes glare-pulse {
          0%, 100% { opacity: 0.6; }
          50%      { opacity: 1.0; }
        }
      `;
      document.head.appendChild(style);
    }
    document.body.appendChild(el);
    _glareVignette = el;
  } else {
    _glareVignette?.remove();
    _glareVignette = null;
  }
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
// frames. `horizon` is the lower-sky band (where land meets sky), `zenith`
// is the top of the dome. fog uses `horizon` so distant geometry fades
// into the visible horizon line.
const SKY_KEYFRAMES = [
  { h: 0,  horizon: 0x141a35, zenith: 0x05081a, sunI: 0.0,  ambientI: 0.15, sunColor: 0xfff3a8, cloudColor: 0x2a3550, cloudEmissive: 0.02 },
  { h: 5,  horizon: 0x2a3055, zenith: 0x101830, sunI: 0.0,  ambientI: 0.2,  sunColor: 0xffaa66, cloudColor: 0x3a4560, cloudEmissive: 0.02 },
  { h: 6,  horizon: 0xff8855, zenith: 0x5a78a8, sunI: 0.4,  ambientI: 0.4,  sunColor: 0xffaa55, cloudColor: 0xffc890, cloudEmissive: 0.05 },
  { h: 8,  horizon: 0xa0d5f0, zenith: 0x5fa8e0, sunI: 0.85, ambientI: 0.6,  sunColor: 0xfff3a8, cloudColor: 0xffffff, cloudEmissive: 0.04 },
  { h: 12, horizon: 0xb5dcf0, zenith: 0x6fb4e6, sunI: 1.0,  ambientI: 0.7,  sunColor: 0xffffff, cloudColor: 0xffffff, cloudEmissive: 0.04 },
  { h: 17, horizon: 0xa5d0e8, zenith: 0x5fa0d8, sunI: 0.9,  ambientI: 0.65, sunColor: 0xfff3a8, cloudColor: 0xffffff, cloudEmissive: 0.04 },
  { h: 18, horizon: 0xff7040, zenith: 0x4a6890, sunI: 0.5,  ambientI: 0.45, sunColor: 0xffaa55, cloudColor: 0xffc890, cloudEmissive: 0.06 },
  { h: 20, horizon: 0x2a3055, zenith: 0x101830, sunI: 0.05, ambientI: 0.2,  sunColor: 0xff8855, cloudColor: 0x3a4560, cloudEmissive: 0.02 },
  { h: 24, horizon: 0x141a35, zenith: 0x05081a, sunI: 0.0,  ambientI: 0.15, sunColor: 0xfff3a8, cloudColor: 0x2a3550, cloudEmissive: 0.02 },
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
