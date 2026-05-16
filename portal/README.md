# TreeOS Portal

A client for **IBP, the Inter-Being Protocol**. Not documents at URLs. Beings addressing beings across lands, via Portal Addresses.

## What's named what

IBP is the protocol. Everything under this folder is shaped around it. Top-level vocabulary:

| Name | Role | Web analog |
|---|---|---|
| **IBP** (Inter-Being Protocol) | The protocol. Four verbs over WebSocket. | HTTP |
| **Portal Address** | The address format. `stance :: stance`. | URL |
| **Portal** | The client that speaks IBP and inhabits stances. | Browser |
| **Position Description** | What a land returns when IBP asks "what's at this stance?" | HTML |

This README and the docs in `docs/` use these names precisely. "Portal" never means the protocol; it always means the client. "IBP" never means a client; it always means the protocol.

## What this is

The web browser assumes documents at URLs. You request a URL, receive HTML, render the page. Navigation is clicking links between documents. That stack is HTTP plus URL plus HTML plus Browser.

The TreeOS Portal assumes **beings at positions, addressing other beings at other positions**. Every address names where interaction occurs AND which being is acting there. The portal renders based on what's at the position; the embodiment shapes how the user (or AI) at the address acts on it. That stack is IBP plus Portal Address plus Position Description plus Portal.

Two architectural commitments make this different from the web:

1. **Identity-first.** You can't open the portal anonymously. Every session starts signed in as a being at some land. Every action has an actor. The accountability chain TreeOS depends on starts in the portal's root surface.

2. **Stance-aware addressing.** Web URLs locate resources. Portal Addresses (PAs) locate STANCES (positions interpreted through embodiments). The same node viewed @ruler vs @historian renders differently — same data, different lens, different tools.

## Addressing in TreeOS

Two categories of things are addressable in IBP. Position and Stance. Everything else in the vocabulary is structural — names for the protocol, the address format, the building blocks — not addressable on its own.

### Addressable. Targets of verb calls.

| Concept | Form | Example |
|---|---|---|
| **Position** | `<land>/<path>` | `treeos.ai/` (root), `treeos.ai/~tabor` (home), `treeos.ai/flappybird/chapter-1` (tree node) |
| **Stance** | `<position>@<embodiment>` | `treeos.ai/flappybird@ruler`, `treeos.ai/@auth` |

### Structural vocabulary. Not addressable on its own.

- **Land** does double duty, distinguished by the trailing slash. `treeos.ai` (no slash) is the bare domain identifier — the name of the sovereign server, used by BE when dispatching to the land's auth-being. `treeos.ai/` (with slash) is the Land Position of that land — addressable like any Position. The trailing slash is the load-bearing distinction.
- **Portal Address** is the bridge form, `<stance> :: <stance>`. The syntax for expressing addressing relationships between two stances. Not a thing that gets addressed; the format used to address things. Like URL is not addressed; URLs are the format.
- **Embodiment** is a cognitive shape (`@ruler`, `@archivist`, a username). Not addressable on its own. Combines with a Position to form a Stance.

### Addressing grammar

| Form | Meaning | Verbs |
|---|---|---|
| `treeos.ai` | domain only, Land identifier | BE |
| `treeos.ai/` | domain plus trailing slash, Land Position | SEE, DO |
| `treeos.ai/flappybird` | domain plus path, deeper Position | SEE, DO |
| `treeos.ai/@auth` | Land Position plus embodiment, Stance at the Land Position | TALK, BE |
| `treeos.ai/flappybird@ruler` | deeper Position plus embodiment, Stance at node | SEE, TALK, BE |

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

Lands no longer return HTML pages for each URL. They return **Position Descriptions** — structured JSON describing what's at a position. The portal knows how to render TreeOS-shaped data:

- governance state (plans, contracts, runs, workers, flags) at Ruler scopes
- artifact content at Worker leaves
- child positions for navigation
- beings invocable at this position
- extension-contributed panels
- chat threads addressing beings here

Rendering is consistent across lands because the portal owns the visual language — every land's positions look like TreeOS positions because the portal draws them that way.

See [docs/position-description.md](docs/position-description.md) for the JSON shape and [docs/zones.md](docs/zones.md) for how each zone type renders.

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

The TreeOS Portal does not wrap the web. It is its own surface, speaking IBP rather than HTTP, rendering Position Descriptions rather than HTML.

For TreeOS lands, the Portal speaks IBP's four WebSocket verbs (SEE, DO, TALK, BE). The legacy `land/routes/api/*` HTTP routes keep running during per-extension migration but are not part of IBP; nothing new wires through them.

For domains outside TreeOS (regular HTTP sites), the portal can present the domain's *being-side*. Every domain can publish an AI-being layer that the TreeOS Portal knows how to invoke (TALK with the appropriate intent). Instead of MCP servers stitched onto a website, a full being can know and act on the platform. The site's HTML stays reachable in any normal browser; the new being-layer is the preferred surface for portal users.

## How this relates to TreeOS itself

The Land server (existing TreeOS server in `../land/`) is the backend. It already has:
- the node tree
- the governing extension (Ruler / Planner / Contractor / Foreman / Worker)
- workspaces (book-workspace, code-workspace) that produce artifacts
- a WebSocket layer for live events
- legacy HTTP routes and an HTML dashboard surface

This portal sits opposite the Land server. It speaks IBP: four WS verbs (SEE / DO / TALK / BE) carrying Portal Addresses, plus a single HTTP bootstrap endpoint. The Land server gains an IBP layer in `land/portal/` that exposes these verbs. The legacy HTTP routes keep working during migration; each extension's routes retire as it migrates to `do set-meta` plus TALK.

Future: the same portal opens any TreeOS-speaking land. Federation (Canopy) means a portal session can navigate across lands. A bridge connects a stance on one land to a stance on another.

## What gets built first

IBP's surface is four WebSocket verbs, each with a distinct address rule:

| Verb | Accepts | Why |
|---|---|---|
| **SEE** | position or stance | Observation works at either tier: what's here, or what does this being see here. |
| **DO** | position only | Mutations target persistent data. Embodiments are summoned moments, not storage — nothing at a stance to mutate. |
| **TALK** | stance only | Beings live as stances. Engagement requires both position and embodiment (inboxes are per-being-per-position). |
| **BE** | stance only | Self-identity operations target stances. For fresh registration, the stance is the land's auth-being. |

**Data and beings.** IBP distinguishes data from beings. Data is mutable (through DO). Beings are not. You can shape a being's environment (DO on its position data), send it messages (TALK to its stance), and observe its perspective (SEE on its stance). You cannot mutate a being directly. See [docs/protocol.md](docs/protocol.md) for the architectural commitment.

- **SEE** observe (one-shot or live)
- **DO** mutate (named structural actions plus generic `set-meta` for namespaced metadata)
- **TALK** deliver a message to a being's inbox (chat / place / query / be carried as intent classifier)
- **BE** identity lifecycle (register / claim / release / switch)

The build sequence:

1. Demolish the earlier portal scaffolding (`portal:fetch`, `portal:resolve`, `portal:discover`) in one commit. No aliases.
2. Build SEE fresh. Full Position Description for all three zones; live SEE streams RFC 6902 patches.
3. Build DO with four named actions plus `set-meta` to prove the dispatch pattern.
4. Build TALK and the inbox. Sync respond-mode first, with one demonstration embodiment.
5. Build BE. Auth-being handles register/claim/release/switch.
6. Add async respond-mode. Response routing back to the originator's inbox.
7. Finish the Portal shell. Land/Home/Tree zone renderers, tabs, navigator, identity panel.

The first version proves the concept: sign in as a being at a land, navigate to your home, see your tree, talk to beings at scopes. All over IBP.

See [docs/roadmap.md](docs/roadmap.md) for detailed phase sequencing.

## Directory layout

```
portal/
├── README.md                  this file
├── docs/
│   ├── protocol.md            IBP, the four-verb spec, top-level
│   ├── being-summoned.md      architectural framing: beings are summoned, not running
│   ├── message-envelope.md    TALK envelope and intent semantics
│   ├── inbox.md               inbox model, summoning triggers, response delivery
│   ├── do-actions.md          catalog of named DO actions plus set-meta
│   ├── be-operations.md       identity bootstrap and auth-being
│   ├── server-protocol.md     wire-level rules for the four ops
│   ├── portal-address.md      PA grammar + parser semantics
│   ├── position-description.md JSON shape lands return per zone
│   ├── zones.md               land / home / tree zone rendering rules
│   ├── identity.md            identity-first session model
│   ├── surfaces.md            address bar / identity / chat / navigator / tabs
│   └── roadmap.md             build phases under the four-verb model
└── lib/
    └── portal-address.js parser + formatter for the PA grammar
```

The app shell itself (Electron / Tauri / framework choice) gets scaffolded once the protocol contracts are locked.
