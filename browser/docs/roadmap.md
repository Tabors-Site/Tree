# Build roadmap

The TreeOS Browser is a multi-pass build. This document sequences the work.

## Phase 0 — Foundations (this folder)

What's done in this pass:

- Conceptual model written (README + docs/).
- Perspective Address grammar defined ([perspective-address.md](perspective-address.md)).
- Position Descriptor JSON contract defined ([position-descriptor.md](position-descriptor.md)).
- Identity-first session model ([identity.md](identity.md)).
- Zone types specified ([zones.md](zones.md)).
- Browser surface inventory ([surfaces.md](surfaces.md)).
- Server protocol locked ([server-protocol.md](server-protocol.md)).
- PA parser scaffolded ([../lib/perspective-address.js](../lib/perspective-address.js)).

Done = the documents that anyone joining can read before writing the first line of UI code. The format contracts (PA + Position Descriptor) are the load-bearing pieces; the rest is implementation-shaped guidance.

## Phase 1 — Server-side: Position Descriptors

Smallest end-to-end slice. Goal: a land server returns valid Position Descriptors for the three zone types.

**Work:**

1. New route file in `land/routes/api/position.js`:
   - `GET /api/v1/.treeos-discovery` (capabilities)
   - `GET /api/v1/position/land/` (land zone)
   - `GET /api/v1/position/home/:user` (home zone)
   - `GET /api/v1/position/node/*` (node zone, deep paths)
2. Position-resolver helpers in `land/seed/tree/` that map a PA to a node + governance state and shape it into the descriptor JSON.
3. Reuse existing extensions:
   - `governing.buildDashboardData` → governance block
   - `seed.tree.notes.getNotes` → artifacts block
   - `governing.findActiveWorkspaceAtScope` → extension surfacing
   - Existing tree-fetch primitives for children + lineage + siblings
4. Embodiment authorization gate — small helper that, given an identity and a position, returns which `beings:` entries are invocable. Reads existing extension-scope rules.

**Verification:**

- `curl http://localhost:3000/api/v1/.treeos-discovery` with auth → returns capabilities JSON
- `curl /api/v1/position/land/` → returns land discovery JSON with public trees
- `curl /api/v1/position/home/tabor` → returns home zone JSON with tabor's trees
- `curl /api/v1/position/node/tagay-book?embodiment=ruler` → returns full node descriptor

No browser needed yet — Phase 1 stands alone. Existing CLI / HTML browser keep working in parallel.

**Estimate:** 1-2 days of focused work. Most logic exists; this is shaping + new routes.

## Phase 2 — Browser shell (minimal)

Goal: an Electron (or Tauri) app that signs in, navigates by PA, renders home + node zones.

**Choice point:** Electron vs Tauri.

- **Electron** — JavaScript everywhere; reuses TreeOS conventions; bigger bundle (~150MB); fastest to develop given existing JS stack.
- **Tauri** — Rust shell + JS frontend; tiny bundle (~5MB); native OS integration; rust toolchain required.

Recommend **Electron** for Phase 2. Bundle size doesn't matter for the dev-test loop; matching the existing JS stack means a contributor can read the whole codebase. Tauri considered for Phase 4 polish.

**Work:**

1. Scaffold `browser/app/` with Electron + Vite + React (or similar minimal stack).
2. Sign-in screen:
   - Land URL input.
   - Existing-being picker (from local roster).
   - "Add identity" flow.
3. Address bar (left chip + right text, parser-backed).
4. Main view:
   - Home zone renderer — tree grid.
   - Node zone renderer — governance panel + artifact body + sidebar.
5. Identity panel (always visible, switch roster, sign-in elsewhere).
6. Tree navigator (sidebar).
7. WS subscription wiring — descriptor patches apply live.

**Verification:**

- Launch browser → sign-in screen.
- Sign in as `tabor @ localhost:3000` → home zone renders showing tabor's trees.
- Click `tagay-book` → node zone renders with current state from descriptor.
- Open another tab, navigate to `tagay-book/chapter-1` → renders chapter scope.
- Live update: another client modifies the tree → first browser tab updates without refresh.

**Estimate:** 1-2 weeks. UI is the heavy lift.

## Phase 3 — Chat panel + live event integration

Goal: the chat surface works end-to-end. Beings are invocable. Events stream live.

**Work:**

1. Chat panel surface (dock or sidebar).
2. Multi-thread routing — events filtered by threadId.
3. Inline rich content rendering (tool calls, thinking, chainstep bubbles, plan cards, lifecycle chip).
4. Send → receive flow with the existing TreeOS WS chat protocol (extended with threadId per [server-protocol.md](server-protocol.md)).
5. Embodiment selection in the chat-invoke dropdown (reads from Position Descriptor's `beings:`).
6. Plan-card actions (accept / revise / cancel) wired to send the appropriate user message.

**Verification:**

- Open chat at `tagay-book@ruler` → input bar focused, address shown.
- Type "build me a book about flappy bird" → user message appears, Ruler responds, lifecycle chip pulses through plan → contracts → dispatch → done.
- Sub-Ruler events appear in the parent chat thread (this requires server-side sessionId plumbing too — combined work).
- Open a second chat at `chapter-1@archivist` → read-only, no chat-write surface.

**Estimate:** 1 week. Lots of existing chat-panel logic reusable from `extensions/treeos-base/app/`.

## Phase 4 — Land zone + discovery + extensions panels

Goal: discovery works. The TreeOS land becomes inhabitable.

**Work:**

1. Land zone renderer — discovery cards.
2. Cross-tab linking (drag node-link into chat).
3. Extension surface rendering (per-extension panels).
4. Tabs (multiple PAs open simultaneously, identity-scoped).
5. Back / forward / home navigation.
6. Search across local tree subgraph.

**Verification:**

- Land zone shows trees, extensions, beings.
- Click into a public tree → node zone.
- Open three tabs simultaneously: home / project root / chapter inside project.
- Drag a node from tree navigator → drops as a position-link in active chat.

**Estimate:** 1-2 weeks.

## Phase 5 — Legacy HTML mode + transition

Goal: existing HTML pages still work inside the new browser. Migration path for old surfaces.

**Work:**

1. iframe-style fallback for positions returning HTML (legacy mode).
2. Migration helper: a small tool that scans existing HTML routes and suggests Position Descriptor equivalents.
3. Configuration per land — which routes are HTML vs Position Descriptor.

**Estimate:** 1 week.

## Phase 6 — Federation prep (Canopy integration)

Goal: cross-land navigation works. Federated identities propagate.

**Work:**

1. Position requests across lands.
2. Federated identity headers.
3. Visited-land authorization rules via Canopy.

This sits under the broader Pass 5 federation push and may not be Phase 6 of the browser specifically. Depends on Canopy's status at the time.

## Phase 7 — Polish

Theming, keyboard shortcuts, accessibility, mobile-shaped layout (browser as a tablet-aware app), Tauri port if bundle size becomes painful, sync of identity roster across devices (via federated home land).

## Sequencing summary

```
Phase 0  [DONE — this folder]   foundations: format contracts + docs
Phase 1  [2 days]               server-side: Position Descriptor routes
Phase 2  [1-2 weeks]            browser shell: sign-in + home/node rendering
Phase 3  [1 week]               chat panel + live events
Phase 4  [1-2 weeks]            land zone + extensions + tabs
Phase 5  [1 week]               legacy HTML fallback
Phase 6  [depends on Pass 5]    federation
Phase 7  [open-ended]           polish
```

Total to "TreeOS browser is the daily-driver for using the system": ~5-6 weeks of focused work, distributed however contributors are available.

## What NOT to build

Resist these temptations:

- **Generic web browsing.** The TreeOS Browser doesn't render arbitrary websites. It renders Position Descriptors. Legacy HTML fallback is for TreeOS pages that haven't migrated yet, not for the open web.
- **Heavy UI framework reach.** Stick with the lightest stack that works. React + Vite. No Material-UI / heavy component libraries. Visual style is TreeOS-shaped (sage / dark / monospace accents), not platform-native.
- **Re-implementation of TreeOS features.** All governance / planning / contracting logic stays on the land server. The browser renders state and emits user messages.
- **Mobile-first.** Desktop first. Mobile shape is a Phase 7 concern.
- **Cross-browser compatibility.** This IS the browser. There's no "render in Chrome too" requirement.

## When to write the first line of UI code

When at least these are true:
- Position Descriptor contract reviewed and locked.
- Land server returns valid descriptors for the three zone types (Phase 1 done).
- The shape of `beings:` and `extensions:` is validated against real data from the existing TreeOS server.

Then the browser shell can be built confidently against a stable backend.
