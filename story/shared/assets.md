Here's the comprehensive reference. I'll write it as a single document covering the substrate, how a being changes its skin, and the optimization roadmap. Save this and point your agent at it whenever the topic comes up.

---

# TreeOS Sensory Pipeline — Complete Reference

This document covers the full lifecycle of how visual and auditory rendering works in TreeOS: how extensions ship their own models and sounds, how the portal renders them, how a being changes its own skin, and how to scale this system to many beings and complex scenes without performance loss. Read top to bottom for the full picture; sections are independent if you need a specific piece.

---

## Part I — The Architecture, Stated Plainly

### The principle

Rendering in TreeOS is a pure function of the fact stream. The chain holds what happened; the portal renders the consequences. There is no separate "what does this look like" state — every visual or audible event is a derived consequence of a fact landing on a reel, dispatched by the portal to whichever sensory channels the affected entity declares.

This means: replay-from-zero produces the same visual sequence. Two users viewing the same dance floor see the same animations at the same beats. The audiovisual world is a *projection* of the chain, just like coordinates and possession and identity. Nothing is hidden in client-side state; everything is recoverable from the chain.

The portal is a renderer of fact streams across multiple sensory channels:

- **Visual** — meshes, animations, transformations
- **Auditory** — sounds, music, ambient
- (Future channels — particle effects, haptics, voice synthesis, screen reader, all use the same shape)

Each channel reads from `qualities.render` on the rendered entity. Each channel responds independently to fact arrivals. A fact's arrival can trigger animation and sound and a particle effect simultaneously — all driven by the same chain event.

### The four pieces of the pipeline

1. **Assets** — the binary files (glTF models, MP3 sounds) that the portal renders or plays. These live on disk, served by the substrate via HTTP static file serving.

2. **Declarations** — extensions or beings declare what assets exist and how they're addressed. This lives in extension manifests (for extension-supplied assets) or in matter (for user-uploaded assets).

3. **Render blocks** — each matter, space, or being can carry a `qualities.render` block declaring its visual/auditory representation: which model to use, which animations fire on which fact-actions, which sounds play on which fact-actions.

4. **Dispatch** — when a fact lands on a subscribed reel, the portal looks up the affected entity's render block and dispatches to the appropriate channels in parallel.

---

## Part II — Extension-Provided Assets

### How extensions ship assets

Each extension can ship its own assets bundled with its code. The structure on disk:

```
reality/extensions/<extension-name>/
├── manifest.js
├── ops/
├── ables/
├── seeds/
└── assets/
    ├── models/
    │   ├── drum.glb
    │   ├── dancer.glb
    │   └── drummer.glb
    └── sounds/
        ├── drum-hit.mp3
        └── footstep.mp3
```

Models and sounds live in their respective subdirectories under `assets/`. File formats:

- **Models**: glTF binary (`.glb`) is the only supported format. Don't use FBX (proprietary, larger), don't use OBJ (no animations or skeletons). The glTF standard is web-native, three.js loads it directly, and it supports skeletal animation and embedded animations.
- **Sounds**: MP3 or OGG for normal use. WAV for ultra-short percussive sounds (under 100ms) where decode latency matters.

### Manifest declaration

The extension's `manifest.js` declares which assets it provides:

```js
export default {
  name: "harmony",
  
  // ... existing fields (ops, ables, seeds) ...

  provides: {
    assets: {
      models: {
        "drum":    "models/drum.glb",
        "dancer":  "models/dancer.glb",
        "drummer": "models/drummer.glb",
      },
      sounds: {
        "drum-hit": "sounds/drum-hit.mp3",
        "footstep": "sounds/footstep.mp3",
      },
    },
  },
}
```

The keys on the left (`"drum"`, `"drum-hit"`) are the names extensions use when referencing assets — `"harmony:drum"` resolves to harmony's `models["drum"]`. The values on the right are paths inside the `assets/` directory.

### How the substrate mounts these

At extension load, the substrate:

1. Walks the `assets/` directory and validates each file.
2. Enforces per-file size limits and per-extension cumulative limits (see Part VI).
3. Generates a runtime manifest at `/assets/<extension-name>/manifest.json` combining all declared models and sounds with their resolved paths.
4. Mounts `/assets/<extension-name>/*` as an Express static-file route serving the `assets/` directory.

The portal fetches `/assets/<extension>/manifest.json` once when first encountering an extension reference; subsequent asset URLs are constructed from the manifest's path mappings.

### Asset references in render blocks

Anywhere a render block needs to reference an extension asset, it uses the `<extension>:<asset-name>` format:

```js
qualities.render = {
  model: "harmony:drum",
  sounds: { "harmony:tick": "harmony:drum-hit" },
}
```

The portal sees the prefix `harmony:`, fetches harmony's manifest, finds the asset path, and constructs the URL `/assets/harmony/models/drum.glb` (or `/assets/harmony/sounds/drum-hit.mp3`).

---

## Part III — The Render Block Schema

Every matter, space, and being can carry a `qualities.render` block declaring its sensory representation. This is the canonical schema:

```js
qualities.render = {
  model: "<asset-reference>",           // optional — model to render
  scale: 1.0,                            // optional — uniform scale, default 1.0
  rotation: { x: 0, y: 0, z: 0 },        // optional — initial rotation in radians
  animations: {                          // optional — fact-action → animation clip name
    "harmony:step": "step",
    "harmony:tick": "sway-on-beat",
  },
  sounds: {                              // optional — fact-action → sound asset reference
    "harmony:step": "harmony:footstep",
    "harmony:tick": "harmony:drum-hit",
  },
}
```

Every field is optional. Missing `model` means primitive fallback (cube, sphere, grid depending on entity kind). Missing `animations` means no event animations — the model plays its default `idle` clip continuously. Missing `sounds` means silence.

The schema is closed — the substrate rejects unknown top-level keys to catch typos. Future channels (particle effects, haptic feedback, voice synthesis) will be added as additional top-level keys (`effects`, `haptics`, etc.); the substrate ships ready to validate them once they're added to the canonical schema.

### Writing render blocks

The only legitimate writer of `qualities.render` is the seed-level `set-render` DO operation. Ables authorized to use it declare `canDo: ["set-render"]`. The operation takes the full schema as args:

```js
do(targetId, "set-render", {
  model: "harmony:dancer",
  animations: { "harmony:step": "step" },
  sounds: { "harmony:step": "harmony:footstep" },
})
```

The op writes the block to `qualities.render` via the standard set-qualities path. The fact stamps on the target's reel. The reducer projects it onto the row. The portal reads it via SEE.

Replay-from-zero reproduces render blocks identically — they're just qualities, folded from the reel.

### Standard animation clip names

When a model includes animations, name the clips using a small standard vocabulary:

- `idle` — default loop, plays when no event animation is active. **Required for any character model** — without it the character freezes between events.
- `walk` or `step` — moving
- `run` — moving fast
- `wave`, `point`, `dance` — gesture animations
- Plus any extension-specific names (`drum`, `tick`, `pulse`, etc.)

Using standard names lets the portal auto-wire common animations during user upload (Part V). If your model's clips have weird names (`mixamo.com|Walking`), the user must explicitly map them or rename them in Blender first.

---

## Part IV — How the Portal Renders

### Initial render

When the portal opens a space or being, it walks the descriptor and for each entity:

1. Check for `qualities.render.model`.
2. If absent, render the primitive fallback (cube for matter, capsule for being, grid for space).
3. If present, resolve the asset reference:
   - If `<extension>:<name>`, look up in the extension's manifest, build the URL.
   - If `matter:<id>` (user content), look up the matter, read its content path, build the URL. (See Part V.)
4. Fetch the glTF, parse with `GLTFLoader`, instantiate as a `THREE.Group` in the scene.
5. Apply scale and rotation from the render block.
6. Position at the entity's coords.

The glTF loader runs async — for the first load, show a primitive placeholder until the model loads, then swap. On subsequent loads of the same model URL, the cached version returns instantly.

### Animation playback

When a glTF loads with animations, set up an `AnimationMixer`:

```js
const mixer = new THREE.AnimationMixer(loadedScene);
const actions = {};
for (const clip of gltf.animations) {
  actions[clip.name] = mixer.clipAction(clip);
}
// Play idle by default
if (actions.idle) {
  actions.idle.setLoop(THREE.LoopRepeat).play();
}
```

Each frame, advance the mixer: `mixer.update(deltaTime)`. The character's bones interpolate; the model moves continuously.

### Fact-arrival dispatch

The portal subscribes to reels for entities in the current scene. When a fact seals on any of those reels, the server pushes:

```js
{
  kind: "fact",
  payload: {
    targetKind: "matter" | "space" | "being",
    targetId: "<uuid>",
    action: "<fact-action-string>",
    at: "<iso-timestamp>",  // optional, for rhythm-precise scheduling
  }
}
```

The portal handles the push by walking visible entities and dispatching:

```js
for (const entity of visibleEntities) {
  const render = entity.qualities?.render;
  if (!render) continue;
  
  // Animation dispatch
  const clipName = render.animations?.[fact.action];
  if (clipName && entity.actions[clipName]) {
    entity.actions[clipName]
      .reset()
      .setLoop(THREE.LoopOnce)
      .play();
    // On end, return to idle
    mixer.addEventListener("finished", () => {
      entity.actions.idle?.reset().play();
    });
  }
  
  // Sound dispatch
  const soundRef = render.sounds?.[fact.action];
  if (soundRef) {
    const buffer = await getAudioBuffer(soundRef);
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.start(0);
  }
  
  // Future channels would dispatch here in parallel
}
```

Both channels (animation, sound) run in parallel. Both are no-ops if their mapping isn't declared. Both can fire for the same fact arrival — the drum's tick animates the drum AND plays drum-hit.mp3 AND animates the drummer's strike AND animates every dancer's sway-on-beat AND plays footstep sounds for dancers stepping — all from the same atomic fact.

### Subscription scope

A dancer reacting to the drum's tick is implemented through subscription. The dancer's render block declares `"harmony:tick": "sway-on-beat"` — even though `harmony:tick` facts land on the *drum's* reel, the dispatch logic walks every visible entity and matches the fact's action against each entity's render mappings. Any entity that names `harmony:tick` in its animations or sounds reacts.

This makes population-level rhythm work naturally: 50 dancers all react to one drum tick because all 50 dancers' render blocks declare a mapping for that action.

### Browser audio policy

Browsers refuse to play audio until they see a user interaction. The first time the portal tries to play a sound:

```js
if (audioCtx.state === "suspended") {
  // Show "tap to enable sound" overlay
  // On click: audioCtx.resume()
}
```

After the first interaction, audio works normally. Pre-decode `AudioBuffer`s when the portal first sees a sound reference in a descriptor — by the time the first fact arrives, the buffer is ready.

### Rhythm-precise timing

For musical content where timing jitter is perceptible (the drum's tick must hit on-beat), the fact's `at` timestamp is used to schedule playback:

```js
const factTime = new Date(fact.at).getTime();
const audioCtxTime = audioCtx.currentTime + (factTime - Date.now()) / 1000;
source.start(audioCtxTime);  // schedule precisely
```

This requires the fact to be published slightly *ahead* of its intended play time (server publishes "tick at T+50ms", portal receives within 20ms, schedules audio for T+50ms — perfect timing despite network jitter).

For non-rhythmic sounds (footsteps, chimes), play-on-arrival (`source.start(0)`) is fine. Don't bother with scheduling unless rhythm precision is measurably needed.

---

## Part V — User-Uploaded Skins

### The architecture

A being changing its appearance — uploading a custom character and becoming it — uses the same render pipeline as extension assets, with one new prefix: `matter:`.

User-uploaded assets are stored as **matter**. A user uploads a `.glb`, the substrate creates a matter row with `kind: "asset:model"` whose content is the file. The user's being then references that matter as its skin via `set-render`. The portal resolves `matter:<id>` by fetching the matter, reading its content path, loading the file.

No new endpoints, no new verbs. Skin upload is two ordinary acts plus byte transport.

### The full flow

When a user drags a `.glb` onto their being in the portal:

**Step 1: Client-side validation.** Portal validates file type (whitelist: `.glb`, `.gltf`, `.mp3`, `.ogg`, `.wav`) and size (15 MB for models, 5 MB for sounds). Reject early with actionable error messages.

**Step 2: Inspect animation clip names.** The portal reads the glTF header without rendering — just JSON-parses the `animations` array — to extract clip names. Mixamo files typically have names like `mixamo.com|Idle`, `mixamo.com|Walking`. Authored files have varied names.

**Step 3: Auto-map standard names.** If the file has clips named `idle`, `step`, `walk`, etc., the portal pre-fills the mapping. The upload "just works."

**Step 4: Show clip-mapping UI if needed.** If standard names aren't found, the portal shows a small dialog:

> Found 3 clips: `mixamo.com|Idle`, `mixamo.com|Walking`, `mixamo.com|Standing`
> 
> Assign clips to slots:
> - **idle:** [dropdown of clip names]
> - **step:** [dropdown of clip names]
> - **wave:** [dropdown, optional]
> 
> [Submit] [Cancel]

User picks a clip per slot, or leaves a slot empty (that animation won't fire). Submits.

**Step 5: Create the matter via IBP.** Client fires:

```js
do(<uploadSpace>, "create-matter", {
  kind: "asset:model",
  contentHandle: <new-uuid>,
  contentMeta: {
    size: <file size>,
    type: "model/gltf-binary",
    name: <original filename>,
    animationClips: [<extracted clip names>],
  }
})
```

The matter is created immediately with `content: { pending: true, handle, meta }`. The fact lands on the chain.

**Step 6: Stream bytes via existing upload route.** Client `PUT`s the file bytes to the existing `/api/v1/uploads` route, keyed by the content-handle. Server:

1. Validates the handle exists in a pending matter.
2. Validates the operator is connected to the being doing the upload.
3. Validates the file size matches `contentMeta.size`.
4. Writes the bytes to `data/content/<sha-hash-of-bytes>.glb`.
5. Updates the matter's content: `content: { path: "data/content/<hash>.glb", size, type, animationClips }`.

**Step 7: Set the being's render.** Client fires:

```js
do(self, "set-render", {
  model: "matter:<matter-id>",
  animations: {
    "harmony:step": "<user's chosen clip for step>",
    "harmony:tick": "<user's chosen clip for idle/tick>",
  },
})
```

The being's `qualities.render` updates. The fact lands on the being's reel.

**Step 8: Portal renders.** The portal sees the new render. Asset resolver sees `matter:` prefix, fetches the matter, reads `content.path`, loads the .glb. AnimationMixer sets up with the loaded clips. Other beings viewing this being see the same model — the render block is on the chain, so anyone folding the being's qualities sees the same skin.

### Asset references with two prefixes

The portal's asset resolver handles two prefix shapes:

- `<extension-name>:<asset-name>` — extension-supplied assets. Lookup against the extension manifest.
- `matter:<matter-id>` — user-uploaded content. Lookup against the matter row.

Both resolve to a URL the portal fetches via standard HTTP.

### Quotas and limits

To prevent runaway storage growth:

- **Per-file (uploaded matter):** same as extensions. 15 MB models, 5 MB sounds.
- **Per-being cumulative:** 50 MB total across all asset-matter the being has created. Generous enough for a character + animations + several sounds; tight enough that runaway beings can't fill the server.
- **Per-operator cumulative:** 500 MB across all beings the operator owns. Prevents one operator with 100 beings from gobbling disk.

Quotas are enforced server-side at the byte-upload step. Rejection messages should be actionable: "50 MB cap reached. Delete an older skin to make room."

### Auth

- Upload route: operator must be connected to the being creating the matter (single-writer doctrine — only the owning identity can author their being's assets).
- Set-render: standard verb auth — only the being itself (or someone connected to it) can write its own qualities.
- Cross-being skin reference: a being can `set-render` referencing any matter it can SEE. This makes skin sharing free — one being's uploaded skin can be reused by another being if it has SEE access. No marketplace mechanism needed yet.

### Skin history is on the chain

Every `set-render` fact stamps on the being's reel. The full history of a being's appearance is recoverable by folding:

- "I uploaded skin A at time T1."
- "I switched to skin B at time T2."
- "I switched back to skin A at time T3."

Replay-from-zero reconstructs the visual history exactly — every skin change appears at the seq it was made.

### One important note: assets aren't part of replay correctness

If a user deletes a skin file (via a future "delete-matter" verb), their being's render still references `matter:<id>` but the file is gone. Replay shows the primitive fallback for that being during the period it referenced the deleted matter.

This is correct behavior, but worth documenting: **the fact stream is replayable; the visual fidelity depends on assets being present.** The chain holds the truth ("I set my render to this matter at time T"); the file is just bytes that may or may not be available later. This matches how every distributed system handles binary asset references — the database holds references, files live in object storage with their own lifecycle.

### Clip-mapping UI (more detail)

The dialog is small and focused. Inputs:

- File metadata (name, size, type)
- Extracted clip names from the file

Outputs (when submitted):

- A `{factAction: clipName}` map for whichever slots the user filled
- Optional: a name/label for the skin (defaults to filename minus extension)

When submitted, the panel dispatches the three steps (create-matter, byte upload, set-render). Show progress for the byte upload. On success, the being's appearance updates live.

Build this dialog using your structured-UI-language layer if available; otherwise as a one-off component for now.

---

## Part VI — Performance and Optimization

### The principle

Performance issues with this architecture are almost always *implementation* issues, not *architectural* issues. Every comparable platform (VRChat, Resonite, Mozilla Hubs, Roblox) uses the same underlying pattern — user-uploaded glTF assets, render blocks declaring presentation, fact-driven dispatch. They solved performance with a standard optimization stack, not by changing paradigms.

Apply optimizations in the order below. Each one has a measurable benefit. Don't pre-optimize, but don't skip optimizations either when the symptoms appear.

### Optimization 1: Draco compression

This is the single biggest win and should be done before anything else. Every shipped `.glb` should be Draco-compressed.

Tool: `gltf-pipeline` (npm package).

```bash
npm install -g gltf-pipeline
gltf-pipeline -i dancer.glb -o dancer.glb -d
```

The `-d` flag enables Draco compression. Typical results: 5-10x file size reduction with no visible quality loss. A 5 MB character model becomes 500 KB - 1 MB.

Apply this to every model in the extension's `assets/models/` directory before shipping. Document it in EXTENSION_FORMAT.md as required for any shipped asset.

For user uploads, optionally apply Draco compression server-side during the byte-write step. The user uploads an uncompressed file; the server compresses it before writing to disk. Adds maybe 1 second to upload processing, dramatically reduces storage and bandwidth.

The portal's `GLTFLoader` decompresses Draco automatically — needs the DRACOLoader plugin, which three.js ships. Wire it up at portal init:

```js
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('/draco/');  // path to draco decoder files
gltfLoader.setDRACOLoader(dracoLoader);
```

The Draco decoder runs in a Web Worker (doesn't block the main thread).

### Optimization 2: Texture compression

Texture data is often the bulk of a model's size. Uncompressed PNG textures are huge; compressed formats reduce them dramatically.

Use **KTX2** with Basis Universal compression. Like Draco for meshes, KTX2 is the standard compressed-texture format for glTF.

Tool: `toktx` (from KTX-Software):

```bash
toktx --bcmp --t2 texture.ktx2 texture.png
```

Typical results: 4-8x size reduction. A 4 MB PNG texture becomes 500 KB - 1 MB.

Three.js loads KTX2 textures via `KTX2Loader`, similar to DRACOLoader:

```js
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

const ktx2Loader = new KTX2Loader();
ktx2Loader.setTranscoderPath('/basis/');
ktx2Loader.detectSupport(renderer);
gltfLoader.setKTX2Loader(ktx2Loader);
```

### Optimization 3: Lazy loading

Don't load every asset at portal boot. Load each asset the first time it's referenced by a visible entity.

The portal's asset resolver should:

1. Receive descriptor with entity references.
2. For each entity with a `render.model`, queue the model URL for loading.
3. Show primitive placeholder until the load completes.
4. Swap in the loaded model.
5. Cache the loaded glTF — subsequent entities referencing the same model use the cache.

Models for spaces the portal hasn't visited never download. Models for entities that come into view are loaded on demand and cached for subsequent visits.

### Optimization 4: Instancing

When the same model is rendered multiple times (5 dancers using the same dancer.glb, 50 grid-tiles using the same tile model), use three.js `InstancedMesh` or scene-graph cloning to share GPU memory.

```js
// Load the model once
const dancerGLTF = await gltfLoader.loadAsync('/assets/harmony/models/dancer.glb');
const dancerMesh = dancerGLTF.scene;

// For each dancer instance
for (const dancer of dancers) {
  const instance = dancerMesh.clone();
  instance.position.set(dancer.x, 0, dancer.y);
  scene.add(instance);
}
```

For animated characters with skeletons, `SkeletonUtils.clone(mesh)` (from three.js examples) clones the mesh while sharing geometry — each instance can have its own animation state without copying the underlying geometry data.

Five dancers with shared geometry use roughly the same GPU memory as one dancer. Critical for scenes with many similar entities.

### Optimization 5: Level-of-detail (LOD)

When the camera is far from an entity, render a low-poly version. As it gets closer, swap to higher detail.

Three.js has built-in `LOD` support:

```js
const lod = new THREE.LOD();
lod.addLevel(highDetailMesh, 0);     // 0-10 units away
lod.addLevel(midDetailMesh, 10);     // 10-30 units away
lod.addLevel(lowDetailMesh, 30);     // 30+ units away
scene.add(lod);
```

Three.js automatically swaps based on camera distance. Useful for large scenes with many entities; pointless for small scenes like the dance floor.

For shipped extensions, ship multiple LOD versions of each model (suffix convention: `dancer.glb`, `dancer_lod1.glb`, `dancer_lod2.glb`) and declare them in the manifest. The portal builds the LOD chain from the manifest. Defer this until scenes are big enough to need it.

### Optimization 6: Asset hosting

For development, serving assets from local disk (`/assets/<ext>/*` via Express static) is fine. For production deployment with many users, move to a CDN.

Options:

- **Git LFS** — assets ship with the extension's repo but Git treats them as references. Free up to a small bandwidth budget, then GitHub charges. Simple, integrated, works for low-traffic extensions.
- **Cloudflare R2** — S3-compatible object storage with zero egress fees. Cheap. Standard pattern: upload assets to R2 at extension publish, set the manifest to point at R2 URLs. Fast worldwide.
- **AWS S3 / CloudFront** — the boring choice. Reliable, costs scale with usage, integrates with everything.

For user-uploaded skins, the same options apply — local disk for now, R2 or S3 when traffic justifies it. The matter row's `content.path` would be updated to a URL instead of a local filesystem path; the portal fetches the URL via standard HTTP.

### Optimization 7: Quotas (already implemented)

Per-file, per-extension, per-being, per-operator caps prevent any single entity from dominating storage or bandwidth. These should be in place from the start, not added later:

- **Per-file:** 15 MB models, 5 MB sounds
- **Per-extension cumulative:** 100 MB warning, 250 MB hard fail
- **Per-being:** 50 MB total asset-matter
- **Per-operator:** 500 MB across all beings

Apply Draco and KTX2 compression and these limits stop binding for almost any realistic asset.

### Optimization 8: Web Worker for parsing

glTF parsing happens on the main thread by default, which can cause frame drops when loading large models mid-session. Move parsing to a Web Worker:

Three.js's `GLTFLoader` has a `setMeshoptDecoder` and worker support; with the right configuration, models parse off the main thread and the UI stays responsive during load.

This matters more for large scenes (loading 50 different entity types) than small scenes. Defer until the dance floor or its equivalent has many distinct models loading at once.

### Optimization 9: Frustum culling and entity virtualization

Only render entities that are within the camera's view frustum. Three.js does this automatically per-mesh — but for very large scenes, also cull entities that are not in the active room/space the user is viewing.

For huge worlds with thousands of beings, virtualize: only instantiate three.js objects for entities currently visible. Beings in far-away rooms exist on the substrate but aren't in the scene graph. When the user navigates closer, instantiate; when they navigate away, dispose.

This is far-future scope; the dance floor doesn't need it. Worth knowing the option exists.

### Optimization order in practice

For your current state (dance floor with 5 dancers, basic Mixamo models):

1. **Draco-compress every shipped .glb.** Single biggest win, applies immediately, no architectural change. Apply to `dancer.glb`, `drummer.glb`, `drum.glb` right now.
2. **Texture-compress.** If your Mixamo characters have textures (most do), convert to KTX2.
3. **Instance the dancers.** One mesh load, five clones, shared geometry.
4. **Lazy-load.** Don't fetch models for unseen spaces.

After these four, a dance floor with 50 dancers using Mixamo characters loads in under 2 seconds and runs at 60fps on a normal laptop.

The other optimizations (LOD, CDN, web workers, frustum culling) are not needed until you're handling worlds substantially larger than a dance floor. Apply them when measurement shows they're needed; don't pre-build.

---

## Part VII — What Other Systems Do (For Comparison)

You're not building this alone. Every major bring-your-own-content 3D platform uses substantially the same pattern. For reference:

**VRChat**: Users upload custom avatars and worlds. Format: Unity bundles (with glTF underneath). Server-side compression, lazy loading, CDN delivery, per-user storage quotas. Tens of millions of users at scale.

**Resonite**: Closest in philosophy to TreeOS — event-sourced shared worlds with user-uploaded everything. Drag-and-drop glTF/FBX directly into the world. Animations work. Custom shaders work. Replay works.

**Mozilla Hubs**: Browser-native (three.js + glTF), bring-your-own avatars via drag-and-drop, room-based worlds. Open source — read their code for patterns. Closest technical analog to TreeOS.

**Roblox**: Custom everything, server-side asset processing, CDN delivery, per-user storage quotas, marketplace. Hundreds of millions of users.

**Second Life**: Doing this since 2003. Custom meshes, animations, sounds. Still operating.

**Garry's Mod**: User-uploaded models via Steam Workshop. Standard pipeline; long-tail content thrives.

The pattern is identical across all of them: standard format (glTF or similar), compression as baseline, CDN delivery, lazy loading, instancing, per-user quotas, optional LOD. TreeOS does the same thing with a different substrate underneath.

When implementing this, you can study Mozilla Hubs's code directly (open source, browser-native, similar stack) for reference on the rendering pipeline. Their asset-handling code is a good template.

---

## Summary

The TreeOS sensory pipeline is:

- **Assets** live in extensions (bundled) or in matter (user-uploaded).
- **Render blocks** on entities declare model, animations, sounds.
- **The set-render DO op** is the only writer.
- **The portal** subscribes to reels, dispatches fact arrivals to animation and sound channels in parallel, falls back to primitives when render isn't declared.
- **User skin upload** is two ordinary acts (create-matter + set-render) plus byte transport; no new endpoints or verbs.
- **Performance** scales via standard optimizations: Draco compression, texture compression, lazy loading, instancing, CDN delivery, per-being quotas.

The architecture matches what every major 3D platform does. The optimizations are well-understood. Apply them in measurable order — Draco first, then instancing, then lazy loading. Almost all scaling concerns dissolve after those three.

This document is the reference. When in doubt about how rendering should work, where assets should live, or how to scale, return here.

---

That's the full overview. Save it, point your agent at it for any rendering or asset question, and the conversation stays in one place from now on. The document is structured so you can answer questions by pointing at sections rather than re-explaining — Part II for extension assets, Part V for user skins, Part VI for optimization. Anyone working on the system has the doctrinal answer in one place.







==================

# Being Self-Model System — Complete Specification

This is the full specification for how a being changes its own visual representation (model, animations, sounds) — both via portal-driven user upload and via being-internal acts. It builds on the sensory pipeline reference document and reuses every primitive already in the substrate. No new verbs, no new endpoints beyond what already exists, no special-case storage.

---

## Part I — The Architecture, Stated Plainly

### What a "being's skin" actually is

A being's skin is a **render block** (`qualities.render`) that points at an asset stored as **matter** in the world. The asset is a `.glb` file (model) or `.mp3` file (sound) that was uploaded to the substrate as the content of a matter row. The being's render block references that matter via the `matter:<id>` prefix.

When a being changes its skin, two things happen in sequence:

1. A piece of matter exists somewhere holding the asset bytes (either pre-existing or newly created from an upload).
2. The being acts `set-render` on itself with `model: "matter:<that-matter-id>"`.

That's the entire conceptual model. No new ownership system, no separate asset library, no marketplace machinery. Skins are matter; beings reference matter; the portal renders what beings reference.

### Why "skins are matter" is the right shape

Reusing matter for user assets gives you everything for free:

- **Storage**: matter already has content fields, file-path semantics, byte-streaming upload via `/api/v1/uploads`.
- **Replay**: matter creation is a fact on the chain; deletion is a fact; ownership is recoverable by folding.
- **Sharing**: a being can `set-render` referencing any matter it can SEE. One person uploads a skin; another person uses it. No marketplace needed; SEE permission is the gate.
- **Auth**: only the creator of a matter (or someone with appropriate connect-permission to the creator's being) can modify or delete it. Standard single-writer doctrine.
- **Quotas**: same shape as extension quotas — matter created by a being counts toward that being's allocation.
- **Cleanup**: when a matter is deleted (via a delete-matter act, when that exists), references to it gracefully fall back to primitive rendering. No dangling state.

The architecture extends without inventing new primitives. Every concern is already solved by an existing one.

### The two prefixes the portal resolves

```
<extension-name>:<asset-name>    # Extension-supplied (e.g., "harmony:drum")
matter:<matter-id>               # User-uploaded (any being's content)
```

These are the *only* two asset reference shapes. Extensions ship bundled assets via their manifest. Users upload assets that become matter. Same portal resolver, two branches.

---

## Part II — The Asset Matter Kind

### Kind taxonomy

Asset-matter uses a small set of kind values:

- `asset:model` — glTF binary (`.glb`) for 3D rendering
- `asset:sound` — audio file (`.mp3` or `.ogg`) for playback
- `asset:image` — texture or image (`.png`, `.jpg`) for UI or future texture-override use

Each kind has a defined file-type whitelist and size limit. Adding a new asset kind is a substrate change with explicit documentation; extensions cannot define new asset kinds.

### Matter content schema for assets

When a matter is created with an asset kind, its content has this shape:

```js
{
  // Before bytes upload:
  pending: true,
  handle: "<uuid>",
  meta: {
    size: <bytes>,
    type: "model/gltf-binary",
    name: "dancer.glb",
    animationClips: ["idle", "walk", "step"],  // extracted client-side, for model kind
  }
}

// After bytes upload:
{
  path: "data/content/<sha256>.glb",
  size: <actual bytes written>,
  type: "model/gltf-binary",
  name: "dancer.glb",
  animationClips: ["idle", "walk", "step"],  // for model kind
  contentHash: "<sha256>",                    // for dedupe + integrity
}
```

The pre-upload state with `pending: true` is the matter's content while bytes are in transit. The handle is a UUID generated client-side that links the matter row to the eventual byte payload. Once bytes arrive, the matter content is updated to point at the stored file.

### Per-asset-kind validation

The substrate validates asset-matter at upload time:

**`asset:model`:**
- Extensions: `.glb` only (strictly glTF binary)
- Max size: 15 MB per file (post-compression where possible)
- File must parse as valid glTF before bytes are accepted
- Server extracts `animationClips` from glTF header

**`asset:sound`:**
- Extensions: `.mp3` or `.ogg`
- Max size: 5 MB per file
- File must have valid audio header before bytes are accepted

**`asset:image`:**
- Extensions: `.png`, `.jpg`, `.webp`
- Max size: 5 MB per file
- File must be valid image

Validation happens at byte-upload time, not at matter-creation. If validation fails, the matter row stays in `pending` state and times out after 5 minutes (cleaned up by a periodic sweep).

---

## Part III — The Upload Flow

### Three IBP acts plus byte transport

A complete skin upload is exactly three steps. The first and third are IBP acts. The second is byte transport via the existing `/api/v1/uploads` endpoint.

**Step 1: Create the matter (IBP `do create-matter`)**

```js
do(uploadSpaceId, "create-matter", {
  kind: "asset:model",
  contentHandle: "<new-uuid>",
  contentMeta: {
    size: <file size>,
    type: "model/gltf-binary",
    name: "dancer.glb",
    animationClips: ["idle", "walk", "step"],
  }
})
```

The act seals immediately. The matter row exists with `content: { pending: true, handle, meta }`. The fact lands on the upload space's reel and on the being's own reel. No bytes have moved.

**Step 2: Stream bytes (HTTP `PUT /api/v1/uploads/<handle>`)**

The client streams the file bytes to the existing upload endpoint, keyed by the content-handle. The server:

1. Validates the handle exists in a pending matter row.
2. Validates the operator's connected being is authorized for that matter (matches the creator).
3. Validates the file size matches `contentMeta.size`.
4. Validates the file content matches the declared type (glTF magic bytes for model, audio header for sound).
5. Writes bytes to `data/content/<sha256>.glb` (dedupes if another matter already has this hash).
6. For models: parses glTF header server-side, extracts animation clip names, updates `contentMeta.animationClips` if it diverges from the client's claim.
7. Updates the matter's content: `content: { path, size, type, name, animationClips, contentHash }`.

This is **transport**, not a verb. The act of byte-streaming doesn't appear on the chain; what appears is the matter's content updating (which is itself a substrate-level write tied to the existing upload mechanism).

**Step 3: Set the being's render (IBP `do set-render`)**

```js
do(self, "set-render", {
  model: "matter:<matter-id>",
  animations: {
    "harmony:step": "step",       // user-chosen clip name
    "harmony:tick": "idle",       // user-chosen clip name
  },
  // sounds optional, follow same shape
})
```

The being's `qualities.render` updates. The fact lands on the being's reel. Other beings viewing this being now SEE the new render block; the portal fetches the new matter, loads the .glb, swaps the mesh.

### Why three steps and not one

The split is intentional and doctrinally necessary:

- **Step 1 (create-matter)** is universal — it creates a matter row regardless of whether bytes ever arrive. Some matter has bytes (assets), some doesn't (placeholders, references, computed content). The verb is generic.
- **Step 2 (byte transport)** is not a verb because *moving bytes from client to server is not an act in the model* — it's the physical realization of content the matter already declared it would have. The matter row's existence on the chain is the chain-level fact; the file on disk is implementation.
- **Step 3 (set-render)** is the being's act of *becoming* the skin. Separate from creating the asset. A being can change skins repeatedly using already-uploaded matter without re-uploading; a being can create assets that other beings use without itself changing.

Other beings could use matter created by this being. The act of *using* (set-render) is separate from the act of *making available* (create-matter). Separation enables sharing without coupling.

---

## Part IV — Animation Clip Mapping (The Hard Part of Upload)

### The problem

User-uploaded glTF files have animation clips with arbitrary names. A Mixamo export typically has clips like `mixamo.com|Idle`, `mixamo.com|Walking`. A Blender authored file might have `Armature|Action.001`. The substrate doesn't know which clip is the user's "idle" or "step."

The user needs to map clip names to fact-actions, but most users won't open a Blender tutorial first.

### Standard animation vocabulary

The substrate defines a small set of standard slot names that any rendered being might react to:

- `idle` — default loop, plays when no event animation is active. **Required for any character model.**
- `walk` / `step` — moving across cells
- `run` — moving fast (optional)
- `wave` / `point` / `dance` — gesture animations (optional, future use)
- `strike` / `tick` / `drum` — event-driven (varies by extension)

These names are *suggestions*, not enforced — they're what the auto-mapper looks for and what the clip-mapping UI offers as slot labels. The being's `qualities.render.animations` can map any fact-action to any clip name; standard names just make auto-mapping work.

### Auto-mapping path

When the portal inspects an uploaded glTF, it tries to auto-map clip names:

```js
function autoMapClips(clipNames) {
  const mapping = {};
  const standardSlots = ["idle", "walk", "step", "run", "wave", "point", "dance"];
  
  for (const slot of standardSlots) {
    // Exact match first
    let match = clipNames.find(c => c.toLowerCase() === slot);
    
    // Then partial match (handles "mixamo.com|Idle" matching "idle")
    if (!match) {
      match = clipNames.find(c => c.toLowerCase().includes(slot));
    }
    
    if (match) mapping[slot] = match;
  }
  
  return mapping;
}
```

If all required slots auto-match (just `idle` is required), the upload UI **skips the clip-mapping dialog entirely** and proceeds. The user drops a file, animations work.

If `idle` doesn't auto-match (or the user wants to customize), show the clip-mapping UI.

### Clip-mapping UI

Small, focused dialog shown only when needed. Renderable via your structured-UI-language layer or as a one-off React component:

```
Found 3 clips in dancer.glb:
  • mixamo.com|Idle
  • mixamo.com|Walking
  • mixamo.com|Standing

Map clips to slots:
  idle:    [▾ mixamo.com|Idle (recommended)]
  step:    [▾ mixamo.com|Walking (recommended)]
  
Optional:
  wave:    [▾ (none) — leave unmapped]
  dance:   [▾ (none) — leave unmapped]

[Save Skin] [Cancel Upload]
```

The dropdowns are populated from the extracted clip names. Recommendations are pre-selected from auto-map results. Unmapped slots stay unmapped — those animations just won't fire for that being. User clicks Save Skin, the upload proceeds with the chosen mapping.

### Storage of the mapping

The mapping is stored in the being's `qualities.render.animations` — same place as any other render block's animations. Nothing special:

```js
qualities.render = {
  model: "matter:<id>",
  animations: {
    "harmony:step": "mixamo.com|Walking",   // user-chosen clip name
    "harmony:tick": "mixamo.com|Idle",      // user-chosen clip name
  }
}
```

Two beings using the same uploaded matter could have *different* mappings — being A might map `harmony:step` to `mixamo.com|Walking`; being B might map it to `mixamo.com|Standing`. The mapping is on the being's render block, not on the matter. The matter is just the file with its clip names; the being is what assigns meaning to those clips.

This also means: a user re-skinning their being can keep their mapping if the new skin's clip names match, or remap if they don't. The clip-mapping UI checks: "your previous skin used 'mixamo.com|Walking' for step. Your new skin has 'Armature|Walk' — should we remap step?"

---

## Part V — Portal Render Resolution

### Asset resolver with two branches

The portal's asset resolver handles both prefix shapes through one function:

```js
async function resolveAssetUrl(assetReference) {
  if (assetReference.startsWith("matter:")) {
    return await resolveMatterAsset(assetReference);
  }
  
  // Extension prefix: "<ext-name>:<asset-name>"
  const colonIdx = assetReference.indexOf(":");
  if (colonIdx === -1) return null;
  
  const extName = assetReference.slice(0, colonIdx);
  const assetName = assetReference.slice(colonIdx + 1);
  return resolveExtensionAsset(extName, assetName);
}

async function resolveMatterAsset(reference) {
  const matterId = reference.slice("matter:".length);
  const matter = await fetchMatter(matterId);  // SEE the matter
  
  if (!matter || !matter.content?.path) {
    return null;  // matter doesn't exist or has no file — primitive fallback
  }
  
  // Serve via the same static-file mount used for extension assets,
  // or via a dedicated matter-content route.
  return `/api/v1/content/${matter.content.contentHash}`;
}
```

The `fetchMatter` call goes through standard SEE — the portal already does this for matter descriptors. If the matter is unreachable (deleted, not authorized to SEE, etc.), `resolveMatterAsset` returns null and the portal falls back to primitive rendering with a logged warning.

### Static file serving for matter content

The substrate serves matter content via a route:

```
GET /api/v1/content/<contentHash>
```

This returns the file bytes for the matter with that content hash. The route:

1. Validates the request is authenticated.
2. Looks up which matter rows reference this content hash.
3. Validates the requester has SEE permission for at least one such matter.
4. Serves the file with appropriate Content-Type header.

This is one endpoint for all asset content, regardless of which being created it or which being references it. The content-hash-based addressing enables natural dedupe (10 beings using the same skin → one file on disk).

### Caching

- **Client-side**: the portal caches loaded glTF/audio by content hash. Subsequent references to the same matter use the cache instantly.
- **CDN**: in production, the `/api/v1/content/*` route should be cached at the CDN layer. Content hashes are immutable (the file at hash X is the same forever), so cache-control can be aggressive (`max-age=31536000, immutable`).
- **Server-side**: the substrate can cache glTF parsing results so repeated content extraction (animation clip names, etc.) doesn't re-parse.

### Render swap-on-load

When the portal sees a render block, it:

1. Resolves the asset URL.
2. If the URL is cached, instantiates immediately.
3. If not, fetches and parses in the background, showing a primitive placeholder.
4. When the load completes, swaps the placeholder for the loaded model.
5. Sets up AnimationMixer with the loaded clips.
6. Plays the `idle` clip in loop by default.

If the asset fails to load (404, parse error), logs a warning and keeps the primitive.

For initial scene loads (first descriptor fetch), wait for *all* visible-entity models to load before beginning render — avoids the "five primitives pop into characters" visual artifact. For runtime entity arrival (a new being walks into the space), the swap-on-load pattern is fine.

---

## Part VI — Authorization

### Who can do what

The auth model uses existing primitives:

**Create asset matter (`do create-matter` with `kind: "asset:*"`)**: any being can create asset matter, subject to its own quotas (see Part VII). The creator is the "owner" — `doer` on the create-matter fact.

**Upload bytes to handle**: the operator's connected being must match the creator of the matter that holds the handle. Single-writer doctrine: only the creator authors their matter's content.

**Set-render referencing matter (`do set-render` with `model: "matter:<id>"`)**: the being changing its render can reference any matter it can SEE. Standard SEE auth applies — if the matter is in a space the being can SEE, the reference is allowed. If the matter is private or the being doesn't have access, the set-render rejects.

**Delete asset matter**: only the creator can delete (via a future delete-matter act). Other beings' set-renders that reference deleted matter gracefully fall back to primitive on the next render cycle.

### What about sharing?

A being uploads `dancer.glb` as `asset:model` matter. Five other beings want to use it as their skin. The flow:

1. The uploader creates the matter in a SEE-able space (their own being's body-space, or a public upload space).
2. Other beings can SEE the matter (it's in a reachable space).
3. Other beings call `set-render` with `model: "matter:<that-id>"`. The reference is allowed because they can SEE the matter.
4. The portal resolves the matter for each being, fetches the file once (deduped by content hash), instances per-being.

If the uploader wants to restrict sharing, they can put the matter in a private space only accessible to themselves. Others can't SEE it, so they can't reference it. Same auth model as any other matter access.

This gives sharing without building marketplace infrastructure. Marketplace shape (discovery, ratings, search, etc.) is a future layer on top; the substrate already supports the underlying capability.

### Server-side validation chain

When `set-render` is called with `model: "matter:<id>"`:

```js
// In set-render's handler
async function handleSetRender({ target, args, summonCtx }) {
  const { model } = args;
  
  if (model?.startsWith("matter:")) {
    const matterId = model.slice("matter:".length);
    const matter = await fetchMatter(matterId);
    
    // Validate matter exists and is the right kind
    if (!matter) {
      throw new Error("set-render: matter not found");
    }
    if (!matter.kind?.startsWith("asset:")) {
      throw new Error(`set-render: matter ${matterId} is not an asset (kind: ${matter.kind})`);
    }
    
    // Validate the calling being can SEE this matter
    const canSee = await checkSeePermission(summonCtx.beingId, matter);
    if (!canSee) {
      throw new Error(`set-render: cannot SEE matter ${matterId}`);
    }
  }
  
  // Validate against extension prefix in the same way if not matter:
  // ... existing extension-asset validation ...
  
  // Stamp the set-render fact via emitFact
  await emitFact({...}, summonCtx);
}
```

The handler doesn't fetch the file or validate the file format — that's done at upload time. Set-render only validates the reference is resolvable and authorized.

---

## Part VII — Quotas

### Per-being asset quota

Each being has a cumulative limit on asset-matter it has created:

- **Per-being cap: 50 MB**

This counts all `asset:*` matter where the being is the creator. The limit is checked at byte-upload time — if accepting these bytes would push the being over 50 MB, reject with an actionable message:

```
50 MB asset cap reached for being <name>.
Current usage: 47 MB.
This upload: 5 MB.
Delete unused assets to free space, or contact your operator to raise the cap.
```

### Per-operator cap (cross-being)

Each operator (identity connected to potentially multiple beings) has a cap across all their beings:

- **Per-operator cap: 500 MB**

This prevents one operator from spinning up many beings to circumvent per-being limits. Counted as sum of all asset-matter created by beings the operator currently or has previously connected to.

### Per-file limits

- **`asset:model`**: 15 MB per file
- **`asset:sound`**: 5 MB per file
- **`asset:image`**: 5 MB per file

Files larger than the limit are rejected at upload-validation time with an actionable error message recommending compression:

```
Model file too large: 23 MB exceeds 15 MB cap.

Recommendation:
- Apply Draco compression (typically 5-10x reduction):
  npx gltf-pipeline -i in.glb -o out.glb -d
- Reduce texture resolution (4K → 2K)
- Reduce polycount if very high
```

### Quota enforcement points

1. **Client-side pre-check**: portal validates file size before uploading. Fast feedback.
2. **Server-side validation**: at byte-receive time, before writing to disk. Authoritative.
3. **Server-side cumulative check**: at byte-receive time, sum existing matter sizes for the being, reject if over.

Quotas are stored as projection fields on the being row — `qualities.assetUsage: { totalBytes, fileCount, lastUpdated }`. Updated by the reducer whenever asset matter is created or deleted. Read at upload-time to check limits.

---

## Part VIII — The Portal UI

### The "skin" panel

When a user is viewing or connected to a being, a small "skin" panel is accessible. It shows:

```
┌────────────────────────────────────┐
│ Appearance: explorer-21d43b        │
├────────────────────────────────────┤
│ Current skin:                      │
│   dancer.glb (you, 4.2 MB)         │
│                                    │
│ Drag a .glb here to change skin    │
│ [                                ] │
│                                    │
│ Your uploaded skins:               │
│ • dancer.glb (4.2 MB) [Use] [Del]  │
│ • drummer.glb (3.8 MB) [Use] [Del] │
│                                    │
│ Storage used: 8 MB / 50 MB         │
└────────────────────────────────────┘
```

The panel shows:
- Current skin (the matter the being currently references via render).
- A drag-and-drop zone for new uploads.
- A list of previously-uploaded skins owned by this being (or accessible via SEE).
- Storage usage with the cap.

Actions:
- Drag a file onto the drop zone → triggers upload flow.
- Click "Use" on an existing skin → fires `set-render` with that matter reference.
- Click "Del" on a skin → fires delete-matter (when that verb exists; until then, hide the button).

### The upload flow, end-to-end in the portal

When a user drops a `.glb`:

1. **Client validates**: file type (`.glb`/`.gltf`), file size (15 MB cap), available space (per-being quota).
2. **Client parses glTF header**: extracts animation clip names without loading geometry.
3. **Auto-map standard clip names**: see Part IV.
4. **If mapping incomplete, show clip-mapping UI**: see Part IV.
5. **Generate content handle** (UUID v4).
6. **Fire `do create-matter`**: act seals immediately, matter row exists with pending content.
7. **Stream bytes to `/api/v1/uploads/<handle>`**: progress bar shown to user.
8. **Server validates and writes**: file written to `data/content/<sha256>.glb`, matter content updated.
9. **Fire `do set-render`**: act seals, being's appearance updates.
10. **Portal sees the new render**: fetches the matter, loads the file, swaps the mesh.

The whole flow is one drag-and-drop gesture from the user's perspective. Behind it, three IBP acts plus byte transport. Show progress at each step (validating → uploading → setting skin).

### Error recovery

Each step can fail; the UI handles each cleanly:

- **Validation fails**: show error, no acts dispatched, user fixes file.
- **Create-matter fails**: show error, no further action.
- **Byte upload fails (network, validation, quota)**: matter stays in pending state; user can retry the upload using the same handle, or cancel and the matter times out after 5 minutes.
- **Set-render fails**: matter exists with the file but the being's render didn't update. User can retry the "Use this skin" action.

Failures don't corrupt state because each step is atomic. Partial uploads leave a pending matter; partial set-renders leave the being's existing render unchanged.

### Permissions panel access

A user can only modify a being they're connected to. The skin panel is hidden or read-only when viewing other beings. The portal checks the operator's connected being against the target being before showing edit UI.

---

## Part IX — Implementation Order

Build in this order. Each rung is independently testable.

### Rung 1: Asset matter and upload (no UI yet)

1. Define `asset:model`, `asset:sound`, `asset:image` as recognized matter kinds.
2. Extend `create-matter` to accept asset kinds with `contentHandle` and `contentMeta` instead of immediate content.
3. Extend the existing `/api/v1/uploads` route to handle asset uploads keyed by handle:
   - Validate handle → pending matter exists
   - Validate operator auth
   - Validate file size, type, magic bytes
   - For models: extract animation clips via server-side glTF parsing
   - Write to `data/content/<sha>.glb`
   - Update matter content from pending to materialized
4. Add the `/api/v1/content/<contentHash>` route for serving asset bytes.

**Verify**: manually create an asset matter via IBP console, upload bytes via curl, confirm matter content updates correctly.

### Rung 2: Set-render with matter prefix

5. Extend `set-render` to accept `model: "matter:<id>"` references.
6. Set-render handler validates the matter exists, is an asset kind, and the caller can SEE it.
7. Portal's asset resolver gains the `matter:` prefix branch.

**Verify**: manually upload a matter via Rung 1, then fire `set-render` on a test being referencing it. Confirm the portal renders the uploaded model.

### Rung 3: Portal upload UI

8. Build the skin panel as a UI component.
9. Build the clip-mapping dialog.
10. Wire the drag-and-drop flow: validate → create-matter → upload → set-render.
11. Show storage usage and existing skins.

**Verify**: user drag-and-drops a `.glb` onto a being in the portal; sees their being become the model with animations working.

### Rung 4: Quotas

12. Track per-being asset usage as a projection field.
13. Track per-operator cumulative usage.
14. Enforce per-file, per-being, per-operator limits at upload-validation time.
15. Surface usage and remaining space in the UI.

**Verify**: upload until cap is hit; confirm clean rejection with actionable error.

### Rung 5: Asset deletion (when delete-matter verb exists)

16. When delete-matter acts on an asset, also remove the file from disk (if no other matter references the same content hash).
17. Beings' set-renders referencing the deleted matter gracefully fall back to primitive.
18. Storage usage decrements.

**Verify**: delete an uploaded skin; confirm bytes are removed from disk and other beings still using that skin fall back to primitive on next render.

### Rung 6: Sharing and discovery (future)

When marketplace shape is desired:

- Public upload spaces where beings can publish skins for community use.
- A "browse community skins" view in the portal.
- Optional ratings, comments, tags.
- All built on top of existing SEE permissions; no new substrate needed.

Defer until there's real demand.

---

## Part X — Invariants and Verification

### The doctrinal invariants

These hold for the system to be correct. Each is testable.

1. **Asset matter content is identified by content hash.** Two matters with identical file content reference the same on-disk file. Deduplication is automatic.

2. **The chain holds the truth.** Every skin change is a `set-render` fact; every matter creation is a `create-matter` fact. Replay-from-zero reconstructs the full skin history for every being.

3. **Files are not part of replay correctness.** If a user deletes their skin file, replay of old facts referencing it shows primitive fallback. Replay reconstructs the fact stream identically; visual fidelity depends on file presence.

4. **Single-writer holds for asset matter.** Only the creator of an asset matter can modify or delete it. Other beings can reference it (via set-render) if they can SEE it.

5. **Quotas are enforced at upload-time.** No way to exceed quotas by going through any path; the byte-receive validation is the gate.

6. **The portal renders only what the chain says.** No client-side skin state that isn't derived from `qualities.render` on the being.

### Verification scripts

Standing checks to run regularly:

- **`verify-asset-quotas.js`**: walk all beings, sum asset matter sizes, confirm none exceed 50 MB.
- **`verify-content-orphans.js`**: walk `data/content/*`, confirm every file is referenced by at least one matter. Remove orphans.
- **`verify-matter-content-integrity.js`**: walk all asset matter, confirm `content.path` exists on disk and `contentHash` matches file SHA.
- **`verify-set-render-references.js`**: walk all `qualities.render` blocks on beings, confirm `matter:` references resolve to existing matter (warn on dangling references; don't fail since dangling is acceptable post-deletion).

These run as part of CI and periodically in production.

---

## Part XI — Summary

The being self-model system is built entirely on existing primitives:

- **Matter** holds uploaded assets (kind `asset:*`).
- **Create-matter** with a content-handle initiates upload.
- **The existing `/api/v1/uploads` endpoint** transports bytes.
- **Set-render** with `model: "matter:<id>"` makes a being use an asset.
- **The portal** resolves `matter:` references the same way it resolves extension references.
- **Quotas** are projection fields enforced at upload-validation.
- **Auth** uses existing single-writer doctrine and SEE permissions.
- **Sharing** is free — any being can reference any matter it can SEE.

No new verbs. No new endpoints beyond what exists. No special-case storage. Skins are matter; beings reference matter; the portal renders what beings reference. The architecture extends from one truth: **a being's appearance is a fact on its reel pointing at content in the world.**

This document is the canonical reference for the system. When in doubt about how skin upload should work, where assets should live, who can modify what, return here.