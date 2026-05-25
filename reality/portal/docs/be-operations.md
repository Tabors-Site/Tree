# BE Operations

The BE verb manages be-er identity. This document specifies the four operations (register, claim, release, switch) and the auth-being model that handles them.

Read [protocol.md](protocol.md) first.

## Why BE is its own verb

SEE, DO, and SUMMON all operate from a be-er upon the world. They require an established identity. BE is the only verb that operates **upon the be-er itself**, and it is the only verb that handles unestablished requesters.

The `@` in an IBP Address points at the be-er, not at an action. Identity operations act on what the `@` refers to. They are categorically different from acting in the world as an established be-er.

Folding BE into DO would require an `anonymous-from` exception to the protocol's "identity required" rule and would conflate two different verb purposes. Keeping BE separate is cleaner.

## The four operations

The BE envelope always carries a `stance`. Self-identity operations target stances. For fresh registration, the stance is the place's auth-being (typically `<place>/@auth`); the auth-being processes the credential creation.

```
{ verb: "be", operation: "register" | "claim" | "release" | "switch", stance: "<stance>", identity?, payload? }
```

The auth-being at the stance's place processes the operation. It is a real being inspectable via SEE on its stance; places choose the qualifier name (`@auth`, `@identity`) and may install custom auth-being beings per place.

### register

Creates a new be-er at a place. There is no prior stance, so the address is the place's auth-being.

```
{
  verb:      "be",
  operation: "register",
  stance:    "<place>/@auth",
  payload:   { username, password, ...place-specific fields }
}
```

The payload carries credentials and any registration data the place's auth-being requires (e.g., invite code, real name, contract acceptance).

Returns: `{ identityToken, beingAddress }`. The new be-er is established for this session; subsequent SEE/DO/SUMMON use the returned token.

Errors: `FORBIDDEN` (registration not open on this place), `RESOURCE_CONFLICT` (username taken), `INVALID_INPUT` (missing required fields).

### claim

Logs in. Two entry forms:

**Credential-based** (no prior stance; address is the auth-being):

```
{
  verb:      "be",
  operation: "claim",
  stance:    "<place>/@auth",
  payload:   { username, password }
}
```

**Token re-claim** (you have a previously-held stance and a still-valid token; re-establishes the active claim):

```
{
  verb:      "be",
  operation: "claim",
  stance:    "<held stance>",
  identity:  <token>
}
```

Returns: `{ identityToken, beingAddress }`. The session now holds this be-er.

Errors: `UNAUTHORIZED` (credentials invalid or token expired), `USER_NOT_FOUND` (username does not exist).

### release

Releases a held stance.

```
{
  verb:      "be",
  operation: "release",
  stance:    "<held stance>",
  identity:  <token>
}
```

Returns: `{ released: true }`. The token is no longer valid for subsequent operations.

If the session holds multiple stances, `release` affects only the named stance. Use `switch` to change the active stance without releasing any.

### switch

Swaps the active be-er within a session that holds multiple. The address is the target stance.

```
{
  verb:      "be",
  operation: "switch",
  stance:    "<target stance>",
  from:      "<currently-active stance>",
  identity:  <token-for-target>
}
```

Both stances must already be held by the session (claimed in this or a prior session and still valid). The identity token for the target stance confirms the session has it.

Returns: `{ active: "<target stance>" }`.

This is the operation behind "switch identity" in the portal's identity panel. It does not re-authenticate; it just selects which held be-er is the active one for new requests.

## The auth-being

Every place has a per-place auth-being. By convention, addressable as `<place>/@auth` or `<place>/@identity` (place's choice). It handles BE operations.

The auth-being is **a real being.** It has a position (the place root), an being (`auth` or similar), an inbox, a record. It is inspectable like any being. A SEE on `<place>/@auth` returns a descriptor showing the auth-being's policies (open vs. closed registration, supported credential types, etc.).

This matters because:

- **Each place can specialize its auth-being.** A public place's auth-being welcomes any registration. A private place's may require an invite code. A research place's may bind the be-er to a contract or NDA. A place with values about who can be there expresses those values through its auth-being.
- **The auth-being can be replaced.** Places install custom auth beings to change registration flow, credential schemes, identity verification, etc. The protocol stays uniform.
- **The auth-being can have its own inbox.** A registration that requires manual approval can be a SUMMON from the auth-being to the place operator with `intent: chat`, awaiting a response.

The auth-being's being honors the BE operations as protocol-level interactions. The protocol does not deliver BE operations as SUMMON messages; they are dispatched directly to the auth-being's BE handler. But the auth-being may SUMMON to others as part of processing (e.g., notifying admins of new registrations).

## Identity tokens

The identity token returned by `register` and `claim` is the bearer credential for SEE/DO/SUMMON.

The protocol does not specify the token format. The place may issue:
- JWTs (current TreeOS convention)
- Opaque tokens backed by a session store
- Cryptographic signatures with public-key identity

Whatever the format, the contract is:
- Returned by `register` and `claim`
- Carried by the client on subsequent SEE/DO/SUMMON
- Invalidated by `release`
- Verified by the place on every request

Tokens are scoped to a single place. A session that holds be-ers across multiple places holds multiple tokens.

## Multi-be-er sessions

A portal session may hold many be-ers simultaneously: identities on different places, multiple identities on the same place (e.g., personal + work). The portal's identity panel lists them; `switch` selects the active one.

The protocol does not store this. It is client-side state. The portal client tracks `{ activeBeing, beings: [{ stance, identityToken, place }, ...] }` and adjusts the `identity` field of outgoing requests based on which be-er is active.

`switch` is a client-side action (selecting a different held identity) that confirms with the place. Some places may require re-claiming if too much time has passed; the place may respond to `switch` with `UNAUTHORIZED` and the client should fall back to `claim`.

## Federated identities

A be-er on Place A can address a position on Place B. The protocol envelope carries the home-place identity:

```
{
  verb:        "see",
  position:    "place-b.example/some-tree",
  identity:    <token from Place A>,
  homePlace:    "place-a.example"
}
```

Place B verifies the federated identity by contacting Place A (or via Canopy signature). The auth-being on Place B decides whether to accept federated identities and what permissions they have.

Federation BE operations:
- A federated `claim` lets a be-er on Place A establish a session token on Place B without re-registering.
- A federated `register` is rare; usually a be-er registers locally on each place they want to inhabit.

Federation details belong to the Canopy spec and are out of scope here. The protocol envelope reserves the shape.

## Switching as a SUMMON to the auth-being

`switch` is structurally a BE operation, but a more elaborate identity flow (proving identity through challenge-response, multi-factor, etc.) may use SUMMON to the auth-being:

```
{
  verb:    "talk",
  stance:  "<place>/@auth",
  identity: <token>,
  message: {
    from:        "<current stance>",
    content:     { request: "switch-to", target: "<stance>" },
    intent:      "chat",
    correlation: ...
  }
}
```

The auth-being can respond with a challenge, await an answer, and complete the switch through a final BE operation. The protocol supports both: `BE switch` for simple held-be-er selection, SUMMON + final BE for complex flows.

## The arrival stance

An unestablished requester is in the **arrival stance** at the place. Arrival is not a protocol special case; it is a regular stance whose permissions the place defines. See [protocol.md](protocol.md#the-arrival-stance) for the full framing.

The protocol commits to:

1. Every place has an arrival stance.
2. BE addressed at the auth-being is always permitted from the arrival stance.

Beyond those two, places configure what an arrival can do. Some places are open: arrivals SEE public scopes, SUMMON to a public host being, even DO bounded things like leave a guestbook entry. Some places are closed: arrivals can only BE.

Configuration lives at `<place>/` under `metadata.beings.arrival.permissions`:

```
{
  see:  { allowed: [...], denied: [...] },
  do:   { allowed: [{ action, scope, ... }] },
  summon: { allowed: ["@auth", "@host", ...] },
  be:   { allowed: ["register", "claim"] }
}
```

Authorization checks arrival permissions on every request from an unestablished requester. No special-case logic.

The discovery position (`<place>/.discovery`) is implicitly readable by arrivals on every place regardless of configuration, because clients need to learn the place's capabilities before they can engage in any other way.

## Errors

See [protocol.md](protocol.md) for the full error vocabulary. The codes BE most commonly returns:

| Code | When |
|---|---|
| `FORBIDDEN` | registration closed on this place; switch to a non-held be-er; release on an already-released token |
| `UNAUTHORIZED` | claim with invalid credentials |
| `SESSION_EXPIRED` | switch with an expired token |
| `USER_NOT_FOUND` | claim or release on an unknown username |
| `INVALID_INPUT` | register missing required fields per the auth-being's policy |
| `RESOURCE_CONFLICT` | register with a username already taken on this place |
| `ADDRESS_PARSE_ERROR` | the address field could not be parsed |
| `EMBODIMENT_UNAVAILABLE` | the auth-being qualifier in the address is not recognized on this place |
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

client -> { verb: "be", operation: "register", place: "treeos.ai", payload: { username: "tabor", password: "..." } }
client receives { identityToken, beingAddress: "tabor@treeos.ai" }

client now has an identity. All subsequent SEE/DO/SUMMON use the token.
```

### Returning user

```
client -> { verb: "see", position: "treeos.ai/.discovery" }
client -> { verb: "be", operation: "claim", place: "treeos.ai", payload: { username: "tabor", password: "..." } }
client receives { identityToken, beingAddress: "tabor@treeos.ai" }
```

### Adding a second identity

Already signed in as tabor. Wants to also hold a work identity:

```
client (still as tabor) -> { verb: "be", operation: "claim", place: "work.example", payload: { username: "tabor-work", ... } }
client receives second token; now holds two be-ers
client decides which is active via switch
```

### Logout

```
client -> { verb: "be", operation: "release", stance: "tabor@treeos.ai", identity: <token> }
client receives { released: true }
```

Token invalidated; client may stop using it.

## See also

- [protocol.md](protocol.md) the four-verb spec
- [identity.md](identity.md) the identity-first session model
- [ibp-address.md](ibp-address.md) what `@auth` and stance addresses mean
- [server-protocol.md](server-protocol.md) wire-level rules for the be op
