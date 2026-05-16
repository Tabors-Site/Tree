# The TreeOS Portal Protocol

The protocol that lands speak to portals and that portals speak to lands. Four verbs over WebSocket. One message envelope for being engagement. One inbox per being, part of the record.

Before reading further, read [being-summoned.md](being-summoned.md). The protocol is shaped around that framing; nothing here will make sense without it.

## Four verbs

Every interaction is one of four verbs.

| Verb | What it does |
|---|---|
| **SEE** | Observe a position. One-shot, or live via a flag. |
| **DO** | Mutate the world at a position. |
| **TALK** | Deliver a message to a being's inbox. |
| **BE** | Manage be-er identity (register, claim, release, switch). |

Three verbs operate from a be-er upon the world. One verb operates upon the be-er itself. The categorical line is sharp and deliberate: SEE/DO/TALK require an established be-er; BE is how a be-er is established or changed.

There is no fifth verb. Anything that does not fit one of the four does not belong in the protocol; it belongs in an embodiment, an extension, or a layer above the protocol.

## Transport

WebSocket only. Socket.IO ops named `portal:see`, `portal:do`, `portal:talk`, `portal:be`. The connection is the session; closing the connection ends all live subscriptions.

A single HTTP endpoint exists for bootstrap: `GET /.well-known/treeos-portal` returns the WebSocket URL and protocol version. The client opens a socket and never speaks HTTP for protocol verbs again. Everything else, including capability discovery, flows through `portal:see` on the `.discovery` position of a land.

The legacy `land/routes/api/*` HTTP routes continue running during migration, but they are not part of the new protocol. Nothing new wires through them.

## Three address concepts

The protocol talks about addresses at three levels of specificity. Each name is used precisely.

| Concept | Form | What it names |
|---|---|---|
| **Position** | `<land>/<path>` | A place in the world. The land domain followed by `/` followed by the path. The path may be empty (just `/`, the land root), `~user...` (a home), or any tree node. Examples: `treeos.ai/` (land), `treeos.ai/~tabor` (home), `treeos.ai/flappybird/chapter-1` (a tree node). |
| **Stance** | `<position>@<embodiment>` | A being at a position. `treeos.ai/flappybird@ruler`. Position + as what being. |
| **Portal Address** | `<stance> :: <stance>` | The bridge form, naming a relationship between two stances. `tabor :: treeos.ai/flappybird@ruler`. |

The slash is always present in a position. `treeos.ai` is not a position; `treeos.ai/` is (the land root). There are two things you can address in the world: a **position** (a place) or a **stance** (a being at a place).

A Portal Address is rarely inside a verb envelope. It describes the *relationship* between requester and target. The envelope carries the target side only (as a position, stance, or land); the requester side is implicit, established by BE and carried in the identity token. Portal Addresses appear in UI surfaces (tab titles, history) and in being-to-being framing.

## Envelopes

Each verb's envelope is named explicitly for the kind of address it expects. There is no generic `address` field with per-verb interpretation; the field name itself tells the reader what the verb needs.

### SEE

Accepts a `position` field OR a `stance` field. Position when no embodiment qualifier is needed; stance when the descriptor should be augmented with embodiment-specific fields.

```
{ verb: "see", position: "<position>", identity, live?: boolean }
{ verb: "see", stance:   "<stance>",   identity, live?: boolean }
```

### DO

Accepts a `position` field OR a `stance` field. Position for the common case (default identity-level authorization is sufficient). Stance when the requester's embodiment matters for authorization (e.g., the identity holds multiple roles at the same place and the user is acting as one of them specifically).

```
{ verb: "do", action: "<action>", position: "<position>", identity, payload: {...} }
{ verb: "do", action: "<action>", stance:   "<stance>",   identity, payload: {...} }
```

### TALK

Accepts a `stance` field. Required. Inboxes are per-being-per-position, so the embodiment qualifier is mandatory.

```
{ verb: "talk", stance: "<stance>", identity, message: {...} }
```

### BE

Accepts a `land` field. Identity bootstrap happens at the land level; the auth-being is implicit (the verb knows to dispatch to the land's auth-being).

```
{ verb: "be", operation: "<op>", land: "<land>", identity?, payload?: {...} }
```

The portal client and the land server speak these envelopes identically. The verb dispatches; the position/stance/land field tells the verb where to act; the identity names who; verb-specific fields name what.

For BE operations, `identity` may be absent (register, claim). All other verbs require it; the land rejects with `UNAUTHORIZED` if missing.

## SEE

```
{ verb: "see", position: "<position>", identity, live?: boolean }
{ verb: "see", stance:   "<stance>",   identity, live?: boolean }
```

Exactly one of `position` or `stance` must be present. One-shot returns a Stance Descriptor (see [stance-descriptor.md](stance-descriptor.md)). With `live: true`, the response is the initial descriptor followed by a stream of JSON-Patch (RFC 6902) frames as the addressed place changes.

The presence of `stance` (rather than `position`) augments the descriptor with embodiment-specific fields (inbox, honored intents, response mode, conversations for that embodiment). With `position`, the descriptor describes the place alone with the union of embodiments invocable there.

Artifact reads use a path suffix:

```
{ verb: "see", position: "<position>/notes/<noteId>", identity }
```

Discovery is a SEE on a well-known position:

```
{ verb: "see", position: "<land>/.discovery", identity? }
```

Discovery may be requested without identity for capability negotiation.

Closing the socket ends all live SEE subscriptions. There is no UNSUBSCRIBE.

Full detail: this file is the high-level surface. The wire-level rules live in [server-protocol.md](server-protocol.md).

## DO

```
{
  verb:     "do",
  action:   "<named action> | set-meta | clear-meta",
  position: "<position>",       // or stance: "<stance>"
  identity: <token>,
  payload:  <action-specific>
}
```

Exactly one of `position` or `stance` must be present. Most DO actions use `position`; use `stance` when the requester's embodiment matters for authorization.

Two action categories.

**Named structural actions** for kernel-level operations (create-child, rename, move, delete, change-status, write-note, edit-note, delete-note, upload-artifact, invite, transfer-owner, revoke, accept-invite, install-extension, enable-extension, disable-extension, scope-extension, set-config, set-llm-connection, assign-llm-slot, compress, prune, split). These are minted by the kernel and documented in [do-actions.md](do-actions.md).

**Generic extension actions** for any extension that writes to its metadata namespace:

```
{ verb: "do", action: "set-meta", position: "<position>", identity, payload: { extension: "values", data: { compassion: 7 } } }
```

Extensions do not mint new DO actions for every endpoint. They consume `set-meta` against their namespace. The kernel-named actions are reserved for kernel-structural operations.

Full catalog: [do-actions.md](do-actions.md).

## TALK

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

The `stance` field is required. The `message.from` is also a stance and is required. Inboxes are per-being-per-position; without an embodiment qualifier on either side there is no destination being and no identifiable sender. A missing or unqualified field on TALK returns `INVALID_INPUT`.

TALK delivers the message to the inbox of the being at `stance`. The being's embodiment determines what happens next: immediate summoning, hook-triggered summoning, scheduled summoning, etc. The protocol does not specify.

`intent` is the permission-and-response classifier. The being reads it on summoning and knows its constraint profile for this message:

- `chat`: full permission, response expected
- `place`: write permission only, no response expected
- `query`: read permission only, response expected
- `be`: self-directed inquiry, response shape per embodiment

Response delivery depends on the embodiment's `respondMode`:

- **sync**: the response returns inline on the same ack
- **async**: the protocol acks immediately; the response (if any) arrives later as a follow-up TALK at the original sender's inbox, with `inReplyTo` set to the correlation id of the originating message
- **none**: the protocol acks; no response is expected

User chat, cascade arrival, Ruler wake, being-to-being addressing, and gateway arrivals are all TALK. The protocol has one shape; the embodiment decides how to interpret it.

Full detail: [message-envelope.md](message-envelope.md) and [inbox.md](inbox.md).

## BE

```
{
  verb:      "be",
  operation: "register" | "claim" | "release" | "switch",
  land:      "<land>",
  identity?: <token>,
  payload?:  <operation-specific>
}
```

The `land` field names the land where identity is being established or changed. The auth-being at that land processes the operation; it is implicit (the verb knows to dispatch there). The auth-being is still a real being inspectable by SEE on its stance (typically `<land>/@auth`, though lands choose the qualifier name and may install custom auth-being embodiments).

BE operates upon the be-er itself: establishing one, claiming one, releasing one, or switching between be-ers a session holds.

- **register**: create a new be-er at a land. Targeted at the land's auth-being. Payload carries credentials and any land-specific registration data.
- **claim**: log in. Returns `{ identityToken, beingAddress }`.
- **release**: log out. Invalidates the identity token.
- **switch**: swap the active be-er within a session (from one be-er the session holds to another).

The land has a per-land auth-being that handles BE operations. The auth-being can be specialized per land: a public land's auth-being may welcome any registration; a private land's may require an invite code; a research land's may bind the be-er to a contract. The auth-being is inspectable like any being.

BE is the only verb that handles unestablished requesters. SEE/DO/TALK uniformly require an established be-er.

Full detail: [be-operations.md](be-operations.md).

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

Error codes are unified with the land's existing semantic error vocabulary in `seed/protocol.js` (`ERR.*`). The portal does not invent a parallel vocabulary; it reuses seed's codes wherever the meaning matches and adds five portal-specific codes for protocol-layer concerns seed does not cover.

### Reused from seed (`ERR.*`)

| Code | Meaning in portal context |
|---|---|
| `UNAUTHORIZED` | Missing or invalid identity token. SEE/DO/TALK reject; BE register/claim do not. |
| `FORBIDDEN` | Identity is not authorized at this address or for this action. |
| `SESSION_EXPIRED` | Identity token expired; client should re-claim. |
| `NODE_NOT_FOUND` | Address resolved but the node does not exist (or was deleted). |
| `USER_NOT_FOUND` | BE claim on a username that does not exist. |
| `NOTE_NOT_FOUND` | SEE on a note artifact that does not exist. |
| `TREE_NOT_FOUND` | Root address does not resolve to a known tree. |
| `EXTENSION_NOT_FOUND` | DO set-meta naming an extension not installed on the land. |
| `EXTENSION_BLOCKED` | DO set-meta naming an extension blocked at this position by scope. |
| `INVALID_INPUT` | Generic schema or parse failure on the request body. |
| `INVALID_STATUS` | DO change-status with an unrecognized status value. |
| `INVALID_TYPE` | DO create-child with an unrecognized node type. |
| `RATE_LIMITED` | Throttled. |
| `RESOURCE_CONFLICT` | BE register with a username already taken; DO action's preconditions not met (e.g., delete on a role-bearing node without force); concurrent edit collision. |
| `TIMEOUT` | Sync TALK exceeded time budget; DO action timed out internally. |
| `UPLOAD_TOO_LARGE` | DO upload-artifact bytes exceed configured limit. |
| `UPLOAD_MIME_REJECTED` | DO upload-artifact content type not accepted. |
| `UPLOAD_DISABLED` | Uploads disabled on this land. |
| `DOCUMENT_SIZE_EXCEEDED` | TALK content or DO payload exceeds size budget. |
| `LLM_TIMEOUT` | Sync TALK summoning's LLM call timed out. |
| `LLM_FAILED` | Sync TALK summoning's LLM call errored. |
| `LLM_NOT_CONFIGURED` | The being's embodiment has no LLM resolved. |
| `PEER_UNREACHABLE` | Federated TALK or SEE to an unreachable peer land. |
| `INTERNAL` | Server error. |

### Portal-specific codes (new)

| Code | Meaning |
|---|---|
| `ADDRESS_PARSE_ERROR` | The `address` field could not be parsed as a position-with-optional-qualifier. |
| `EMBODIMENT_UNAVAILABLE` | The address's `@<embodiment>` qualifier is not invocable at this position by this identity. |
| `VERB_NOT_SUPPORTED` | The address does not support the requested verb. (E.g., TALK on an unqualified address; DO at a read-only public stance.) |
| `ACTION_NOT_SUPPORTED` | DO action name is unknown or not permitted at this position. |
| `INVALID_INTENT` | TALK message's `intent` is not in the addressed embodiment's `honoredIntents`. |

These five live in the portal layer (`land/portal/errors.js`) and may be returned by any of the four verbs as appropriate.

### Error envelope detail

The `detail` field may carry a structured object with context. Conventions:

- For `EMBODIMENT_UNAVAILABLE`: `{ address, available: [<list of invocable embodiments here>] }` so the client can suggest alternatives.
- For `FORBIDDEN`: `{ address, suggestedIdentities: [...] }` listing other be-ers the session holds that might be authorized.
- For `RESOURCE_CONFLICT` on BE register: `{ field: "username" }`.
- For `INVALID_INPUT`: `{ field: "...", reason: "..." }` pointing at the offending field.

Detail is optional. Clients render the human-readable `message` if detail is absent.

## What the protocol does not do

The protocol intentionally does not specify:

- **How a being thinks.** That is the embodiment.
- **How coordination works.** A Ruler firing-and-forgetting background work uses hooks and fire-and-forget primitives; the protocol sees only individual TALK deliveries.
- **Whether responses stream.** Sync responses may stream chunks within an ack, but the protocol does not require it; that is a transport detail.
- **What an address means semantically.** The stance / Portal Address grammar (see [portal-address.md](portal-address.md)) defines the syntax; resolving a stance to a node + embodiment is the land's job; what a being at that stance is for is the embodiment's job.
- **What a position is structurally.** That is the Node schema in the kernel.

The protocol does message delivery to beings and operations on the world from be-ers. Everything that is not those two things lives somewhere else.

## See also

- [being-summoned.md](being-summoned.md) the architectural framing
- [portal-address.md](portal-address.md) the address grammar
- [stance-descriptor.md](stance-descriptor.md) the SEE response shape
- [message-envelope.md](message-envelope.md) the TALK envelope in detail
- [inbox.md](inbox.md) the inbox model and summoning triggers
- [do-actions.md](do-actions.md) the catalog of named DO actions
- [be-operations.md](be-operations.md) identity bootstrap and auth-being
- [server-protocol.md](server-protocol.md) wire-level rules for the four ops
