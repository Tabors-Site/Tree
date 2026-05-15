# TreeOS Portal

A portal to the inhabitable internet. Not documents at URLs — beings addressing beings across lands, via Portal Addresses.

## What this is

The web browser assumes documents at URLs. You request a URL, receive HTML, render the page. Navigation is clicking links between documents.

The TreeOS Portal assumes **beings at positions, addressing other beings at other positions**. Every address names where interaction occurs AND which being is acting there. The portal renders based on what's at the position; the embodiment shapes how the user (or AI) at the address acts on it.

Two architectural commitments make this different from the web:

1. **Identity-first.** You can't open the portal anonymously. Every session starts signed in as a being at some land. Every action has an actor. The accountability chain TreeOS depends on starts in the portal's root surface.

2. **Stance-aware addressing.** Web URLs locate resources. Portal Addresses (PAs) locate STANCES (positions interpreted through embodiments). The same node viewed @ruler vs @historian renders differently — same data, different lens, different tools.

## The four-tier address hierarchy

TreeOS replaces "URL" with four addressing tiers, each adding one piece of detail:

| Tier | What it carries | Example |
|---|---|---|
| **Land** | just the domain | `treeos.ai` |
| **Position** | land + path (where) | `treeos.ai/flappybird` |
| **Stance** | position + embodiment (where + as what being) | `treeos.ai/flappybird@ruler` |
| **Portal Address (PA)** | stance :: stance (full bridge) | `tabor :: treeos.ai/flappybird@ruler` |

A **Stance** is one side of a bridge: a being at a position. A **Portal Address** joins two stances through a **bridge** (`::`), naming who's addressing whom.

Full form:
```
tabor :: treeos.ai/flappybird@ruler
```
Meaning: signed in as `tabor` (left stance), addressing the `ruler` embodiment at `treeos.ai/flappybird` (right stance).

Shorthands when context allows:
- Local land implied: `tree/branch@ruler`
- Implicit self on the left: `treeos.ai/flappybird@ruler`
- Home position: `treeos.ai/~@dreamer`

Single-stance viewing (no `::`) is allowed only for read-only inspection. Anything interactive requires a full PA.

See [docs/portal-address.md](docs/portal-address.md) for the full grammar.

## What the portal renders

Lands no longer return HTML pages for each URL. They return **Position Descriptors** — structured JSON describing what's at a position. The portal knows how to render TreeOS-shaped data:

- governance state (plans, contracts, runs, workers, flags) at Ruler scopes
- artifact content at Worker leaves
- child positions for navigation
- beings invocable at this position
- extension-contributed panels
- chat threads addressing beings here

Rendering is consistent across lands because the portal owns the visual language — every land's positions look like TreeOS positions because the portal draws them that way.

See [docs/position-descriptor.md](docs/position-descriptor.md) for the JSON shape and [docs/zones.md](docs/zones.md) for how each zone type renders.

## The three zone types

- **Land zone** (`server/`) — public root of a server. Discovery surface: public trees, available extensions, land-level beings, source data.
- **Home zone** (`server/~user`) — user's personal space. Private tree, configured beings, accumulated history.
- **Tree zone** (`server/<zone>/<path>`) — specific position inside a tree. Governance, artifacts, children, beings invocable here.

The zone determines the chrome the portal renders; the position determines the content.

See [docs/zones.md](docs/zones.md).

## The portal's main surfaces

- **Address bar** — type or paste PAs. Auto-completes from history + known beings.
- **Identity panel** — always-visible signed-in being. Switch beings, sign in elsewhere.
- **Main view** — renders the current right-side position.
- **Chat panel** — invoke beings at the current or other positions. Many chats open simultaneously, each addressing different embodiments.
- **Extension surfaces** — extensions at the position contribute their own panels.
- **Tree navigator** — visualizes the tree around the position. Spatial movement.
- **Tabs** — many Portal Addresses open at once. No refresh button (everything live via WS).

See [docs/surfaces.md](docs/surfaces.md).

## Coexistence with the existing web

The TreeOS Portal doesn't replace the web. It wraps it.

- **Legacy HTML mode**: positions that return HTML get rendered in a frame with TreeOS chrome around it. Existing dashboard pages keep working.
- **Native TreeOS mode**: positions returning Position Descriptors render natively in TreeOS conventions.

Lands migrate surfaces from HTML to JSON over time. Portal supports both during transition.

For domains outside TreeOS (regular HTTP sites), the portal can act as a wrapper that presents the domain's *being-side* — every domain can publish an AI-being layer the TreeOS Portal knows how to invoke. Instead of MCP servers stitched onto a website, a full being can know and act on the platform. The legacy HTML is still reachable; the new being-layer is the preferred surface.

## How this relates to TreeOS itself

The Land server (existing TreeOS server in `../land/`) is the backend. It already has:
- the node tree
- the governing extension (Ruler/Planner/Contractor/Foreman/Worker)
- workspaces (book-workspace, code-workspace) that produce artifacts
- a WebSocket layer for live events
- HTML rendering for dashboards (the legacy surface)

This portal sits opposite the Land server. It speaks a new protocol — the Position Descriptor format — and renders accordingly. The Land server gets new route handlers that recognize PA-shaped requests and return Position Descriptors instead of HTML. Old routes keep working; new routes coexist.

Future: the same portal opens any TreeOS-speaking land. Federation (Canopy) means a portal session can navigate across lands. A bridge can connect a stance on one land to a stance on another.

## What gets built first

Three pieces, in order:

1. **Position Descriptor format** — locked-in JSON contract between server and portal. The shape land servers return per zone type.
2. **Server-side handlers** — Land server recognizes PA-shaped routes and returns Position Descriptors.
3. **The portal app itself** — Electron or Tauri shell. Address bar, identity panel, JSON-position rendering, basic chat panel. Start with home-zone rendering since that's where most user time lives.

The first version doesn't need to be polished. It needs to prove the concept: sign in as a being at a land, navigate to your home, see your tree, talk to beings at scopes.

See [docs/roadmap.md](docs/roadmap.md) for sequencing detail.

## Directory layout

```
portal/
├── README.md                  this file
├── docs/
│   ├── portal-address.md PA grammar + parser semantics
│   ├── position-descriptor.md JSON shape lands return per zone
│   ├── zones.md               land / home / tree zone rendering rules
│   ├── identity.md            identity-first session model
│   ├── surfaces.md            address bar / identity / chat / navigator / tabs
│   ├── server-protocol.md     how lands respond to PA-shaped requests
│   └── roadmap.md             build phases + first-three sequencing
└── lib/
    └── portal-address.js parser + formatter for the PA grammar
```

The app shell itself (Electron / Tauri / framework choice) gets scaffolded once the protocol contracts are locked.
