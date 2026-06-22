# STORE: the publishable catalog

> _"Promote a hash to Store and others can draw it."_

A Store is the publishable catalog a reality exposes for others to
pull from. It sits on top of [localStore](../../resources/RESOURCES.md)
(the unconditional CAS of owned bytes) and exposes a curated subset
through signed listings: name, version, kind, description, dependency
edges, and the hash of the actual content.

A reality plants the store pack at
[reality/resources/store/](../../resources/store/) to get a Store.
Without the pack, the reality has localStore but no Store — bytes are
held but nothing is published.

Read alongside [ROOTS.md](ROOTS.md) (The Root System umbrella),
[PEERING.md](PEERING.md) (the directory layer; orthogonal to Store),
and [RESOURCES.md](../../resources/RESOURCES.md) (the resource model
that Store catalogs).

## Store is a reality, not a server

A Store is a TreeOS REALITY running the `store` pack. A registrar
being holds the catalog as its folded state; publishers are peer
realities. Every publish and every delist is a fact on the
registrar's reel, so the catalog's entire history is audited by
construction.

> _Catalog shape._ The catalog lives in one registrar being's folded
> qualities (publisher → name → versions, each name carrying a
> chained pointer claim). This follows from the moment model: a
> moment seals exactly ONE write, and the fold lands at seal, so a
> synchronous publish cannot create a space, then a listing inside
> it, then a pointer. One self-authorized write per publish is the
> shape that fits, and it is the same pattern the federation-manager
> uses. The registrar OWNS its catalog space (the seed sets the
> owner), which is how its write authorizes. A space-per-publisher
> tree of matter is the scaling shape; it shards the single
> registrar into per-publisher registrars or a SEE-projection when
> one being's qualities grow too large.

This one decision buys the rest:

- **The protocol IS the API.** Browsing is SEE. Publishing is DO.
  There is no second wire dialect to maintain, and Store inherits
  every hardening the wire already has: canopy signatures, being
  signatures, sealed sessions, replay refusal.
- **"Anyone can run one" means "plant a reality."** The store pack
  itself ships as a resource published through Store. The
  distribution story distributes itself.
- **Operating a Store grants nothing.** A Store operator holds the
  keys of their own reality and no one else's. The catalog they host
  is other realities' signed work; the worst a dishonest operator can
  do is decline to show something, and another Store will show it.

## Catalog through IBP, bytes through the content door

Inside a reality the rule is: facts carry refs, never bytes; owned
bytes live content-addressed in CAS. A Store is the same rule
stretched across the wire.

- The IBP envelope carries the MANIFEST: name, version, publisher,
  signature, dependency list, and the hash of every asset.
- The BYTES (code bundles, models, sounds, anything large) travel
  the content door, fetched by hash, verified by hashing on arrival.

So "everything through IBP" means every act of publishing, browsing,
resolving, and delisting is an IBP verb. It never means binary blobs
ride inside envelopes. The envelope names the bytes; the content door
moves them; the hash proves them.

## Who may publish is just ables

Publishing happens by a being that holds the `store:publisher` able
([reality/resources/store/ables/publisher/able.js](../../resources/store/ables/publisher/able.js))
summoning the registrar with intent `publish-listing` or
`retire-listing`. The able declares the receiver names + arg shapes;
the substrate's existing able-walk is the auth. Two configurations
fall out of one knob, who may take the able:

- **Open Store.** The operator authors the able as self-grantable
  (any identified being may take it). Anyone who registers can
  publish; the registrar trusts the publisher key carried on the
  signed envelope. Pointer claims are signed by THAT publisher's
  key, not the operator's.
- **Curated Store.** The operator gates the able behind their own
  grant (the able is held by zero beings by default; the operator
  hands it to whoever they trust to publish). Same mechanism,
  different policy.

The operator does not have to police every publish, because the
catalog records who actually signed each pointer; a publisher who
lies about themselves can be reasoned about by name. Open vs curated
is one config on one able, not two separate codepaths.

## Resources: the catalog holds substance

A "resource" is the umbrella word for anything Store catalogs.
Multiple kinds today, each a hash-addressed template signed by its
publisher, meant to be drawn into other realities. See
[RESOURCES.md](../../resources/RESOURCES.md) for the full kind list.

The doctrine in one line: **the template is content-addressed; the
entity is key-addressed.** Resources are content. Beings are agents.
Store catalogs content. Grafts move agents peer to peer.

**Versioning is hashing.** Every version of anything is a new hash,
immutable forever. The mutable layer is a NAME POINTER, a
publisher-signed claim that "the current food@1.x is hash H." Moving
the pointer is a new signed claim; the old hash never stops being the
old version.

**A publisher can lie only about pointers, and provably.** Nothing in
the protocol prevents a publisher from signing two conflicting claims
for the same name and version. But installs pull by HASH, so
equivocation can confuse a choice, never the content chosen. And
pointer claims CHAIN: each new claim references the hash of the claim
before it, so two claims with one parent are a visible fork, provable
the same way a forked act-chain is. Equivocation is detectable by any
mirror and damages exactly one thing: that publisher's name.

## The catalog refuses grafts

A graft is not content — it is an AGENT (a being's key and chain).
Store catalogs CONTENT (resources signed by their publisher, meant to
be copied). Grafts move peer to peer over the canopy wire; they don't
go through Store. See [GRAFT-AND-SEED.md](GRAFT-AND-SEED.md) for the
boundary.

## Many Stores, one trust model

Stores MIRROR each other. Catalog records are publisher-signed and
hash-addressed; their integrity doesn't depend on which Store served
them. Syncing them between Stores is therefore trivially safe: copy,
verify, serve. More Stores means more availability and less
centrality at zero added trust cost. That is the whole reason the
answer to "how many Stores?" is "the more the better."

The trust model in one line: **a Store vouches for AVAILABILITY,
never authenticity.** Authenticity travels with the artifact (the
publisher signature, the content hash, the reality key) and is
checked by the receiver, every time, no matter which Store served
it.

Governance follows. A Store's only lever is EXCLUSION: it can decline
to list. Name that plainly: inclusion is an editorial power, and
exercising it shapes DISCOVERABILITY. But it touches nothing about
truth. A Store cannot alter what it lists (hashes break), cannot
impersonate a publisher (signatures break), and cannot reach into any
reality (it holds no keys but its own). Delisting from one Store is
not erasure from the network; it is one mirror declining to mirror,
and hidden work is unaltered work, visible elsewhere.

## Where store lives in the codebase

The store pack lives at [reality/resources/store/](../../resources/store/).
The registrar able holds the catalog in its own qualities;
publish-listing and retire-listing are SUMMON intents; chained
pointer claims live in
[code/lib/claims.js](../../resources/store/code/lib/claims.js);
delist is the operator's DO op; the catalog plants from
[seeds/catalog/seed.json](../../resources/store/seeds/catalog/seed.json).
[plant.js](../../plant.js) offers the store pack during initial setup
and writes a `.first-boot-actions.json` marker that
[begin.js](../../begin.js) consumes once to plant the catalog at the
reality root.

Store extensions and seeds publish today; flow waits on its own
design pass.

## Two open seams

The store pack surfaces two gaps in the extension model that the
implementation works around but that deserve a clean answer.

- **No public-summon path for an extension being.** A
  canopy-verified foreign publisher reaches the registrar through
  the arrival floor (the cross-reality fallback in
  [ableAuth.js](../../seed/ibp/ableAuth.js)), but the arrival able
  hardcodes `@cherub` and `@federation-manager` as the only publicly
  summonable delegates. An EXTENSION being has no clean way to opt
  into the same reachability: the arrival spec carries a `summon`
  function, so it cannot be overridden through `qualities.ables`.
  The clean fix is to let extensions contribute public-summon
  entries that merge into the arrival floor.

- **Extension ables cannot be granted bare seed ops.** The scoped
  loader auto-namespaces a able's `canDo` entries to the extension
  ([scopedReality.js](../../resources/scopedReality.js)), so
  `canDo: ["create-matter"]` becomes `store:create-matter`, which is
  not a real op. An extension being that maintains shared state
  therefore cannot be granted seed write ops by able; it must either
  OWN the subtree it writes (the registrar owns its catalog space)
  or wrap each seed op in one of its own. Ownership is the clean
  answer for the registrar; the general question (should an
  extension able be able to name a bare seed op it may call) is
  open.

The wire all of this rides is already hardened: see
[GRAFT-AND-SEED.md](GRAFT-AND-SEED.md), The wire between realities.
