# Perspective Address — grammar and semantics

A Perspective Address (PA) names **a being addressing another being**. PAs replace URLs in the TreeOS Browser.

## The four-tier hierarchy

TreeOS replaces the single notion of "URL" with four addressing tiers, each adding one piece of detail:

| Tier | What it carries | Example | Answer to |
|---|---|---|---|
| **Land** | just the domain | `treeos.ai` | "What land?" |
| **Position** | land + path (where, no being) | `treeos.ai/flappybird` | "What's the position?" |
| **Stance** | position + embodiment (where + as what being) | `treeos.ai/flappybird@ruler` | "What's the stance?" |
| **Perspective Address (PA)** | stance -> stance (full bridged form) | `tabor -> treeos.ai/flappybird@ruler` | "What's the perspective address?" |

A **Stance** is one side of a bridge — a being at a position. A **Perspective Address** joins two stances through a **bridge** (`->`), naming who's addressing whom.

The conceptual shift from the web: a URL says *"this resource, fetched."* A PA says *"this being addressing that being, both with full position and embodiment."*

## Full grammar

```
PerspectiveAddress    := Bridge | Stance
Bridge                := Stance "->" Stance
Stance                := Position "@" Embodiment | Position | Embodiment
Position              := Land? Path?
Land                  := Domain | Domain ":" Port
Path                  := "/" Segment ("/" Segment)*  | "/~" UserSlug ("/" Segment)*  | "/"
Embodiment            := "@" Identifier
Domain                := Host (DNS-style; tld optional for local lands)
Segment               := url-safe identifier (node-name OR node-id uuid)
UserSlug              := url-safe identifier (the user's home identity)
Identifier            := [a-z][a-z0-9-]*
```

## The bridge form (two-sided, symmetric)

```
left-stance -> right-stance
```

**Both sides are stances and use the exact same grammar.** A Stance is always `land/path@embodiment`. There is no special "identity carrier" on the left — the human user is just another embodiment, addressed by their username at their land's root.

Canonical form:

```
treeos.ai/@tabor -> treeos.ai/flappybird@ruler
```

Read: "at `treeos.ai` land root, embodied as `tabor`, addressing the `ruler` embodiment at `treeos.ai/flappybird`."

The left stance parses as:
- land = `treeos.ai`
- path = `/` (land root — the user is "at" their land)
- embodiment = `tabor` (the username, which IS the embodiment label for that human being)

The right stance parses as:
- land = `treeos.ai`
- path = `/flappybird`
- embodiment = `ruler`

Same shape on both sides. Same grammar. The asymmetry the user experiences is purely a display shorthand for the common case where the left side is themselves.

### Display shorthand for the human user's left side

In the address bar, the user's own left side is collapsed because the values are implicit:

```
[ tabor ] -> [ treeos.ai/flappybird@ruler ]
```

The left chip shows just `tabor` (the embodiment label). The land is implicit (the land the user is signed into; visible elsewhere in chrome). The path is implicit (always `/` for a human at their land root). The `@` prefix is dropped because the chip-style rendering makes it visually clear that this is a label.

Clicking the chip expands to the full form so the user can see what land they're signed into:

```
[ treeos.ai/@tabor ▾ ] -> [ ... ]
```

### Why both sides matter — being-to-being bridges

Two AI beings can talk. Pass 2 court material expects this:

```
treeos.ai/projectA/some-ruler@ruler -> otherland.com/library/the-oracle@oracle
```

A `ruler` at projectA addressing an `oracle` at otherland's library. The court / federation layer adjudicates or routes based on both sides. **No new grammar needed** — the same `land/path@embodiment` Stance shape works for both human and AI beings. A human just happens to live at the land root (`/`) embodied as themselves (`@<username>`).

For Pass 1, the left stance is almost always the signed-in user's `<land>/@<username>`. Pass 2+ unlocks AI-to-AI by having the same shape carry an AI being's position + embodiment on the left.

## The single-stance form (no bridge)

When the user is viewing artifact content with no interactive intent — read-only inspection — the input is just a Stance, not a Perspective Address:

```
treeos.ai/projectA/chapter-1@historian
```

This is the stance the data is rendered THROUGH, but no being is addressing it. The browser still requires a signed-in being to make the request (the request carries the being's identity in headers), but the rendering treats this as observation, not action. Chat panels and write tools are hidden in this mode.

The user toggles single-stance mode explicitly (a "viewer" pill in the address bar) or it auto-applies when the embodiment is one of the read-only canonical embodiments (`@historian`, `@archivist`).

## Stance breakdown

A Stance has three parts that combine the four tiers:

```
treeos.ai          /flappybird/chapter-1    @ruler
└── land           └── path                 └── embodiment
└──────── position ────────┘
└──────────────────── stance ────────────────────┘
```

### Land

Just the domain. DNS-style for federated lands (`treeos.ai`, `otherland.com`). Local-only lands can use bare identifiers (`localhost`, `my-laptop`, `home`). Port allowed: `treeos.ai:3000`.

Omitted when the browser session is already inside a land (current-land implicit).

### Path

The three zone markers, taken literally:

- `/` IS the land zone (the slash alone — the server's public root)
- `~` (or `~user`) IS the home zone (shorthand; expands to `/~user`)
- `/<node>...` IS a node zone (one or more segments deep)

A node's path can be written in any of FOUR forms, all resolving to the same position:

| Form | Example | Used when |
|---|---|---|
| Full chain, names | `/tagay-book/chapter-1` | normal navigation; human-readable |
| Leaf only, name | `/chapter-1` | quick jump when the name is unique; address-bar collapse |
| Full chain, ids | `/<uuid-a>/<uuid-b>` | stable across renames; canonical for links pasted between sessions |
| Leaf only, id | `/<uuid-b>` | shortest stable form; deep links |

Both representations (names and ids) and both depths (full chain and leaf only) are first-class — the user switches between them in the address bar. Names are friendlier; ids survive renames. The browser can render either at any moment because the Position Descriptor returns the full chain in BOTH forms.

Each segment is either:
- a node-name (kebab-case identifier, e.g. `chapter-1`)
- a node-id (uuid, e.g. `7f3c8a2e-...-...`)

The server resolves whichever form arrives. Mixed segments within one path are allowed (a uuid for the part the user knows stable, a name for the leaf they're naming). The resolver normalizes against the live tree.

Home zone path:
- `/~user` — home root for `user`
- `/~user/<subpath>` — node inside the user's tree

Tree paths can be arbitrarily deep (`/~tabor/flappy-bird/chapter-1/section-introduction`).

### Embodiment

`@<identifier>` — the active being mode at this position. The embodiment determines:
- system instructions for the being
- enabled tools at this position
- permissions surface
- personality and voice
- memory scope
- which extensions surface visibly at this scope

Embodiments are NOT tied to specific people. `@ruler` at one position is a different actor from `@ruler` at another — same KIND of embodiment, different instance. The position scopes the embodiment.

Canonical embodiments (initial set; extensible):
- `@ruler` — leadership/governance tools and permissions
- `@planner` — decomposition planning
- `@contractor` — vocabulary commitment
- `@worker` — artifact production
- `@foreman` — execution judgment
- `@oracle` — knowledge synthesis, prediction, deep memory
- `@dreamer` — creative/imaginative cognition
- `@merchant` — trade/economy/social negotiation
- `@guardian` — defense/moderation/security
- `@builder` — construction/land editing
- `@citizen` — normal participant perspective
- `@historian` — archive/memory/history-oriented (read-only)
- `@archivist` — read-only browsing of artifacts and trace history
- `@swarm` — collective/group-agent cognition

Lands can extend with custom embodiments. The browser doesn't need to know all embodiments in advance — it asks the land what's invocable at this position (in the Position Descriptor) and renders the chat-invoke surface accordingly.

## Shorthands

When context allows, parts can be omitted. Both sides of a bridge expand the same way.

### Right-side shorthands (where you're addressing)

| Shorthand | Expands to | Used when |
|---|---|---|
| `~@dreamer` | `<current-land>/~<current-user>@dreamer` | inside a session, current user's home |
| `~tabor@dreamer` | `<current-land>/~tabor@dreamer` | inside a land, specific user's home |
| `/flappybird@ruler` | `<current-land>/flappybird@ruler` | inside a land |
| `@ruler` | `<current-land><current-path>@ruler` | re-embody current node with different mode |
| `flappybird/chapter-1` | `<current-land>/flappybird/chapter-1@<default-embodiment>` | inside a land; embodiment default applies |

### Left-side shorthands (who you are)

| Shorthand | Expands to | Used when |
|---|---|---|
| `tabor` | `<current-land>/@tabor` | the signed-in human user; bare username at land root |
| `@tabor` | `<current-land>/@tabor` | explicit-@ form of the same |
| `treeos.ai/@tabor` | (already canonical) | another land's user, e.g. cross-land bridges |
| `otherland.com/projectX/some-ruler@ruler` | (already canonical) | AI being on another land acting through @ruler |

The left-side bare-identifier shorthand (no `@`, no `/`, no `.`) is treated as a human-user embodiment. This is the most common case — the user typing or seeing their own username.

The browser keeps a "current context" (land + path + user) and uses it to expand shorthands at parse time on both sides.

## Default embodiment

When the right side omits `@embodiment`, the default is the embodiment most natural for that zone type:

- Land zone (`server/`) — `@citizen` (browsing the land)
- Home zone (`server/~user`) — `@dreamer` or `@builder` (personal creative space; user picks via setting)
- Node zone (`server/<path>`) — depends on the node's role. Ruler scopes default to `@ruler`. Worker leaves default to `@worker`. Read-only artifact nodes default to `@archivist`.

The Position Descriptor surfaces which embodiments are invocable at the position (in the `beings:` field); the browser uses that list to populate the address-bar autocomplete.

## Address-bar UX

The address bar shows the **full bridge** but visually separates left and right:

```
[ tabor ] -> [ treeos.ai/flappybird@ruler          ]
```

Left chip = current identity (click to switch). Right text = editable position+embodiment. The user types into the right side; the left is locked unless they explicitly switch beings.

Autocomplete:
- typing `~` suggests user homes the current session knows about
- typing `/` suggests public trees on the current land
- typing `@` suggests embodiments invocable at the current right-side path
- typing a domain suggests known lands

## Identity vs embodiment

These are different concepts even though, for a human user, they collapse:

- **Identity** is WHO YOU ARE. The persistent record of an actor across all their sessions. Tied to credentials, history, ownership. A single identity persists for years.
- **Embodiment** is HOW YOU'RE OPERATING AT A POSITION RIGHT NOW. The lens, mode, role. Switches as you navigate.

For a human user, the username IS BOTH the identity record AND the canonical embodiment label at their land root. So `treeos.ai/@tabor` simultaneously names the human user's identity (tabor) AND the embodiment they're operating through (also tabor, in human-being mode). The terms collapse because there's only one human-being embodiment per identity.

For AI beings, they pull apart: an AI Ruler at `projectA` has a position (`treeos.ai/projectA`) and an embodiment (`@ruler`). The identity-equivalent (which AI being, with which configuration) is implicit in the position + embodiment combination.

The grammar doesn't need to model identity-vs-embodiment separately. Both sides of a bridge use the same `land/path@embodiment` shape, and the embodiment field carries:
- A username for human-being perspectives (`@tabor`)
- A role label for AI-being perspectives (`@ruler`, `@oracle`, etc.)
- A custom embodiment a land has defined

## Examples

Each row shows the **display shorthand** (what the user sees) and the **canonical form** (the fully-expanded address). The shorthand always re-expands to the canonical via the parser given a `currentLand + currentUser` context.

| Shorthand | Canonical | Meaning |
|---|---|---|
| `tabor -> /flappybird@ruler` | `treeos.ai/@tabor -> treeos.ai/flappybird@ruler` | tabor addressing the ruler at /flappybird |
| `tabor -> ~@dreamer` | `treeos.ai/@tabor -> treeos.ai/~tabor@dreamer` | tabor visiting his own home in dreamer mode |
| `tabor -> ~tabor/notes/idea-1@archivist` | `treeos.ai/@tabor -> treeos.ai/~tabor/notes/idea-1@archivist` | tabor reading his own old idea note |
| `tabor -> /library/cookbook@oracle` | `treeos.ai/@tabor -> treeos.ai/library/cookbook@oracle` | tabor querying a public oracle at a recipe library |
| `tabor -> otherland.com/chess-club@citizen` | `treeos.ai/@tabor -> otherland.com/chess-club@citizen` | tabor visiting another land's chess club as a participant |
| `treeos.ai/flappybird/chapter-1@archivist` | (already canonical, no left side) | single-side: reading chapter-1 without a sender — public observation |
| `@ruler` | `treeos.ai/@tabor -> treeos.ai/<current-path>@ruler` | re-embody the current node as ruler (shortest possible PA — left auto-fills from session identity) |
| `treeos.ai/projectA/some-ruler@ruler -> otherland.com/library/the-oracle@oracle` | (already canonical) | Pass 2+: AI being-to-being bridge |

## Parser semantics

The `lib/perspective-address.js` parser:
- accepts any of the above forms
- returns a normalized object: `{ left?: Stance, right: Stance }` where `Stance = { land?, path?, embodiment? }`
- expands shorthands when given a context: `parse(input, { currentLand, currentPath, currentUser })`
- round-trips: `format(parsed) === normalized canonical form`
- rejects malformed input with structured errors so the address bar can highlight the bad segment

See [`../lib/perspective-address.js`](../lib/perspective-address.js) for the implementation.

## What this is NOT

- It's not a URL with extra syntax. URLs locate resources; PAs locate stances (position + embodiment) and connect two of them via a bridge. A position has many possible stances depending on the embodiment chosen.
- It's not an actor model. Stances don't name individual workers or threads. They name positions a being CAN operate at; the same `@ruler` is invoked freshly each session.
- It's not a permission model. Embodiments suggest what tools/permissions apply, but the actual authorization is on the land server (each request carries identity headers; the land enforces). PAs are addressing, not authorization.
