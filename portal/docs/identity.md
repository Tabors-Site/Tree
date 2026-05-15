# Identity-first session model

The TreeOS Portal cannot be opened anonymously. Every session begins **signed in as a being at a land**. Identity is the root of every action; without it, no Portal Address can form.

This document defines what a being is, how identity flows, and what's deferred to future passes.

## Why identity-first

Three architectural commitments force identity to the root:

1. **Every action has an actor.** TreeOS's accountability chain (contributions, flags, plans, contracts, executions) requires knowing who initiated each event. The portal making requests on a user's behalf carries identity through every call. There is no "anonymous browse" because there are no anonymous actions.

2. **LLM access is resolved per-position.** Lands CAN ship with LLM connections set up at the land level. Users CAN bring their own LLM. Or both — the existing TreeOS resolution chain walks tree → user → land. When a human invokes an AI being on the right, the human's credentials are in scope and feed the chain. When an AI being sits on the LEFT side of a bridge (AI being addressing another being), the human's credentials don't propagate through it — that left-side AI needs an LLM configured at its tree-scope OR provided by the receiving land. Identity is still required because authorization checks need to know who's invoking what; provisioning has multiple sources.

3. **Authorization is per-position, per-identity.** Lands check who's invoking each being at each position. A `@ruler` at `/some-tree` may only be invocable by the tree's owner or its members. Without identity, the land has no way to decide who's allowed.

The web's anonymous-by-default model breaks all three. The TreeOS Portal inverts: signed-in-by-default, anonymous-never.

## What a being is

A **being** is an actor that can sit on either side of a Portal Address — i.e. it occupies a Stance (`land/path@embodiment`). The `@<label>` portion of the Stance names the being at that position. The label resolves to one of two kinds:

### Human being

`@<username>` — the label is a registered user on the land. The most common case: the signed-in human at their land root.

```
treeos.ai/@tabor                       # tabor (human) at the land root
treeos.ai/flappybird@tabor             # tabor (human) acting at the flappybird node
```

The same human can be at any position. The land root is the typical home; deeper paths give location context for where the request is coming from. Backed by the existing TreeOS user record (username, password/JWT, llmConfig, homePath = `/~<username>`). Pass 1's only stored-credential identity.

Display shorthand: bare `tabor` on the left side of a bridge means `<current-land>/@tabor` (the human at their land root). The chip in the address bar's left side.

### AI being at a node

`@<embodiment>` — the label is an embodiment kind (Ruler, Planner, Oracle, Dreamer, etc.). The being lives at the position; its "home" IS the node it operates from. The embodiment kind names the cognition active there — system instructions, enabled tools, permissions surface, voice.

```
treeos.ai/flappybird@ruler             # the Ruler-AI-being at the flappybird node
treeos.ai/library/cookbook@oracle      # the Oracle-AI-being at a recipe library
```

AI beings don't have their own stored credentials in Pass 1. They run under the inviting human being's auth — when `tabor :: /flappybird@ruler` opens a chat, the Ruler turn calls the LLM via the resolution chain (tree-scope → user → land). If `tabor` has a user LLM configured, the call uses it; otherwise the tree's or land's LLM connection picks it up. Pass 5+ can add federated AI being identities with their own signatures.

### How the land tells human from AI

The land looks at the `@<label>` and the position:
- Label matches a registered username on this land → human being.
- Label matches a known embodiment kind invocable at this position → AI being.
- Both could in principle match — the label-namespace is shared — but in practice usernames and embodiment kinds occupy disjoint namespaces (usernames are user-picked; embodiment kinds come from the extension manifest).

The Position Descriptor's `beings[]` field tells the portal which kind each invocable label resolves to.

### A bridge connects two beings

The `::` separator always means "this being addressing that being." Either side can be human or AI:

```
tabor :: /flappybird@ruler                                   # human → AI being
tabor :: otherland.com/library@oracle                        # human → AI being on another land
/projectA/some-ruler@ruler :: /library@oracle                # AI being → AI being (substrate-internal)
treeos.ai/flappybird@tabor :: /flappybird/chapter-1@worker   # human at a node → AI being deeper in the tree
```

The grammar is uniform: both sides are `land/path@embodiment`. The position and the label-kind together determine whether a side is human or AI. The only stored-identity layer at Pass 1 is the human; AI beings exist *at* nodes and are addressed *by* position + embodiment kind.

## What's deferred (not Pass 1)

- **AI beings with their own credentials.** A Ruler that owns its own auth, its own LLM keys, its own cross-session persistence — a true second-class actor. Requires Pass 2 governance (courts) and Pass 5 federation.
- **A third identity layer** between the human and the in-PA embodiment. Reserved namespace, not yet designed.

Pass 1 keeps it simple: humans are stored identities; AI beings are positions-plus-embodiments invoked under a human's auth.

## The sign-in surface

The portal's first screen — opened before any address is loaded — is the sign-in surface. Options:

1. **Sign in to an existing being on a land.** Pick a land from the roster (or type a new land URL), enter username + password (or paste a key). The land validates against its existing user record.
2. **Register a new being on a known land.** If registration is open, the portal collects username + auth method + LLM config (if bring-your-own-LLM).
3. **Federate an existing being** (Pass 5+). Carry credentials from another land via Canopy. Placeholder.
4. **Local-only mode.** Sign in to a being on `localhost` or a local-only land. For development or offline use.

After sign-in, the portal has a **session identity**: which human being on which land. This is the left side of every PA typed in the address bar until the user explicitly switches.

## The identity panel

Always visible in the portal chrome. Shows:

- the current session identity (`tabor @ treeos.ai`)
- a roster dropdown of other beings the user is signed in on (across lands)
- a "switch" action that swaps the active identity for new tabs
- a "sign in elsewhere" action that opens the sign-in surface for another land

Identity switching is a deliberate gesture, not silent. Tabs spawned under identity A stay tied to A; switching to B opens new tabs under B. One tab = one identity.

## How identity flows through requests

Every HTTP/WS request the portal makes carries identity headers:

```
X-TreeOS-Being: <username>
X-TreeOS-Auth:  Bearer <jwt>
X-TreeOS-Land:  <land hostname>
```

These map onto TreeOS's existing JWT auth — the portal just makes them explicit and persistent across tabs. Lands validate via existing middleware and either:
- accept the request (authorized) and respond
- reject with `FORBIDDEN` + suggested alternative identities
- ask for re-authentication if the token is stale

The portal surfaces `FORBIDDEN` either as an inline "switch to a different being you have" hint OR a re-auth prompt.

When an AI being is invoked on the right side, the same human-being headers attach — the AI runs under that human's auth for Pass 1.

## Cross-land identity

When a user navigates to a different land than the one they're signed in on:

1. **The user has a being on that land too.** Portal switches identity (with consent) and continues.
2. **The user doesn't have one but the land allows guests.** Portal opens with a guest being that lets the user browse the land zone (no write actions).
3. **Federated being.** The user's home-land being is presented to the other land via Canopy (Pass 5). The other land validates the federated signature.

Pass 1: option 1 only (manual roster across lands). Options 2 and 3 are Pass 4+ work.

## The roster

The portal keeps a roster of human beings the user has signed into. Each entry:

```
(land, username, displayName, lastUsed, authMaterial)
```

`authMaterial` is the refresh-token-or-equivalent the portal uses to re-sign-in transparently. Stored encrypted at rest where the OS provides secure storage (macOS Keychain, Windows Credential Manager, Linux Secret Service); falls back to a passphrase-protected store otherwise.

The portal does NOT store passwords in cleartext. Refresh tokens / signed keys only.

## Being creation flow

When the user creates a new being on a land:

1. Portal asks: which land?
2. Land returns its registration policy (`open` / `invite-only` / `closed`).
3. If open: portal collects username + password. The land's discovery declares whether LLM is land-provided, user-required, or optional-augment.
4. Portal sends create-user request to the land. Land validates uniqueness, returns auth material.
5. If the land requires (or allows) bring-your-own-LLM, portal walks the user through configuring (proxy URL, API key, model preferences). Otherwise the land's LLM is used by default.
6. Portal stores the being in the roster. Auto-signs-in.

When the user wants to use their own LLM in addition to (or instead of) the land's, the existing TreeOS `setup` flow can be reused. The resolution chain (tree → user → land) picks whichever is available, so users with a personal LLM override the land's default; users without fall back to whatever the land provides.

## Sign-out

Signing out of a being:
- closes all tabs operating as that being
- clears in-memory auth tokens for that being
- preserves the roster entry (so re-sign-in is one click)

"Remove from roster" is a separate destructive gesture that requires confirmation. It clears stored credentials and removes the being from the dropdown.

## What this means for the address bar

The left side of the address bar is **always** the current session being — for Pass 1, the signed-in human. It's visually a chip (not editable text). Clicking the chip opens the roster dropdown for switching.

When a tab has no being attached (which shouldn't happen because the portal refuses to open without one), the address bar refuses input and shows the sign-in surface inline.

The right side of the address bar is freely editable — that's where the user types positions to address. Pressing Enter sends a request to the right-side land+path with the left-side being's auth headers attached.

## Failure modes the portal handles

- **Land unreachable.** Show error, allow the user to retry or navigate elsewhere. Identity stays signed in (only this tab is affected).
- **Being revoked.** Land rejects auth with REVOKED. Portal removes the being from active state and prompts re-sign-in.
- **Token expired.** Portal refreshes via stored refresh token. Transparent to the user.
- **No LLM available in the resolution chain.** Being can browse positions but can't invoke AI beings — happens only if neither user, tree, nor land has an LLM configured. Portal shows an inline hint at chat-panel time pointing the user to either configure a personal LLM or use a land that provides one.
- **Multiple beings on same land.** Allowed. Roster lists both; user picks per tab.

## Relationship to existing TreeOS auth

The current Land server uses JWT bearer auth + WebSocket auth tokens against the User model. The TreeOS Portal carries these through the identity layer unchanged:

- Each roster entry holds the bearer token (in secure storage).
- Each request adds `Authorization: Bearer <token>` plus the explicit identity headers above.
- WS connections present the token at handshake.
- The portal doesn't bypass or extend any of the existing auth — it makes the identity layer explicit, multi-being-aware, and visible in the UI.

No backwards-incompatible changes to the Land's auth model. The portal is a more explicit client over the same surface.
