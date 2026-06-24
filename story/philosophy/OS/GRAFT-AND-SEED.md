# GRAFT AND SEED — moving worlds between realities

> _"Graft brings the thing itself. Seed brings the shape of the thing."_

Two operations move structure between realities. They look similar (both
package a region of one reality and plant it in another) and for a long
time one piece of code tried to be both. They are not the same operation,
and the difference is identity.

This file pins the distinction, what each preserves, where each can land,
and how partial transfer works. Read alongside
[IDENTITY.md](IDENTITY.md) (why ids are portable at all) and the publish
module ([seed/materials/publish/](../../seed/materials/publish/)).

## The one distinction

- **GRAFT brings the thing itself.** A being, a history, a subtree, moved
  into another reality WITH its identity intact. Same public key, same
  act-chain, same history, hash-linked and signed exactly as it was at
  home. The grafted being is not a copy shaped like the original; it IS
  the original, now also present here. Migration, succession, federation,
  backup-restore, "bring my work to this reality" all want graft.

- **SEED brings the shape of the thing.** A structural shell: spaces laid
  out a certain way, able patterns, default matter, configuration. Plant
  it and you get a NEW instance shaped like the template, with fresh ids
  and a fresh chain. Each instance is sovereign; the template author has
  no authority over what people plant. Community blueprints, extension
  distributions, "give me an empty world set up for X" all want seed.

The test: **does identity survive the move?** Graft preserves it (the
key and chain travel). Seed discards it (the structure travels, new
identities are minted on arrival). One question, two operations.

## Why graft is possible now

Graft used to be impossible to do honestly, so the old code only did seed
(and called it "graft"). The reason was namespacing: a `uuid` id means
nothing in another reality, so to move a subtree you had to strip every id
and mint fresh ones on the receiving side — which destroys identity by
construction. You could only ever produce a shell.

[IDENTITY.md](IDENTITY.md) removed that wall. A being's id IS its public
key, portable everywhere. Its acts are signed; its reels and act-chains
verify self-certifyingly ([verifyReel](../../seed/past/fact/verifyReel.js),
[verifyActChain](../../seed/past/act/actHash.js)); reality and history
Merkle roots prove whole regions at once. So a being's
`{ key, signed act-chain, lineage, matter }` is now a verifiable, portable
package. Graft moves that package and the receiver verifies it. Nothing is
rebuilt; the being continues.

This is also why graft is mostly already built, under the wrong name: the
whole-reality genome path (capture verbatim ids + full chains, verify the
root reproduces) IS graft at reality scale. It generalizes down to a
being or a history, and out to landing in a living reality.

## The 2×2: what moves, and where it lands

Each operation answers WHAT moves; placement answers WHERE it lands. They
compose freely.

|                                | **at the reality root** (new)                 | **at an existing position** (living)   |
| ------------------------------ | --------------------------------------------- | -------------------------------------- |
| **SEED** (shell, fresh ids)    | a new top-level world from a template         | a subtree planted under a position     |
| **GRAFT** (identity preserved) | a being/history into a fresh or empty reality | a being/history into a running reality |

- **Placement = reality root.** The planted region becomes new top-level
  structure (or the whole of a fresh reality). For graft into an empty
  reality this is the genome boot path that exists today.
- **Placement = existing position.** The region lands at a chosen position
  in a living reality, alongside everything already there. For seed this is
  the subtree-plant that exists today; for graft this is the new capability:
  bring a being into a reality that is already running, without disturbing
  what is there.

A word on "position" versus "history", because the two are easy to conflate.
Position is the landing spot, WHERE a transfer attaches in the destination
(the code calls the sentinel for it the insertion point). Branch always
means the lineage fork, WHICH fork of history the facts ride on, the
git-style fork folded into every fact's hash. A position sits on some
history, but history never names the landing spot. When you read "branch"
anywhere below, it is the fork; when you read "position", it is the place.

All four quadrants are first-class. The substrate should not be able to do
three of them and fake the fourth.

### Scope, and why genome is not a third operation

There is a third axis under WHAT and WHERE: **scope** — how much of the
thing you bring. A graft ranges from one being, to a being and the subtree
it owns, to a whole history's worth of activity, up to the entire reality.
Seed ranges the same way over structure.

A whole-reality graft has a name of its own — the **genome** — but it is
not a separate operation. It is simply graft at maximal scope, placed at
the root. The same machinery (verbatim ids, full chains, verify on arrival)
that brings one being brings them all. The one thing the genome carries
that a smaller graft does not is the reality's OWN identity: its `realityId`
(which is I's key) travels too, so the planted result IS the same
reality, a mirror or a migration. That is exactly why the genome lands only
in an empty store — two realities cannot share one, and a reality grafted
into a _different_ reality would be two identities in one place. A being
grafted into a living reality is the opposite case: the being keeps its own
identity while taking up residence under a host reality that keeps its.

So: one verb (graft), one range of scope (being → reality), one choice of
placement (root → existing position). Genome is the top-left corner of the
graft column, not a fourth thing.

## What a graft carries

A graft package is identity, not shape. For each entity it moves:

- **The public key id**, unchanged. It IS the entity on arrival.
- **The act-chain** — every act the being took, in order, each signed by
  its key at the time, hash-linked back through its history. The chain is
  the substance; without it a graft is just key transport (a valid but
  biographically empty being). Real graft moves the chain.
- **The reel facts** the chain produced (the entity's own reel, and the
  space/matter reels it owns).
- **Owned matter**, content-addressed (so identical content the receiver
  already holds deduplicates by hash).
- **Lineage references** — mother-line and other being references, by
  public key, even when they point at beings in other realities (the
  reference is portable; the referenced being need not be present).

On arrival the receiver VERIFIES before integrating: recompute every fact
hash, verify every act signature against the entity's key, walk the chain
for continuity, check the bundle's own signature. Identity that does not
verify is refused. Identity that verifies is integrated as-is.

### Dedup by public key

Because the id is the key, "do I already know this being?" is a key
lookup, not a guess. Two grafts of the same being are recognized as the
same being. A graft of a being already present is not a collision and not
a duplicate — it is an UPDATE: the new history merges into the existing
record (append the acts the receiver did not have; the chain proves the
order). A graft of an unknown being CREATES it, preserving its key and
chain. There is no id remapping, ever; that was the old shell operation.

## Imported history is foreign by construction

A graft inserts the source's facts and acts VERBATIM, by their original
hashes, and never replays them. This is not a discipline anyone has to
remember; it is structural. A fact's `_id` digest folds in its `history`
and its provenance (`homeReality`, `wasRemote`); an act's folds its
`history` and `reality` ([hash.js contentOf](../../seed/past/fact/hash.js),
[actHash.js contentOfAct](../../seed/past/act/actHash.js)). The hash is
bound to WHERE the deed happened. Re-homing an imported fact (changing its
reality, pushing it onto a different history) changes its hash, and a
changed hash is a DIFFERENT fact. You cannot replay an imported fact as a
local act: the act you would produce is provably not the one you imported.

So the scariest guard any import system carries — "imported acts are a
historical record, not actionable; do not replay them" — is not a policy
here. It falls out of the digest. One rule holds it:

> Foreign facts keep foreign hashes. Anything that should have a LOCAL
> effect is a NEW local fact that references the imported one.

A grafted being's reel is therefore a foreign segment (its origin chain,
verbatim, `homeReality` = origin) followed — if it acts here — by local
facts (`homeReality` = host) whose prev-hash links onto the imported tip.
The chain stays continuous; provenance flips at the boundary, visibly and
tamper-evidently. Imported chains land by verbatim insert (original ids),
never through `emitFact` — `emitFact` is the LOCAL writer, and a local
write of a foreign fact is, by the digest, not that fact at all. This is
the deepest payoff of putting history and reality in the digest: the replay
attack is not refused, it is unreachable.

## The import contract

Verification answers "is this really that being's history?" The contract
below is what the receiver enforces AFTER yes. Each line is structural
doctrine, not tunable preference.

- **Identity is not authority.** The bundle proves WHO the being is, never
  what it may do here. A grafted being lands with its biography and nothing
  else; stance authority is granted by the receiving reality after arrival,
  exactly as it is granted to a native being. The key is a passport, not a
  visa.

- **References stay references.** Imported history references other beings
  (the mother line, mates, past correspondents) by public key. Those
  references stay opaque and foreign: a graft never pulls referenced beings
  in behind itself, and integrating a bundle never triggers a fetch from
  another reality. The bundle is CLOSED; what it declares is all that
  lands. A foreign being that wants live presence and agency here gains it
  through being citizenship (do:mate), never as a side effect of someone
  else's graft.

- **The import is itself an act.** Accepting a graft stamps a local
  provenance fact on the receiver's own chain: who accepted it, the bundle
  hash, the declared scope, that verification passed. The imported history
  explains the being; the provenance fact explains how the being got HERE.
  Both survive audit.

- **All or nothing.** The whole bundle verifies, then the whole bundle
  integrates. A bundle that half verifies is wholly refused; there is never
  a partially grafted being to clean up.

- **Bounds are policy, the contract is not.** Bundle size, import rate, and
  who may graft at all are receiving authority decisions (see
  [Mediators](#mediators)). Everything above this line holds regardless of
  policy.

## Partial graft

A full chain can be enormous, and you do not always want all of it. Graft
supports coherent SUBSETS, declared explicitly in the bundle so the
receiver knows what it is verifying and what is missing.

- **Genesis prefix.** Facts from birth up to a cutoff. Verifies by
  continuous hash from a known start (genesis). The being arrives with
  shortened history ending at the cutoff.
- **Signed checkpoint segment.** A segment starting at a point the being
  signed as a checkpoint (head hash + key, attested). The receiver
  verifies the segment from the checkpoint without the chain before it;
  earlier acts are referenced by hash and fetchable later.
- **Single history.** One history's worth of the entity's activity, verified
  within that history's lineage. Useful for moving one project's work.
- **State snapshot.** The entity's current folded state, signed at a point
  in time, accepted as authoritative current-state without folding a full
  chain. Pairs with any of the above for "current state + partial history."

All four are built (`capturePartialGraft` / `applyGraft`):

- **genesis prefix** — the reel from birth to a cutoff, verified by `verifyReel`
  (genesis-rooted). Carries the being's birth, so it folds; a later graft merges
  the tail.
- **signed checkpoint segment** — a contiguous suffix on one history, anchored at
  a signed checkpoint and verified by `verifyReelFrom`.
- **single history** — every fact of the being on one fork, anchored at the fork
  point, with the fork's lineage Branch rows carried so the receiver resolves
  and verifies just that slice. Same anchored verify as checkpoint segment.
- **state snapshot** — no chain at all: a signed folded state landed as an
  attested projection (the one projection not folded from local facts). Its own
  apply path; a later real graft of the reel supersedes it.

What is partial is the HISTORY available, never the identity. In every
partial graft the key is the same, the included acts verify, and the being
is unambiguously itself. The bundle declares its partiality; the receiver
plants the being with that metadata visible, refuses (or federation-fetches)
history queries beyond the extract, and never pretends a partial chain is
whole.

Seed has no "partial" — a shell is already only structure; there is no
history to take a subset of. Partiality is a graft concept.

## Empty shells live in seed

An empty shell (structure, no content) is a seed with a minimal payload.
Plant it, get a fresh structured world ready to populate. There is no
"empty graft": a being with no chain is not a being, it is a key. Graft is
always full-content (or a coherent partial); seed is always fresh-identity.
The two never blur into each other.

## The template is content-addressed; the entity is key-addressed

A seed TEMPLATE has an identity: the hash of its content. Same template
anywhere, same hash; publish "the community template at hash X," verify you
have the authentic one, version it explicitly. The author can SIGN the
template (provenance: "I made this"), and every INSTANCE planted from it is
sovereign (its own ids, its own chain, its own authority). Author identity
and instance sovereignty both hold.

A graft ENTITY has an identity too, but a different kind: its public key.
The template is named by what it contains; the entity is named by who it
is. That is the whole distinction restated in id terms — seed is content,
graft is agent (see [IDENTITY.md](IDENTITY.md), the derivation rule).

## Mediators

Id-collision mediation is gone (there are no colliding ids to resolve;
dedup is a key lookup). What remains is POLICY and ARBITRATION: should this
graft be accepted here (a receiving-authority decision), and when two
honestly-divergent chains both claim to continue the same being, which is
real (a succession/fork question). Those are mediator-being and policy
concerns, not id-translation, and they are smaller than the old shell
operation's remapping ever was.

## The wire between realities

Graft bundles and live cross reality calls ride the same wire: one door
per reality, and a cross reality arrival authenticates at that door before
anything inside hears it. The key model lives in [IDENTITY.md](IDENTITY.md)
(Cross reality, and No rotation, only succession); this section pins what
the wire adds on top of it.

- **Two signatures, two claims.** The sending REALITY signs the exact
  bytes of every request. Its `realityId` IS its public key, so first
  contact needs no key ceremony: knowing a peer is knowing its key. Inside
  that, the acting BEING signs the envelope it acts through: verb, address,
  payload, act id, history, home reality, and a wall clock timestamp, bound
  into one signature. The reality layer says "this really came from alpha.test";
  the being layer says "this being really asked for this exact deed." A
  peer can be marked strict (`requireSignedEnvelopes` on its peer record)
  and then the being layer is mandatory, not advisory.

- **Replay dies four times.** A request older than the freshness window is
  refused. A signature already seen inside the window is refused. A being
  signature whose own timestamp went stale is refused, so a compromised
  peer cannot rewrap an old signed envelope as fresh traffic. And a foreign
  act that already dispatched here is refused: one act, one dispatch. The
  layers overlap on purpose; each catches what the others structurally
  cannot. Freshness here means HOST WALL CLOCK: the sender stamps its
  clock, the receiver compares against its own, inside a tunable window.
  Replay refusal needs a shared now, and the wall clock is the only now
  two sovereign realities share; chain time cannot order a foreign
  envelope. These stamps live only on the wire and are never folded into
  the chain, so a skewed clock can bounce live traffic at the door but
  can never touch history.

- **Sealed sessions, forward secrecy.** Peers establish a sealed session at
  first contact: an ephemeral X25519 handshake authenticated by the reality
  keys, then ChaCha20-Poly1305 frames with separate keys per direction.
  Ephemeral session keys give FORWARD SECRECY, and that matters here
  precisely because reality keys never rotate, they only succeed: traffic
  sealed yesterday stays sealed even against a key that leaks tomorrow.
  Sealing is opportunistic (a peer that cannot seal falls back to
  plaintext, and the wire remembers not to ask again for a while) unless
  policy requires it (`CANOPY_REQUIRE_SEALED`).

- **Sealing wraps authentication, never replaces it.** Signatures are made
  over the plaintext and verified after unsealing. A sealed frame carrying
  a bad signature is still a refused request.

In code: the canopy ([protocols/ibp/canopy.js](../../protocols/ibp/canopy.js))
signs, verifies, and dedupes; the sealed session lives in
[protocols/ibp/secureChannel.js](../../protocols/ibp/secureChannel.js); the
being signature in [seed/past/act/actSig.js](../../seed/past/act/actSig.js).

## How this maps to the code today

The names are being switched to match this doctrine. Today:

- The code called **`graft`** ([clone.js](../../seed/materials/publish/clone.js)
  - [graft.js](../../seed/materials/publish/graft.js)) re-mints every id and
    carries no history. That is SEED behavior. It becomes **seed**.
- The code called **`seed`** ([seed.js](../../seed/materials/publish/seed.js))
  preserves ids verbatim and carries full chains. That is GRAFT behavior. It
  becomes **graft**, and generalizes from whole-reality-into-empty-DB to
  being/history scope and living-reality placement, and gains partial extracts.

The crypto-identity layer (signed acts, content-hash matter, pubkey beings,
signed bundles) is the foundation both stand on. After the switch, the names
finally mean what they say: graft brings the thing, seed brings its shape.
