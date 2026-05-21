# Server Protocol: IBP Wire-Level Rules

This document specifies how places respond to IBP's four verbs at the wire level. It is the bridge between the conceptual protocol spec ([protocol.md](protocol.md), which defines IBP) and the implementation in `place/ibp/`.

Read [protocol.md](protocol.md), [being-summoned.md](being-summoned.md), and [message-envelope.md](message-envelope.md) first.

## Transport

WebSocket only. The Socket.IO implementation runs on the place's existing `/ws` namespace. The portal client opens a single socket per place it engages with and reuses it for all verb traffic.

There are no HTTP endpoints for the four verbs. The single HTTP endpoint that exists is the bootstrap.

## Bootstrap

```
GET /.well-known/treeos-portal
```

Returns:

```json
{
  "ws": "wss://treeos.ai/ws",
  "protocolVersion": "1.0",
  "place": "treeos.ai"
}
```

The client uses this only to learn the WS URL. Capability discovery (zones, beings, version negotiation) flows through `see <place>/.discovery` over the socket once connected.

Authentication: none required for bootstrap. Anyone can learn how to connect.

## Socket.IO ops

Four ops, one per verb.

```
ibp:see   (verb: SEE)
ibp:do    (verb: DO)
ibp:summon  (verb: SUMMON)
ibp:be    (verb: BE)
```

Each is a Socket.IO event taking a request payload and returning an ack (or, for live SEE, a stream of emitted frames in addition to the ack).

The client emits with a request id; the place returns the ack carrying the same id. Streamed frames also carry the request id so the client can route them.

## Request shape

Common envelope:

```json
{
  "id":       "<request id, client-generated>",
  "verb":     "see" | "do" | "talk" | "be",
  "identity": "<token, optional for some SEE and BE>",
  "...":      "address field (named per verb) plus verb-specific fields"
}
```

Each verb names its address field explicitly. The four verbs partition cleanly: SEE observes, DO mutates, SUMMON engages a being, BE acts on the requester's own identity.

| Verb | Field | Why |
|---|---|---|
| SEE | `position` OR `stance` | Observation works at either tier: position-level (what's here?) or being-specific view (what does this being see here?). |
| DO | `position` only | The world is data at positions; beings are not data targets. Mutations always place at a position. |
| SUMMON | `stance` only | Beings live as stances (being-at-position). Engagement requires both. Inboxes are per-being-per-position. |
| BE | `stance` only | Self-identity operations target stances. For fresh registration, the stance is the place's auth-being. |

No generic `address` field. The field name tells the reader what the verb requires. None of these are IBP Addresses (the bridged `stance :: stance` form); they are the target side of an implicit relationship. The requester side is established by the identity token.

Verb-specific fields:

**SEE**: `live?: boolean`

**DO**: `action: string, payload: object`

**SUMMON**: `message: { from, content, intent, correlation, inReplyTo?, attachments?, sentAt? }` (server sets sentAt if missing)

**BE**: `operation: "register" | "claim" | "release" | "switch", payload?, from?, to?`

## Response shape

Successful ack:

```json
{
  "id":     "<request id>",
  "status": "ok",
  "data":   <verb-specific>
}
```

For SEE one-shot: `data` is the Position Description.
For SEE live: the initial `data` is the descriptor; subsequent frames arrive as separate emits.
For DO: `data` is action-specific (often `{ written: true }` or `{ spaceId, address }`).
For SUMMON sync: `data` is the response message envelope.
For SUMMON async or none: `data` is `{ status: "accepted" }`.
For BE: `data` is `{ identityToken, beingAddress }` for register/claim, `{ released: true }` for release, `{ active }` for switch.

Error ack:

```json
{
  "id":     "<request id>",
  "status": "error",
  "error":  {
    "code":    "<error code>",
    "message": "<human-readable>",
    "detail":  <structured detail, optional>
  }
}
```

Error codes are listed in [protocol.md](protocol.md).

## SEE wire rules

### One-shot

```
client emits ibp:see { id, position: "<position>", identity?, live: false (or omitted) }
       OR  ibp:see { id, stance:   "<stance>",   identity?, live: false (or omitted) }
place responds with ack { id, status: "ok", data: <Position Description> }
```

Exactly one of `position` or `stance` must be present. `identity` is required except for explicitly anonymous-accessible places (the `.discovery` position at a place, public-visibility place zones).

### Live

```
client emits ibp:see { id, position OR stance, identity, live: true }
place responds with ack { id, status: "ok", data: <initial Position Description> }
place emits portal:patch frames (any number, any time):
  { id, op: "patch", patch: [<RFC 6902 patches>] }
  { id, op: "replace", descriptor: <full descriptor> }
  { id, op: "invalidate" }
client closes socket -> live SEE ends, no UNSUBSCRIBE needed
client emits a new ibp:see with same field -> new subscription, new id
```

The place may emit `patch`, `replace`, or `invalidate` frames at its discretion. The client applies patches in order. If patches drift (the client missed a frame), the place emits `replace` or `invalidate` to recover.

Multiple live SEEs from the same client are allowed (different request ids, different addresses). Each is independent.

When the socket closes (intentionally or via network), all live SEEs for that socket end. On reconnect, the client re-emits the SEEs it wants to keep alive.

### Authorization

The place checks for each SEE:

1. Is exactly one of `position` or `stance` present and parseable? `INVALID_INPUT` or `ADDRESS_PARSE_ERROR` if not.
2. Does it resolve to a known place? `NODE_NOT_FOUND` if not.
3. If `stance`: is the being qualifier invocable here for this identity? `EMBODIMENT_UNAVAILABLE` if not.
4. Does the identity have read access here? `FORBIDDEN` if not.
5. For anonymous SEE: is this place public? `UNAUTHORIZED` if not.

## DO wire rules

```
client emits ibp:do { id, action, position: "<position>", identity, payload }
place responds with ack { id, status: "ok", data: <action-specific> }
```

`position` is the only address field. There is no `stance` form. Sequential per identity: the place may serialize DOs from the same identity to avoid races on the same space. The protocol does not require strict ordering across identities.

### Validation chain

1. `position` present and parseable (`INVALID_INPUT` or `ADDRESS_PARSE_ERROR`).
2. `position` resolves to a known place (`NODE_NOT_FOUND` if not).
3. Identity check (`UNAUTHORIZED` if missing or invalid).
4. Address-level authorization (`FORBIDDEN` if not authorized at this position). The kernel reads the requester's role from the identity token (not from the address).
5. Action-level authorization (some actions need `isAdmin`).
6. Payload schema validation per action (`INVALID_INPUT` if mismatch).
7. Pre-hooks (`beforeSpaceCreate`, etc.) fire and may cancel.
8. The mutation executes.
9. Post-hooks fire.
10. Live SEE subscribers receive descriptor patches for the affected place(s).

### Multi-step payloads

For large uploads (`upload-matter` with megabyte-scale bytes), the action supports chunking:

```
client emits ibp:do { id, action: "upload-matter", position, identity, payload: { kind, name, contentType, chunk: 0, totalChunks: 5, bytes: <chunk 0> } }
place responds with ack { id, status: "ok", data: { chunkAccepted: 0 } }
client emits ibp:do { id, action: "upload-matter", payload: { chunk: 1, totalChunks: 5, bytes: <chunk 1>, uploadId: <returned in first ack> } }
... and so on
final chunk: place responds with ack { id, status: "ok", data: { matterId, position: "<position>/matters/<matterId>" } }
```

Chunked uploads use a per-upload `uploadId` returned in the first ack and threaded through subsequent chunks.

## SUMMON wire rules

```
client emits ibp:summon { id, stance: "<stance>", identity, message }
```

The place's SUMMON handler:

1. Validates envelope shape. `INVALID_INPUT` if malformed or `stance` field missing/unqualified.
2. Resolves stance. `NODE_NOT_FOUND` or `EMBODIMENT_UNAVAILABLE` if fails.
3. Authorizes SUMMON at the stance. `FORBIDDEN` if not.
4. Validates intent against being's permission list. `INVALID_INTENT` if not honored.
5. Atomically: appends `message` to inbox + fires summoning per `triggerOn`.
6. Per `respondMode`:
   - `sync`: holds ack open; when summoning completes, returns the response message inline as `data: <response envelope>`
   - `async`: returns ack immediately with `data: { status: "accepted" }`; the response (if any) arrives later as a new ibp:summon delivered to the sender's inbox
   - `none`: returns ack immediately with `data: { status: "accepted" }`

### Sync response delivery

For sync, the ack data is the full response message envelope:

```json
{
  "id": "<id>",
  "status": "ok",
  "data": {
    "from": "<being's stance>",
    "content": "<response>",
    "intent": "chat",
    "correlation": "<new id>",
    "inReplyTo": "<originating correlation>",
    "sentAt": "<server timestamp>"
  }
}
```

Sync may stream chunks. The place emits intermediate frames before the final ack:

```
place emits ibp:summon-delta { id, delta: "<partial content>" }
place emits ibp:summon-delta { id, delta: "<more content>" }
place responds with final ack { id, status: "ok", data: <complete response envelope> }
```

Beings declare `streaming: true` to opt into delta frames. Without that, the response arrives only in the final ack.

### Async response delivery

The originating client receives async responses through a live SEE on the sender's home position. When the response SUMMON is appended to the sender's inbox, the live SEE emits a patch frame that adds the new inbox entry.

```
client A -> ibp:summon { id: "talk-1", stance: "<ruler stance>", message: { from: "tabor@treeos.ai", ... } }
client A <- ack { id: "talk-1", status: "ok", data: { status: "accepted" } }

(time passes)

ruler's async summoning produces a response.
place writes response as SUMMON to tabor@treeos.ai's inbox.
client A is running live SEE on stance "tabor@treeos.ai".
client A receives portal:patch with the new inbox entry.
client A renders the response in the chat thread keyed by inReplyTo.
```

This is why a portal client should always have a live SEE on the user's home stance open: it is how async responses arrive.

### Cascade and system-generated SUMMONs

When the place's internal code (cascade-deliver, completion hooks, scheduler) needs to deliver a message to a being, it constructs a SUMMON request internally and goes through the same SUMMON handler. The `from` field names the system origin (e.g., the cascade source stance, the completing job's stance). The `identity` is a system identity issued by the place for internal traffic.

This means cascade arrivals are indistinguishable from user SUMMONs at the protocol layer. The being's being may inspect `from` to know the origin, but the protocol does not separate them.

## BE wire rules

```
client emits ibp:be { id, operation, stance: "<stance>", payload?, identity?, from? }
```

`stance` is the only address field. For fresh registration, the stance is the place's auth-being (typically `<place>/@auth`). The place's BE handler dispatches to the auth-being at the named stance's place.

### Validation chain

1. `operation` is one of the four. `INVALID_INPUT` if not.
2. `stance` is present and qualified. `INVALID_INPUT` if missing or unqualified.
3. The stance's place is this server (Pass 1: no federated BE yet).
4. Identity requirement varies:
   - `register` or credential-based `claim` (stance is auth-being, payload has credentials): identity may be absent.
   - Token-based `claim` (stance is a held being, identity carries the still-valid token): identity required.
   - `release` and `switch`: identity required.
5. The auth-being at the stance's place processes the operation per its being's policy.
6. Place returns the operation-specific response.

### Atomicity

`register` is atomic: either the be-er is created and the token issued, or nothing is created and an error is returned. No partial registration.

`switch` is purely client-coordination on the place side; the place may verify the token but does not mutate state.

### Token issuance

Tokens are issued by the auth-being. The format is place-specific (today TreeOS uses JWT). The token is returned in the ack data:

```json
{
  "id": "<id>",
  "status": "ok",
  "data": {
    "identityToken": "<token>",
    "beingAddress": "tabor@treeos.ai",
    "expiresAt": "<ISO8601, optional>"
  }
}
```

Clients should store tokens securely and present them on subsequent SEE/DO/SUMMON.

## Discovery

A SEE with `position: "<place>/.discovery"` returns the place's capabilities:

```json
{
  "place": "treeos.ai",
  "protocolVersion": "1.0",
  "supportedVerbs": ["see", "do", "talk", "be"],
  "supportedZones": ["place", "home", "tree"],
  "beings": [
    { "name": "ruler", "description": "Coordinates work at this scope" },
    { "name": "worker", "description": "Executes leaf-level work" },
    "..."
  ],
  "extensionsInstalled": [
    { "name": "governing", "version": "1.0.0" },
    "..."
  ],
  "authBeing": { "stance": "treeos.ai/@auth", "registrationOpen": true, "credentialTypes": ["password"] },
  "capabilities": ["live-see", "streaming-talk", "federation"]
}
```

The client uses this to:
- Confirm protocol version compatibility
- Populate address-bar autocomplete with beings
- Render the sign-in surface based on auth-being policy
- Decide which features to enable

Discovery is anonymous-accessible by default. Places may restrict discovery if they choose.

## Backwards compatibility

The legacy `place/routes/api/*` HTTP routes continue serving traffic during migration. They are not part of the four-verb protocol; nothing new is built against them.

Each extension migrates its routes in its own pass. When an extension is migrated:
- Its existing HTTP routes are retired.
- Its mutations move to `do set-meta` against its namespace.
- Its reads move into the Position Description or are SEE-fetchable as matters.
- Its tools (for AI use) keep using the existing tool registry; tools are not protocol verbs.

The legacy WS chat handler (`place/seed/ws/websocket.js`) keeps running until SUMMON is proven and the migration completes. There may be a transition window where both chat handlers run; clients use the new one.

## Implementation layout

The new protocol lives in `place/ibp/`. Verb handlers are in `place/ibp/verbs/`:

- `place/ibp/verbs/see.js` SEE handler (one-shot and live)
- `place/ibp/verbs/do.js` DO action dispatcher
- `place/ibp/verbs/talk.js` SUMMON with inbox append and summoning trigger
- `place/ibp/verbs/be.js` BE operations via auth-being

Shared utilities:

- `place/ibp/address.js` IBPA parser + server-context injection (existing)
- `place/ibp/resolver.js` IBPA to position resolution (existing, internal only)
- `place/ibp/descriptor.js` Position Description builder (existing, extended)
- `place/ibp/inbox.js` inbox kernel helpers (new)
- `place/ibp/errors.js` PortalError + error codes (existing, extended)
- `place/ibp/actions/` one file per kernel-named DO action (new)

Wiring:

- `place/ibp/protocol.js` registers the four ops on the Socket.IO instance
- `place/ibp/bootstrap-route.js` the single HTTP bootstrap endpoint
- `place/ibp/index.js` boot hook from `genesis.js`

## Versioning

The protocol carries a version in the bootstrap response. Major versions are breaking; minor versions add fields. The client's first SEE after connect should check the version against its supported range:

```
client connects
client -> ibp:see { position: "<place>/.discovery" }
client checks protocolVersion against its supported list
client proceeds or shows a version-mismatch error
```

This pass is `1.0`. Federation extends to `1.1` when Canopy details place.

## See also

- [protocol.md](protocol.md) the conceptual four-verb spec
- [being-summoned.md](being-summoned.md) the architectural framing
- [message-envelope.md](message-envelope.md) SUMMON details
- [inbox.md](inbox.md) inbox model
- [do-actions.md](do-actions.md) DO action catalog
- [be-operations.md](be-operations.md) identity bootstrap
- [position-description.md](position-description.md) SEE response shape
- [ibp-address.md](ibp-address.md) IBPA grammar
