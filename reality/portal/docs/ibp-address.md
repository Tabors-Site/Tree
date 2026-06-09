# IBP Address: grammar and semantics

An IBP Address (IBPA) names **a being addressing another being**. IBPAs are the address format that IBP, the Inter-Being Protocol, carries. IBPAs replace URLs in the TreeOS Portal the same way URLs replaced bare hostnames in the web.

## The vocabulary

Two categories of things are addressable in IBP: a **Position** (a place) and a **Stance** (a being at that place). The other names that appear in the protocol (Place, IBP Address, Being) are structural vocabulary, not addressable on their own.

### Addressable. Targets of verb calls.

| Concept | Form | Example | Answer to |
|---|---|---|---|
| **Position** | `<place>/<path>` | `treeos.ai/` (root), `treeos.ai/~tabor` (home), `treeos.ai/flappybird/chapter-1` (tree space) | "Where in the world?" |
| **Stance** | `<position>@<being>` | `treeos.ai/flappybird@ruler`, `treeos.ai/@cherub` | "Which being at the place?" |

### Structural vocabulary. Not addressable on its own.

- **Place** does double duty, distinguished by the trailing slash. `treeos.ai` (no slash) is the bare domain identifier, the name of the sovereign server, used by BE when dispatching to the place's cherub. `treeos.ai/` (with slash) is the Place Position of that place, addressable like any Position. The trailing slash is the load-bearing distinction. When the docs say "place" they usually mean one or the other depending on context.
- **IBP Address** is the bridge form, `<stance> :: <stance>`. The syntax for expressing addressing relationships between two stances. Not a thing that gets addressed; the format used to address things. Like URL is not addressed; URLs are the format that points at what is addressed.
- **Being** is a cognitive shape (`@ruler`, `@archivist`, a username). Not addressable on its own. Combines with a Position to form a Stance. The `@qualifier` in a Stance address names the being but never targets it.

A **Stance** is one side of a bridge: a being at a position. An **IBP Address** joins two stances through a **bridge** (`::`), naming who's addressing whom.

The conceptual shift from the web: a URL says *"this resource, fetched."* An IBPA says *"this being addressing that being, both with full position and being."*

### Addressing grammar (forms in practice)

| Form | Meaning | Verbs that accept it |
|---|---|---|
| `treeos.ai` | domain only, Place identifier | BE |
| `treeos.ai/` | domain plus trailing slash, Place Position | SEE, DO |
| `treeos.ai/flappybird` | domain plus path, deeper Position | SEE, DO |
| `treeos.ai/@cherub` | Place Position plus being, Stance at the Place Position | SUMMON, BE |
| `treeos.ai/flappybird@ruler` | deeper Position plus being, Stance at space | SEE, SUMMON, BE |

## Full grammar

```
IbpAddress         := Bridge | Stance
Bridge                := Stance "::" Stance
Stance                := Position "@" Being | Position | Being
Position              := Place "/" Path?
Place                  := Domain | Domain ":" Port
Path                  := Segment ("/" Segment)*  | "~" UserSlug ("/" Segment)*  | ""
Being            := "@" Identifier
Domain                := Host (DNS-style; tld optional for local places)
Segment               := url-safe identifier (space-name OR space-id uuid)
UserSlug              := url-safe identifier (the user's home identity)
Identifier            := [a-z][a-z0-9-]*
```

A Position requires the Place followed by `/`. The Path after the slash may be empty (the Place Position), start with `~` (a home), or be one or more segments (a tree space).

## The bridge form (two-sided, symmetric)

```
left-stance :: right-stance
```

The left stance is the **actor** (who is addressing); the right stance is the **receiver** (who is addressed). Action runs left → right.

**Both sides are stances and use the exact same grammar.** A Stance is always `place/path@being`. There is no special "identity carrier" on the left — the human user is just another being, addressed by their username at their place's root.

Canonical form:

```
treeos.ai/@tabor :: treeos.ai/flappybird@ruler
```

Read: "at the Place Position `treeos.ai/`, embodied as `tabor`, addressing the `ruler` being at `treeos.ai/flappybird`."

The left stance parses as:
- place = `treeos.ai`
- path = `/` (Place Position — the user is "at" their place)
- being = `tabor` (the username, which IS the being label for that human being)

The right stance parses as:
- place = `treeos.ai`
- path = `/flappybird`
- being = `ruler`

Same shape on both sides. Same grammar. The asymmetry the user experiences is purely a display shorthand for the common case where the left side is themselves.

### Display shorthand for the human user's left side

In the address bar, the user's own left side is collapsed because the values are implicit:

```
[ tabor ] :: [ treeos.ai/flappybird@ruler ]
```

The left chip shows just `tabor` (the being label). The place is implicit (the place the user is signed into; visible elsewhere in chrome). The path is implicit (always `/` for a human at their Place Position). The `@` prefix is dropped because the chip-style rendering makes it visually clear that this is a label.

Clicking the chip expands to the full form so the user can see what place they're signed into:

```
[ treeos.ai/@tabor ▾ ] :: [ ... ]
```

### Why both sides matter — being-to-being bridges

Two AI beings can talk. Pass 2 court material expects this:

```
treeos.ai/projectA/some-ruler@ruler :: otherland.com/library/the-oracle@oracle
```

A `ruler` at projectA addressing an `oracle` at otherland's library. The court / federation layer adjudicates or routes based on both sides. **No new grammar needed** — the same `place/path@being` Stance shape works for both human and AI beings. A human just happens to live at the Place Position (`/`) embodied as themselves (`@<username>`).

For Pass 1, the left stance is almost always the signed-in user's `<place>/@<username>`. Pass 2+ unlocks AI-to-AI by having the same shape carry an AI being's position + being on the left.

## The single-stance form (no bridge)

When the user is viewing matter content with no interactive intent — read-only inspection — the input is just a Stance, not an IBP Address:

```
treeos.ai/projectA/chapter-1@historian
```

This is the stance the data is rendered THROUGH, but no being is addressing it. The portal still requires a signed-in being to make the request (the request carries the being's identity in headers), but the rendering treats this as observation, not action. Chat panels and write tools are hidden in this mode.

The user toggles single-stance mode explicitly (a "viewer" pill in the address bar) or it auto-applies when the being is one of the read-only canonical beings (`@historian`, `@archivist`).

## Stance breakdown

A Stance is a Position with an Being qualifier:

```
treeos.ai          /flappybird/chapter-1    @ruler
place             + path                   + being
└──────── position ────────┘
└──────────────────── stance ────────────────────┘
```

The `@` is the load-bearing piece. It names the **being** at the position. Everything to the left of `@` is the position (where); the `@<label>` is the being (who) at that place. When we say "stance" we mean the whole chain (place + path + being), but the working focus is usually the being at the end.

### What each kind of being brings to a Stance

The being on either side of a bridge brings its own capability surface:

- **Human being** (`@<username>` — usually at the Place Position `/`). The human brings *everything they are* — their full life experience, all the modes and tools available to them as a person, plus any account-level settings (LLM config, identity roster, permissions on this place). The default left-side stance for a signed-in human is `<place>/@<username>` — the human inhabits the Place at its root. A human CAN appear at deeper positions (`treeos.ai/flappybird@tabor`); the path then provides context about *where on the place they're operating from*, beyond just "user." For Pass 1 the focus is the default `/` case.

- **AI being** (`@<being>` — at any space). The AI brings whatever it's programmed with at that position: enabled tools, the mode/orchestration script, the rulership scope, system instructions, memory window, extension surfaces invocable at this position. None of that is intrinsic to the being label; it's whatever the place has wired up under that label at that scope. `@ruler` at one space can have a completely different toolset from `@ruler` at another — same kind, different instance, different configuration.

So when you read a stance, the `@<label>` is the being. The place tells human from AI by whether the label matches a registered username or a configured being kind. What that being can *do* at the position is determined by:
- Human → the human's account + the place's rules for users at this position.
- AI → the position's being configuration (tools, modes, orchestration, rulership, etc.).

### Place

Just the domain. DNS-style for federated places (`treeos.ai`, `otherland.com`). Local-only places can use bare identifiers (`localhost`, `my-laptop`, `home`). Port allowed: `treeos.ai:3000`.

Omitted when the portal session is already inside a place (current-place implicit).

### Path

The three zone markers, taken literally:

- `/` IS the place zone (the slash alone — the server's public root)
- `~` (or `~user`) IS the home zone (shorthand; expands to `/~user`)
- `/<space>...` IS a tree zone (one or more segments deep)

A space's path can be written in any of FOUR forms, all resolving to the same position:

| Form | Example | Used when |
|---|---|---|
| Full chain, names | `/tagay-book/chapter-1` | normal navigation; human-readable |
| Leaf only, name | `/chapter-1` | quick jump when the name is unique; address-bar collapse |
| Full chain, ids | `/<uuid-a>/<uuid-b>` | stable across renames; canonical for links pasted between sessions |
| Leaf only, id | `/<uuid-b>` | shortest stable form; deep links |

Both representations (names and ids) and both depths (full chain and leaf only) are first-class — the user switches between them in the address bar. Names are friendlier; ids survive renames. The portal can render either at any moment because the Position Description returns the full chain in BOTH forms.

Each segment is either:
- a space-name (kebab-case identifier, e.g. `chapter-1`)
- a space-id (uuid, e.g. `7f3c8a2e-...-...`)

The server resolves whichever form arrives. Mixed segments within one path are allowed (a uuid for the part the user knows stable, a name for the leaf they're naming). The resolver normalizes against the live tree.

Home zone path:
- `/~user` — home root for `user`
- `/~user/<subpath>` — space inside the user's tree

Tree paths can be arbitrarily deep (`/~tabor/flappy-bird/chapter-1/section-introduction`).

### Being

`@<identifier>` — the active being mode at this position. The being determines:
- system instructions for the being
- enabled tools at this position
- permissions surface
- personality and voice
- memory scope
- which extensions surface visibly at this scope

Beings are NOT tied to specific people. `@ruler` at one position is a different actor from `@ruler` at another — same KIND of being, different instance. The position scopes the being.

Canonical beings (initial set; extensible):
- `@ruler` — leadership/governance tools and permissions
- `@planner` — decomposition planning
- `@contractor` — vocabulary commitment
- `@worker` — matter production
- `@foreman` — execution judgment
- `@oracle` — knowledge synthesis, prediction, deep memory
- `@dreamer` — creative/imaginative cognition
- `@merchant` — trade/economy/social negotiation
- `@guardian` — defense/moderation/security
- `@builder` — construction/place editing
- `@citizen` — normal participant stance
- `@historian` — archive/memory/history-oriented (read-only)
- `@archivist` — read-only browsing of matters and trace history
- `@swarm` — collective/group-agent cognition

Places can extend with custom beings. The portal doesn't need to know all beings in advance — it asks the place what's invocable at this position (in the Position Description) and renders the chat-invoke surface accordingly.



## Shorthands

When context allows, parts can be omitted. Both sides of a bridge expand the same way.

### Right-side shorthands (where you're addressing)

| Shorthand | Expands to | Used when |
|---|---|---|
| `~@dreamer` | `<current-place>/~<current-user>@dreamer` | inside a session, current user's home |
| `~tabor@dreamer` | `<current-place>/~tabor@dreamer` | inside a place, specific user's home |
| `/flappybird@ruler` | `<current-place>/flappybird@ruler` | inside a place |
| `@ruler` | `<current-place><current-path>@ruler` | re-embody current space with different mode |
| `flappybird/chapter-1` | `<current-place>/flappybird/chapter-1@<default-being>` | inside a place; being default applies |

### Left-side shorthands (who you are)

| Shorthand | Expands to | Used when |
|---|---|---|
| `tabor` | `<current-place>/@tabor` | the signed-in human user; bare username at the Place Position |
| `@tabor` | `<current-place>/@tabor` | explicit-@ form of the same |
| `treeos.ai/@tabor` | (already canonical) | another place's user, e.g. cross-place bridges |
| `otherland.com/projectX/some-ruler@ruler` | (already canonical) | AI being on another place acting through @ruler |

The left-side bare-identifier shorthand (no `@`, no `/`, no `.`) is treated as a human-user being. This is the most common case — the user typing or seeing their own username.

The portal keeps a "current context" (place + path + user) and uses it to expand shorthands at parse time on both sides.

## Default being

When the right side omits `@being`, the default is the being most natural for that zone type:

- Place zone (`server/`) — `@citizen` (browsing the place)
- Home zone (`server/~user`) — `@dreamer` or `@builder` (personal creative space; user picks via setting)
- Tree zone (`server/<path>`) — depends on the space's role. Ruler scopes default to `@ruler`. Worker leaves default to `@worker`. Read-only matter spaces default to `@archivist`.

The Position Description surfaces which beings are invocable at the position (in the `beings:` field); the portal uses that list to populate the address-bar autocomplete.

## Address-bar UX

The address bar shows the **full bridge** but visually separates left and right:

```
[ tabor ] :: [ treeos.ai/flappybird@ruler          ]
```

Left chip = current identity (click to switch). Right text = editable position+being. The user types into the right side; the left is locked unless they explicitly switch beings.

Autocomplete:
- typing `~` suggests user homes the current session knows about
- typing `/` suggests public trees on the current place
- typing `@` suggests beings invocable at the current right-side path
- typing a domain suggests known places

## Identity vs being

These are different concepts even though, for a human user, they collapse:

- **Identity** is WHO YOU ARE. The persistent record of an actor across all their sessions. Tied to credentials, history, ownership. A single identity persists for years.
- **Being** is HOW YOU'RE OPERATING AT A POSITION RIGHT NOW. The lens, mode, role. Switches as you navigate.

For a human user, the username IS BOTH the identity record AND the canonical being label at their Place Position. So `treeos.ai/@tabor` simultaneously names the human user's identity (tabor) AND the being they're operating through (also tabor, in human-being mode). The terms collapse because there's only one human-being being per identity.

For AI beings, they pull apart: an AI Ruler at `projectA` has a position (`treeos.ai/projectA`) and an being (`@ruler`). The identity-equivalent (which AI being, with which configuration) is implicit in the position + being combination.

The grammar doesn't need to model identity-vs-being separately. Both sides of a bridge use the same `place/path@being` shape, and the being field carries:
- A username for human-being stances (`@tabor`)
- A role label for AI-being stances (`@ruler`, `@oracle`, etc.)
- A custom being a place has defined

## Examples

Each row shows the **display shorthand** (what the user sees) and the **canonical form** (the fully-expanded address). The shorthand always re-expands to the canonical via the parser given a `currentPlace + currentUser` context.

| Shorthand | Canonical | Meaning |
|---|---|---|
| `tabor :: /flappybird@ruler` | `treeos.ai/@tabor :: treeos.ai/flappybird@ruler` | tabor addressing the ruler at /flappybird |
| `tabor :: ~@dreamer` | `treeos.ai/@tabor :: treeos.ai/~tabor@dreamer` | tabor visiting his own home in dreamer mode |
| `tabor :: ~tabor/notes/idea-1@archivist` | `treeos.ai/@tabor :: treeos.ai/~tabor/notes/idea-1@archivist` | tabor reading his own old idea note |
| `tabor :: /library/cookbook@oracle` | `treeos.ai/@tabor :: treeos.ai/library/cookbook@oracle` | tabor querying a public oracle at a recipe library |
| `tabor :: otherland.com/chess-club@citizen` | `treeos.ai/@tabor :: otherland.com/chess-club@citizen` | tabor visiting another place's chess club as a participant |
| `treeos.ai/flappybird/chapter-1@archivist` | (already canonical, no left side) | single-side: reading chapter-1 without a sender — public observation |
| `@ruler` | `treeos.ai/@tabor :: treeos.ai/<current-path>@ruler` | re-embody the current space as ruler (shortest possible IBPA — left auto-fills from session identity) |
| `treeos.ai/projectA/some-ruler@ruler :: otherland.com/library/the-oracle@oracle` | (already canonical) | Pass 2+: AI being-to-being bridge |

## Parser semantics

The `lib/ibp-address.js` parser:
- accepts any of the above forms
- returns a normalized object: `{ left?: Stance, right: Stance }` where `Stance = { place?, path?, being? }`
- expands shorthands when given a context: `parse(input, { currentPlace, currentPath, currentUser })`
- round-trips: `format(parsed) === normalized canonical form`
- rejects malformed input with structured errors so the address bar can highlight the bad segment



See [`../../place/seed/addressing/address.js`](../../place/seed/addressing/address.js) for the implementation. The substrate owns the grammar; Portal consumes it via the `@ibp-address` Vite alias.

## What this is NOT

- It's not a URL with extra syntax. URLs locate resources; IBPAs locate stances (position + being) and connect two of them via a bridge. A position has many possible stances depending on the being chosen.
- It's not an actor model. Stances don't name individual workers or threads. They name positions a being CAN operate at; the same `@ruler` is invoked freshly each session.
- It's not a permission model. Beings suggest what tools/permissions apply, but the actual authorization is on the place server (each request carries identity headers; the place enforces). IBPAs are addressing, not authorization.
