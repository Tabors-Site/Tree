# TreeOS Portal

A portal to the inhabitable internet. Not documents at URLs — beings addressing beings across lands, via Portal Addresses.

## What this is

The web browser assumes documents at URLs. You request a URL, receive HTML, render the page. Navigation is clicking links between documents.

The TreeOS Portal assumes **beings at positions, addressing other beings at other positions**. Every address names where interaction occurs AND which being is acting there. The portal renders based on what's at the position; the embodiment shapes how the user (or AI) at the address acts on it.

Two architectural commitments make this different from the web:

1. **Identity-first.** You can't open the portal anonymously. Every session starts signed in as a being at some land. Every action has an actor. The accountability chain TreeOS depends on starts in the portal's root surface.

2. **Stance-aware addressing.** Web URLs locate resources. Portal Addresses (PAs) locate STANCES (positions interpreted through embodiments). The same node viewed @ruler vs @historian renders differently — same data, different lens, different tools.

## Addressing in TreeOS

There are two places to address in the world: a **position** (a place) and a **stance** (a being at that place). A **Portal Address** is the bridge form linking two stances. A **land** is the domain name; it appears at the start of every position and is used by the BE verb to name where identity is established.

| Concept | Form | Example |
|---|---|---|
| **Land** | bare domain | `treeos.ai` (used by BE to identify the land) |
| **Position** | `<land>/<path>` | `treeos.ai/` (land root), `treeos.ai/~tabor` (home), `treeos.ai/flappybird/chapter-1` (tree node) |
| **Stance** | `<position>@<embodiment>` | `treeos.ai/flappybird@ruler` |
| **Portal Address** | `<stance> :: <stance>` | `tabor :: treeos.ai/flappybird@ruler` |

The slash is always present in a position. `treeos.ai` (no slash) is the land identifier; `treeos.ai/` is the land's root position. The path may be empty (just `/`), a home (`/~user...`), or any tree node.

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

Single-stance addressing (no `::`) is the normal mode for the four protocol verbs. SEE / DO / TALK / BE name the addressed stance; the requesting stance is implicit, established by BE. A full Portal Address (`stance :: stance`) is the relationship between two stances, used in UI surfaces (tab titles, history) and in advanced flows like being-to-being addressing.

See [docs/portal-address.md](docs/portal-address.md) for the full grammar.

## What the portal renders

Lands no longer return HTML pages for each URL. They return **Stance Descriptors** — structured JSON describing what's at a position. The portal knows how to render TreeOS-shaped data:

- governance state (plans, contracts, runs, workers, flags) at Ruler scopes
- artifact content at Worker leaves
- child positions for navigation
- beings invocable at this position
- extension-contributed panels
- chat threads addressing beings here

Rendering is consistent across lands because the portal owns the visual language — every land's positions look like TreeOS positions because the portal draws them that way.

See [docs/stance-descriptor.md](docs/stance-descriptor.md) for the JSON shape and [docs/zones.md](docs/zones.md) for how each zone type renders.

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

The TreeOS Portal does not wrap the web. It is its own surface, speaking a different protocol than HTTP/HTML.

For TreeOS lands, the portal speaks four WebSocket verbs (SEE, DO, TALK, BE) and renders Stance Descriptors. The legacy `land/routes/api/*` HTTP routes keep running during per-extension migration but are not part of the new protocol; nothing new wires through them.

For domains outside TreeOS (regular HTTP sites), the portal can present the domain's *being-side*. Every domain can publish an AI-being layer that the TreeOS Portal knows how to invoke (TALK with the appropriate intent). Instead of MCP servers stitched onto a website, a full being can know and act on the platform. The site's HTML stays reachable in any normal browser; the new being-layer is the preferred surface for portal users.

## How this relates to TreeOS itself

The Land server (existing TreeOS server in `../land/`) is the backend. It already has:
- the node tree
- the governing extension (Ruler / Planner / Contractor / Foreman / Worker)
- workspaces (book-workspace, code-workspace) that produce artifacts
- a WebSocket layer for live events
- legacy HTTP routes and an HTML dashboard surface

This portal sits opposite the Land server. It speaks a new protocol: four WS verbs (SEE / DO / TALK / BE) carrying Portal Addresses, plus a single HTTP bootstrap endpoint. The Land server gains a portal layer in `land/portal/` that exposes these verbs. The legacy HTTP routes keep working during migration; each extension's routes retire as it migrates to `do set-meta` plus TALK.

Future: the same portal opens any TreeOS-speaking land. Federation (Canopy) means a portal session can navigate across lands. A bridge connects a stance on one land to a stance on another.

## What gets built first

The protocol surface is four WebSocket verbs:

- **SEE** observe a position (one-shot or live)
- **DO** mutate the world (named structural actions plus generic `set-meta` for extensions)
- **TALK** deliver a message to a being's inbox (chat / place / query / be carried as intent classifier)
- **BE** identity lifecycle (register / claim / release / switch via a per-land auth-being)

The build sequence:

1. Demolish the earlier portal scaffolding (`portal:fetch`, `portal:resolve`, `portal:discover`) in one commit. No aliases.
2. Build SEE fresh. Full Stance Descriptor for all three zones; live SEE streams RFC 6902 patches.
3. Build DO with four named actions plus `set-meta` to prove the dispatch pattern.
4. Build TALK and the inbox. Sync respond-mode first, with one demonstration embodiment.
5. Build BE. Auth-being handles register/claim/release/switch.
6. Add async respond-mode. Response routing back to the originator's inbox.
7. Finish the portal shell. Land/Home/Tree zone renderers, tabs, navigator, identity panel.

The first version proves the concept: sign in as a being at a land, navigate to your home, see your tree, talk to beings at scopes.

See [docs/roadmap.md](docs/roadmap.md) for detailed phase sequencing.

## Directory layout

```
portal/
├── README.md                  this file
├── docs/
│   ├── protocol.md            the four-verb spec, top-level
│   ├── being-summoned.md      architectural framing: beings are summoned, not running
│   ├── message-envelope.md    TALK envelope and intent semantics
│   ├── inbox.md               inbox model, summoning triggers, response delivery
│   ├── do-actions.md          catalog of named DO actions plus set-meta
│   ├── be-operations.md       identity bootstrap and auth-being
│   ├── server-protocol.md     wire-level rules for the four ops
│   ├── portal-address.md      PA grammar + parser semantics
│   ├── stance-descriptor.md JSON shape lands return per zone
│   ├── zones.md               land / home / tree zone rendering rules
│   ├── identity.md            identity-first session model
│   ├── surfaces.md            address bar / identity / chat / navigator / tabs
│   └── roadmap.md             build phases under the four-verb model
└── lib/
    └── portal-address.js parser + formatter for the PA grammar
```

The app shell itself (Electron / Tauri / framework choice) gets scaffolded once the protocol contracts are locked.
