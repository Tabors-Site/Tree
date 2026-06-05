# IBP Federation (Diff B — deferred)

This document captures the cross-reality work that Diff A explicitly does
NOT include. Diff A retired the legacy `envelope.identity` field and made
the address's left stance the canonical identity carrier for LOCAL calls.
Cross-reality calls need additional architectural surface, captured here
so the next pass has a clean starting point.

## Doctrinal landing

IBP is the inter-being protocol. The "inter" crosses realities. A being
in `treeos.ai` can SEE / DO / SUMMON / BE against a being in
`othersite.ai` directly via the same four verbs. The portal (visual
rendering convention) signals "this being you see is not co-located",
but the protocol underneath is just IBP routing envelopes to the
foreign substrate.

A BE:birth through a cross-reality call mints the being in the
destination reality. Beings live in exactly one reality at a time;
they never "enter" another.

## Three-layer auth (cross-reality)

| Layer       | Where     | Proves                                                                |
|-------------|-----------|-----------------------------------------------------------------------|
| Local auth  | Sender    | "I am tabor on treeos.ai" — socket token / session                    |
| Federation  | Envelope  | "This envelope genuinely originates from treeos.ai" — canopy sig      |
| Authorize   | Receiver  | "tabor on treeos.ai may SEE this space" — foreign substrate's rules   |

Each check at the right place. The signature on the envelope is provenance,
NOT identity. Identity lives in `address.left`. The signature only
verifies that the named reality actually authorized the call.

## Envelope shape (after Diff B)

```js
{
  id, verb, address, payload,
  signature?: {
    sig:      string,  // detached signature over the canonical envelope bytes
    signedAt: string,  // iso8601
  }
  // signature absent  → local call, socket auth covers it
  // signature present → cross-reality call, verified against
  //                     <address.left.reality>'s published key
}
```

After Diff A landed, the envelope is:
```js
{ id, verb, address, payload }
```

Diff B adds the optional `signature` block. NO `identity` field returns —
identity is in `address.left` regardless of whether the call is local or
cross-reality.

### IDs in the cross-reality envelope

The envelope payload carries bare-string IDs (`params.value` on
`set-being:position`, `params.spec.parent` on `create-space`,
`params.to` on `move`, etc.). The substrate's schemas know which
fields hold which kind of aggregate; the wire doesn't tag them.

Federation propagates **facts**, not bundles of state — and a fact
carries its target kind in the envelope (`target: { kind, id }`).
The receiver's reducer knows what each `params` field means from the
fact's `(verb, action, target.kind)` triple. No type-tagging in the
payload is needed.

The case where ID-tagging earns its place is **replicate** (and the
future clone): a foreign-reality export bundle of beings/spaces/matter
arriving at a fresh local namespace needs a walker to find every
aggregate reference in the bundle and remap to new local IDs. That
walker reads tagged `{ __ref, id }` values out of bundle content
where the receiving substrate doesn't have schema knowledge for the
foreign data shapes. See `seed/REFS.md` for the walker primitive
and `seed/publishing.md` for the export/replicate flow.

Federation itself (fact propagation) does not bundle this kind of
content. It rides the substrate's existing structural typing.

## What Diff B needs to build

### 1. Cross-reality router

Today's wire dispatcher in `protocols/ibp/verbs/*.js` assumes the address
is local. After Diff A, the verb dispatcher refuses foreign addresses
explicitly. Diff B adds the routing decision:

```js
const targetReality = expanded.left.reality;
if (targetReality === getRealityDomain()) {
  // Local dispatch (current behavior).
} else {
  // Foreign dispatch: forward via canopy with signed envelope.
  return await canopy.forwardSigned(envelope, targetReality);
}
```

Canopy already has a `forwardToPeer` function in
[protocols/ibp/canopy.js](canopy.js); Diff B extends it to carry IBP
envelopes (not just discovery/canopy frames) and to apply/verify
signatures.

### 2. Signature mechanism

Each reality holds a long-lived signing keypair. The public key is
published at `<reality>/.well-known/treeos-portal` (already exists for
discovery; extend the response shape).

Sender: serializes the canonical envelope bytes, signs with the
reality's private key, attaches `signature = { sig, signedAt }` to the
envelope.

Receiver: fetches `<address.left.reality>/.well-known/treeos-portal`,
extracts the public key, verifies the signature against canonical
envelope bytes. Reject `INVALID_SIGNATURE` if verification fails.

`signedAt` provides replay protection: reject envelopes whose
`signedAt` is more than N seconds old (configurable; suggest 60s).

### 3. Foreign-stance authorization

The current `authorize.js` evaluates rules against stance properties
derived from local data (Being row, ownership chain, role registry,
home relations). A foreign asker has none of these locally.

Foreign-stance properties must be derivable from:
- `address.left.reality` — the home reality (string)
- `address.left.beingId` — the canonical uuid in their reality
- `address.left.branch` — their branch at time of call
- The verified signature — proof the call genuinely originates

Proposed foreign-stance properties for `requires` matching:
```js
{
  arrival:            false,      // foreign callers are not arrival
  homeOnThisReality:  false,      // by definition
  foreign:            true,       // marks this stance as cross-reality
  homeReality:        "<dns>",    // their reality
  signedBy:           "<dns>",    // verified signer (same as homeReality)
}
```

Per-position permission rules can opt in to foreign askers explicitly:
```js
qualities.permissions.see["*"] = {
  requires: { foreign: true, homeReality: "trusted-peer.ai" },
};
```

Default: foreign askers refused at every position unless a rule
explicitly admits them. Existing `arrival: false` rules continue to
reject foreign askers (since `arrival: false` requires not-arrival,
and foreign-but-not-arrival evaluates true only if a foreign-aware
rule admits it explicitly).

### 4. Public id-to-name directory

Foreign beings appearing in local faces must have their names
resolvable for the portal to render them.

Add two SEE-callable endpoints on every reality:
- `<reality>/.beings/<beingId>` — `{ id, name, role?, publicly-safe metadata }`
- `<reality>/.spaces/<spaceId>` — `{ id, name, path, publicly-safe metadata }`

These must be callable WITHOUT local auth (so any peer can resolve
display info for ids that appear in their faces). Privacy controls:
realities choose what to expose; defaults expose just `id` + `name`.
A being can be marked private — endpoint returns 404 even if the id
exists.

Local cache: when receiving a SEE descriptor that contains foreign
ids, the local wire kicks off a background fetch against the foreign
reality's directory and caches the (id → name) mapping. TTL ~5
minutes; refresh on cache miss.

### 5. Fact attribution for cross-reality calls

The Fact schema already has `homeReality` and `wasRemote` fields.
Diff B wires them properly:

- A fact stamped on the FOREIGN reality's reels in response to an
  IBP call from local-reality carries `homeReality: <our-reality>`,
  `wasRemote: true` on the foreign side.
- A fact stamped on OUR reels (because a foreign reality's call
  caused work to happen here) carries `homeReality: <foreign-reality>`,
  `wasRemote: true`.

Provenance survives the fact chain. Replay-from-genesis reconstructs
who-acted-from-where.

### 6. Cross-reality branch semantics

Open question: when a being on `treeos.ai#1` calls a verb against
`othersite.ai`, what branch does the foreign reality's substrate use?

Options:
- **(a)** Always main: foreign reality always processes on `#0` regardless
  of caller's branch. Branches stay reality-local.
- **(b)** Mirror: foreign reality processes on the SAME branch path
  the caller is on. Requires branches to mean the same thing across
  realities (probably not).
- **(c)** Address-typed: caller types the foreign branch explicitly
  in the address (`othersite.ai#3/...`). Default if branch omitted in
  cross-reality address: main.

Recommendation: **(c)**. Each reality owns its branch namespace; the
caller addresses a specific branch on the foreign reality. Branch
qualifier in cross-reality addresses is independent of the caller's
current branch.

## What Diff A delivered (already done)

For reference, Diff A retired:
- `envelope.identity` field (now part of `address.left`)
- Wire-side findByName lookups during verb dispatch
- Two separate sources of truth for "who is acting" (socket + identity field)

Diff A added:
- `beingId` field on the expanded stance, resolved at the wire boundary
- Impersonation refusal: `socket.beingId === expanded.left.beingId`
- The doctrine that the address IS the actor

Diff A did NOT touch:
- Foreign-reality addresses (still refused with INVALID_INPUT for now)
- Federation signature machinery (`signature` field reserved but not added)
- Cross-reality canopy routing for IBP envelopes (only the existing
  discovery/peer-list canopy works today)
- Public directory slices

## Suggested implementation order for Diff B

1. **Signature mechanism + key publishing** — the easiest piece; everything else assumes this works.
2. **Cross-reality router** in wire verbs — the dispatch fork that decides local vs forward.
3. **Public directory slices** — small additive endpoints, no breaking change.
4. **Foreign-stance authorization** — needs design round on default rules.
5. **Fact attribution wiring** — small change to fact emission paths.
6. **Cross-reality branch semantics** — decision needed before any of this ships, but the implementation is small.

Probably two diffs within B: a "federation transport" diff (signature,
router, directory) and a "federation authorization" diff (foreign-stance
rules, default permissions, fact attribution).
