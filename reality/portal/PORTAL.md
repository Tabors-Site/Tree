# PORTAL — From Web Bundle to TreeOS Native Shell

> _"The portal speaks IBP. The renderer and the transport are negotiable."_

This file pins the portal's trajectory. The current shape is a Vite + Three.js web bundle served by the reality server. The destination is the default shell that boots when TreeOS itself is the OS, rendered without a web engine, talking to the local kernel through in-process IBP. This document maps the path between those two endpoints in phases small enough to ship and large enough to converge.

Read alongside [philosophy/OS/OSV2.md](../philosophy/OS/OSV2.md) (the OS vision: spaces, matter, beings, the four verbs, the substrate as observable factory). The portal is the surface that makes that vision visible.

## One sentence

**The portal is a client for IBP that hosts one or more VIEWS over the same IBP state; everything else (transport, host shell, asset pipeline) can change without changing what a portal IS.**

## The endgame is IBPA only (pinned 2026-06-12)

The web bundle, the HTTP origin, and every `/api` path are a TEMPORARY
stage. The destination is a portal that is fully IBPA: one address bar,
one protocol, no HTTP wrapping anywhere. HTML may survive past that
point only as a legacy access path (people who still want to reach the
system through a browser) and as matter-side content rendering, and
even the access path is expected to migrate away. Every seam built in
the web stage (core/assets.js, the content-carrier fetches, hash sync,
storage) exists so that removal is a resolver swap, not a rewrite.

## The four views — TreeOS user space

A **view** is a way of rendering the current IBP state. The portal hosts FIVE views (the fifth, Time, added 2026-06-12 by Tabor's call), and together they ARE the user space of TreeOS. Every other "kind of app" that conventional OSes ship (desktop, file manager, terminal, document viewer, dashboard, control panel, history browser) collapses into one of these. They are not modes the portal offers; they are the canonical surfaces a user inhabits the kernel through.

Each view shows the same thing because they all read from one in-memory model that mirrors the kernel's response to the current address. Switching views is instant and stateless: the user flips between any two without re-fetching, re-authenticating, or losing pending state.

| View         | Renders                                                                                                                                                                                                                                                                                                                     | Conventional OS analog          | Status   |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | -------- |
| **3D**       | Spatial scene: spaces as rooms, children as doorways and trees, beings as figures, matter as objects in the world                                                                                                                                                                                                           | **None.** A new surface; the closest pre-existing thing is a video-game world, not anything from a conventional OS. A 3D place to represent the data. | Built    |
| **Text**     | The ACTION CENTER — where work gets done fast, graphically. Its main feature is the task menubar (window-menu style, scope broadest→narrowest: Reality / Branch / Place / @being); choosing an action opens its form or panel in the work area. The @being menu appears whenever the IBPA's right stance carries a being (selected in any view) — chat, inspect, the role's summon intents, its verb actions. The inbox (your work queue) rides the bar's right edge. HTML-native: matter that ships as HTML renders through iframes; the kernel speaks IBP, this view speaks HTML on top of it. Navigation furniture deliberately absent — the shell IBPA, explorer, and console own movement. | **None exactly.** Closest: a menu-bar app + control panel + inbox fused — not a desktop (3D is the place), not a browser (explorer browses). | Built    |
| **Console**  | A stance-anchored verb prompt. The user types verbs (see, do, summon, be) against the current address; results stream back as structured blocks. More freeform than the backtick IBP console (which is a debug panel); the canonical view for scripting, remote work over slow links, and any user who prefers reading sentences | Terminal / shell                | Built (DOM) |
| **Explorer** | A file browser over the kernel's primitives. The address bar IS the IBP address; the right stance is "the open folder," and inside it you see only what's here: spaces (the folders), beings (a new kind of inhabitant), matter (the files). Clicking a space walks into it, which actually MOVES you (every view follows, navigation is shared). Matter shows a type true preview (image renders, model gets a solid, doorway gets the portal mark, web link embeds the site, text shows its first lines, else a file icon). Clicking a being or matter is a "coming soon" for now; interaction stays in the console and text views. Built off the projection folds, the same way a conventional file manager is built off the filesystem. | File manager / Finder   | Built (DOM) |
| **Time**     | The machine as its own biography (added 2026-06-12). A chronological feed over the chains the kernel already keeps: the current space's fact reel, your act chain, or the IBPA-selected being's chain — actor, action, branch, the moment's facts, progressively loading older history. Click any moment's timestamp and the whole portal folds to it: the ghost-walk anchor pins navigation at that instant, so 3D, text, console, and explorer all show what was there. No conventional OS can offer this surface because no conventional OS remembers. | **None.** The closest things — a shell history, a git log, a backup browser — each cover a sliver of one program; this is the whole world's history as a first-class surface. | Built (DOM) |

A view is NOT a separate app. The user's session, address, identity, branch, and pending state belong to the portal; the view is one window into that. Four views over the same address show the same beings, the same matter, the same pending inbox count, in their own visual language.

### The shell chrome — IBPA on top, tabs per being

The frame around the views is fixed and view-independent:

- **The IBPA stance bar is pinned to the very top, always visible, on every view.** `actor :: receiving`, both sides editable, cross-branch state always amber, a send arrow on its right, then `/` (reality root) and `~` (home). No view hides or re-hosts it; it is shell chrome (shared/stance-bar.js placed by core/shell.js), so the four views can never disagree about where the user is.
- **The view switcher sits beside it.** Four entries, one per view (Alt+1..4; `\` flips 3d↔text). Switching is a render swap against the shared model, never a refetch.
- **The being tab strip rides directly under the IBPA bar** and also never hides, on any view — one tab can sit in 3D while another tab is in text as another being.
- **The whole user space is tabbed per being.** Each shell tab is one PortalContext — its own IBP client, session, and state model. One being per tab; switch tabs and you switch beings; each tab remembers its own active view and address. Inhabiting a lineage being opens the borrowed body as a new tab. This is the portal-scale prototype of the OS shell's multi-context surface (Phase 5's "multi-window, multi-context").
- **The branch/timeline bar is chrome too.** Branches and rewind apply to every view (the ghost-view guard blocks writes regardless of renderer), so the bar mounts at shell level and the active view only renders the consequences.
- **Rewind is PORTAL state, not view state.** A timeline rewind pins a historical anchor on the shared model; every navigate carries the same `at:` qualifier until return-to-now, so the user WALKS AROUND IN THE PAST — doorways in 3D, folders in explorer, `cd` in console all stay at that moment, and all four views render the fold at T. The console and text views still SHOW the past even though they are act surfaces: acts are simply refused while rewound (the ghost guard), reading is always allowed. Fresh connections always land in the present.

One language rule for the console view: its navigation words are the Linux ones — `cd` moves between spaces (spaces ARE the directories), `ls` lists what's here, `pwd` prints the address — and the ONLY new words are the four verbs. That's the learnability claim made concrete: everything a terminal user knows carries over; what's new is exactly what TreeOS adds.

### Why these four

The set covers the legible ways humans interact with structured data — space, work, language, hierarchy, and time. The mapping is about how each view FEELS to use, not about which verbs it can call:

- **3D → inhabit.** The user is INSIDE the structure, walking around in it.
- **Text → operate.** The user WORKS the structure — menus, forms, inbox; actions fire fast.
- **Console → instruct.** The user EMITS into the structure, verbing at it directly.
- **Explorer → navigate.** The user TRAVERSES the structure, drilling in and out.
- **Time → remember.** The user REVISITS the structure — the chain rendered as a life, any moment one click from being re-inhabited.

**Every view exposes all four verbs.** SEE, DO, SUMMON, BE all work in 3D, text, console, and explorer. The 3D view is not the "BE view." The console is not the "DO view." A user in 3D can SEE just as fluently as someone in text; a user in console can BE somewhere just as fluently as someone in 3D. The interaction style differs — clicking a doorway, reading a panel, typing a verb, expanding a node — but the verb surface underneath is the same.

The natural-mode mapping above tells you which view will feel best for a given task, not which view is required. Move between them at any time and the verbs you can call do not change.

### What this means at the OS level

When TreeOS is the OS (Phase 5), these four views replace the conventional OS user space wholesale. There is no separate window manager, no separate terminal emulator, no separate file manager, no separate browser. The portal IS the user space. The four views ARE the surfaces. Switching views replaces "switching applications"; the user stays at their address, in their reality, and the way they're looking at it changes.

**The browser is not a separate thing.** This is the conceptual move that's hardest to swallow if you come from conventional computing. In TreeOS the whole machine is the reality, and the portal is how you USE that reality. A web browser, a terminal, a file manager, a 3D world — these were four separate applications on a conventional OS because each was a different lens on a different kind of data with a different process underneath. In TreeOS the data is one (spaces, matter, beings), the process is one (the portal hosting the IBP client), and the four views are four lenses on the same world. There's no application to switch INTO; there's a view to switch TO.

This is also why "portal" is the right name and not "browser" or "shell." A browser is one view (text, HTML-rendered). A terminal is another (console). A file manager is another (explorer). A spatial world is another (3D). The portal hosts all four; the user picks.

### Defining properties

1. **Synced.** Every view reads from the same in-memory model. A descriptor update from the kernel updates every mounted view in the same frame. Switching views is a render swap, not a data refetch.
2. **Switchable.** Views mount and unmount cheaply. Keyboard shortcut, button, or programmatic call swaps the active view. The address bar, identity, and pending state outside the view stay constant.
3. **Closed set.** The protocol does not grow new views and extensions don't add views — only doctrine does (Time joined 2026-06-12 because TIME is a legible axis the other four can't carry). The five ARE the surfaces; growth happens by enriching the kernel's response and letting every view show the new content in its own language.

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

- **Explorer** shows one space at a time, the user's current address, as an open folder. Its contents are the spaces, beings, and matter at that position; clicking a space walks into it (the whole portal moves, since navigation is shared), and the breadcrumb address bar plus an up button walk back out, exactly the file manager loop. The items are richer than files (matter has a type and a type true preview, beings have cognition, spaces can branch) because the kernel knows more than a filesystem does.
- **Console** addresses a stance and emits verbs. `see ./roles` prints the role registry. `do set-being:position` mutates. `summon @worker "draft a doc"` engages another being. The console is the explorer's language form: same data, same address grammar, expressed as input rather than navigation. A user can pick whichever lens fits the task.

Neither view invents a parallel storage model. Both read the projection. When TreeOS owns the OS at Phase 5, the projection IS the filesystem from the user's perspective; the explorer IS the file manager; the console IS the shell. The naming is conventional; the underlying primitives (spaces, matter, beings, stamps, reels, projection) are TreeOS's.

## HTML stays for the text view

The text view is HTML-rendered today, and it stays HTML-rendered at every phase, including when the portal otherwise leaves the web engine behind. Two reasons:

**1. HTML is the matter-side rendering format.** Some matter ships as HTML — embedded apps, rich documents, third-party content the user has grafted in. Today these render through iframes inside the text view. There is no universe in which it makes sense to invent a parallel markup language to replace HTML for these cases; the ecosystem of content the user wants to reach is HTML-native. The text view continues to embed it.

**2. Inventing a new markup is expensive and gains nothing.** HTML + CSS handles the descriptor → panel rendering well. Any TreeOS-specific markup would have to re-solve text flow, form fields, scrolling, embedded media, accessibility, internationalization. None of those are TreeOS problems; they're already solved problems. The text view rides HTML so the portal team can spend its budget on TreeOS-specific work.

What this implies for Phase 4 (drop the web engine):

- The 3D view goes fully native (wgpu).
- The console view goes fully native (terminal-style emitting + structured response blocks).
- The explorer view goes fully native (file-manager widget).
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

## Phase 0 — the foundation passes (LANDED)

```
portal/
├── package.json + vite.config.js      Vite build; three.js lazy, socket.io
├── index.html / text.html             two entries, both load core/boot.js
├── dist/                              built bundle (served by transports/http)
├── core/                              the spine (see Phase 1/2 below)
├── 3d/  flat/  console/  explorer/    the four views, each behind view.js
├── shared/                            cross-view chrome + panels
└── styles/                            css per surface, imported via Vite
```

The foundation passes that made the later phases possible:

- `core/` separated from renderers (no DOM in `core/client.js` or `core/config.js`).
- All inline `injectStyles()` swept into `styles/` so the renderer surface is data + CSS, not data + CSS-as-JS-string.
- Single config resolver for the place URL (no more `defaultPlaceUrl()` scattered).
- Flat and 3d render the same descriptor through one model.

What still lives in the web assumption: transport is Socket.IO over WebSocket dialed from `window.location` or config; styles, assets, and bundling assume a browser; HTML hosts the shell. Phases 3+ loosen those.

## Phase 1 — solidify the seam (LANDED 2026-06-11)

Goal: every renderer reads from the same in-memory model and reacts to the same events. No renderer reaches around the model. This is the structural pass that made "swap the renderer" a one-line decision instead of a refactor.

What landed:

- **`core/state.js`.** THE single subscribable model: `{ session, discovery, descriptor, currentAddress, actorBranch, selectedBeing, history, ... }`. The two former singletons (`flat.state` in `flat/host.js`, `state` in `3d/main.js`) collapsed into it. `3d/main.js` is gone; the `flat` object survives only as a mount-scoped adapter the text view populates FROM the model on each mount.
- **`core/navigation.js`.** The `navigate(address)` flow lives once: branch stickiness, history push/replace, hash sync, live re-subscribe, the per-navigate position fact, rewind/return-to-now, stale-session and branch-gone recovery, anonymous/authenticated landing.
- **The view contract** (`core/views.js`): `{ mount(rootEl, ctx), onDescriptor(desc, meta), onSelection(sel), destroy() }`. `3d/view.js` and `flat/view.js` implement it; a registry maps view name → lazy module.
- **`PortalContext`** (`core/context.js`). Per-tab bundle of client + session + state + navigation. No module-level singletons; several contexts coexist in one shell — which is exactly what makes being-tabs possible.

Exit criterion met: the text entry boots and runs without Three.js ever loading; the 3D view is an optional lazy module.

## Phase 2 — split the entry, drop the HTML-first assumption (LANDED 2026-06-11)

Goal: the text view boots without Three.js. The portal stops being "a 3D app with a text overlay" and becomes "an IBP client with a view registry."

What landed:

- **Two Vite entries.** `index.html` boots 3D-default; `text.html` boots text-first (`?view=` overrides either). Both load the same `core/boot.js`.
- **Three.js lazy load.** The 3D view module (and only it) imports Three.js; the registry imports views on first activation. Text-first sessions never fetch the ~700KB chunk (verified in the headless smoke test).
- **In-session view swap.** The old text-mode overlay became a real view swap (destroy active, mount next) through the registry; address, identity, and pending state ride the shared model across the swap. The console and explorer views landed alongside (DOM-rendered, per the phase table).
- **`core/assets.js`.** Asset-URL seam; the glTF/sound resolver routes through it so a native shell can later resolve from a local matter store instead of the HTTP origin.

Exit criterion met: a CI smoke test launches the text entry headless, never loads Three.js, and exercises full functionality; a user in 3D presses `\` (or Alt+2) and is in the text view instantly.

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
| Console view         | DOM            | DOM             | native emitter           | native emitter           |
| Explorer view        | DOM            | DOM             | native tree              | native tree              |
| Host shell           | browser        | Tauri webview   | native window            | TreeOS itself            |
| Entry                | index/text.html | Tauri main     | Rust main                | TreeOS boot              |

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

Phases 0 through 2 are landed (2026-06-11): the seam is solid, the entry is split, all four views exist over one state, and the shell carries the IBPA bar, the view switcher, and being tabs. The portal folder is self-contained (no imports reaching into seed/ or transports/) — exportable as the client.

Next concrete pass: **Phase 3 (Tauri shell)**. It is a separable engineering project that doesn't block the kernel's evolution: a thin Cargo crate around the existing dist, the `ibp://` protocol handler, keychain-backed session storage behind a `core/native.js` bridge that no-ops in the browser, and per-platform installers. Alongside it, the console and explorer views grow vocabulary as the kernel's response enriches — that's normal usage growth, not a phase.
