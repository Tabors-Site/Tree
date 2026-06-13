# HORIZON: the public directory

> _"Horizon holds what is meant to be copied, never what is meant to continue."_

Horizon is where the network meets: the public directory where realities
find each other and where published work lives. It is one server today. It
is meant to be MANY: anyone can run one, mirrors strengthen the network,
and nothing in the design ever requires trusting a horizon. This file pins
what a horizon is, what its catalog holds, what its catalog refuses, and
why the whole thing stays safe when the directory itself is untrusted.

Read alongside [GRAFT-AND-SEED.md](GRAFT-AND-SEED.md) (what moves between
realities) and [IDENTITY.md](IDENTITY.md) (why keys make all of this
verifiable).

## Horizon is a reality, not a server

The first Horizon was a standalone server with its own REST dialect, its
own auth, its own database. That shape is retired. A horizon is a TreeOS
REALITY running the `horizon` extension. A registrar being holds the
catalog as its folded state; publishers are peer realities. Every publish
and every delist is a fact on the registrar's reel, so the catalog's
entire history is audited by construction.

> _What v0.1 built._ The catalog lives in one registrar being's folded
> qualities (publisher to name to versions, each name carrying a chained
> pointer claim). This follows from the moment model: a moment seals
> exactly ONE write, and the fold lands at seal, so a synchronous publish
> cannot create a space, then a listing inside it, then a pointer. One
> self-authorized write per publish is the shape that fits, and it is the
> same pattern the federation-manager uses. The registrar OWNS its catalog
> space (the seed sets the owner), which is how its write authorizes. A
> space-per-publisher tree of matter is the SCALING shape, not the v0.1
> shape; it shards the single registrar into per-publisher registrars or a
> SEE-projection when one being's qualities grow too large.

This one decision buys the rest:

- **The protocol IS the API.** Browsing is SEE. Publishing is DO. There is
  no second wire dialect to maintain, and the directory inherits every
  hardening the wire already has: canopy signatures, being signatures,
  sealed sessions, replay refusal.
- **"Anyone can run one" means "plant a reality."** The horizon extension
  itself ships as a seed, distributed through a horizon. The distribution
  story distributes itself.
- **Operating a horizon grants nothing.** A horizon operator holds the keys
  of their own reality and no one else's. The catalog they host is other
  realities' signed work; the worst a dishonest operator can do is decline
  to show something, and another horizon will show it.

## Catalog through IBP, bytes through the content door

Inside a reality the rule is: facts carry refs, never bytes; owned bytes
live content-addressed in CAS. Horizon is the same rule stretched across
the wire.

- The IBP envelope carries the MANIFEST: name, version, publisher,
  signature, dependency list, and the hash of every asset.
- The BYTES (code bundles, models, sounds, anything large) travel the
  content door, fetched by hash, verified by hashing on arrival.

So "everything through IBP" means every act of publishing, browsing,
resolving, and delisting is an IBP verb. It never means binary blobs ride
inside envelopes. The envelope names the bytes; the content door moves
them; the hash proves them.

## The catalog holds three things, and they are all content

Extensions, roleflows, and seeds are one kind of thing at the identity
layer: HASH-ADDRESSED templates, signed by their publisher, meant to be
copied. (The doctrine line from [GRAFT-AND-SEED.md](GRAFT-AND-SEED.md):
the template is content-addressed, the entity is key-addressed.)

- **Extensions.** A code bundle plus its owned matter: the models, sounds,
  and other assets an extension carries. The listing's manifest names every
  asset by hash; the assets are CAS blobs any horizon can mirror.
- **Roleflows.** A template of behavior: composition data over the role
  machinery realities already run. Roles are registered by extensions; a
  roleflow declares WHICH roles and HOW they compose, with a `requires`
  manifest naming the extensions that provide them, by hash or by
  publisher-scoped name and version. A roleflow installs into an EXISTING
  reality. Install resolves the manifest: the planting reality pulls each
  requirement by hash, from this horizon or any other. This is the
  youngest of the three types: its exact contents and install semantics
  need their own design pass before it is built.
- **Seeds.** A template of structure: a shell world, fresh ids on planting,
  per [GRAFT-AND-SEED.md](GRAFT-AND-SEED.md).

**Versioning is hashing.** Every version of anything is a new hash,
immutable forever. The mutable layer is a NAME POINTER, a publisher-signed
claim that "the current food@1.x is hash H." Moving the pointer is a new
signed claim; the old hash never stops being the old version.

**A publisher can lie only about pointers, and provably.** Nothing in the
protocol prevents a publisher from signing two conflicting claims for the
same name and version. But installs pull by HASH, so equivocation can
confuse a choice, never the content chosen. And pointer claims CHAIN: each
new claim references the hash of the claim before it, so two claims with
one parent are a visible fork, provable the same way a forked act-chain
is. Equivocation is detectable by any mirror and damages exactly one
thing: that publisher's name.

**Retirement is a pointer state, not a deletion.** A publisher marks a
listing unmaintained, or points at a successor, with the same signed
pointer machinery. That is distinct from DELISTING (one horizon declining
to show) and from DECAY (mirrors hold bytes per their own retention;
content the network stops caring about fades from availability). The hash
never stops naming what it names; only the bytes' availability ages.

**Names are publisher-scoped.** There is no global namespace to squat. A
name means `(publisher, name)`, where the publisher is a reality identity
(one operator, one land). Horizons INDEX names; they never arbitrate them.
Two publishers can both ship a `food`; the catalog shows whose is whose,
and the publisher signature proves it.

**Browsing is by ecosystem, not flat lists.** Listings declare what they
are built for (`builtFor`), and that declaration is a claim referencing
ANOTHER LISTING: an OS, a bundle, an extension. The taxonomy is the graph
of those claims, derived automatically; no horizon maintains a blessed
category list, so categories cannot become a soft centralization lever.
(Search and ranking on top of this graph are portal work, out of scope
here.)

## The catalog refuses grafts

A graft is not content. It is an AGENT: a being's key and chain, meant for
continuing, not for copying. A public catalog of grafts would make horizons
custodians of identities and biographies, exactly the custody this
architecture refuses. So the pin:

> Horizon catalogs CONTENT. Grafts move PEER TO PEER over the sealed canopy
> wire, between the two realities concerned, and nowhere else.

Two narrow graft-adjacent services are legitimate, and neither is a
catalog:

- **Discovery.** Pointers, not chains: "being X is home at reality Y,"
  "reality Z accepts graft offers." A pointer leaks no history and grants
  no custody.
- **Encrypted escrow.** When two realities are not online at the same
  moment, a sender may park a graft bundle at a horizon ENCRYPTED to the
  receiving reality's key. The horizon stores bytes it cannot read,
  addressed to exactly one key, deleted on pickup or expiry. The same shape
  covers a reality parking its own encrypted genome backup. Opaque storage,
  never a listing. Keys here never rotate, they SUCCEED
  ([IDENTITY.md](IDENTITY.md)), and escrow is designed around that: expiry
  is SHORT, and the sender always keeps the original (escrow is a
  convenience copy, never the only copy). A succession during the window
  just means re-sending to the successor key; an orphaned bundle expires
  unread. Short expiry also bounds the at-rest exposure: a bundle
  encrypted to a key that is later compromised should already be gone.

## Peers find each other here

Federation needs a meeting point, and this is Horizon's second job: the
PEER DIRECTORY.

A peer record is small and self-signed: `{ realityId, baseUrl, lastSeen }`,
signed by the reality it describes. Because a `realityId` IS that reality's
public key ([IDENTITY.md](IDENTITY.md), Cross reality), the directory
cannot lie in any way that matters:

- Point you at a wrong baseUrl, and the canopy handshake fails immediately.
  Whoever answers there cannot sign as that key.
- Forge a record outright, and the record's own signature fails.
- The only lie available is OMISSION, hiding a peer, and any other horizon
  can tell the truth.

Realities register themselves with the horizons they choose, refresh their
own records, and check each other's liveness with an ordinary SEE ping.
First contact needs no key ceremony: knowing the peer record is knowing the
key.

Two honesty notes. A peer record is an ATTESTATION, not an endorsement: it
says "I exist, here," signed by the one who exists, and storing it vouches
for nothing. And because registering costs only a signature, the directory
will accumulate dead and junk records; horizons prune what stops answering
(housekeeping, not curation), and discovery filters on freshness
(`lastSeen`). Spam can clutter a directory; it cannot counterfeit one.

## Turning a reality into a horizon

Every reality already has the FEDERATION half: peering, the canopy wire,
the cross reality verbs. The horizon extension adds the DIRECTORY half:
serve a catalog, serve peer records, mirror other horizons. Any existing
reality can switch the role on and become a directory node. Serving is
opt-in (a directory is a public service, with storage and bandwidth
costs); querying is universal (every reality is a horizon CLIENT, able to
ask any horizon and register itself with the ones it chooses).

There is no standalone type. A dedicated horizon, a reality that does
nothing but directory work, is an operational choice, not a different kind
of thing.

- **The first hello is the only hard moment.** A fresh reality knows
  nobody. Every decentralized network solves this the same way: ship a few
  WELL-KNOWN addresses as defaults. The loader already defaults to
  `https://horizon.treeos.ai`; that single value should become a short,
  overridable list. This centralizes INTRODUCTION and nothing else: the
  default is a door you may knock on first, not an authority.

- **One hello teaches you everything.** SEE any one horizon's peer space
  and you receive every record it holds: realities, and other horizons,
  each record self-signed by the reality it describes. You verify each
  record yourself, so the introducer needs no trust at all. Cache what you
  learned and your own peer list IS your directory from then on; the
  well-known address is never load-bearing again. Knowing one peer is
  knowing the network.

- **Neighborhoods, not one world view.** Horizons choose what they mirror
  (exclusion is their one lever), so the network is overlapping
  neighborhoods rather than one guaranteed global catalog. Any entry point
  shows you its neighborhood; two entry points show you the union. That is
  the design working, not failing: the more horizons, the wider the
  overlap.

And the hard question: what if the DEFAULTS go bad? The list ships in the
reality's config alongside the seed code, updates the way code updates,
and any operator can override it. A captured default cannot forge records,
alter listings, or impersonate anyone; everything it serves still
self-certifies. What it can do is BLIND: show a partial network, an
eclipse. The breakers are plural defaults (independent operators, so the
views union) and out-of-band introduction (paste any peer's address
directly; the directory is a convenience, never a gatekeeper). One honest
hello from anywhere ends the eclipse. The exposure is real but narrow:
introduction, briefly, and nothing else.

## Many horizons, one trust model

Horizons MIRROR each other. Catalog records are publisher-signed and
hash-addressed; peer records are self-signed. Syncing them between horizons
is therefore trivially safe: copy, verify, serve. More horizons means more
availability and less centrality at zero added trust cost. That is the
whole reason the answer to "how many horizons?" is "the more the better."

Honestly: expect a power law. A few well-resourced horizons will hold most
of the catalog with good uptime, and a long tail of small mirrors will
hold slices of it. The architecture does not promise flatness; it promises
REPLACEABILITY. No horizon is required, switching is one config line, and
the big ones stay honest precisely because leaving them is cheap.

The trust model in one line: **a horizon vouches for AVAILABILITY, never
authenticity.** Authenticity travels with the artifact (the publisher
signature, the content hash, the reality key) and is checked by the
receiver, every time, no matter which horizon served it.

Governance follows. A horizon's only lever is EXCLUSION: it can decline to
list. Name that plainly: inclusion is an editorial power, and exercising
it shapes DISCOVERABILITY. But it touches nothing about truth. A horizon
cannot alter what it lists (hashes break), cannot impersonate a publisher
(signatures break), and cannot reach into any reality (it holds no keys
but its own). Delisting from one horizon is not erasure from the network;
it is one mirror declining to mirror, and hidden work is unaltered work,
visible elsewhere.

## How this maps to the code today

The standalone server ([horizon/](../../../horizon/)) is the past tense of
this file. Its extension-registry half is LIVE: the loader
([extensions/loader.js](../../extensions/loader.js)) fetches
`HORIZON_URL/extensions/<name>[/<version>]`, defaulting to
`https://horizon.treeos.ai`. Its health half is DEAD:
[healthCheck.js](../../../horizon/jobs/healthCheck.js) pings
`/canopy/info`, an endpoint realities no longer serve. Peering today is
operator-manual (`registerPeer` in
[protocols/ibp/peers.js](../../protocols/ibp/peers.js) has no live
callers).

The build order, then:

1. The `horizon` extension. BUILT (v0.1):
   [extensions/horizon/](../../extensions/horizon/). The registrar role
   holds the catalog in its own qualities; publish-listing and
   retire-listing are SUMMON intents; chained pointer claims live in
   [lib/claims.js](../../extensions/horizon/lib/claims.js); delist is the
   operator's DO op; the catalog plants from
   [seeds/catalog.seed.json](../../extensions/horizon/seeds/catalog.seed.json).
   Extensions and seeds publish; roleflow is refused pending its design
   pass. Proven end to end by
   [.test/e2e/horizon-catalog-e2e.mjs](../../.test/e2e/horizon-catalog-e2e.mjs)
   (publish, immutability, pointer chaining, retire, publisher-scoping,
   delist).
2. The loader's fetch path moves from the legacy routes to SEE on a horizon
   reality plus content-door pulls by hash.
3. Peer records land in the same catalog: self-registration over the wire,
   SEE-ping liveness, retiring the `/canopy/info` job, and `HORIZON_URL`
   generalizing to a short default list.
4. Roleflow as a listing type with `requires` resolution at install, after
   its own design pass settles contents and install semantics.
5. Escrow last, if at all. It is storage, not catalog, and nothing above
   depends on it.

### Two seam findings from building v0.1

Building the registrar surfaced two gaps in the extension model. Both are
real, both are reported here rather than papered over, and neither blocks
v0.1.

- **No public-summon path for an extension being.** A canopy-verified
  foreign publisher reaches the registrar through the arrival floor (the
  cross-reality fallback in [roleAuth.js](../../seed/ibp/roleAuth.js)), but
  the arrival role hardcodes `@cherub` and `@federation-manager` as the
  only publicly summonable delegates. An EXTENSION being has no clean way
  to opt into the same reachability: the arrival spec carries a `summon`
  function, so it cannot be overridden through `qualities.roles`. The clean
  fix is to let extensions contribute public-summon entries that merge into
  the arrival floor, making "publicly reachable delegate" a first-class,
  extensible concept instead of a seed-hardcoded list. Until then the e2e
  drives the registrar's handler the way the summon verb does after auth.

- **Extension roles cannot be granted bare seed ops.** The scoped loader
  auto-namespaces a role's `canDo` entries to the extension
  ([scopedReality.js](../../extensions/scopedReality.js)), so
  `canDo: ["create-matter"]` becomes `horizon:create-matter`, which is not
  a real op. An extension being that maintains shared state therefore
  cannot be granted seed write ops by role; it must either OWN the subtree
  it writes (the registrar owns its catalog space) or wrap each seed op in
  one of its own. Ownership is the clean answer for the registrar; the
  general question (should an extension role be able to name a bare seed op
  it may call) is open.

The wire all of this rides is already hardened: see
[GRAFT-AND-SEED.md](GRAFT-AND-SEED.md), The wire between realities.
