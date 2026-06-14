# ROOTS: where realities meet underground

> _"Roots hold what is meant to be copied, never what is meant to continue."_

Roots are nodes of **The Root System**, the underground network where
realities find each other and share resources. A reality plants roots when
it runs this extension; the resources flowing through those roots
(extensions, seeds, peer records) become visible to anyone who reaches in.
The Root System is layer 1 wiring for the forest of TreeOS realities. No
reality is required to be on it. Any reality that wants to be is.

Read alongside [GRAFT-AND-SEED.md](GRAFT-AND-SEED.md) (what moves between
realities) and [IDENTITY.md](IDENTITY.md) (why keys make all of this
verifiable).

## Why the name

This used to be called Horizon. Horizon suggests a distant edge you scan
toward, separate from where you stand. That framing positioned the
directory as an external lookup service. Roots is more honest to what the
thing actually does. Tree roots reach toward each other, share resources
through mycorrhizal networks, and anchor the trees that grow above them.
Realities running this extension form the same shape: not far-off lookup
points, but the connective tissue of the network itself. The metaphor is
descriptive, not decorative; the architecture has been ecological in its
commitments all along.

`root` already does double duty in TreeOS (cryptographic root, reality
root, Merkle root). The shared word captures a real conceptual unity. A
reality has cryptographic roots (its identity, its Merkle proofs) AND
network roots (its connections to other realities through The Root
System). Both are foundational; both anchor the reality in its larger
context. Capitalize Roots when you mean the directory layer; lowercase
"root" or compound names like "Merkle root" when you mean the
cryptographic concept.

## Roots is a reality, not a server

A Roots node is a TreeOS REALITY running the `roots` extension. A
registrar being holds the catalog as its folded state; publishers are
peer realities. Every publish and every delist is a fact on the
registrar's reel, so the catalog's entire history is audited by
construction.

> _Catalog shape._ The catalog lives in one registrar being's folded
> qualities (publisher to name to versions, each name carrying a chained
> pointer claim). This follows from the moment model: a moment seals
> exactly ONE write, and the fold lands at seal, so a synchronous publish
> cannot create a space, then a listing inside it, then a pointer. One
> self-authorized write per publish is the shape that fits, and it is the
> same pattern the federation-manager uses. The registrar OWNS its catalog
> space (the seed sets the owner), which is how its write authorizes. A
> space-per-publisher tree of matter is the scaling shape; it shards the
> single registrar into per-publisher registrars or a SEE-projection when
> one being's qualities grow too large.

This one decision buys the rest:

- **The protocol IS the API.** Browsing is SEE. Publishing is DO. There is
  no second wire dialect to maintain, and Roots inherits every hardening
  the wire already has: canopy signatures, being signatures, sealed
  sessions, replay refusal.
- **"Anyone can run one" means "plant a reality."** The roots extension
  itself ships as a resource published through Roots. The distribution
  story distributes itself.
- **Operating a Roots node grants nothing.** A Roots operator holds the
  keys of their own reality and no one else's. The catalog they host is
  other realities' signed work; the worst a dishonest operator can do is
  decline to show something, and another Roots node will show it.

## Catalog through IBP, bytes through the content door

Inside a reality the rule is: facts carry refs, never bytes; owned bytes
live content-addressed in CAS. A Roots node is the same rule stretched
across the wire.

- The IBP envelope carries the MANIFEST: name, version, publisher,
  signature, dependency list, and the hash of every asset.
- The BYTES (code bundles, models, sounds, anything large) travel the
  content door, fetched by hash, verified by hashing on arrival.

So "everything through IBP" means every act of publishing, browsing,
resolving, and delisting is an IBP verb. It never means binary blobs ride
inside envelopes. The envelope names the bytes; the content door moves
them; the hash proves them.

## Who may publish is just roles

Publishing happens by a being that holds the `roots:publisher` role
([extensions/roots/roles/publisher.js](../../resources/roots/roles/publisher.js))
summoning the registrar with intent `publish-listing` or
`retire-listing`. The role declares the receiver names + arg shapes; the
substrate's existing role-walk is the auth. Two configurations fall out
of one knob, who may take the role:

- **Open Roots.** The operator authors the role as self-grantable (any
  identified being may take it). Anyone who registers can publish; the
  registrar trusts the publisher key carried on the signed envelope.
  Pointer claims are signed by THAT publisher's key, not the operator's.
- **Curated Roots.** The operator gates the role behind their own grant
  (the role is held by zero beings by default; the operator hands it to
  whoever they trust to publish). Same mechanism, different policy.

The operator does not have to police every publish, because the catalog
records who actually signed each pointer; a publisher who lies about
themselves can be reasoned about by name. Open vs curated is one config
on one role, not two separate codepaths.

## Resources: the catalog holds substance

A "resource" is the umbrella word for anything Roots catalogs. Three
shapes today, each a hash-addressed template signed by its publisher,
meant to be drawn into other realities:

- **Extensions.** A code bundle plus its owned matter (models, sounds,
  other assets). The listing's manifest names every asset by hash; the
  assets are CAS blobs any Roots node can mirror.
- **Seeds.** A template of structure: a shell world that takes fresh ids
  when planted, per [GRAFT-AND-SEED.md](GRAFT-AND-SEED.md). Distinct from
  a graft (which moves an existing reality verbatim).
- **Roleflows.** A template of behavior: composition data over the role
  machinery realities already run. A roleflow declares which roles
  compose and how, with a `requires` manifest naming the extensions that
  provide them. A roleflow installs into an EXISTING reality; install
  resolves the manifest by pulling each requirement by hash, from this
  Roots node or any other. This is the youngest of the three: its exact
  contents and install semantics need their own design pass before it is
  built.

The doctrine in one line: **the template is content-addressed; the
entity is key-addressed.** Resources are content. Beings are agents.
Roots catalogs content. Grafts move agents peer to peer.

**Versioning is hashing.** Every version of anything is a new hash,
immutable forever. The mutable layer is a NAME POINTER, a publisher-signed
claim that "the current food@1.x is hash H." Moving the pointer is a new
signed claim; the old hash never stops being the old version.

**A publisher can lie only about pointers, and provably.** Nothing in the
protocol prevents a publisher from signing two conflicting claims for the
same name and version. But installs pull by HASH, so equivocation can
confuse a choice, never the content chosen. And pointer claims CHAIN:
each new claim references the hash of the claim before it, so two claims
with one parent are a visible fork, provable the same way a forked
act-chain is. Equivocation is detectable by any mirror and damages
exactly one thing: that publisher's name.

**Retirement is a pointer state, not a deletion.** A publisher marks a
listing unmaintained, or points at a successor, with the same signed
pointer machinery. That is distinct from DELISTING (one Roots node
declining to show) and from DECAY (mirrors hold bytes per their own
retention; content the network stops caring about fades from
availability). The hash never stops naming what it names; only the bytes'
availability ages.

**Names are publisher-scoped.** There is no global namespace to squat. A
name means `(publisher, name)`, where the publisher is a reality identity
(one operator, one land). Roots nodes INDEX names; they never arbitrate
them. Two publishers can both ship a `food`; the catalog shows whose is
whose, and the publisher signature proves it.

**Browsing is by ecosystem, not flat lists.** Listings declare what they
are built for (`builtFor`), and that declaration is a claim referencing
ANOTHER LISTING: an OS, a bundle, an extension. The taxonomy is the graph
of those claims, derived automatically; no Roots node maintains a blessed
category list, so categories cannot become a soft centralization lever.
(Search and ranking on top of this graph are portal work, out of scope
here.)

## The catalog refuses grafts

A graft is not content. It is an AGENT: a being's key and chain, meant
for continuing, not for copying. A public catalog of grafts would make
Roots nodes custodians of identities and biographies, exactly the custody
this architecture refuses. So the pin:

> Roots catalogs RESOURCES. Grafts move PEER TO PEER over the sealed
> canopy wire, between the two realities concerned, and nowhere else.

Two narrow graft-adjacent services are legitimate, and neither is a
catalog:

- **Discovery.** Pointers, not chains: "being X is home at reality Y,"
  "reality Z accepts graft offers." A pointer leaks no history and grants
  no custody.
- **Encrypted escrow.** When two realities are not online at the same
  moment, a sender may park a graft bundle at a Roots node ENCRYPTED to
  the receiving reality's key. The Roots node stores bytes it cannot
  read, addressed to exactly one key, deleted on pickup or expiry. The
  same shape covers a reality parking its own encrypted genome backup.
  Opaque storage, never a listing. Keys here never rotate, they SUCCEED
  ([IDENTITY.md](IDENTITY.md)), and escrow is designed around that:
  expiry is SHORT, and the sender always keeps the original (escrow is a
  convenience copy, never the only copy). A succession during the window
  just means re-sending to the successor key; an orphaned bundle expires
  unread. Short expiry also bounds the at-rest exposure: a bundle
  encrypted to a key that is later compromised should already be gone.

## Peers find each other here

Federation needs a meeting point, and this is Roots' second job: the
PEER DIRECTORY.

A peer record is small and self-signed: `{ realityId, baseUrl, lastSeen }`,
signed by the reality it describes. Because a `realityId` IS that
reality's public key ([IDENTITY.md](IDENTITY.md), Cross reality), the
directory cannot lie in any way that matters:

- Point you at a wrong baseUrl, and the canopy handshake fails
  immediately. Whoever answers there cannot sign as that key.
- Forge a record outright, and the record's own signature fails.
- The only lie available is OMISSION, hiding a peer, and any other Roots
  node can tell the truth.

Realities register themselves with the Roots nodes they choose, refresh
their own records, and check each other's liveness with an ordinary SEE
ping. First contact needs no key ceremony: knowing the peer record is
knowing the key.

Two honesty notes. A peer record is an ATTESTATION, not an endorsement:
it says "I exist, here," signed by the one who exists, and storing it
vouches for nothing. And because registering costs only a signature, the
directory will accumulate dead and junk records; Roots nodes prune what
stops answering (housekeeping, not curation), and discovery filters on
freshness (`lastSeen`). Spam can clutter a directory; it cannot
counterfeit one.

## Planting roots on an existing reality

Every reality already has the FEDERATION half: peering, the canopy wire,
the cross reality verbs. The roots extension adds the DIRECTORY half:
serve a catalog, serve peer records, mirror other Roots nodes. Any
existing reality can switch the role on and become a Roots node. Serving
is opt-in (a directory is a public service, with storage and bandwidth
costs); querying is universal (every reality is a Roots CLIENT, able to
ask any Roots node and register itself with the ones it chooses).

[plant.js](../../plant.js) offers the roots extension during initial
setup and asks whether to plant this tree with roots. If yes,
`.first-boot-actions.json` queues `roots:catalog` and
[begin.js](../../begin.js) plants it at the reality root on first boot.
The operator can move the catalog later; this is just a sensible default
landing spot.

There is no standalone type. A dedicated Roots node, a reality that does
nothing but directory work, is an operational choice, not a different
kind of thing.

- **The first hello is the only hard moment.** A fresh reality knows
  nobody. Every decentralized network solves this the same way: ship a
  few WELL-KNOWN addresses as defaults. This centralizes INTRODUCTION
  and nothing else: the default is a door you may knock on first, not an
  authority.

- **One hello teaches you everything.** SEE any one Roots node's peer
  space and you receive every record it holds: realities, and other
  Roots nodes, each record self-signed by the reality it describes. You
  verify each record yourself, so the introducer needs no trust at all.
  Cache what you learned and your own peer list IS your directory from
  then on; the well-known address is never load-bearing again. Knowing
  one peer is knowing the network.

- **Neighborhoods, not one world view.** Roots nodes choose what they
  mirror (exclusion is their one lever), so the network is overlapping
  neighborhoods rather than one guaranteed global catalog. Any entry
  point shows you its neighborhood; two entry points show you the
  union. That is the design working, not failing: the more Roots nodes,
  the wider the overlap.

And the hard question: what if the DEFAULTS go bad? The list ships in the
reality's config alongside the seed code, updates the way code updates,
and any operator can override it. A captured default cannot forge
records, alter listings, or impersonate anyone; everything it serves
still self-certifies. What it can do is BLIND: show a partial network,
an eclipse. The breakers are plural defaults (independent operators, so
the views union) and out-of-band introduction (paste any peer's address
directly; the directory is a convenience, never a gatekeeper). One
honest hello from anywhere ends the eclipse. The exposure is real but
narrow: introduction, briefly, and nothing else.

## Many Roots nodes, one trust model

Roots nodes MIRROR each other. Catalog records are publisher-signed and
hash-addressed; peer records are self-signed. Syncing them between Roots
nodes is therefore trivially safe: copy, verify, serve. More Roots nodes
means more availability and less centrality at zero added trust cost.
That is the whole reason the answer to "how many Roots nodes?" is "the
more the better."

Honestly: expect a power law. A few well-resourced Roots nodes will hold
most of the catalog with good uptime, and a long tail of small mirrors
will hold slices of it. The architecture does not promise flatness; it
promises REPLACEABILITY. No Roots node is required, switching is one
config line, and the big ones stay honest precisely because leaving them
is cheap.

The trust model in one line: **a Roots node vouches for AVAILABILITY,
never authenticity.** Authenticity travels with the artifact (the
publisher signature, the content hash, the reality key) and is checked
by the receiver, every time, no matter which Roots node served it.

Governance follows. A Roots node's only lever is EXCLUSION: it can
decline to list. Name that plainly: inclusion is an editorial power, and
exercising it shapes DISCOVERABILITY. But it touches nothing about
truth. A Roots node cannot alter what it lists (hashes break), cannot
impersonate a publisher (signatures break), and cannot reach into any
reality (it holds no keys but its own). Delisting from one Roots node is
not erasure from the network; it is one mirror declining to mirror, and
hidden work is unaltered work, visible elsewhere.

## Where roots lives in the codebase

The roots extension lives at [extensions/roots/](../../resources/roots/).
The registrar role holds the catalog in its own qualities; publish-listing
and retire-listing are SUMMON intents; chained pointer claims live in
[lib/claims.js](../../resources/roots/lib/claims.js); delist is the
operator's DO op; the catalog plants from
[seeds/catalog.seed.json](../../resources/roots/seeds/catalog.seed.json).
[plant.js](../../plant.js) offers roots during initial setup and writes a
`.first-boot-actions.json` marker that [begin.js](../../begin.js) consumes
once to plant the catalog at the reality root. Extensions and seeds
publish today; roleflow waits on its own design pass.

## Two open seams in the extension model

The registrar surfaced two gaps that the roots extension works around but
that deserve a clean answer.

- **No public-summon path for an extension being.** A canopy-verified
  foreign publisher reaches the registrar through the arrival floor (the
  cross-reality fallback in [roleAuth.js](../../seed/ibp/roleAuth.js)),
  but the arrival role hardcodes `@cherub` and `@federation-manager` as
  the only publicly summonable delegates. An EXTENSION being has no
  clean way to opt into the same reachability: the arrival spec carries
  a `summon` function, so it cannot be overridden through
  `qualities.roles`. The clean fix is to let extensions contribute
  public-summon entries that merge into the arrival floor, making
  "publicly reachable delegate" a first-class, extensible concept
  instead of a seed-hardcoded list.

- **Extension roles cannot be granted bare seed ops.** The scoped loader
  auto-namespaces a role's `canDo` entries to the extension
  ([scopedReality.js](../../resources/scopedReality.js)), so
  `canDo: ["create-matter"]` becomes `roots:create-matter`, which is not
  a real op. An extension being that maintains shared state therefore
  cannot be granted seed write ops by role; it must either OWN the
  subtree it writes (the registrar owns its catalog space) or wrap each
  seed op in one of its own. Ownership is the clean answer for the
  registrar; the general question (should an extension role be able to
  name a bare seed op it may call) is open.

The wire all of this rides is already hardened: see
[GRAFT-AND-SEED.md](GRAFT-AND-SEED.md), The wire between realities.
