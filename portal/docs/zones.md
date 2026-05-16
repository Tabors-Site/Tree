# Zones — land, home, node

Every position in the TreeOS Portal belongs to one of three zone types. The zone determines the top-level chrome the portal renders. The position within the zone determines what the body shows.

## Land zone

`land/` — the public root of a server. The discovery surface.

### What it surfaces

- **Public trees** — anything ext-allow'd at land scope, browsable by visitors.
- **Land-level beings** — embodiments invocable on the land itself (`@citizen`, `@oracle` for public knowledge, `@merchant` if there's a marketplace, custom land-defined beings).
- **Available extensions** — what this land hosts that users can install on their trees.
- **Source data** — public files / artifacts shared at land scope.
- **Land metadata** — who runs it, what's its operating policy, registration status, economy (if any).
- **Visitors-from-elsewhere registry** — beings on other lands who've registered themselves as accessible here (Pass 5 federation).

### When a visitor arrives without a more specific address

`treeos.ai` with no path → the land zone renders. Whoever stops by sees what's available: a list of public trees, a sign-up surface if registration is open, beings they can talk to as a guest.

### Chrome

- Header: land name + operator + status pill
- Body: discovery cards (trees, extensions, beings)
- Sidebar: navigation into specific public trees
- Identity panel still in place — the visitor's signed-in identity is shown; if they're not a being here, the prompt to register is visible

### Default embodiment

`@citizen` — generic participant. Read-only browsing. Talking to public beings allowed; creating things on the land typically requires elevation (which the land's auth model gates).

## Home zone

`land/~user` — a user's personal tree root.

### What it surfaces

- **The user's tree** — every project / book / note / branch they've created.
- **Configured beings** — the user's personally invocable embodiments. May include custom beings the user has crafted with their own prompts and tools.
- **Active extensions** — what's ext-allow'd in the home's spatial scope.
- **Accumulated history** — recent activity, chat threads, recent navigation, favorites.
- **Personal LLM config** — visible to the home's owner only. Switch model defaults, manage API keys.

### Privacy boundary

Home zone is PRIVATE by default. Only the owner (and identities they've explicitly authorized) sees the full content. The portal refuses to render someone else's home zone unless the requesting identity has been granted access.

### Where personal work happens

The home zone is the most-visited part of the portal for any given user. Building things. Coordinating personal beings. Running projects. Notes. Reading.

### Chrome

- Header: home owner name + active LLM hint + identity panel
- Body: tree grid (each child = a project or notes-tree)
- Sidebar: recent activity, favorite positions, chat-thread restore
- Quick-create: "new tree" gesture to spawn a fresh tree root

### Default embodiment

`@dreamer` for creative-leaning users (poetic / generative interactions feel right). `@builder` for engineering-leaning users (focused on construction). User picks via setting; can be overridden per-tab via the address bar.

## Tree zone

`land/<path>` — a specific position inside a tree.

### What it surfaces

Depends heavily on what's at the position. The Stance Descriptor describes it; the portal renders accordingly. Possible surfaces:

- **Governance state** if the node is a Ruler scope: plan / contracts / runs / workers / flags / lifecycle pill.
- **Artifact content** if the node has notes or files: rendered as markdown / images / code per the artifact `kind`.
- **Children** for navigation deeper into the tree.
- **Siblings** for sideways movement.
- **Lineage breadcrumb** upward.
- **Beings invocable here** in the chat-invoke dropdown.
- **Extension panels** — any extension active at this scope contributes its surface.
- **Live activity** — current chat threads, running spawns, lifecycle chip, ongoing Worker output.

### The Ruler scope renderer

Special case. Most-used surface in the system once people are coordinating. Layout:

```
┌─────────────────────────────────────────────────────────────────┐
│ Breadcrumb: treeos.ai / ~tabor / tagay-book                     │
│ tagay-book               [lifecycle: running] [identity panel]  │
├──────────────────┬──────────────────────────────────────────────┤
│ Tree navigator   │  Governance panel                            │
│ - parent         │  ┌────────────┬────────────┬────────────┐    │
│ - this           │  │ Plan       │ Contracts  │ Runs       │    │
│ - children       │  │ ord. 1     │ 3 ratified │ rec-1 run  │    │
│   • chapter-1    │  └────────────┴────────────┴────────────┘    │
│   • chapter-2    │                                              │
│   • chapter-3    │  Workers                                     │
│   • chapter-4    │  ▶ chapter-01: running                       │
│                  │  ✓ chapter-03: done                          │
│                  │  ○ chapter-02: pending                       │
│                  │  ○ chapter-04: pending                       │
│                  │                                              │
│                  │  Flags                                       │
│                  │  (none pending)                              │
├──────────────────┴──────────────────────────────────────────────┤
│ Artifact: tagay-story-brief.md           (chat panel) ──→       │
│ The story of Tagay and Egay opens with...                       │
│ ...                                                             │
├──────────────────────────────────────────────────────────────────┤
│ chat: tabor :: treeos.ai/tagay-book@ruler           [send]     │
└─────────────────────────────────────────────────────────────────┘
```

Three columns + bottom chat + lifecycle chip in the header. Real-time updates via WS — no refresh.

### The Worker leaf renderer

When the position is a leaf with artifact content, the artifact takes center stage. Sidebar shows the spec that produced it (for accountability + reading the spec against the output). Chat panel invokable to discuss / refine.

### The intermediate-Ruler scope renderer

A Ruler with sub-Ruler children. Governance panel collapsed (smaller); child tree expanded so the user can drill in. Each child has a status pill (running / completed / stalled / etc.).

### Default embodiment

- Ruler scopes: `@ruler` (the user can coordinate the scope)
- Worker leaves: `@worker` (rare — usually the user observes via `@archivist`)
- Plan / contracts / runs trio-children: `@archivist` (read-only inspection)
- Custom node types: per the Stance Descriptor's `beings:` field

## Cross-zone shared chrome

Every zone has:

- **Address bar** at the top (left = identity, right = position+embodiment)
- **Identity panel** always visible
- **Tabs** for multiple Portal Addresses open at once
- **Back / forward / home buttons** (home = home zone of current land; tree button to go to tree root when inside a tree)
- **No refresh button** — everything is live via WS. State invalidation is event-driven.

The only chrome difference is the body — what fills the main view and which sidebars / panels are populated.

## Switching zones

Address-bar typing handles cross-zone moves transparently. Typing `/` jumps to the land zone of the current land. Typing `~` jumps to the user's home. Typing a path jumps to a node.

Visual cues distinguish the zones — different background tint, different sidebar shape. Doesn't have to be loud; just enough that the user knows which zone they're in at a glance.

## Why three and not more

These three carve at real architectural joints:

- **Land zone**: the server's public-facing surface. Discovery + economy. Anyone may visit.
- **Home zone**: a user's private root. Personal authority + accumulated artifacts.
- **Tree zone**: everywhere else — every position inside any tree, any user's home, any land-public tree. The recursive workspace.

Four would over-specify (tree zone covers a lot of different node types but the BROWSER chrome stays the same; the Stance Descriptor varies the BODY). Two would conflate land and home (both are "roots" but their privacy + content differ enough).

The three-zone split makes the address bar predictable: type `/` you're in land, `~` you're in home, a path you're in node. The portal knows which chrome to draw before the Stance Descriptor arrives.

## Open question: ZONE for cross-land federation

A "federated zone" for visiting another land while signed in to your home land might warrant its own chrome (subtly different border / "federated" indicator). For Pass 1 this is over-design; cross-land visits use the tree-zone chrome with a small "federated" pill. Revisit if Pass 5's federation work makes the visit pattern common.
