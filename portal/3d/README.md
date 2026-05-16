# Portal 3D

A 3D client that speaks IBP.

The flat Portal in `portal/app/` is one client speaking IBP. This folder is another. Same protocol, same Position Descriptions, same four verbs. Different renderer.

Read [portal/docs/protocol.md](../docs/protocol.md) first. Nothing here is new protocol. It is an interpretation pattern that a client applies to data the protocol already serves.

## The architectural property this rests on

IBP commits to data, not presentation. A Position Description is JSON describing what is at a position: children, artifacts, beings, governance, lineage. The protocol does not say how to render it. The flat Portal renders it as forms and panels. The 3D Portal renders it as scenes and objects. Future clients (VR, AR, voice-only, accessibility-focused) render it however makes sense for their medium.

This is not a workaround. It is the architecture working. The same property that lets one client render two different stances of the same position differently lets two different clients render the same Position Description differently.

## The core mapping

Five lines.

- **Position = scene.** Each position is a 3D scene. Walking around at a position means walking around inside its scene.
- **Children = objects in the scene.** A position's children render as objects within the parent's scene. The objects sit in space; the user can see them, walk around them, approach them.
- **Doorway = scene boundary.** A child position whose metadata marks it as a doorway is an entry point. Entering it triggers a SEE on that position and a scene transition. The user is now inside the child's scene.
- **Being = figure in a scene.** Beings at a position render as figures (avatars, low-poly shapes, whatever the embodiment specifies). They stand in the scene; the user can approach them, look at them, talk to them.
- **User = first-person camera.** The user moves through scenes as a first-person presence. Their left stance (`<land>/@<username>`) follows them everywhere. The right side of any TALK or DO is the being or position they are interacting with in the current scene.

Everything follows from these five lines.

## How the four verbs work in 3D

**SEE** happens on every scene load. The client SEEs the position to get its Position Description, then renders it. SEE on a stance (when the user is looking at a being) augments the descriptor with embodiment-specific content; the client renders the focus accordingly (e.g. a UI panel showing the being's surface). Live SEE keeps the scene in sync with the underlying data; new children appear as new objects, status changes update visual state.

**DO** happens when the user interacts with an object. Approach an object, hit interact (or click), pick an action from a small menu, and the client sends the DO call against the object's position. Mutation lands at the position; the live SEE patches the scene.

**TALK** happens by proximity and gaze. Get close to a being. Look at them. A chat pane (or eventually a voice channel) opens. Type or speak. The client constructs a TALK envelope with the being's stance as target and the user's stance as `from`. The being's response renders as a speech bubble above their head (MVP), later as TTS audio in 3D space.

**BE** happens in the land scene itself. The auth-being stands somewhere in the land as a real figure the user encounters on arrival (the architectural commitment that the auth-being is a being made literal). Staring at the auth-being triggers a hazy glare effect (sensory cue: you are entering an identity moment) and a login menu opens overlaid in 3D space. The user picks register or claim, fills in credentials, the BE call goes out, the token comes back, the glare clears, and they are in the world as their established stance. Switching identity later is the same flow: walk back to the auth-being, stare, the glare returns, switch. The flat Portal's BE surface still exists for users who prefer it, but the native 3D flow is gaze-on-auth-being.

## 2D/3D toggle

Both clients speak IBP. Switching between them carries the current address. Nothing more.

- In 3D, looking at a being at a position: toggle opens the flat Portal at `<position>@<being>`.
- In 3D, not looking at a being: toggle opens the flat Portal at `<position>`.
- In flat Portal at an address: toggle opens the 3D client at the same address, the camera positioned in that position's scene.

The two views are different presentations of the same Position Description. No state coordination beyond the address. The flat Portal is naturally better for configuration and form-heavy work; the 3D client is naturally better for navigation, presence, and conversation. Users switch fluidly based on what they are doing.

## What this needs from the architecture

Three small additions. None are protocol changes. All are metadata or extension capabilities the protocol already accommodates.

### 1. Rendering metadata namespace

A position can declare rendering hints under `metadata.rendering`. Shape sketch:

```
metadata.rendering = {
  sceneType: "outdoor" | "indoor" | "abstract" | "<custom>",
  isDoorway: boolean,
  layout: { ... },                  // optional: how children are placed
  beingPlacements: { "<embodiment>": { x, y, z } },  // optional: where beings stand
  ambient: { ... },                 // optional: lighting, sound, mood
  model: "<asset ref>",             // optional: a 3D model for this position itself
}
```

The flat Portal ignores this namespace. The 3D client reads it. Other clients interpret as fits their medium. Sensible defaults apply when a position has no rendering metadata.

### 2. Extension seed declarations

Extensions can declare named **seed patterns**. A seed is a structured scaffolding operation: when planted at a position, it creates child positions, registers embodiments, installs related extensions, and sets metadata.

Example: a `rulership-tree` extension declares a `basic-court` seed. Planting it at a position scaffolds:
- a `court-chamber` child position with the right rendering metadata
- `@ruler`, `@judge` embodiments registered at the new positions
- the court contracts installed
- whatever else the rulership pattern needs

Invocation is a DO action: `do plant-seed { extension, seedName }` at the target position. The kernel routes to the extension; the extension does its work using existing primitives (create-child, set-meta, register-embodiment).

In 3D this looks like growing a tree. In the flat Portal it looks like a structured set of new children appearing.

### 3. Being placement hints

Optional `metadata.rendering.beingPlacements` maps embodiment names to scene coordinates. When absent, the 3D client places beings by default rules (center of scene, or at named anchors if the position model defines them). Lets land owners curate scenes without forcing them to.

## Implementation order

Phase 6 and Phase 7 happen as planned. The flat Portal needs to be useful for real users before the 3D client is meaningful — beings need real LLM backing (Phase 6), the chrome needs DO/TALK affordances (Phase 7).

The extension seed mechanism can land alongside Phase 6 or Phase 7. It is a natural extension capability that doesn't require 3D rendering. The flat Portal can plant seeds too. It just looks like scaffolded structure appearing in the tree.

The rendering metadata namespace can land anytime. It is additive metadata that the flat Portal ignores. Worth adding once seeds exist so seed authors can include rendering hints.

The 3D client is its own track. It can begin experimentally in parallel with Phase 6/7 (proves the protocol supports immersive rendering), focus after Phase 8 migration (when IBP is the unified surface), or whenever there is energy and engineering capacity for it. The protocol will be ready when the client is.

## What an MVP looks like

A minimal Three.js client that:

1. Speaks IBP via the existing PortalClient primitives (`see`, `do`, `talk`, `be`).
2. Renders a small overworld. Land position as an outdoor scene. Public trees visible as 3D objects (simple shapes based on `metadata.rendering.sceneType` or sensible defaults).
3. Handles doorway transitions for one or two positions to prove the scene-change pattern works.
4. Renders beings as low-poly avatars at their stances.
5. Wires TALK via proximity + gaze + chat pane. Speech bubbles above being heads. Voice later.
6. Supports the 2D/3D toggle.
7. Supports one seed extension end to end (plant it in 3D, watch the structure grow).

This is real product work, real Three.js engineering, real attention to camera, collision, scene loading, asset management. The architectural readiness does not erase the engineering scope. But none of it requires anything from IBP that doesn't exist.

## What this is NOT

- **A new protocol.** IBP is the protocol. The 3D client speaks it.
- **A game engine.** This is a renderer for IBP positions. Game mechanics are emergent from how beings, contracts, and extensions interact, not designed in as game systems.
- **A separate product.** It is the same Portal architecture with a different rendering surface. Tabor's TreeOS, rendered as inhabitable space.
- **A replacement for the flat Portal.** The flat Portal is excellent for configuration, form work, and dense information surfaces. The 3D client is excellent for presence, navigation, and conversation. Both ship.
- **VR/AR specific.** The first MVP runs in a browser with WASD movement and mouse look. VR and AR are later layers when the substrate is solid.

## Open questions

These deserve thought before the 3D client starts in earnest. Not blockers; design surfaces.

- **Scene composition for positions without rendering metadata.** What is the default scene? A flat platform with default objects? An abstract void with floating children? Worth deciding the fallback feel.
- **Camera persistence across scene transitions.** Do you walk through a door and re-spawn at the entrance of the new scene, or carry orientation through? Probably entrance-spawn for clarity.
- **Multi-user presence in the same scene.** Two users at the same position both inhabit its scene. Do they see each other's avatars? When? Pass 1 may be single-user; multi-user comes when federation and presence broadcast are designed.
- **Voice latency and quality.** Browser STT/TTS is mediocre. May want server-side STT routing through the inbox-tts pattern. Out of scope for MVP; flagged for later.
- **Asset model.** Where do 3D models for positions, beings, objects live? Extensions provide them? Land owners upload them? The protocol can serve them as artifacts via SEE. Asset management is a real subsystem.

## Filing this here

This folder is the design surface. Code lives elsewhere when it lands (probably `portal/3d-app/` or similar) so this README stays the conceptual reference. As the design tightens, this doc gains more specifics. As code lands, it gets cross-referenced.
