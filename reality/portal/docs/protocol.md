# IBP . The Inter-Being Protocol

IBP is the protocol that places speak to portals and that portals speak to places. Four verbs over WebSocket. One message envelope for being engagement. One inbox per being, part of the record.

IBP is a sibling to HTTP, not a layer inside it. HTTP gave the world a web of documents addressed by URLs, opened in a browser. IBP gives it a web of beings addressed by IBP Addresses, opened in the Portal. Both ride the same internet substrate. Both coexist.

This document is the protocol spec. The address format IBP carries is the **IBP Address** ([ibp-address.md](ibp-address.md)). The client that speaks IBP is the **Portal** (see the parent [README](../README.md)). The response shape SEE returns is the **Position Description** ([position-description.md](position-description.md)).

Before reading further, read [being-summoned.md](being-summoned.md). IBP is shaped around that framing; nothing here will make sense without it.

## Four verbs

Every interaction is one of four verbs.

| Verb | What it does |
|---|---|
| **SEE** | Observe a position. One-shot, or live via a flag. |
| **DO** | Mutate the world at a position. |
| **SUMMON** | Deliver a message to a being's inbox. |
| **BE** | Manage be-er identity (register, claim, release, switch). |

Three verbs operate from a be-er upon the world. One verb operates upon the be-er itself. The categorical line is sharp and deliberate: SEE/DO/SUMMON require an established be-er; BE is how a be-er is established or changed.

There is no fifth verb. Anything that does not fit one of the four does not belong in IBP; it belongs in an being, an extension, or a layer above IBP.

## Data and beings

IBP distinguishes data from beings. **Data is mutable. Beings are not.** This is an architectural commitment, not a convention.

Data is fully mutable through DO. The protocol provides direct mechanisms for changing what data holds: space structure, notes, matters, namespaced metadata. DO targets positions because positions are where data persists.

Beings are not mutable. They are summoned executors: when addressed, they wake, read the world (their position's data, plus the extension source code that defines them), act according to their own interpretation, and end. Between summonings they do not exist as anything you can write to. There is nothing at a stance to mutate.

What you CAN do with beings:

- **Shape the environment a being encounters.** DO on position data, including the being's configuration namespace at the position, or the extension source code that defines the being. When the being is next summoned, it reads the changed environment and acts accordingly.
- **Send messages a being will receive when summoned.** SUMMON delivers a message to a stance's inbox; the next summoning sees it.
- **Observe a being's perspective.** SEE on a stance returns position data as that being would interpret it.
- **Read everything a being produced.** Reasoning traces, prompts, tool calls, intermediate steps, outputs. All of it is written to position data and is observable through SEE. The being's record is fully readable after the fact.

What you CANNOT do with beings:

- **Force a being to take a specific action.** The being's response when summoned is its own.
- **Reach inside a live invocation.** While a summoning is running you cannot peek inside the LLM, alter its prompt mid-flight, or steer what it does next. The invocation runs to completion on its own. Records of everything it did become readable after; the act itself is not addressable.
- **Mutate a being directly.** DO accepts position only, never stance, because beings are not stored. There is no storage at a stance to write to.

This is what makes beings categorically different from data in TreeOS. Anyone building against IBP should understand: they are not building a system where agents can be controlled. They are building a system where agents can be **influenced** through environment and **addressed** through messages. The agency stays with the being.

## Transport

WebSocket only. Socket.IO ops named `ibp:see`, `ibp:do`, `ibp:summon`, `ibp:be`. The connection is the IBP session; closing the connection ends all live subscriptions.

A single HTTP endpoint exists for bootstrap: `GET /.well-known/treeos-portal` returns the WebSocket URL and IBP protocol version. The client opens a socket and never speaks HTTP for IBP verbs again. Everything else, including capability discovery, flows through `ibp:see` on the `.discovery` position of a place.

The legacy `place/routes/api/*` HTTP routes continue running during migration, but they are not part of IBP. Nothing new wires through them.

## What can be addressed

Two categories of things are addressable in IBP. Position and Stance. Everything else in the vocabulary is structural — names for the protocol, the address format, the building blocks — not addressable on its own.

### Addressable. Targets of verb calls.

| Concept | Form | What it names |
|---|---|---|
| **Position** | `<place>/<path>` | A place in the world. The place domain plus `/` plus the path. Examples: `treeos.ai/` (Place Position), `treeos.ai/~tabor` (home), `treeos.ai/flappybird/chapter-1` (a tree space). Accepted by SEE and DO. |
| **Stance** | `<position>@<being>` | A being at a position. `treeos.ai/flappybird@ruler`, `treeos.ai/@auth`. Accepted by SEE, required by SUMMON and BE. |

### Structural vocabulary. Not addressable on its own.

- **Place** does double duty, distinguished by the trailing slash. `treeos.ai` (no slash) is the bare domain identifier, the name of the sovereign server, used by BE when dispatching to the place's auth-being. `treeos.ai/` (with slash) is the Place Position of that place, addressable like any Position. The trailing slash is the load-bearing distinction.
- **IBP Address** is the bridge form, `<stance> :: <stance>`. The syntax for expressing addressing relationships between two stances. Not a thing that gets addressed; the format used to address things. Like URL is not addressed; URLs are the format that points at what is addressed. An IBP Address is rarely inside a verb envelope. It describes the *relationship* between requester and target. The envelope carries the target side only; the requester side is implicit, established by BE and carried in the identity token. IBP Addresses appear in UI surfaces (tab titles, history) and in being-to-being framing.
- **Being** is a cognitive shape (`@ruler`, `@archivist`, a username like `@tabor`). Not addressable on its own. Combines with a Position to form a Stance. The `@qualifier` in a Stance address names the being but never targets it.

### Addressing grammar

| Form | Meaning | Verbs that accept it |
|---|---|---|
| `treeos.ai` | domain only, Place identifier | BE |
| `treeos.ai/` | domain plus trailing slash, Place Position | SEE, DO |
| `treeos.ai/flappybird` | domain plus path, deeper Position | SEE, DO |
| `treeos.ai/@auth` | Place Position plus being, Stance at the Place Position | SUMMON, BE |
| `treeos.ai/flappybird@ruler` | deeper Position plus being, Stance at space | SEE, SUMMON, BE |

## Envelopes

Each verb's envelope is named explicitly for the kind of address it expects. There is no generic `address` field with per-verb interpretation; the field name itself tells the reader what the verb needs.

| Verb | Field | Why |
|---|---|---|
| **SEE** | `position` OR `stance` | Observation works at either tier. Position-level data (what's here?) or being-perspective interpretation (what does this being see here?). |
| **DO** | `position` only | Mutation only happens to persistent data. Beings are summoned moments, not storage — there is nothing at a stance to mutate. |
| **SUMMON** | `stance` only | Beings live as stances (being-at-position). Engagement requires both. Inboxes are per-being-per-position. |
| **BE** | `stance` (full form) OR `place` (domain form, auth-being implicit) | Self-identity operations target stances. For fresh registration the stance is the place's auth-being (`<place>/@auth`); passing just the bare domain (`<place>`, no slash) is shorthand for the same. |

The asymmetry between SEE and DO is real and reflects what beings are. Observation can ask "what does this being see here" because that question has meaning even when the being is not currently summoned (the answer is "how this being would interpret position data"). Mutation cannot ask "what does this being become" because beings are not mutable — only the data they read is mutable.

### SEE

Accepts a `position` field OR a `stance` field. Position when no being qualifier is needed; stance when the descriptor should be augmented with being-specific fields.

```
{ verb: "see", position: "<position>", identity, live?: boolean }
{ verb: "see", stance:   "<stance>",   identity, live?: boolean }
```

### DO

Accepts a `position` field. Only `position` — never `stance`. The world is data at positions; beings are not data targets. The requester's being, when relevant for authorization, lives in the identity token.

```
{ verb: "do", action: "<action>", position: "<position>", identity, payload: {...} }
```

### SUMMON

Accepts a `stance` field. Required. Inboxes are per-being-per-position, so the being qualifier is mandatory.

```
{ verb: "talk", stance: "<stance>", identity, message: {...} }
```

### BE

Accepts a `stance` field (the full form) OR a `place` field (the domain-only shorthand). Both forms address the place's auth-being for `register` and credential-based `claim`. For `release`, `switch`, and token-based `claim`, the address is the specific held stance.

```
// register: use either form
{ verb: "be", operation: "register", place:   "<place>",        payload: {...} }
{ verb: "be", operation: "register", stance: "<place>/@auth",  payload: {...} }

// claim with credentials: either form (auth-being processes credentials)
{ verb: "be", operation: "claim",    place:   "<place>",        payload: { username, password } }
{ verb: "be", operation: "claim",    stance: "<place>/@auth",  payload: { username, password } }

// token re-claim, release, switch: stance form (names the specific be-er)
{ verb: "be", operation: "claim",    stance: "<stance>", identity: <token> }
{ verb: "be", operation: "release",  stance: "<stance>", identity: <token> }
{ verb: "be", operation: "switch",   stance: "<target>", from: "<from>", identity: <token-for-target> }
```

The Portal client and the place server speak these IBP envelopes identically. The verb dispatches; the position/stance/place field tells the verb where to act; the identity names who; verb-specific fields name what.

For BE operations, `identity` may be absent (register, claim). All other verbs require it; the place rejects with `UNAUTHORIZED` if missing.

## SEE

```
{ verb: "see", position: "<position>", identity, live?: boolean }
{ verb: "see", stance:   "<stance>",   identity, live?: boolean }
```

Exactly one of `position` or `stance` must be present. One-shot returns a Position Description (see [position-description.md](position-description.md)). With `live: true`, the response is the initial descriptor followed by a stream of JSON-Patch (RFC 6902) frames as the addressed place changes.

The presence of `stance` (rather than `position`) augments the descriptor with being-specific fields (inbox, honored intents, response mode, conversations for that being). With `position`, the descriptor describes the place alone with the union of beings invocable there.

Matter reads use a path suffix:

```
{ verb: "see", position: "<position>/notes/<noteId>", identity }
```

Discovery is a SEE on a well-known position:

```
{ verb: "see", position: "<place>/.discovery", identity? }
```

Discovery may be requested without identity for capability negotiation.

Closing the socket ends all live SEE subscriptions. There is no UNSUBSCRIBE.

Full detail: this file is the high-level surface. The wire-level rules live in [server-protocol.md](server-protocol.md).

## DO

All DO actions target positions. Position data has many namespaces; different actions modify different parts of it.

```
{
  verb:     "do",
  action:   "<action name>",
  position: "<position>",
  identity: <token>,
  payload:  <action-specific>
}
```

DO accepts `position` only. There is no `stance` form. The world is data at positions; beings are not data targets. If authorization checks need to know the requester's being, they read it from the identity token, not from the address. Asking for `stance` here would suggest the being is itself being mutated, which it never is.

The seed mints a small set of primitive actions; extensions can register additional named DO actions on top. The seed primitives, grouped by what part of position data they modify:

- **Structural actions** write Space-schema fields: `create-child`, `rename`, `move`, `delete`, `change-status`, `set-visibility`, `transfer-owner`, `invite`, `accept-invite`, `revoke`.
- **Position-level content**: `write-note`, `edit-note`, `delete-note`, `upload-matter`.
- **Namespaced metadata**: `set-meta` and `clear-meta` are the generic writes; `scope-extension` and `assign-llm-slot` are named conveniences over specific namespaces with seed-aware semantics.
- **Place-level operations** (targeted at `<place>/`): `install-extension`, `enable-extension`, `disable-extension`, `uninstall-extension`, `publish-extension`, `set-config`, `set-llm-connection`, `remove-llm-connection`.

**Extension-registered actions** (examples, NOT seed-minted): `compress` (tree-compress), `prune` and `reroot` (treeos-maintenance), `split` (standalone), and any other action an extension registers. They go through the same dispatcher; the extension owns the payload + behavior. See [do-actions.md](do-actions.md#extension-registered-do-actions).

The generic `set-meta` writes any namespace within position data. The `namespace` payload field names which:

```
{ verb: "do", action: "set-meta", position: "<position>", identity, payload: { namespace: "values", data: { compassion: 7 } } }
{ verb: "do", action: "set-meta", position: "<position>", identity, payload: { namespace: "ruler",  data: { systemInstructions: "...", tools: [...] } } }
```

The first writes the `values` extension's data. The second writes the `@ruler` being's configuration at this position (the configuration the being will read when summoned here). Same action shape; the namespace value tells the seed where to write.

Full catalog: [do-actions.md](do-actions.md).

## SUMMON

```
{
  verb:     "talk",
  stance:   "<stance>",
  identity: <token>,
  message:  {
    from:        "<stance>",
    content:     <text or structured>,
    intent:      "chat" | "place" | "query" | "be",
    correlation: <id>,
    inReplyTo?:  <correlation id>,
    attachments?: [...]
  }
}
```

The `stance` field is required. The `message.from` is also a stance and is required. Inboxes are per-being-per-position; without an being qualifier on either side there is no destination being and no identifiable sender. A missing or unqualified field on SUMMON returns `INVALID_INPUT`.

SUMMON delivers the message to the inbox of the being at `stance`. The being's being determines what happens next: immediate summoning, hook-triggered summoning, scheduled summoning, etc. The protocol does not specify.

`intent` is the permission-and-response classifier. The being reads it on summoning and knows its constraint profile for this message:

- `chat`: full permission, response expected
- `place`: write permission only, no response expected
- `query`: read permission only, response expected
- `be`: self-directed inquiry, response shape per being

Response delivery depends on the being's `respondMode`:

- **sync**: the response returns inline on the same ack
- **async**: the protocol acks immediately; the response (if any) arrives later as a follow-up SUMMON at the original sender's inbox, with `inReplyTo` set to the correlation id of the originating message
- **none**: the protocol acks; no response is expected

User chat, cascade arrival, Ruler wake, being-to-being addressing, and gateway arrivals are all SUMMON. The protocol has one shape; the being decides how to interpret it.

Full detail: [message-envelope.md](message-envelope.md) and [inbox.md](inbox.md).

## BE

BE manages the requester's own identity. The address is a `stance` (the full form) or a `place` (the domain-only shorthand for register and credential claim). Both forms reach the place's auth-being; `place` is just the shorter version.

```
{
  verb:      "be",
  operation: "register" | "claim" | "release" | "switch",
  stance:    "<stance>",        // OR place: "<place>"
  identity?: <token>,
  payload?:  <operation-specific>
}
```

| Operation | Address | Why |
|---|---|---|
| `register` | `place: "<place>"` or `stance: "<place>/@auth"` (equivalent) | No prior stance. The auth-being processes credential creation. |
| `claim` (credentials) | `place: "<place>"` or `stance: "<place>/@auth"` (equivalent) | No prior stance. Credentials are validated by the auth-being. |
| `claim` (token re-claim) | `stance: "<held stance>"` | A previously-held stance is being re-activated. |
| `release` | `stance: "<held stance>"` | The user knows which one they are letting go. |
| `switch` | `stance: "<target stance>"` | The session already holds the target; this selects it as active. |

The auth-being is the place's welcome character: it is the stance that visitors first encounter. Whatever the place's values are about who can be there get expressed through the auth-being's responses. Public places shape their auth-being to be friendly and accessible. Private places shape theirs to require an invite code. Research places shape theirs to bind the be-er to a contract. The auth-being is an architectural commitment that becomes a UX surface.

The auth-being is inspectable via SEE on its stance (typically `<place>/@auth`); places choose the qualifier name and may install custom auth-being beings.

Full detail: [be-operations.md](be-operations.md).

## The arrival stance

An unestablished requester is in the **arrival stance** at the place they have just connected to. Arrival is not a protocol special case. It is a regular stance whose permissions the place defines.

The protocol commits to exactly two things about arrivals:

1. Every place has an arrival stance, so unestablished visitors have something to be.
2. Every place has an auth-being, and BE addressed at the auth-being (`<place>` or `<place>/@auth`) is always permitted from the arrival stance, so visitors can register or claim — subject to which BE operations the place's auth-being enables (a private place can disable `register` entirely).

Beyond those two, **everything is place-configured**. The place defines what an arrival can SEE, DO, and SUMMON to. The place's character expresses through what its arrival stance permits.

### Configuration shape

Arrival permissions live at the place's root position under `metadata.beings.arrival.permissions`. The Phase 5 shape is deliberately simple. Expressive enough for the patterns places actually want today, with room to extend:

```
{
  see:  { allowed_visibility: ["public"] | [] },
  do:   { allowed_actions: [] | ["action-name", ...] | "*" },
  summon: { allowed_targets: [] | ["@being", ...] | "*" },
  be:   { allowed_operations: ["register", "claim", "release", "switch"] }
}
```

What each field means:

- **`see.allowed_visibility`** lists Space `visibility` values that arrivals may SEE. The `visibility` field already exists on the Space schema; arrivals get filtered access to positions whose visibility matches. `["public"]` is the common open setting. `[]` denies all SEE.
- **`do.allowed_actions`** is a list of action names (`["write-note", "set-meta"]`) or the wildcard `"*"`. Empty list denies all DO.
- **`talk.allowed_targets`** lists being names arrivals can SUMMON to. `["@auth", "@guide"]` permits the auth-being and a public guide; `"*"` permits any being.
- **`be.allowed_operations`** lists which BE operations are honored. `["register", "claim"]` is the default; a closed place may narrow it.

Stance Authorization (see below) checks arrival permissions on every request from an unestablished requester. No special-case logic at the protocol layer. Arrivals follow the same rules as any other stance, with their permission profile sourced from this metadata namespace.

The discovery position (`<place>/.discovery`) is implicitly readable by arrivals on every place regardless of configuration, so clients can learn capabilities before engaging in any other way.

### Place-level BE configuration

Two booleans at the place root govern which BE operations the auth-being honors:

```
metadata.auth.register_enabled = true | false   // default: true
metadata.auth.claim_enabled    = true | false   // default: true
```

A closed place disables `register_enabled` and leaves `claim_enabled` on. A maintenance-mode place disables both. The auth-being reads these on every BE call; it rejects with `FORBIDDEN` when the requested operation is disabled. These are intentionally simpler than per-stance `be.allowed_operations` for the common case. Most places tune register/claim availability at the place level, not per stance.

### The system default

The default arrival permissions are conservative: BE register and claim are enabled; SEE is permitted on positions with `visibility: "public"`; DO and SUMMON are denied. Place owners loosen this as their character allows by editing `metadata.beings.arrival.permissions`.

## Stance Authorization

**Stance Authorization** is the seed system that determines what one stance can do toward another stance or position through a portal connection. Every authorization decision in IBP flows through it.

The function the seed runs on every verb call:

```
authorize({ acting, target, verb, action?, namespace? })
  -> { ok, stance, reason? }
```

Inputs:

- **acting** — the stance making the request (the "from" side; derived from the identity token, or the arrival stance if no identity).
- **target** — the stance or position being addressed (the "to" side, from the verb's address field).
- **verb** — SEE / DO / SUMMON / BE.
- **action** / **namespace** — the operation's detail (DO action name, set-meta namespace, SUMMON intent, BE operation).

Output: allow or deny, plus the resolved acting stance that was checked.

Per request the seed resolves the acting stance at the addressed place (arrival if unestablished, otherwise the stance the place has assigned to this identity), reads the stance's permissions from place metadata, and decides. One function. One configuration shape. Every verb call.

### Phase 5 stances

Phase 5 ships two real stances at the protocol level. Additional stance vocabularies are future work.

- **arrival**. Unauthenticated requester. Default permissions: SEE positions with `visibility: "public"`, BE register and claim. Nothing else. Configurable per place via `metadata.beings.arrival.permissions`.


- **owner**. Authenticated requester who owns the addressed scope (existing `resolveTreeAccess.write` semantics). Default permissions: SEE everything, DO everything, SUMMON anything, all BE operations. This is what place owners have at their own places.

Authenticated requesters who are not owners of the addressed scope fall through to the existing access checks (contributors via `resolveTreeAccess`, visibility filters on SEE). They do not yet have a named protocol stance; introducing `member`, `guest`, `contributor`, `moderator` as configurable stances is Phase 7 work.

The authorize function is **load-bearing for every IBP request.** It is one of the most important pieces of the seed. Performance matters (it runs on every verb call). Correctness matters (bugs have system-wide blast radius). Place owners' permission configurations become security policy; tooling to compute "what can stance X actually do at this place" is part of the supporting surface, not a nicety.

### What "arrival" means precisely

Arrival is for **strangers to the protocol** — visitors with no identity established at any place. Once you have signed in at any place, you carry that identity wherever you go. A cross-place visit by an established identity is not an arrival; the receiving place looks up its permission policy for that identity and assigns a stance.

Two cases, both handled by the same authorize call:

- **No identity token.** Stance is `arrival` at the contacted place. Permissions come from the place's arrival configuration.
- **Identity token present.** Stance is whatever the contacted place assigns to that identity (owner of the addressed scope, member, granted guest, etc.). Permissions come from that stance's configuration.

The protocol cleanly separates two concerns: **authorization** answers "given this stance, what is permitted?" (Phase 5). **Cross-place stance assignment** answers "given this visitor, what stance does the receiving place assign?" (Phase 8+ federation work, requires cross-place trust infrastructure).

### Future work (Phase 7+)

These are deliberately deferred until real places surface real configuration needs:

- **Richer permission semantics**: glob/prefix path matching, allowed-vs-denied conflict resolution, inheritance of permissions through descendant positions. The Phase 5 shape uses simple lists; extending to a richer DSL is incremental.
- **Additional stance vocabularies**: `member`, `guest`, `contributor`, `moderator`, and custom stances configured per place. The seed's authorize function reads `metadata.beings.<stance>.permissions` regardless of stance name; Phase 7 work is the resolver that assigns these stances to authenticated identities at a place.
- **Cross-place stance assignment** (Phase 8+ federation). When an identified visitor from another place contacts this place, the receiving place needs to look up its policy for that identity and assign a stance. Requires cross-place identity infrastructure (Canopy or successor). The authorize function is designed so this resolver plugs in without changing the verb-side flow.
- **Place-tooling presets** (personal / community / service) that configure arrival permissions out of the box. Not protocol features; convenience configurations the place installer provides.
- **Auth-being customization** beyond defaults. Places that want different welcome characters, invite-only registration flows, contract acceptance, etc. Today's default auth-being is open registration.

The architecture's commitments are preserved by Phase 5; the implementation just ships only what real use has validated. The authorize function adapts as new shape requirements surface; the work compounds rather than gets replaced.

## Errors

Every verb may respond with an error envelope:

```
{
  status:  "error",
  error:   {
    code:    "<error code>",
    message: "<human-readable>",
    detail?: <structured detail>
  }
}
```

Error codes are unified with the place's existing semantic error vocabulary in `seed/protocol.js` (`ERR.*`). The portal does not invent a parallel vocabulary; it reuses seed's codes wherever the meaning matches and adds five portal-specific codes for protocol-layer concerns seed does not cover.

### Reused from seed (`ERR.*`)

| Code | Meaning in portal context |
|---|---|
| `UNAUTHORIZED` | Missing or invalid identity token. SEE/DO/SUMMON reject; BE register/claim do not. |
| `FORBIDDEN` | Identity is not authorized at this address or for this action. |
| `SESSION_EXPIRED` | Identity token expired; client should re-claim. |
| `NODE_NOT_FOUND` | Address resolved but the space does not exist (or was deleted). |
| `USER_NOT_FOUND` | BE claim on a username that does not exist. |
| `NOTE_NOT_FOUND` | SEE on a note matter that does not exist. |
| `TREE_NOT_FOUND` | Root address does not resolve to a known tree. |
| `EXTENSION_NOT_FOUND` | DO set-meta naming an extension namespace whose extension is not installed on the place. |
| `EXTENSION_BLOCKED` | DO set-meta naming an extension namespace whose extension is blocked at this position by scope. |
| `INVALID_INPUT` | Generic schema or parse failure on the request body. |
| `INVALID_STATUS` | DO change-status with an unrecognized status value. |
| `INVALID_TYPE` | DO create-child with an unrecognized space type. |
| `RATE_LIMITED` | Throttled. |
| `RESOURCE_CONFLICT` | BE register with a username already taken; DO action's preconditions not met (e.g., delete on a role-bearing space without force); concurrent edit collision. |
| `TIMEOUT` | Sync SUMMON exceeded time budget; DO action timed out internally. |
| `UPLOAD_TOO_LARGE` | DO upload-matter bytes exceed configured limit. |
| `UPLOAD_MIME_REJECTED` | DO upload-matter content type not accepted. |
| `UPLOAD_DISABLED` | Uploads disabled on this place. |
| `DOCUMENT_SIZE_EXCEEDED` | SUMMON content or DO payload exceeds size budget. |
| `LLM_TIMEOUT` | Sync SUMMON summoning's LLM call timed out. |
| `LLM_FAILED` | Sync SUMMON summoning's LLM call errored. |
| `LLM_NOT_CONFIGURED` | The being's being has no LLM resolved. |
| `PEER_UNREACHABLE` | Federated SUMMON or SEE to an unreachable peer place. |
| `INTERNAL` | Server error. |

### Portal-specific codes (new)

| Code | Meaning |
|---|---|
| `ADDRESS_PARSE_ERROR` | The `address` field could not be parsed as a position-with-optional-qualifier. |
| `EMBODIMENT_UNAVAILABLE` | The address's `@<being>` qualifier is not invocable at this position by this identity. |
| `VERB_NOT_SUPPORTED` | The address does not support the requested verb. (E.g., SUMMON on an unqualified address; DO at a read-only public stance.) |
| `ACTION_NOT_SUPPORTED` | DO action name is unknown or not permitted at this position. |
| `INVALID_INTENT` | SUMMON message's `intent` is not in the addressed being's `honoredIntents`. |

These five live in the portal layer (`place/ibp/errors.js`) and may be returned by any of the four verbs as appropriate.

### Error envelope detail

The `detail` field may carry a structured object with context. Conventions:

- For `EMBODIMENT_UNAVAILABLE`: `{ address, available: [<list of invocable beings here>] }` so the client can suggest alternatives.
- For `FORBIDDEN`: `{ address, suggestedIdentities: [...] }` listing other be-ers the session holds that might be authorized.
- For `RESOURCE_CONFLICT` on BE register: `{ field: "username" }`.
- For `INVALID_INPUT`: `{ field: "...", reason: "..." }` pointing at the offending field.

Detail is optional. Clients render the human-readable `message` if detail is absent.

## What IBP does not do

IBP intentionally does not specify:

- **How a being thinks.** That is the being.
- **How coordination works.** A Ruler firing-and-forgetting background work uses hooks and fire-and-forget primitives; the protocol sees only individual SUMMON deliveries.
- **Whether responses stream.** Sync responses may stream chunks within an ack, but the protocol does not require it; that is a transport detail.
- **What an address means semantically.** The stance / IBP Address grammar (see [ibp-address.md](ibp-address.md)) defines the syntax; resolving a stance to a space + being is the place's job; what a being at that stance is for is the being's job.
- **What a position is structurally.** That is the Space schema in the seed.

IBP does message delivery to beings and operations on the world from be-ers. Everything that is not those two things lives somewhere else.

## See also

- [being-summoned.md](being-summoned.md) the architectural framing
- [ibp-address.md](ibp-address.md) the address grammar
- [position-description.md](position-description.md) the SEE response shape
- [message-envelope.md](message-envelope.md) the SUMMON envelope in detail
- [inbox.md](inbox.md) the inbox model and summoning triggers
- [do-actions.md](do-actions.md) the catalog of named DO actions
- [be-operations.md](be-operations.md) identity bootstrap and auth-being
- [server-protocol.md](server-protocol.md) wire-level rules for the four ops
