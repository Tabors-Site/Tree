# BE Operations

The BE verb manages be-er identity. This document specifies the four operations (register, claim, release, switch) and the auth-being model that handles them.

Read [protocol.md](protocol.md) first.

## Why BE is its own verb

SEE, DO, and TALK all operate from a be-er upon the world. They require an established identity. BE is the only verb that operates **upon the be-er itself**, and it is the only verb that handles unestablished requesters.

The `@` in a Portal Address points at the be-er, not at an action. Identity operations act on what the `@` refers to. They are categorically different from acting in the world as an established be-er.

Folding BE into DO would require an `anonymous-from` exception to the protocol's "identity required" rule and would conflate two different verb purposes. Keeping BE separate is cleaner.

## The four operations

```
{ verb: "be", operation: "register" | "claim" | "release" | "switch", land: "<land>", identity?, payload? }
```

The `land` field names where identity is being established or changed. Identity bootstrap happens at land level; the auth-being at that land processes the operation, but the verb knows where to dispatch (the auth-being is implicit). The auth-being is still a real being inspectable via SEE on its stance (typically `<land>/@auth`); lands choose the qualifier name and may install custom auth-being embodiments per land.

### register

Creates a new be-er at a land.

```
{
  verb:      "be",
  operation: "register",
  land:      "<land>",
  payload:   { username, password, ...land-specific fields }
}
```

Addressed at the land's auth-being. The payload carries credentials and any registration data the land's auth-being requires (e.g., invite code, real name, contract acceptance).

Returns: `{ identityToken, beingAddress }`. The new be-er is established for this session; subsequent SEE/DO/TALK use the returned token.

Errors: `FORBIDDEN` (registration not open on this land), `RESOURCE_CONFLICT` (username taken), `INVALID_INPUT` (missing required fields).

### claim

Logs in as an existing be-er.

```
{
  verb:      "be",
  operation: "claim",
  land:      "<land>",
  payload:   { username, password }
}
```

Or with alternative credentials (depends on land's auth-being):
```
{
  verb:      "be",
  operation: "claim",
  land:      "<land>",
  payload:   { username, token: <federated identity proof> }
}
```

Returns: `{ identityToken, beingAddress }`. The session now holds this be-er.

Errors: `UNAUTHORIZED` (credentials invalid), `USER_NOT_FOUND` (username does not exist).

### release

Logs out. Invalidates the identity token.

```
{
  verb:      "be",
  operation: "release",
  land:      "<land>",
  identity:  <token>
}
```

Returns: `{ released: true }`. The token is no longer valid for subsequent operations.

If the session holds multiple be-ers (multi-identity portal sessions), `release` affects only the be-er bound to the land in the address. Use `switch` to change active be-er without releasing.

### switch

Swaps the active be-er within a session that holds multiple.

```
{
  verb:      "be",
  operation: "switch",
  land:      "<land>",
  from:      "<stance>",
  to:        "<stance>",
  identity:  <token-for-to>
}
```

`from` is the currently-active stance. `to` is the new active stance. Both must be be-ers the session already holds (claimed in this or a prior session and still valid). The identity token for the `to` stance is provided to confirm the session has it.

Returns: `{ active: <to> }`.

This is the operation behind "switch identity" in the portal's identity panel. It does not re-authenticate; it just selects which held be-er is the active one for new requests.

## The auth-being

Every land has a per-land auth-being. By convention, addressable as `<land>/@auth` or `<land>/@identity` (land's choice). It handles BE operations.

The auth-being is **a real being.** It has a position (the land root), an embodiment (`auth` or similar), an inbox, a record. It is inspectable like any being. A SEE on `<land>/@auth` returns a descriptor showing the auth-being's policies (open vs. closed registration, supported credential types, etc.).

This matters because:

- **Each land can specialize its auth-being.** A public land's auth-being welcomes any registration. A private land's may require an invite code. A research land's may bind the be-er to a contract or NDA. A land with values about who can be there expresses those values through its auth-being.
- **The auth-being can be replaced.** Lands install custom auth embodiments to change registration flow, credential schemes, identity verification, etc. The protocol stays uniform.
- **The auth-being can have its own inbox.** A registration that requires manual approval can be a TALK from the auth-being to the land operator with `intent: chat`, awaiting a response.

The auth-being's embodiment honors the BE operations as protocol-level interactions. The protocol does not deliver BE operations as TALK messages; they are dispatched directly to the auth-being's BE handler. But the auth-being may TALK to others as part of processing (e.g., notifying admins of new registrations).

## Identity tokens

The identity token returned by `register` and `claim` is the bearer credential for SEE/DO/TALK.

The protocol does not specify the token format. The land may issue:
- JWTs (current TreeOS convention)
- Opaque tokens backed by a session store
- Cryptographic signatures with public-key identity

Whatever the format, the contract is:
- Returned by `register` and `claim`
- Carried by the client on subsequent SEE/DO/TALK
- Invalidated by `release`
- Verified by the land on every request

Tokens are scoped to a single land. A session that holds be-ers across multiple lands holds multiple tokens.

## Multi-be-er sessions

A portal session may hold many be-ers simultaneously: identities on different lands, multiple identities on the same land (e.g., personal + work). The portal's identity panel lists them; `switch` selects the active one.

The protocol does not store this. It is client-side state. The portal client tracks `{ activeBeing, beings: [{ stance, identityToken, land }, ...] }` and adjusts the `identity` field of outgoing requests based on which be-er is active.

`switch` is a client-side action (selecting a different held identity) that confirms with the land. Some lands may require re-claiming if too much time has passed; the land may respond to `switch` with `UNAUTHORIZED` and the client should fall back to `claim`.

## Federated identities

A be-er on Land A can address a position on Land B. The protocol envelope carries the home-land identity:

```
{
  verb:        "see",
  position:    "land-b.example/some-tree",
  identity:    <token from Land A>,
  homeLand:    "land-a.example"
}
```

Land B verifies the federated identity by contacting Land A (or via Canopy signature). The auth-being on Land B decides whether to accept federated identities and what permissions they have.

Federation BE operations:
- A federated `claim` lets a be-er on Land A establish a session token on Land B without re-registering.
- A federated `register` is rare; usually a be-er registers locally on each land they want to inhabit.

Federation details belong to the Canopy spec and are out of scope here. The protocol envelope reserves the shape.

## Switching as a TALK to the auth-being

`switch` is structurally a BE operation, but a more elaborate identity flow (proving identity through challenge-response, multi-factor, etc.) may use TALK to the auth-being:

```
{
  verb:    "talk",
  stance:  "<land>/@auth",
  identity: <token>,
  message: {
    from:        "<current stance>",
    content:     { request: "switch-to", target: "<stance>" },
    intent:      "chat",
    correlation: ...
  }
}
```

The auth-being can respond with a challenge, await an answer, and complete the switch through a final BE operation. The protocol supports both: `BE switch` for simple held-be-er selection, TALK + final BE for complex flows.

## Anonymous SEE

The protocol allows SEE without identity for explicitly anonymous-accessible addresses:

```
{ verb: "see", position: "<land>/.discovery" }
{ verb: "see", position: "<land>/" }  // land zone, public visibility
```

The land's auth-being declares which addresses permit anonymous SEE. The protocol does not require an `anonymous` be-er; it simply allows the `identity` field to be omitted for these specific addresses.

DO and TALK never accept anonymous requests. BE register/claim are how anonymous becomes established.

## Errors

See [protocol.md](protocol.md) for the full error vocabulary. The codes BE most commonly returns:

| Code | When |
|---|---|
| `FORBIDDEN` | registration closed on this land; switch to a non-held be-er; release on an already-released token |
| `UNAUTHORIZED` | claim with invalid credentials |
| `SESSION_EXPIRED` | switch with an expired token |
| `USER_NOT_FOUND` | claim or release on an unknown username |
| `INVALID_INPUT` | register missing required fields per the auth-being's policy |
| `RESOURCE_CONFLICT` | register with a username already taken on this land |
| `ADDRESS_PARSE_ERROR` | the address field could not be parsed |
| `EMBODIMENT_UNAVAILABLE` | the auth-being qualifier in the address is not recognized on this land |
| `RATE_LIMITED` | throttled (often applied to register and claim to limit credential probing) |
| `INTERNAL` | server error |

Also relevant to BE error rendering: when a BE error includes a `detail.suggestedIdentities` array, the portal client surfaces those as quick-switch options. When a `RESOURCE_CONFLICT` carries `detail.field: "username"`, the portal highlights the username field in the registration form.

## Example flows

### First-time use of a portal client

```
client opens
client -> GET /.well-known/treeos-portal   // HTTP bootstrap
client receives { ws: wss://treeos.ai/ws, version }

client opens WS

client -> { verb: "see", position: "treeos.ai/.discovery" }   // no identity
client receives capabilities, knows registration is open

client renders sign-in surface

client -> { verb: "be", operation: "register", land: "treeos.ai", payload: { username: "tabor", password: "..." } }
client receives { identityToken, beingAddress: "tabor@treeos.ai" }

client now has an identity. All subsequent SEE/DO/TALK use the token.
```

### Returning user

```
client -> { verb: "see", position: "treeos.ai/.discovery" }
client -> { verb: "be", operation: "claim", land: "treeos.ai", payload: { username: "tabor", password: "..." } }
client receives { identityToken, beingAddress: "tabor@treeos.ai" }
```

### Adding a second identity

Already signed in as tabor. Wants to also hold a work identity:

```
client (still as tabor) -> { verb: "be", operation: "claim", land: "work.example", payload: { username: "tabor-work", ... } }
client receives second token; now holds two be-ers
client decides which is active via switch
```

### Logout

```
client -> { verb: "be", operation: "release", land: "treeos.ai", identity: <token> }
client receives { released: true }
```

Token invalidated; client may stop using it.

## See also

- [protocol.md](protocol.md) the four-verb spec
- [identity.md](identity.md) the identity-first session model
- [portal-address.md](portal-address.md) what `@auth` and stance addresses mean
- [server-protocol.md](server-protocol.md) wire-level rules for the be op
