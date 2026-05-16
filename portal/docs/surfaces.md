# Portal surfaces

The TreeOS Portal has six core surfaces. This document defines each — what it does, what it surfaces, how it behaves.

## 1. Address bar

The primary navigation surface. Always at the top.

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ [ tabor ▾ ]  ::  treeos.ai/flappybird/chapter-1@ruler  [Enter]  │
└──────────────────────────────────────────────────────────────────┘
   left-chip          right-text (editable)
```

- **Left chip**: identity (signed-in being). Not editable. Click → roster dropdown to switch.
- **Right text**: the destination stance (`land/path@embodiment`). Editable. The `::` bridge is rendered between them but not editable as a character.

### Behaviors

- **Type Enter** → navigate to the right-side address using the left-side identity.
- **Auto-complete** triggers on:
  - `~` → user homes in the current land
  - `/` → child paths from current position, then siblings, then known trees
  - `@` → embodiments invocable at the current right-side path (from the Position Description's `beings:`)
  - bare typing → fuzzy match against navigation history + favorites
- **Paste a full PA** (`tabor::treeos.ai/foo@ruler`) → portal parses it; if the left side matches the current identity it just navigates; if it doesn't, prompt to switch.
- **Bridge mode** — typing `::` in the right-side field signals the user wants to address ANOTHER stance from theirs. Used for AI-to-AI bridges later. Pass 1: surface as advanced; the simple case is "I (left stance) address X (right stance)."

### Visual states

- Normal: monospace text, subtle highlight on focused field
- Loading: indicator next to the address while the Position Description is being fetched
- Error: red highlight on the bad segment of the address with the parser's error message in a tooltip
- Authorized-but-degraded: yellow pill ("guest"/"read-only") next to the embodiment when the identity can browse but not invoke

## 2. Identity panel

Always visible. Top-left or top-right of the portal chrome.

### Layout

```
┌─────────────────────┐
│ tabor               │
│ @ treeos.ai         │
│ ┌─────────────────┐ │
│ │ switch identity▾│ │
│ └─────────────────┘ │
└─────────────────────┘
```

### Behaviors

- Click → expand to roster of all signed-in beings the user has.
- "Switch" → open dropdown; selecting a different identity moves all NEW tabs to that identity. Existing tabs stay tied to their original identity.
- "Add identity" → opens the sign-in surface in a side panel.
- "Sign out" → removes from active state but keeps the roster entry.
- "Manage" → opens an identity-management surface for editing display name, LLM config, etc.

### State indicators

- Green dot if the identity's WebSocket is connected to its land.
- Yellow if connected but stale (no events for >5 min).
- Red if disconnected. Click to retry.

## 3. Main view

The body of the current tab. Renders the right-side position's Position Description.

### Layout per zone

- **Land zone**: discovery grid (trees + extensions + beings + land metadata).
- **Home zone**: tree grid (the user's projects + notes + active extensions).
- **Tree zone**: tree-shaped layout with governance panel, artifact body, sibling navigator, lineage breadcrumb.

See [zones.md](zones.md) for per-zone detail.

### Live updates

The main view subscribes to a position-scoped event stream via the WebSocket. Position Description fields update in place as events arrive:
- new plan emission → governance.plan.active replaced; visual highlight on the change
- worker started → governance.workers.running gets a new entry; pulse animation
- worker finished → moves from running to completed; status pill updates
- artifact note added → artifacts list grows; new note slides in

The user never refreshes. State is always current.

### Render mode toggle

A small toggle on the main view: "Live | Snapshot." Live (default) listens to events. Snapshot freezes the current view (useful for screenshots, copy-paste, audit). Server can also send a `renderHints: ["pause-live"]` for surfaces that don't benefit from live updates.

## 4. Chat panel

Sidebar or floating dock. Where the user talks to beings.

### Layout

```
┌─────────────────────────────────┐
│ Chats (3)                 [+]   │
├─────────────────────────────────┤
│ ▼ tabor :: tagay-book@ruler     │
│   (active, lifecycle: running)  │
│   ⋮ messages...                 │
├─────────────────────────────────┤
│ ▶ tabor :: chapter-1@archivist  │
│   (read-only, 4 messages)       │
├─────────────────────────────────┤
│ ▶ tabor :: ~tabor@dreamer       │
│   (idle)                        │
├─────────────────────────────────┤
│ [Message tabor :: tagay-book@.. │
│  ____________________________ ] │
│                          [send] │
└─────────────────────────────────┘
```

### Multi-thread model

The user can have many chat threads open simultaneously — each addressing a different being at a different position. Switching threads is a click; the input bar retargets. Each thread's address (the PA bridge) is shown in the thread header.

### Inline rich content

Chat messages can carry:
- prose (the being's voice)
- live trace lines (`· tool-call`, `… thinking …`, `✓ tool-result`)
- chainstep sub-bubbles (Planner/Contractor/Foreman exit text inline)
- plan cards (with accept / revise / cancel actions when applicable)
- lifecycle chip (persistent "Ruler active — phase: X" while spawns are in flight)
- artifact previews (when a Worker produces something; click to navigate to it)

### Persistence

Threads persist in the portal's local store + on the land server. Closing the panel and reopening shows them again. Threads cross sessions (signing out and back in restores them).

### "Always-on surface" model

Per the architecture brief — chat is NOT request/response. It's an open bidirectional surface. Either party (user or being) speaks whenever. The "thinking" indicator persists across hook-driven turns. No "loading" gate between messages.

## 5. Tree navigator

Visualizes the local tree structure around the current position. Sidebar component.

### Layout

```
┌──────────────────────┐
│ tree                 │
│ ┌──────────────────┐ │
│ │ ↑ parent         │ │
│ │   ~tabor         │ │
│ │ • this           │ │
│ │   tagay-book     │ │
│ │   children:      │ │
│ │   • chapter-1 ▶  │ │
│ │   • chapter-2 ○  │ │
│ │   • chapter-3 ✓  │ │
│ │   • chapter-4 ○  │ │
│ └──────────────────┘ │
└──────────────────────┘
```

### Behaviors

- Click any node → navigate to it.
- Lifecycle pills next to each child (running / completed / stalled / idle).
- Right-click → contextual actions (open in new tab, switch embodiment, view governance dashboard).
- Drag a node to a chat thread → references it in the chat message.
- Search inline (Ctrl-F) → fuzzy search across the local tree subgraph.

### Depth limit

Renders ~2 levels deep by default to stay readable. Expandable on demand. For deep trees, the user navigates by clicking down rather than seeing the whole tree at once.

## 6. Extension surfaces

Extensions installed at the current position contribute their own panels. Rendered alongside the main view per the Position Description's `extensions[].surfaces` field.

### Layout

Each extension surface gets a collapsible panel slot. Surfaces declare their render kind:

- `json-tree` — extension provides hierarchical data; portal renders as a tree
- `json-list` — extension provides flat list; portal renders as a table
- `html-fragment` — extension returns sandboxed HTML the portal embeds
- `custom` — extension provides a registered React/component contract (Pass 4)

For book-workspace: an outline panel + a chapter-status panel. For code-workspace: a file-tree panel + a build-output panel. For values: a domain-list panel. For schedule: a calendar.

Multiple extensions can be active; the user controls which panels are expanded.

## Tabs

Multiple PAs open at once. Each tab is one Portal Address.

### Tab title

Shows `<embodiment-emoji> <path-tail>@<embodiment>`. E.g., `👑 tagay-book@ruler`. Hover shows the full PA.

### Tab pinning

Pinned tabs stay across portal restarts. Useful for home zone + current project.

### Cross-tab linking

Drag a position-link from one tab's content to another tab's chat → references it in chat. Hover a position-link → tooltip shows the Position Description summary without navigating.

## What's NOT a surface

These are intentionally absent (web-portal holdovers that don't fit):

- **Refresh button**. Everything is live. State is event-driven.
- **Bookmarks bar**. Replaced by favorites in the identity panel and tree-navigator pinning.
- **Search bar separate from address bar**. The address bar is the only entry point.
- **Plugin/extension UI as overlays**. Extensions live as panels in the position descriptor, not as portal-chrome popups.
- **DOM inspector / dev tools**. Replaced by a "Position Description inspector" that shows the raw JSON the portal is rendering.
