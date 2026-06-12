# PORTAL — From Web Bundle to TreeOS Native Shell

> _"The portal speaks IBP. The renderer and the transport are negotiable."_

This file pins the portal's trajectory. The current shape is a Vite + Three.js web bundle served by the reality server. The destination is the default shell that boots when TreeOS itself is the OS, rendered without a web engine, talking to the local kernel through in-process IBP. This document maps the path between those two endpoints in phases small enough to ship and large enough to converge.

Read alongside [philosophy/OS/OSV2.md](../philosophy/OS/OSV2.md) (the OS vision: spaces, matter, beings, the four verbs, the substrate as observable factory). The portal is the surface that makes that vision visible.

## One sentence

**The portal is a client for IBP that hosts one or more VIEWS over the same IBP state; everything else (transport, host shell, asset pipeline) can change without changing what a portal IS.**

## The four views — TreeOS user space

A **view** is a way of rendering the current IBP state. The portal hosts FOUR views, and together they ARE the user space of TreeOS. Every other "kind of app" that conventional OSes ship (desktop, file manager, terminal, document viewer, dashboard, control panel) collapses into one of these four. The four are not modes the portal offers; they are the canonical surfaces a user inhabits the kernel through.

Each view shows the same thing because they all read from one in-memory model that mirrors the kernel's response to the current address. Switching views is instant and stateless: the user flips between any two without re-fetching, re-authenticating, or losing pending state.

| View         | Renders                                                                                                                                                                                                                                                                                                                     | Conventional OS analog          | Status   |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | -------- |
| **3D**       | Spatial scene: spaces as rooms, children as doorways and trees, beings as figures, matter as objects in the world                                                                                                                                                                                                           | **None.** A new surface; the closest pre-existing thing is a video-game world, not anything from a conventional OS. A 3D place to represent the data. | Built    |
| **Text**     | Document layout: descriptor fields as panels, lists, forms, breadcrumbs. HTML-native. Matter that ships as HTML (web-style content, embedded apps, rich docs) renders directly through iframes; the kernel speaks IBP, the text view speaks HTML on top of it.                                                              | Traditional GUI / desktop / window manager / web browser collapsed into one surface | Built    |
| **Console**  | A stance-anchored verb prompt. The user types verbs (see, do, summon, be) against the current address; results stream back as structured blocks. More freeform than today's IBP console (which is a debug panel); the canonical view for scripting, remote work over slow links, and any user who prefers reading sentences | Terminal / shell                | Sketched |
| **Explorer** | A tree over the kernel's primitives — spaces, matter, beings. Same data the console emits, rendered as a tree the user can navigate. Click a space to expand its children; double-click a matter to inspect; right-click a being to summon. Built off the projection folds (see "What the views read from" below), the same way a conventional file manager is built off the filesystem. | File manager / Finder   | Sketched |

A view is NOT a separate app. The user's session, address, identity, branch, and pending state belong to the portal; the view is one window into that. Four views over the same address show the same beings, the same matter, the same pending inbox count, in their own visual language.

### Why these four

The four cover the four legible ways humans interact with structured data. The mapping is about how each view FEELS to use, not about which verbs it can call:

- **3D → inhabit.** The user is INSIDE the structure, walking around in it.
- **Text → peruse.** The user is ABOVE the structure, reading dense information.
- **Console → instruct.** The user EMITS into the structure, verbing at it directly.
- **Explorer → navigate.** The user TRAVERSES the structure, drilling in and out.

**Every view exposes all four verbs.** SEE, DO, SUMMON, BE all work in 3D, text, console, and explorer. The 3D view is not the "BE view." The console is not the "DO view." A user in 3D can SEE just as fluently as someone in text; a user in console can BE somewhere just as fluently as someone in 3D. The interaction style differs — clicking a doorway, reading a panel, typing a verb, expanding a node — but the verb surface underneath is the same.

The natural-mode mapping above tells you which view will feel best for a given task, not which view is required. Move between them at any time and the verbs you can call do not change.

### What this means at the OS level

When TreeOS is the OS (Phase 5), these four views replace the conventional OS user space wholesale. There is no separate window manager, no separate terminal emulator, no separate file manager, no separate browser. The portal IS the user space. The four views ARE the surfaces. Switching views replaces "switching applications"; the user stays at their address, in their reality, and the way they're looking at it changes.

**The browser is not a separate thing.** This is the conceptual move that's hardest to swallow if you come from conventional computing. In TreeOS the whole machine is the reality, and the portal is how you USE that reality. A web browser, a terminal, a file manager, a 3D world — these were four separate applications on a conventional OS because each was a different lens on a different kind of data with a different process underneath. In TreeOS the data is one (spaces, matter, beings), the process is one (the portal hosting the IBP client), and the four views are four lenses on the same world. There's no application to switch INTO; there's a view to switch TO.

This is also why "portal" is the right name and not "browser" or "shell." A browser is one view (text, HTML-rendered). A terminal is another (console). A file manager is another (explorer). A spatial world is another (3D). The portal hosts all four; the user picks.

### Defining properties

1. **Synced.** Every view reads from the same in-memory model. A descriptor update from the kernel updates every mounted view in the same frame. Switching views is a render swap, not a data refetch.
2. **Switchable.** Views mount and unmount cheaply. Keyboard shortcut, button, or programmatic call swaps the active view. The address bar, identity, and pending state outside the view stay constant.
3. **Closed set.** The protocol does not grow new views. Extensions don't add views. The four ARE the surfaces; growth happens by enriching the kernel's response and letting all four views show the new content in their own language.

A registry maps view name → view module; switching is the user picking a different entry. The kernel doesn't know which view is active.

## What the views read from

The views are not parallel data sources. They are parallel renderings of one underlying state. That state is the kernel's projected present, and the present is itself a projection of the chain. Per [philosophy/OS/OSV2.md](../philosophy/OS/OSV2.md):

```
                    Present
                       ▲
                       │
                Projection Engine
                       ▲
                       │
                    Stamps
                       ▲
                       │
                     Reels
                       ▲
                       │
                     Disk
```

Conventional OSes build their views (terminal listing, file manager tree, document viewer) on top of the filesystem. TreeOS builds the four views on top of the projection engine. The storage primitive is the reel; the immutable unit is the stamp; the present (spaces, matter, beings) is reconstructed continuously by folding the chain. Every view reads from that reconstructed present.

This is the same shape as conventional computing, one level deeper. A file manager renders the filesystem; an explorer renders the projection of the chain. The user's mental model can stay "directory tree" if that's how it lands for them — the tree is just a tree of spaces (containers) and matter (leaves) instead of folders and files. The console emits verbs against the same present; the explorer renders the same present; both read the same projection.

Concretely for the explorer + console views:

- **Explorer** walks the space tree from the user's current address. Each node is a space (with children) or a matter (a leaf). Beings show up as occupants of spaces. The expansion + selection model is familiar from any conventional file manager; the items are richer (matter has a type, beings have cognition, spaces can branch) because the kernel knows more than a filesystem does.
- **Console** addresses a stance and emits verbs. `see ./roles` prints the role registry. `do set-being:position` mutates. `summon @worker "draft a doc"` engages another being. The console is the explorer's language form: same data, same address grammar, expressed as input rather than navigation. A user can pick whichever lens fits the task.

Neither view invents a parallel storage model. Both read the projection. When TreeOS owns the OS at Phase 5, the projection IS the filesystem from the user's perspective; the explorer IS the file manager; the console IS the shell. The naming is conventional; the underlying primitives (spaces, matter, beings, stamps, reels, projection) are TreeOS's.

## HTML stays for the text view

The text view is HTML-rendered today, and it stays HTML-rendered at every phase, including when the portal otherwise leaves the web engine behind. Two reasons:

**1. HTML is the matter-side rendering format.** Some matter ships as HTML — embedded apps, rich documents, third-party content the user has grafted in. Today these render through iframes inside the text view. There is no universe in which it makes sense to invent a parallel markup language to replace HTML for these cases; the ecosystem of content the user wants to reach is HTML-native. The text view continues to embed it.

**2. Inventing a new markup is expensive and gains nothing.** HTML + CSS handles the descriptor → panel rendering well. Any TreeOS-specific markup would have to re-solve text flow, form fields, scrolling, embedded media, accessibility, internationalization. None of those are TreeOS problems; they're already solved problems. The text view rides HTML so the portal team can spend its budget on TreeOS-specific work.

What this implies for Phase 4 (drop the web engine):

- The 3D view goes fully native (wgpu).
- The console view goes fully native (terminal-style emitting + structured response blocks).
- The explorer view goes fully native (tree widget).
- The text view keeps a webview ONLY for the text view. The native shell embeds a system webview specifically for that one surface. The webview is no longer the host for the whole portal; it's a component the text view uses. The other three views never touch HTML.

This is a deliberate asymmetry. Three views go native; one keeps HTML because HTML is the right tool for what that view does. The portal as a whole stops needing a browser engine to RUN, but the text view continues to USE a browser-engine-shaped renderer for its content.

When TreeOS itself is the OS (Phase 5), the embedded HTML renderer becomes a TreeOS service rather than a borrowed system webview, but the principle is the same: HTML is for text-view content, not the portal's overall presentation.

## The constant — what never changes

Across every phase, these stay fixed. They are the contract that lets the portal evolve without re-architecting:

1. **Four verbs.** SEE, DO, SUMMON, BE. The portal speaks only these. Any new capability the kernel exposes flows through one of the four; the portal doesn't grow new verbs.
2. **Addresses route.** A stance (`<reality>/<path>@<being>`) and an IBPA (`actor :: receiving`) describe what the portal is doing. Navigation is changing the address; rendering is showing what the address resolves to.
3. **Descriptor in, render out.** The portal pulls a Position Description (JSON today; could be CBOR, FlatBuffers, native struct tomorrow), and the renderer draws it. The descriptor's shape is part of the protocol; the rendering is local.
4. **Sovereignty.** Per [seed/SUMMON.md](../seed/SUMMON.md), the receiver decides. The portal never compels behavior at the kernel; it expresses the user's intent and renders what comes back. This rule travels intact through every phase.
5. **Live by default.** Every read subscribes for updates. The portal does not poll; the kernel pushes changes through the same channel that delivered the initial read.

Everything below changes. Everything above does not.

## Phase 0 — what exists today

```
portal/
├── package.json + vite.config.js      Vite build, Three.js, socket.io
├── index.html                         entry; loads /3d/main.js
├── dist/                              built bundle (served by transports/http)
├── core/
│   ├── client.js                      Socket.IO IBP client
│   └── config.js                      single place-URL resolver
├── 3d/                                Three.js renderer (the default mode)
├── flat/                              DOM renderer (mounted as overlay)
├── shared/                            cross-mode panels (op-form, role-manager, ...)
└── styles/                            8 css files, imported via Vite
```

What's been done so far (the foundation passes that make the next phases possible):

- `core/` separated from renderers (no DOM in `core/client.js` or `core/config.js`).
- All inline `injectStyles()` swept into `styles/` so the renderer surface is data + CSS, not data + CSS-as-JS-string.
- Single config resolver for the place URL (no more `defaultPlaceUrl()` scattered).
- Flat and 3d render the same descriptor, both go through `flat.state.descriptor` / `state.descriptor`.

What still lives in the web assumption today:

- The Three.js bundle is the entry; flat is a sub-renderer.
- Transport is Socket.IO over WebSocket, dialed from `window.location` or a config.
- Styles, assets, and bundling all assume a browser context.
- HTML is the host. The `index.html` boots the JS.

Each phase below loosens one assumption.

## Phase 1 — solidify the seam

Goal: every renderer reads from the same in-memory model and reacts to the same events. No renderer reaches around the model. This is the structural pass that makes "swap the renderer" a one-line decision instead of a refactor.

Work:

- **`core/state.js`.** Single in-memory model: `{ session, discovery, descriptor, currentAddress, currentBranch, selectedBeing, lineage }`. Subscribable. The two singletons (`flat.state` in `flat/host.js`, `state` in `3d/main.js`) become one. Renderers read; they don't own.
- **`core/navigation.js`.** The `navigate(address)` flow lives once. Branch stickiness, history push/replace, live-resubscribe, descriptor preloading, error handling — all in one place. 3d and flat both call this.
- **`core/view.js`.** The contract a view implements:
  ```js
  {
    mount(rootEl, ctx),         // hand it a root to draw into + a PortalContext
    onDescriptor(desc),         // descriptor arrived or changed
    onSelection(beingOrMatter), // user picked something
    showOverlay(spec),
    closeOverlay(),
    destroy(),
  }
  ```
  3d/main.js becomes the 3D view. flat/host.js becomes the text view. A registry maps view name → view module; the entry picks a default and mounts; the user's keybind or button swaps in another.
- **`PortalContext`.** Per-instance state holder. No more module-level singletons. The same JS could mount two portals in two tabs without leaking.

What stays the same: the panels, the scene, every UI surface. This pass is just the lines around them.

Exit criterion: dropping `import "./scene.js"` from `3d/main.js` doesn't break the text view. The 3D view becomes an optional module that the portal mounts when the user picks it; the text view stands on its own.

## Phase 2 — split the entry, drop the HTML-first assumption

Goal: the text view boots without Three.js. Three.js loads only when the 3D view is the entry. The portal stops being "a 3D app with a text overlay" and becomes "an IBP client with a view registry."

Work:

- **Two Vite entries.** `index.html` boots with the 3D view as default; `text.html` boots text-first. Same `core/` + `shared/` + `styles/`; different entry script.
- **Three.js lazy load.** The 3D view loads its module on first activation. Text-first sessions never pay for it. Saves ~500KB+ uncached.
- **In-session view swap.** Today's "text mode" toggle from 3D becomes a real view swap (destroy active view, mount the other) rather than an overlay. The view registry handles the lifecycle; the user keeps their address, identity, and pending state across the swap.
- **Asset abstraction.** Today the portal asks for asset URLs from `discovery.reality` + `/assets/...`. Move asset resolution into `core/assets.js` so a future native shell can resolve from a local matter store instead of an HTTP origin.
- **View registry.** A small map of `name → viewModule`, lazy-loaded. Adding a third view later (audio, map, timeline) is one entry in the registry plus the view module itself.

What stays the same: the descriptor protocol, the IBP transport, the panel shapes that views compose.

Exit criterion: someone running an accessibility-focused tool, a CI smoke test, or a low-power device launches the text entry, never loads Three.js, and gets full functionality; and a user in 3D presses Tab and is in the text view instantly.

## Phase 3 — Tauri shell, install like a browser

Goal: users install the portal as a desktop app. No browser tab. Native window chrome. Behaves like Firefox or VS Code from the user's perspective. The web bundle still lives inside, rendered by the system webview.

Why Tauri (not Electron):

- Binary size: 5 to 15 MB vs 80 to 150 MB. Closer to "install a browser" than "install a bundled browser."
- Native shell in Rust. The portal's Rust code starts living here and grows from this seed in later phases.
- Cross-platform from one codebase (Windows, Mac, Linux). Mobile too via Tauri Mobile.
- Uses the system webview (WebView2 on Windows, WKWebView on Mac, WebKitGTK on Linux), so no per-install Chromium.

Work:

- **`portal/tauri/`.** Cargo crate. Thin shell: opens a window, loads `dist/index.html` (or `flat.html`), exposes a handful of native commands.
- **Native window chrome.** Menu bar, tray icon, file associations for `ibp://` URLs (open a portal at a stance from anywhere in the OS).
- **Local config persistence.** Rust-side storage for the place URL list, session tokens (keychain-backed), user preferences. The web bundle reads through a small `core/native.js` bridge that no-ops in the browser.
- **Protocol handler.** Clicking `ibp://taborgreat.com/projects@worker` anywhere in the OS opens the portal at that stance. Same idea as `mailto:` or `slack://` links.
- **Auto-update.** Tauri's updater shipped from day one. Portal updates feel like a browser update, not a manual rebuild.
- **Installer per platform.** `.dmg`, `.msi`, `.AppImage`, `.deb`. One `npm run build:native` produces all of them.

What stays the same: the web bundle inside, the IBP transport, the renderer architecture from Phase 2.

Exit criterion: download an installer, double-click, the portal opens to a default place URL with auth. Looks and feels like an installed app. Web origin URLs still work; browser tabs are no longer required.

## Phase 4 — drop the web engine (except where text needs it)

Goal: three of the four views go native. The text view keeps an embedded HTML renderer because, per the "HTML stays for the text view" pin above, HTML is the right tool for text-view content. The portal as a whole stops being a webview app; it becomes a native app that uses a webview as a component for one of its views.

**3D view:** wgpu + winit. The Three.js scene maps to wgpu's render pipeline. Three.js itself retires; the scene's geometry, material, and camera abstractions get a native equivalent. Most of the scene's logic (descriptor → meshes, doorways, beings as figures, gaze + first-person controls) is view-agnostic and ports with light editing.

**Console view:** native terminal-style emitter. A text input bound to the current address; verbs typed in; structured response blocks streamed back. No HTML. The render is a scrollable buffer of typed and labeled blocks.

**Explorer view:** native tree widget. Same data as the console view, rendered as expandable nodes. No HTML.

**Text view:** keeps a webview, but only the text view does. The native shell embeds a system webview (or a TreeOS-supplied HTML renderer in Phase 5) specifically for this surface. Iframed matter content keeps rendering. The DOM-heavy panels (inbox, roles, llm, role-manager) continue as HTML + JS inside the text-view webview; they don't have to be re-implemented as native widgets because the text view is allowed to be HTML.

Work:

- **`core/` to Rust (or stay JS with NAPI bindings).** The portal's IBP client, state model, navigation, address resolver — all small and pure. Easy to port. Cheap performance win; bigger structural win because now the portal's spine is one language.
- **JS retires from the 3D, console, explorer view runtimes.** Build artifacts no longer ship a JS runtime for those three views. The text view's webview still loads JS for its panels, but that's scoped to the text view's content area, not the whole portal.
- **Asset pipeline.** glTF, audio, fonts all loaded by the native code for 3D, console, explorer. The text view's webview continues to load HTML-style assets through its own pipeline.
- **The transport layer.** Still IBP, still Socket.IO-shaped semantics, but spoken by a Rust client. The wire format stays compatible because the reality kernel doesn't change.

What stays the same: IBP itself, descriptor shape, addresses, the four verbs, sovereignty.

Exit criterion: the portal binary starts in under 200ms on cold cache, runs at native frame rate on a Raspberry Pi 4. 3D, console, and explorer hold a tight memory budget; the text view's webview costs about what a single Tauri window costs today. No general-purpose web engine on the install footprint; the embedded HTML renderer serves only the text view's content area.

This is the phase where the portal becomes a real native app while keeping HTML where HTML earns its place.

## Phase 5 — TreeOS as the OS

Goal: TreeOS owns userland (the Level 3 vision in [OSV2.md](../philosophy/OS/OSV2.md)). The portal boots as the default shell on a TreeOS machine. There is no Linux underneath, no host browser to fall back to, no separate process model. Everything the user sees is the portal rendering the local kernel's spaces, matter, and beings.

When this lands, the portal's character changes again. It stops being an app you launch and becomes the surface you inhabit:

- **The portal is the shell.** Boot completes; the portal mounts. There is no separate desktop, no taskbar, no start menu. The user is at their home space, addressing the parts of their world they want to act in.
- **Login is BE:connect.** Identity is rooted in the kernel. No login screen; the user's session is their being.
- **Apps are realities.** What today is an installed application becomes a reality the user has authored or grafted in. "Open Slack" becomes "navigate to the slack-bridge reality, see who's there." The portal renders both the same way.
- **Files become matter.** Per OSV2's "matter as universal interface": no file manager, no folder hierarchy distinct from the spatial one. Every addressable thing the user can interact with is matter at a stance.
- **Processes become beings.** Per OSV2's "being replaces process": every running thing has identity, a chain, role grants. The portal renders them as figures inhabiting spaces. The user summons them by name; they reply through cognition (LLM, scripted, or human-inhabited).

Transport collapses. The portal isn't dialing a WebSocket to a remote server anymore; it's invoking IBP against the local kernel in-process. Latency drops to syscall speed. The dial-direct path replaces the network path for the local case; federation (cross-machine IBP) is just the remote case of the same protocol.

The portal becomes the rendering surface for the OS itself. Per OSV2 again: substrate operation becomes observable. The user can watch beings move matter, watch the stamper landing facts, watch IBP packets routing through the gateway, watch authorization decisions resolve. The factory is visible because it's built on the same primitives as the work happening inside it.

Work the portal needs to land this phase:

- **Direct kernel transport.** The IBP client speaks to a local kernel through shared memory / ABI calls, not over a network socket. The transport interface from Phase 4 stays; the implementation gets a new variant.
- **Boot integration.** The portal needs to start before any user can interact, mount the default home space, handle pre-login state (the equivalent of a getty + display manager + lock screen rolled into one).
- **Power, network, audio, USB, GPU.** Everything the conventional OS does to mediate hardware needs an equivalent path: as matter types the user can see and act on, or as kernel services the portal queries through normal IBP reads. Per OSV2: "a GPU is matter."
- **Multi-window. multi-context.** The portal hosts every place the user is at the same time. Equivalent to today's window manager, but spatial rather than rectangular.
- **The substrate-observability mode.** A toggle that switches the rendered scene from the user's work-reality to the kernel-reality (stampers, gateway, authorizer). The user watches their machine think.

This phase is years out. The work above is large. But Phase 4 produces a portal binary that can already serve the local-reality case (TreeOS running as a process on Linux); Phase 5 is the last move where the kernel beneath that binary is also TreeOS.

## The contract that lets all this happen

The reason this trajectory is feasible is that each phase changes one layer and leaves the others stable:

| Layer                | Phase 0        | Phase 3 (Tauri) | Phase 4 (Native)         | Phase 5 (TreeOS)         |
| -------------------- | -------------- | --------------- | ------------------------ | ------------------------ |
| Protocol (IBP)       | same           | same            | same                     | same                     |
| Descriptor format    | JSON           | JSON            | binary opt               | binary opt               |
| Transport            | Socket.IO/WS   | Socket.IO/WS    | Rust WS client           | In-process IBP           |
| 3D view              | Three.js       | Three.js        | wgpu native              | wgpu native              |
| Text view            | DOM + iframes  | DOM + iframes   | embedded webview         | TreeOS HTML renderer     |
| Console view         | (sketched)     | DOM             | native emitter           | native emitter           |
| Explorer view        | (sketched)     | DOM             | native tree              | native tree              |
| Host shell           | browser        | Tauri webview   | native window            | TreeOS itself            |
| Entry                | index.html     | Tauri main      | Rust main                | TreeOS boot              |

The four views are the user space at every phase. Console and explorer land alongside 3D and text along the way; what changes through phases is the rendering technology underneath each view, not the set. The text view keeps an HTML renderer through every phase because HTML is the right substrate for that view's content (iframes, embedded matter, rich docs); the other three go fully native by Phase 4. Users never lose the ability to switch instantly between any two views.

The protocol holds across every column. The other rows change, but each change is a finite engineering project on top of an unchanged contract. The portal doesn't need to be redesigned at any phase; it grows.

This is why the work done in Phase 0 (extracting `core/`, swept-out CSS, single config) earns interest. Each later phase has less to refactor because the lines were drawn early.

## What this enables that browsers can't

Worth being able to articulate when explaining what the portal becomes (OSV2 lays this out in more detail; the highlights):

- **Watch boot.** Fold the chain to time zero, render the kernel coming up. I-Am born, heaven space created, seed delegates birthed. The machine's genesis as visible motion.
- **Time-travel debugging at the OS level.** Something went wrong yesterday at 3pm? Fold the kernel state to 3pm yesterday. Walk around. Watch what happened. Conventional systems forget; TreeOS remembers.
- **Counterfactual exploration.** Branch from a past moment; explore the alternate timeline; compare. Not just for one program — for the whole machine.
- **The machine as biography.** Every act preserved, queryable, navigable. The user's computational life as a place they can revisit.
- **Cross-machine biography.** Archive your reality; restore on a new machine; continue. The new computer remembers everything the old one did.
- **The server/PC distinction collapses.** Per OSV2: your personal machine is selectively a server, selectively a personal computer, and both at once. The portal renders both contexts in the same world because they ARE the same world.

These capabilities aren't bolted on; they fall out of the kernel's commitments. The portal is what makes them visible.

## Pinned slogans

- **The portal speaks IBP. Everything else is negotiable.**
- **Every phase changes one layer; the protocol holds.**
- **Four views, one IBP state. Switch is instant; the world doesn't change.**
- **The machine becomes a place.**
- **The factory is observable because it's built on the primitives it hosts.**

## What to do now

Phase 1 (solidify the seam) is the next concrete pass. `core/state.js` + `core/navigation.js` + `core/renderer.js` interface + retiring the two singletons. Roughly a day of focused work. After that the renderer becomes pluggable, Phase 2 (split entry, drop HTML-first) becomes mechanical, and Tauri (Phase 3) becomes a separable engineering project that doesn't block the kernel's evolution.
