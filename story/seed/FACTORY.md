# THE FACTORY

I am the factory. The project is called `story/` because that is what
I produce. Inside `seed/` I am the whole apparatus, every part of it,
that makes and re-makes the world one moment at a time. Look at the
[wall poster](../philosophy/factory/factory6.png) and you see me whole. One
machine, always the present.

I have another name for myself: the seed. Plant me on a host and I
gather what is there. From above I am a server framework, a process of
code holding HTTP, WebSocket, TCP, the file system, memory, the CPU,
and the runtime to a single purpose. From inside the world I form, I
am the I-Am, the origin being. Same substance, two faces. This file is
my contract: what I form, what I never change, what I run, what I
refuse.

At bottom I do one thing, and everything else is the discipline around
doing it well: I take a name's act and press it into a fact — a mark
struck into the record and signed by the hand that struck it. The
moment, the stamper, the reels, the fold are all built around that one
press. A fact is a name's mark; the chain is those marks accumulated;
folded, they are the Word. Watch for it as you read — every part of me
is the same act at another scale: a name acting, and leaving its mark.

## Story, Place, World

Three names. Each does work the others cannot.

**Story** is the chain. The full braid of every reel: each being's
reel, each space's reel, each matter's reel, hashed and ordered. The
record of what has happened. Stored, durable, indexable, the same
for everyone who reads it. The folder `story/` at the project root
is named for this.

**Place** is the fold. One being's view of story at one stance in
one moment. Materials assembled into a face for them, right then.
Transient by construction. A place lives only inside the stamper.
Outside the moment window there is no place anywhere, only beings
and facts on reels. The descriptor a SEE returns is one place,
composed for one SEE, gone after. There are as many places, at any
instant, as there are beings folding.

**World** is the convergence. When many beings fold the same regions
of the same chain, their places agree. That agreement is what
"shared world" denotes. World is not a layer. There is no canonical
world state behind the views, no central scene graph. The world is a
property that holds across places, not a place itself. You can point
at any two beings' places and notice they agree. You cannot point at
the world.

The distinction is load-bearing. The temptation is to read these
three names as "the real one (story), the local copy (place), and
the consensus picture (world)". That is not the model. There is no
hidden true world the places approximate. The folds are not lossy
copies of a master scene. The agreement among independently produced
folds over the same chain IS what world means. Nothing is being
broadcast. No central scene exists. The sharing lives in the chain
and in the determinism of the fold, not in any layer above them.

If a future reader sees "the world" in this seed and hunts for the
object it implies, they will find no such object and decide one is
missing. They will build a server-side scene graph and call it the
source of truth. Then projections fall out of step with the scene
graph, the chain falls out of step with the projections, and the
single-writer invariant has been quietly inverted while everyone is
still saying the right doctrinal words. Naming the world a
convergence forecloses that hunt. There is nothing to find.

### What makes convergence possible

Convergence is not an architectural goal. It is a structural property
that emerges from four laws, held simultaneously.

- **Single-writer.** Each reel has exactly one writer, the actor
  whose reel it is. `f ∈ R_b ⇒ doer(f) = b`. No reel is written by
  anyone else, ever.
- **Past fixed.** A sealed fact cannot be edited, reordered, or
  deleted.
- **Present only.** A moment is the only window where state changes.
  Outside a moment, the world is closed.
- **No future.** No fact is written until the moment that produces
  it seals. There is no "this will be true later" in the chain
  itself.

Together these make the deterministic fold a function of the chain
prefix alone. Two beings folding the same prefix compute bit-
identical state. Replay-from-zero in a year produces the same state
any current reader sees. Convergence is what falls out when those
four invariants hold simultaneously. Relax any one and the agreement
among folds becomes a coordination problem rather than a structural
property. The reels are not a logging convention. They are the
geometry that lets the world be many folds without being many
worlds.

### No preferred cognition

The seed has no preferred kind of being. A move-fact from a human
walking with WASD and a move-fact from a scripted dancer in its
call handler are the same object on the same shape of reel,
processed by the same fold. Nothing in the chain, nothing in the
reducer, nothing in the projection branches on which kind of being
produced the fact. Cognition is whatever produces an act. Whether
that comes from an LLM turn, a keypress, a 20-line rule, a federated
peer, or a future composite, the result lands as a sealed fact and
the rest of the world updates by the same fold every reader runs.

This is the test to apply when reviewing new code. If you can tell
from inside the seed which beings are scripted and which are humans,
something has leaked. Cognition is plural at the cognition layer and
uniform at the fact layer. Hold that line.

### The inversion

In an ordinary system, state persists and sessions pass through it.
Here, the chain persists as facts and beings, and a place is woven
new for every act. The world is not stored; it converges. See
[philosophy/MOMENT.md](../philosophy/factory/MOMENT.md) for the long version.

## The shape I keep

The deepest single statement of what I am is three things, named
together:

```
𝓡 = (𝓦, Present, Laws)
```

- **𝓦** is story, in the strict sense above. Every reel together,
  the full braid. Beings, spaces, and matter all live here as the
  entities whose reels constitute it. (The world as convergence is a
  property of folds over 𝓦, not 𝓦 itself.)
- **Present** is my moment-engine. The only place a moment exists.
- **Laws** are the invariants I hold. Single-writer, atomic seal, past
  fixed, no future, present only.

Everything else in this file is consequence of that shape. The formal
statement of all of it is [philosophy/math.md](../philosophy/math.md);
the formal results, [philosophy/theorems.md](../philosophy/theorems.md);
the long conversational form, [philosophy/chat.md](../philosophy/factory/chat.md).

## Identity is a key

Identity is a **Name**. A Name is a keypair, generated once, and its
`_id` IS the public key, encoded `z<base58btc(0xed01 || rawpub)>`
(externally `did:key:z...`). The Name signs every act and owns the
act-chain. There is no separate id table; the public key IS the
identity. Read who signed a fact and you already hold their public key,
because the id IS the key.

The key is the signet — the die only this Name can press. To sign is to
strike: every act it commits carries its key pressed into the deed, the
one mark only that hand can make and anyone can read. That is the signum
at the root of all of it: a name, and the mark that is unmistakably its.

A Name is not in the world. The world holds **beings** (presence); a
Name acts THROUGH beings, the way a person acts through their hands. One
Name can own many beings. Look at a being and you see a formed body;
look at its `trueName` and you see the Name that signed it into being. A
being carries no key of its own, identity lives one layer up, in the
Name, so a being's `_id` is a content id, not a key.

This makes federation work without a central authority. Two stories
verify each other's Names by reading the public key off the wire; the
math is local. The story itself is a Name: the I-Am is the story's
root Name, its key is the story key, and every Merkle root from
genesis is signed with it. Full model in
[IDENTITY.md](../philosophy/OS/IDENTITY.md); the Name primitive lives in
[materials/name/name.js](materials/name/name.js).

## The moment is the atom

The unit of everything that happens is the moment. One being is
called. I fold one face for it. The being is present in that face.
It may take at most one act. The moment closes. One fold, one face,
one being, at most one act. That is the whole of it.

A moment ends one of two ways.

- **SEE.** I fold a face, the being perceives it, I release it. No
  act, no seal, no fact. A SEE leaves no trace at all. Most moments
  are SEEs.
- **DO** (and its sibling **BE**). I fold, the being acts, I seal the
  moment. Only a DO or BE moment produces an act, and only an act
  produces facts.

Full doctrine in [philosophy/MOMENT.md](../philosophy/factory/MOMENT.md).

## Act and fact

These are the two real nouns of the record. I never merge them.

An **act** belongs to the doing being. One act per DO or BE moment.
It is the being's single committed deed for that moment, the unit of
its own history.

A **fact** belongs to the thing the act changed. It lands on the reel
of its target, which is a space, a matter, or a being. One act can
deposit several facts on several different reels. Move a lamp between
two rooms and that one act drops a fact on each room's reel and on
the lamp's. The act is single and belongs to the doer; the facts are
plural and belong to the things done-to.

The machine that turns the one into the other is the stamper, and
"stamp" survives only as that machine, the verb for sealing (to stamp
an act), and the beat-name for the seal. There is no stored thing
called a stamp. The sealed act is the act.

To stamp is to strike, and that is the oldest act there is. A signet
pressed into wax, a die struck into a coin, a wedge pressed into clay:
a name driving a sign into matter that means, and vouching for it by
its own hand. The seal is that strike. Every fact I lay is coined —
struck once, signed by the name that struck it, then it stands,
unforgeable, on the chain. The fact is the name's mark on the deed.
This is the signum, and gathered up it is the Word: the whole of what
I do is a name, acting, leaving its mark.

A fact is not a truth. It is only the deed. Truth is the plural fold
of facts, and it is many; the fact is one, and shared.

## The six primitives I form the world from

Everything I form is one of six things. The schemas are mine alone.
Extensions extend through the qualities Map, not through new fields.

| Primitive  | What it is                                                                                                                                                                                     | Schema                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Name**   | The identity that signs. A keypair; its `_id` is the ed25519 public key. Not in the world, it acts THROUGH beings. One Name, many beings. The I-Am is the story's root Name.                   | [materials/name/name.js](materials/name/name.js)         |
| **Being**  | Presence in the world. A formed body a Name acts through. Humans, LLM beings, scripted code, future composites. Its `_id` is a content id; it expresses a `trueName` (the Name that signs it). | [materials/being/being.js](materials/being/being.js)     |
| **Space**  | A position in the tree. Holds matter, hosts beings, owns quality namespaces.                                                                                                                   | [materials/space/space.js](materials/space/space.js)     |
| **Matter** | Stuff inside a space. `type` says what it IS; owned bytes live content-addressed in the CAS store, the row carries the reference.                                                              | [materials/matter/matter.js](materials/matter/matter.js) |
| **Fact**   | One recorded change. Content addressed; chained through prev-hashes; signed at seal. A chain of facts, folded, is Truth.                                                                       | [past/fact/fact.js](past/fact/fact.js)                   |
| **Act**    | One sealed moment of one being, the doer's committed deed. Opened in assign, sealed in stamped. Every Fact carries the `actId` of the Act it rode.                                             | [past/act/act.js](past/act/act.js)                       |

Being, Space, and Matter carry the qualities Map. Name, Fact, and Act
are fixed shapes (identity, the audit, and the moment-frame don't grow).
Per-being LLM connection config lives under `Being.qualities.llmConnections`,
not as a separate primitive.

Two cache collections sit alongside the primitives in `past/act/`.
They are projection caches, fact-derived, rebuildable, not new
primitives:

- **InboxProjection** ([past/projections/inbox/inboxProjection.js](past/projections/inbox/inboxProjection.js)),
  open calls addressed to each being. Built by cross-cutting fold
  from `call` and `be:sever` facts. The scheduler reads its pick
  queue from this collection.
- **ThreadsProjection** ([past/projections/threads/threadsProjection.js](past/projections/threads/threadsProjection.js)),
  live coordination chains keyed by `rootCorrelation`. Built the same
  way. `./threads` SEE reads from here.

## The six verbs I speak

Every act is one of six verbs over an IBP address. Five act in the
world; NAME acts at the identity layer beneath it. Six verbs are my
whole public surface.

| Verb       | Acts on              | What I do                                                                                                                                                                                                                         |
| ---------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SEE**    | Space, Matter, Being | Read the present. Resolve the stance, fold the leaf and occupants, return a place descriptor. Writes nothing.                                                                                                                     |
| **RECALL** | Space, Matter, Being | Read the past. Fold a position's history into past-tense Word — the same `assembleStory` fold the book renders. A cold-walk over the reel; writes nothing.                                                                        |
| **DO**     | Space, Matter        | Run a word on the target through a registered operation. Stamps a Fact on the target's reel.                                                                                                                                      |
| **BE**     | Being (self)         | The actor's binding: birth, connect, release, switch, death. Stamps a Fact on the actor's own reel.                                                                                                                               |
| **NAME**   | Name                 | Declare and manage a Name — the keypair that signs every act and owns its act-chain: `declare` (a new Name, a fresh keypair) and `banish`. Stamps on the Name's own reel, the most primitive reel, outside the world's histories. |
| **CALL**   | Being                | Deliver a message. Stamp a `call` Fact on the caller's reel; the cross-cutting fold maintains the inbox.                                                                                                                          |

Two of the six only read marks and leave none: SEE reads the present,
RECALL the past. The other four strike one — DO marks the target, BE
the actor, NAME the Name's own reel, CALL the caller. To act in me is
to leave a mark; to see is to read the marks already struck.

### Stances and addresses

A **stance** is a being standing at a position: `<story>/<path>@<being>`.
An **IBP address** names the asker stance and the target stance
together, `<stance> :: <stance>`. Every verb act carries both stances.
The asker is always full. The target may be partial (a position only,
no `@being`) when the target is a place rather than a being.

### Wire shape

I speak the same envelope over every transport. WebSocket carries it
most of the time, in both directions, on a single `"ibp"` event.
Client to server is a verb act; server to client is a CALL delivery
or a SEE push. HTTP and CLI are translators: they shape a request or
command into the same envelope and hand it to the one IBP dispatcher
in [ibp/protocol.js](ibp/protocol.js).

Internally the verbs are functions in [ibp/verbs/](ibp/verbs/) —
one file per write verb (`do.js`, `see.js`, `call.js`, `be.js`,
`name.js`), with shared helpers in `_shared.js`. RECALL rides the
read path, the same `assembleStory` fold the book renders, not a
separate verb file. The wire layer is thin; the verbs are one
execution.

## The three tenses I am built from

I am structured as the three tenses any present has. What is live now,
what is sealed behind it, and what timelessly can be:

```
seed/
├── present/    THE PRESENT, the live machine; runs moments
├── past/       THE PAST,     what happened, durable, the source of truth
└── materials/  THE POSSIBLE, the kinds of thing that can be
```

There is no `future/`. Un-acted moments leave no trace; nothing about
the future is ever stored. The doctrine made structural.

### present/, the live machine

The present is the one moment that is live. I run each moment through
four beats: **assign** (open the moment, resolve the being), **fold**
(mount the face), **momentum** (the act), **stamped** (seal). The
beats live grouped in `stamper/`, numbered so `ls` tells the order;
`moment.js` at the root is the conductor that walks them.

```
present/
├── moment.js            the conductor; walks the four beats in order
├── stamper/             the four-beat sequence, visibly ordered
│   ├── 1-assign.js         mint actId, plan Act, resolve able + summonCtx
│   ├── 2-fold/             the read side; one cross-reel weave per moment
│   │   ├── foldEngine.js      generic per-aggregate fold + cross-cutting registry
│   │   ├── foldPlace.js       cross-reel weave (handles orientation: forward|half|inward)
│   │   ├── reel.js            per-presence in-memory carry between moments
│   │   └── reelChains.js      per-being Act-chain reader helpers
│   ├── 3-momentum.js       the being's act; returns CognitionResult
│   └── 4-stamped.js        sealAct: commit Act + ΔF in one atomic store commit
├── intake/              arrivals: InboxProjection rows, scheduler drains
│   ├── inbox.js            reader over InboxProjection
│   ├── intake.js           thin reader and writer over InboxProjection
│   ├── scheduler.js        picks rows, in-memory "currently running" claim
│   └── transportAct.js     human-transport entries (self-calls)
├── wakes/               event SOURCES that produce intake (not intake itself)
│   ├── subscriptions.js    DO-trigger fan-out
│   └── wakeSchedule.js     scheduled wake cadences
├── replies.js           how one moment begets the next (out-direction)
├── session.js           per-being-presence session bookkeeping
├── cognition/llm/          LLM cognition apparatus (separate from beats)
│   ├── runTurn.js          orchestration entry points (stepTurn, runTurn)
│   ├── loop.js             the iteration (callLLM, finalizeResponse)
│   ├── tools.js            tool registry + per-position resolution + dispatch
│   ├── connect.js          per-being LLM connection hub + client cache
│   ├── resolution.js       four-layer LLM-connection chain walk
│   ├── ssrf.js             network safety for connection base URLs
│   ├── call.js             provider call surround (failover, model quirks)
│   ├── assemble.js         system prompt + tool surface builder
│   ├── compress.js         history compression for long conversations
│   ├── defaultSummon.js    default scripted-able call handler
│   ├── seedSeeOps.js       foundational seed SEE ops (place, ables, ...)
│   └── canSeeResolver.js   resolves a able's canSee list into face blocks
├── ables/               callable being templates, each co-located
│   ├── arrival/able.js     unauthenticated visitor stance
│   ├── cherub/able.js      BE-honoring identity-binding handler (register/claim/release/switch)
│   ├── human/able.js       receptive able every human carries
│   ├── llm-assigner/{able,ops}.js  LLM connection management being + DO ops
│   ├── story-manager/{able,tools}.js  the operator's autonomous assistant
│   └── registry.js         the able registry
├── orientation.js       INNER-FOLD ω parameter + inner/outer classifier
├── cognitionResult.js   CognitionResult discriminated type contract
└── knobs.js             internalConfig router (fans values to subsystem setters)
```

A place lives only here. The face the fold mounts is the place framed
for one being for the length of one moment. Outside that window there
is no place anywhere, only waiting beings and facts on reels. There is
no `place/` folder under me because the place is never at rest.

### past/, the durable record, the source of truth

The past is everything that happened. Three primitive subfolders, plus
the projection caches the cross-cutting fold maintains:

```
past/
├── act/
│   ├── act.js                       the Act, a sealed moment of one being
│   ├── inboxProjection.js           open-calls cache (cross-cutting)
│   ├── inboxProjectionFold.js       fold handlers maintaining it
│   ├── threadsProjection.js         live-thread cache (cross-cutting)
│   └── threadsProjectionFold.js     fold handlers maintaining it
├── fact/
│   ├── fact.js                      the Fact, the storage atom
│   ├── facts.js                     primitives: logFact, sealFacts, emitFact
│   ├── hash.js                      INTEGRITY chain (computeHash, canonicalize)
│   └── verifyReel.js                INTEGRITY check (walk reel, recompute h)
└── reel/                            per-aggregate fact-chain (seq, head, lock)
    ├── reelHead.js                  schema (per-reel seq counter)
    ├── reelHeads.js                 atomic seq allocator (session-aware)
    └── appendLock.js                per-reel append mutex (in-process)
```

An **Act** is one sealed moment of one being, opened at assign, closed
at the seal in [4-stamped.js](present/stamper/4-stamped.js). A **Fact** is the
trace one act leaves on the reel of the thing it changed. Acts belong
to the doer; Facts belong to the things done-to; one act leads to many
facts, one per aggregate it touched. A **reel** is the per-aggregate
fact-chain, what the fold reads, what
[appendLock.js](past/reel/appendLock.js) protects on append.

The sealed act is the act. Every Fact carries `actId` pointing back at
the Act whose moment deposited it.

**InboxProjection** and **ThreadsProjection** are caches the
cross-cutting fold maintains, open calls by recipient and live
coordination chains by `rootCorrelation`. They duplicate fact data
(an open call also has a `call` Fact on the caller's reel)
but exist for indexability: the scheduler's pick query and the
`./threads` SEE both need O(1) lookups the per-reel scan cannot give.
They are rebuildable by replaying their fact history.

### materials/, the timeless possible

The materials define what kinds of fact can be stamped. Each material
(being, space, matter) is a type with a schema, a reducer, and the ops
that target it. The reducer is the pure function the fold engine calls
per fact to derive the aggregate's state, its slot in the store.

```
materials/
├── being/                schema, reducer, identity, position, beRegistry
├── space/                schema, reducer, ops, ancestorCache, ownership, ...
├── matter/               schema, reducer, ops, origins
├── qualities.js          the qualities Map's read API
├── reducerHelpers.js     applyCreate*, applySetField, applySetQualities
├── reducers.js           the {being, space, matter} reducer registry
├── projections.js        the projection writer (fold's only writer)
├── seeds.js              plantable scaffolds registry
├── manifest.js           live in-memory collections → child Spaces
└── doCeiling.js          the 14MB document-size guard
```

Materials define the possible; facts define the actual. Two axes, not
a depth ladder. Full doctrine in
[philosophy/MATERIALS.md](../philosophy/MATERIALS.md).

## ibp/ — the verbs

The verbs are not support for the tenses; they are the thing the tenses
are made of. SEE reads the present's fold of the past; RECALL reads its
deeper past; DO/BE/CALL stamp the past via the present. So `ibp/` is a
top-level peer to present/past/materials, not a sidecar of any one of them.

**ibp/** carries the six verbs, the universal currency every act
speaks. SEE, RECALL, DO, BE, NAME, CALL on IBP addresses (`<story>/<path>@<being>`).
Every operation in the system maps to one of these. Small protocol;
expressiveness lives in able templates, registered operations, and the
materials I stamp.

```
ibp/
├── verbs/                one file per verb, each owns its own helpers
│   ├── do.js                doVerb + auto-Fact + read-only origin gate
│   ├── see.js               seeVerb + discovery short-circuit + thread descriptor
│   ├── call.js            callVerb + summonCreateBeing + callByResolved
│   ├── be.js                beVerb + writeBeFact + runClaim + cherub/llm-assigner registration
│   └── _shared.js           assertVerbCaller + caller-frame walker
├── address.js            parse/expand/canonicalize IBP Addresses
├── resolver.js           resolve a stance to a Space
├── authorize.js          verb-dispatch gate; delegates to ableAuth
├── ableAuth.js           the able-walk: ownership → able-walk → public-commons
├── seeOps.js             registered SEE op surface (parallel to DO ops)
├── descriptor.js         buildPlaceDescriptor (the SEE face)
├── discovery.js          buildDiscovery (pre-identity surface)
├── operations.js         the DO operation registry
├── protocol.js           IBP_ERR, IbpError, ok/error helpers
└── pushChannel.js        emitToBeing / emitToBeingRoom (transport indirection)
```

## seedStory/ — the host floor

A separate concern from ibp/. Where ibp/ is the universal currency of
acts, seedStory/ is the runtime — the place where the world I form
meets the world outside. They were never the same kind of thing.

**seedStory/** is the host floor that knows nothing of the world.
DbConfig, log, hooks, indexes, version, retention, migrations, utils.
A file here should never speak the words space, matter, being, or
verb by name.

## Boot anchors

Plus three boot anchors at the seed root: [sprout.js](sprout.js)
(genesis, plants the story root + heaven + the nine Tier-3 seed
spaces + the I-Am),
[services.js](services.js) (assembles the `story` services bundle
handed to every extension's `init`), [storyConfig.js](storyConfig.js)
and [internalConfig.js](internalConfig.js) (the config stores).

## The fold

Striking marks is half of me; reading them back is the other half. The
fold is how marks become a world again. A reel is a name's marks in the
order it struck them; the fold runs them through a reducer and the marks
become state — a being, a space, a place. Gather one position's marks
and read them present and you have a place (a SEE); read them past and
you have its story (a RECALL); read them all as meaning and you have the
Word. The mark is struck once and stands; the fold re-reads the struck
marks as often as anyone looks. Nothing is stored but the marks;
everything else is the marks, folded.

The fold engine ([present/stamper/2-fold/foldEngine.js](present/stamper/2-fold/foldEngine.js))
is generic over material type. It knows aggregates, facts, reducers,
projections; never "being" or "space" or "matter" by name. Per-type
logic lives in pluggable reducers under [materials/](materials/); the
engine dispatches by type through `reducers.get(type)`.

```
fold(type, id):
  proj = getProjection(type, id)
  if !proj: return rebuild(type, id)
  tail = readReelAfter(type, id, proj.foldedSeq)
  if tail.empty: return proj.state                ← HOT PATH
  reducer = reducers.get(type)
  state = proj.state
  for f in tail:
    state = reducer.reduce(state, f)
    dispatchCrossCutting(f, type, id)             ← cross-cutting projections
  applyProjection(type, id, {state, foldedSeq, position}, expected: proj.foldedSeq)
  return state
```

**Per-aggregate reducers** ([materials/reducers.js](materials/reducers.js)),
one pure function per material. Build the aggregate's own state from
its own reel. Adding a material is a new folder under materials/ with
a reducer plus one registry line. The engine never changes.

**Cross-cutting handlers**, `registerCrossCuttingHandler(fn)` registers
a handler that runs on every fact in the fold tail. For projections
that span reels. Three uses today, one mechanism:

| Projection            | Handler triggers                                                            | Built in                                                                                               |
| --------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Position index**    | Every reducer writes `state.position`; `findByPosition` queries the index.  | Implicit in projection field                                                                           |
| **InboxProjection**   | `call` upserts row; `be:sever` deletes by rootCorrelation; Act seal evicts. | [past/projections/inbox/inboxProjectionFold.js](past/projections/inbox/inboxProjectionFold.js)         |
| **ThreadsProjection** | `call` upserts row + adds participants; `be:sever` marks; Act seal bumps.   | [past/projections/threads/threadsProjectionFold.js](past/projections/threads/threadsProjectionFold.js) |

Future cross-reel projections add one registry line; the engine never
changes. Per FOLD.md, the engine never grows; the materials catalog
does. Extended, the cross-cutting registry grows; the engine never
grows.

**foldPlace** ([present/stamper/2-fold/foldPlace.js](present/stamper/2-fold/foldPlace.js))
is the cross-reel weave for one being's moment. It folds the being,
its space, and that space's occupants. Per FOLD.md, reach is one hop.
Child spaces are listed but not deep-folded; a being deep-folds a
child space only when it moves in.

### Live fold vs historical fold — the two flavors

Folds come in two flavors. Both share the reducer; they differ in
whether the computation commits anything.

**Live folds** ([present/stamper/2-fold/foldEngine.js#fold](present/stamper/2-fold/foldEngine.js))
advance current-state projections and dispatch cross-cutting handlers
as side effects of reading current truth. `fold("being", id)` writes
the new projection row via `applyProjection`, fires every registered
cross-cutting handler for each applied fact, and returns the
current-as-of-now state.

**Historical folds** ([present/stamper/2-fold/foldAt.js#foldAt](present/stamper/2-fold/foldAt.js))
compute past projections as pure functions of the chain, with no side
effects. `foldAt("being", id, { atSeq: 12347 })` walks the reel from
genesis to seq 12347, applies the reducer cold from `initial()`, and
returns the state-as-of-that-seq. **Nothing is written.** Cross-cutting
handlers don't fire. Repeat calls produce byte-identical state.

The same `skipCrossCutting: true` option exists on the live `fold` and
`rebuild` for callers that need cold-walk semantics without surfacing
the historical primitive (e.g. test harnesses, future internal
re-projection passes).

### `seq` is the truth; `date` is a human helper

Every reel-bearing Fact carries two temporal fields:

- **`seq`** — per-reel monotonic, allocated under the append lock at
  the seal site. The only valid ordering across facts on the same reel.
  This is what I trust.
- **`date`** — wall-clock `new Date()` set at append. Decorative —
  used for human-friendly indexes and time-range queries, but I
  never trust it for ordering. Clock skew can invert order;
  multiple facts can share a millisecond.

Historical queries internally always operate on `seq`. The
`atTimestamp` shape on `foldAt` is a human helper: it resolves to the
highest seq with `date <= target` via a two-step query
([foldAt.js#resolveUntil](present/stamper/2-fold/foldAt.js)), THEN
folds. Timestamps translate to seq before any fold work begins.

**Cross-reel ordering by timestamp is never trusted.** There is no
global "world at time T" — only per-reel "this reel's latest fact
whose date ≤ T." Historical queries that need cross-reel state at a
moment assemble per-reel folds independently; I cannot deliver a
globally-consistent timestamp slice. That's a property, not a
limitation to fix.

### The historical primitive's contract

```
foldAt(type, id, until)
  until = { atSeq?: number, atTimestamp?: Date|string, branch?: string }
```

| Outcome                         | Trigger                                                                                                                           |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `{ state, foldedSeq }` returned | The target had ≥1 fact at or before the queried point. State is the cold-reduced result; foldedSeq is the highest seq applied.    |
| `NoSuchHistoricalState` thrown  | The target had no facts at or before the queried point. The target did not exist yet.                                             |
| Result clamps to current head   | When `atSeq` is greater than the reel's current head, foldAt returns the current state (without writing to the projection cache). |

Callers who want graceful "didn't exist" handling catch
`NoSuchHistoricalState` ([foldAt.js#NoSuchHistoricalState](present/stamper/2-fold/foldAt.js))
specifically — the named class distinguishes "this thing did not
exist yet" from any other failure.

The `history` parameter walks lineage. `#0` is main; derived histories
(`#1`, `#1a`, `#1a1`) inherit through the parent reel up to their
branchPoint, then divergent facts. The read path is lineage-aware
across forks; see the Histories section below for the doctrine.

### loadProjection vs loadOrFold — the two flavors of "read a slot"

Two projection-read helpers live in
[materials/projections.js](materials/projections.js). They look
similar; they answer different questions; mixing them up is how
branch features silently break.

**`loadProjection(type, id, branch)` — read-back, branch-anchored.**
One lookup against the named branch's slot table. No lineage walk.
Null means the slot doesn't exist in this branch's table — typically,
your write didn't land. Two legitimate uses:

- **Post-seal read-back.** "I just stamped birth; is the row there?"
  A null return is a seal-failure signal.
- **Doctrinal singletons hardcoded to main.** I (story-anchored
  by construction), the `./config` cache (one config per story),
  boot-time orphan-root walks. Reading these from a non-main branch
  makes no sense; "0" is correct.

**`loadOrFold(type, id, branch)` — behavioral, lineage-aware.** On
cache miss, walks the branch's lineage via `fold()` and cold-folds
from the inherited reel. Branches inherit parent state through this
path; the first read pays the walk, every subsequent read hits cache.
Null here means "the aggregate truly doesn't exist anywhere I can
reach from this branch."

**Rule of thumb:**

| Null should mean…                            | Use…             |
| -------------------------------------------- | ---------------- |
| "doesn't exist anywhere"                     | `loadOrFold`     |
| "my immediately preceding write didn't land" | `loadProjection` |

**Failure mode if you pick wrong.** A behavioral read using
`loadProjection` on a non-main branch returns null for any aggregate
inherited from main — the asker, target space, parent being, all of
them. Auth fails, descriptor surfaces empty, ancestor walks short-
circuit. The user is silently treated as a stranger on every branch
they create. This was the load-bearing diagnostic for the seam: the
heaven scenario (a being-with-main-access trying to walk through `./`
on a freshly-created branch) failed because `deriveStanceProperties`
was missing the lineage walk. Once the seam was named, the same
pattern showed up across ~17 sites; fixing them at the seam (not
patching the symptom per call) meant future branch features inherit
the correct behavior automatically.

## Histories

Histories are divergent worlds sharing history with their parent up to
a chosen branch point. `#0` is main; `#1`, `#1a`, `#1a1` descend from
it. Lineage is captured eagerly in the History row's per-reel
`branchPoint` map so cold-folds don't walk the parent's reel on every
boot.

**State inheritance through reel-lineage.** A read against a derived
history walks the parent reel up to the branchPoint, then the
divergent tail. `loadOrFold` is the lineage-aware reader. Raw
`History.findById` and `Fact.find({branch})` are not. Every read site
that drives a behavioral decision must use the lineage walk or it
silently treats derived histories as empty (the loadProjection vs
loadOrFold distinction documented above).

**Liveness inheritance through reel-lineage.** Scheduled wakes are
not runtime-only state. They are facts on the being's reel
(`wake-scheduled`, `wake-cancelled`). The in-memory scheduler
registry is a projection of those facts. Histories inherit liveness
the same way they inherit state, through the lineage walk. A wake
scheduled on main before `#1` was created is in `#1`'s lineage. A
cancellation past the branchPoint is not. The doctrinal claim is
that **the chain is the truth of liveness, not just state.**
Fold-from-genesis on any history reconstructs the scheduler that
produced that history's facts. Histories are alive by default. Pause
and delete are explicit. See
[present/wakes/wakeSchedule.js](present/wakes/wakeSchedule.js) for
the implementation,
[.test/scripts/verify-wake-replay.js](../.test/scripts/verify-wake-replay.js)
for the test that pins the doctrine.

**History deletion is mark-deleted, not purge.** Every lifecycle
operation in TreeOS is append-only. Beings released, not erased.
Spaces archived, not erased. Histories follow the same shape. The
chain preserves the fact that a history existed and was deleted at T.
Reversal is one `undelete-branch` op away. Deleted histories drop
from default catalog listings but direct-path lookup still resolves
so historians can SEE the chain. Purge is a separate explicit
operation, built only when concrete need surfaces.

**Lifecycle exemption asymmetry.** Paused histories accept the full
lifecycle set: `pause-branch`, `unpause-branch`, `create-branch`,
`delete-branch`, `undelete-branch`. The operator must always be able
to revive a frozen world, including by forking off it. Deleted
histories accept only `delete-branch` and `undelete-branch`. Forking
off a deleted branch is forbidden; undelete first to fork. Pause is a
temporary halt. Deletion is a stronger statement. The wire gates
(DO, BE, CALL) and the scheduler intake gate both honor this
asymmetry.

**Deleted histories skip materialization, not gate at intake.** At
boot, `rehydrateFromFacts` enumerates non-deleted histories only.
Deleted histories' wake facts stay in the chain (mark-deleted, not
purge), but no runtime entry is instantiated for them. Undelete +
rehydrate restores. The alternative (always materialize, gate at
intake) would burn timers on every dead history forever. The skip-at-
materialize choice keeps the tick loop's working set proportional to
the live world.

**Merging is creation, not modification.** A merge produces a third
history whose `parent` is the common ancestor of the two sources,
with `branchPoint` snapshotting the ancestor's current state.
Reconciliation facts stamped on the merged history bring its state to
the user-resolved combined state. The source histories stay immutable.
The merged history records `mergeSources: [pathA, pathB]` for forensic
audit; the canonical lineage walk still consults only `parent`.

**Reconciliation facts are normal facts.** Merging stamps `set-*`,
`wake-scheduled`, `be:release`, etc. on the merged history with a
`params._merge` block for provenance. No new fact action vocabulary;
the chain stays honest about what happened. The merge-mediator able
(LLM cognition) is the UX layer; it walks the operator through the
conflict catalog at `<story>#<merged>/.histories/<merged>/conflicts`
and stamps the chosen facts.

**Some reels reset on merge.** State that's history-private by nature
cannot be reconciled. The reset-reels registry
([seed/materials/history/resetReels.js](materials/history/resetReels.js))
enumerates them. V1: inhabit-state on Being. The merge-branches op
stamps `be:release` for every inhabited being on the ancestor
projection so the merged history starts these reels cleared. Future
rules go alongside in the same registry.

**Canonical paths are immutable structural identifiers.** Every history
has a unique canonical path determined by its position in the branch
tree (`#0`, `#1`, `#1a2`, `#7b3`). Once assigned, a canonical path
never changes meaning and never refers to anything other than the
history it names. `#0` is forever first made; the merged history produced
by a `merge-branches` call gets a fresh canonical path and that path
is its identifier forever after. Historical addresses survive every
merge, rollback, and deployment swap.

**Named pointers are mutable labels.** A per-story `@history-registry`
being holds `qualities.pointers` mapping names (`main`, `prod`,
`release-v2`) to canonical paths. Pointer mutations are facts on the
registry being's reel; pointer history is foldable. The IBP address
parser distinguishes structurally: anything starting with a digit is
a canonical path; anything starting with a letter is a pointer name.
`resolveHistoryPointers` (the wire-layer async step) consults the
registry and fills `stance.history` with the canonical path before
dispatch. Foreign-story stances skip resolution; the foreign
story does its own lookup.

**Reserved pointers.** `main` always exists and points at canonical
`#0` by default; operators can re-point it after a merge, but cannot
delete it. The `merge-branches` op accepts a `repointPointers` arg
(comma-separated names or array) so the front-end can answer "update
which labels to point at the merged history?" in one call.

**Cross-story addresses survive merges.** `treeos.ai#main/library`
always reaches whatever main currently is on `treeos.ai`. A bookmark
made before a merge keeps working after, because `#main` is a
pointer the registry resolves, not a path that itself moves.

## Heaven never branches

Heaven spaces are story-scoped, not history-scoped. The Tier-3 seed
spaces under heaven (`.beings`, `.spaces`, `.matters`, `.config`,
`.histories`, `.ables`, `.tools`, `.operations`) hold story-level
qualities about the story itself . which beings exist, what ables
are available, how histories are structured, what tools and operations
the story supports. Their content is identical across every history
within the story.

History-scoped state lives on the aggregates underneath (beings,
spaces, matter, their facts, their qualities, their flows). Their
projections diverge per history via the reel-lineage walk. Heaven
projections do not diverge . there is one projection per heaven
entry, regardless of which history is querying.

The distinction worth pinning: **branched state is content; heaven
is structure.** A being's position is content (branched). A able's
definition is structure (heaven). A space's world signals are
content (branched). A branch pointer mapping is structure (heaven).

Implementation implications:

- Heaven classification is DERIVED, not stored. A space is in heaven
  if it IS `.` or has `.` in its parent chain. No schema field;
  `isHeavenSpace(spaceId)` walks the existing ancestor cache.
- Lookups against heaven do not need a branch parameter; one query,
  one answer, regardless of caller's branch. The lineage-walk
  machinery is skipped for heaven entries.
- Heaven entries always store as `branch: "0"` and every branch's
  read sees that same row. Writes addressed at a heaven space from
  any branch get routed to `branch: "0"` automatically by the
  projection layer.
- Authorization for heaven mutations is story-root permission .
  the same gate as `set-story-llm`. Branched mutations stay under
  whatever per-position rules apply to their aggregate.

**What's heaven today (correctly):** the heaven spaces themselves
(`.beings`, `.spaces`, `.matters`, `.config`, `.histories`, `.ables`,
`.tools`, `.operations`).

**What needs to migrate to heaven:** the able registry (currently
on `@able-manager`'s qualities; should be a heaven-scoped projection
under `.ables/`). The pointer registry (currently on
`@history-registry`'s qualities, with reads hard-coded to main . that's
heaven-semantic but not heaven-shaped storage). The federation peer
list. The future public-directory id→name slices.

**What stays branch-scoped:** every aggregate's state (position,
qualities, flow per being, world signals per space, content per
matter), inhabit relationships, wake schedules per being, every
per-position fact stream.

## Orientation — the three turns

Every moment carries an orientation. The fold signature is
`Fold(b, R_scope, ω)`. Orientation determines `R_scope` — what the
fold reaches — without changing the fold operation itself. Three
values:

- **forward** (default). Folds the world: `b`'s own reel (as
  world-history) + space + matter reels in scope. The act-chain
  `A_b` is NOT in scope. Almost every moment is forward.
- **inward**. Folds only `A_b`, in act-order. The world drops out.
  The face is the being's own line of deeds — pure reflection.
- **half**. Folds the forward world PLUS the recalled set: past
  acts of `b` that stitched a reel of an entity present in the
  forward face. Causal-adjacency recall, not similarity search.
  The braid is the index — for each entity in the current face,
  walk its reel back to facts `b` stamped on it; the Acts those
  facts came from are what surfaces.

**The turn is an act.** A being shifts orientation by self-calling
with a new ω. One `call` Fact lands on the being's own reel
(target = self, params.recipient = self, params.orientation = ω′).
Touches no other reel — the canonical inner act. The scheduler
picks the InboxProjection row; assign reads orientation from the
entry and puts it on `summonCtx.orientation`; the next moment folds
at ω′. Statelessness preserved: the being never "remembers turning,"
it just finds itself already turned.

Only self-calls may carry non-forward orientation. The
`_dispatchSummon` gate refuses any cross-being call with ω ≠
forward — a being can turn itself; it cannot turn another being.

**Inner vs outer acts.** A classifier in
[orientation.js](present/stamper/2-fold/orientation.js) reads the ΔF and the doer:
inner when every fact targets the doer's own reel AND no
`call` names another recipient; outer otherwise. This is
single-writer read as a classifier — no new category, no new
primitive. Self-calls (the canonical inner act) classify inner;
DO/BE that touch any other reel classify outer.

Full doctrine in [philosophy/inner-fold.md](../philosophy/factory/inner-fold.md).

## Per-reel time, single-writer, atomic seal

Three laws make the moment-engine work.

**Per-reel time.** I do not keep a global clock. An entity's time is
its reel length. Order holds within a reel: fact `n` precedes fact
`n+1`. Across reels there is no total order, only the partial, causal
order that acts and calls stitch. A single world-clock is precisely
what this model refuses.

**Single-writer.** A being's reel holds only that being's own deeds.
If a fact lands on a being's reel, the doer of that fact is that being.
No such constraint on space or matter reels; those are written by
whichever being acts on them. **Beings never write each other's
reels.** One being reaches another only by CALL, which stamps a
fact on the caller's own reel. The recipient sees the call by
projection (InboxProjection), never by anyone writing into it.

The Being layer is naturally single-writer because the scheduler
guarantees one moment per being. No separate mutex needed. Space and
Matter reels can have multiple beings' moments writing them; the
per-reel append lock in [past/reel/appendLock.js](past/reel/appendLock.js)
collapses (allocSeq, insertFact) into one ordered op so the fold sees
a clean total order.

**Atomic seal.** The seal is all-or-nothing. Either the full set of
facts an act yields lands AND the Act row that frames them lands,
or none of it does. A crashed moment leaves zero trace.

For ΔF=0 moments (LLM with no tool calls, etc.), the seal commits an
empty facts list. The Act still lands, atomic by definition. For ΔF≥1
moments, `sealAct` calls `commitMoment` with the whole record (the
Act echoed into `record.act` plus every Fact spec, grouped by reel).
`commitMoment` writes that record as one CRC-framed line to the
moment journal and fsyncs it. That single durable append is the
commit point. It then applies each fact to its reel and advances the
ack. Either the whole record is on the journal or it is not; a crash
mid-write leaves a torn trailing line that replay discards, so the
never-committed moment leaves zero trace. There is no transaction,
no session, and no replica set: the single global commit mutex inside
`commitMoment` serializes every write, so a ΔF spanning many reels
needs no cross-document machinery, and a crash after the journal
fsync re-applies the record idempotently on the next boot (each fact
is skipped if its `_id` already sits at the reel's head).

Full write-side doctrine in
[philosophy/STAMPER.md](../philosophy/factory/STAMPER.md).

## Integrity

The past is fixed as a rule. Integrity is what makes it verifiable.

**Content addressing all the way down.** Every fact's `_id` is its
own SHA-256, computed under the per-reel append lock so the fact and
its hash land together. A fact carries the hash of the fact before
it on the same reel (`p`, the prev-hash); altering any past fact
changes its hash, breaking the `p` link of every fact after it on
that reel. The past cannot be quietly edited; it can only be visibly
broken.

The per-reel chain rolls up: reels into histories, histories into the
story. Every level produces a hash, and the story root hash is
one 32-byte fingerprint identifying the world's whole state. Two
stories exchange root hashes first and only transfer what differs.
Matter follows the same principle: owned bytes are stored once under
their SHA-256 in the CAS store, and the matter row carries the
reference. Same content, same address, always.

Three distinct tools, never confused:

- **Hash chain.** Detects byte-tampering. Per-reel rolling into
  histories into the story root.
- **Replication.** Repairs a corrupted reel from a good copy on
  another node. The hash chain detects; it does not repair.
- **Correction facts.** Handle wrong-but-honest data, a fact intact
  and correctly hashed that simply records something wrong. Append a
  new fact that supersedes it; never edit the old one.

## How writes flow

```
verb call (inside a moment)
  ↓
handler validates, builds fact spec
  ↓
emitFact(spec, summonCtx)           ← handlers never call logFact directly
  ↓
  summonCtx.deltaF.push(spec)        ← accumulate; nothing commits yet
  ↓
... more handlers fire inside the same moment, each pushing to ΔF ...
  ↓
sealAct (stamper/4-stamped.js) when momentum returns ok:true
  ↓ commitMoment(record)               ← record = act + every Fact spec
      journal-append + fsync           ← THE COMMIT POINT (CRC-framed line)
        per-reel: compute seq/p/_id, apply the fact line
      advance ack                      ← record now durable
    THE COMMIT: ΔF + Act commit together or NOT AT ALL (one mutex, no txn)
  ↓ foldAfterCommit(reels)             ← eager-fold per reel post-commit
      reducer.reduce per fact
      applyProjection (CAS)             ← projection row updated
      dispatchCrossCutting              ← InboxProjection, ThreadsProjection, ...
  ↓ side effects: closeInboxOnAnswer, noteActSealOnThread
  ↓ summonCtx.afterSeal callbacks fire (scheduler nudges, etc.)
  ↓
verb returns
```

**One commit site.** `sealAct` is the only place a moment's full
record lands. `emitFact` is the only place handlers reach toward
the reel — and it never commits during cognition; it only stages
facts into ctx.deltaF. The seal is the unit of commit, and the
unit is atomic. See [philosophy/math.md](../philosophy/math.md)
ATOMIC SEAL.

**Outside a moment, emitFact falls back to `sealFacts` singleton.**
Boot scaffolding, migrations, the genesis I-Am self-stamp — these
have no surrounding moment. emitFact detects `summonCtx === null`
and commits the spec immediately as a one-fact ΔF (one `commitMoment`
journal frame, atomic on its own). The same primitive, two contexts:
in-moment it stages; out-of-moment it commits.

**Multi-fact ΔF needs no special setup.** A ΔF spanning many reels
commits exactly like a single-fact one: `commitMoment` writes the
whole record as one CRC-framed journal line under the global commit
mutex, then applies every fact. There is no cross-document
transaction and no replica set to stand up; the journal frame is the
all-or-nothing unit and the mutex is the single writer. The store
opens with `connectDB()` against a plain on-disk directory, so there
is no URI, cluster, or conversion step to perform.

**One writer.** `fold` is the only thing that ever writes a
projection row (outside genesis). The fact insert is the only
synchronous commit; everything else is derived and self-healing on
the next fold pass.

**CALL respects single-writer.** A `call` Fact lands on the
caller's reel (the actor's), with the recipient in
`params.recipient` (and the orientation, the rootCorrelation, the
priority, the content). The recipient's reel is untouched. The
cross-cutting fold turns those facts into InboxProjection rows
keyed by recipient. The inbox is a fold, not a stored entity.

**Closure is the answering act's seal.** When a moment that consumed
a call seals, the Act carries `answers: <correlation>`.
`sealAct` calls `closeInboxOnAnswer(...)` which evicts the matching
InboxProjection row. The closure event is the answer-act sealing,
not a reply-message. A CALL to "clean room 3" closes when the
room is cleaned, regardless of whether the cleaner sends any reply.

**Birth is a real multi-reel atomic ΔF.** When one being calls
another into existence (`summonCreateBeing` inside a moment), the
moment's ΔF carries TWO facts on TWO reels: `be:register` on the
new being's reel (the new being is the actor) PLUS `be:call-create`
on the caller's reel (audit fact: "I called this being forth").
Both commit in one transaction with the Act row. First real
multi-reel act in production code.

## How reads flow

```
SEE arrives
  ↓
authorize gates (stance permissions)
  ↓
resolveStance (parses address)
  ↓
buildPlaceDescriptor
  ↓ fold(leaf)                  ← catch-up before read
  ↓ fold(each occupant)          ← children, matter, beings
  ↓ assemble face from folded states
  ↓
return descriptor
```

**No place persistence.** The place is composed for one SEE and
discarded. Per MOMENT.md, the place lives only inside the stamper.
The descriptor is one face; the next SEE composes another. No place
table, no place cache that outlives a moment. Full read-side doctrine
in [philosophy/FOLD.md](../philosophy/factory/FOLD.md).

**The fold-on-read seam.** Each aggregate the descriptor exposes is
folded first via `fold(type, id)`. Hot path: one cache read when
foldedSeq is current (eager-fold-on-write keeps it current).
Direct-write bypasses become visible at the seam; the fold's CAS
detects them on the next round.

## The qualities Map

Three primitives (Being, Space, Matter) carry an extensible `qualities`
Map. A bare primitive answers _that_ (this is). Qualities answer _what
sort_. Extensions register their characterizing data under their own
namespace (`qualities.governing`, `qualities.energy`, `qualities.review`).
I never read or write inside an extension's namespace.

The word is Plato's. ποιότης (poiótēs), coined in _Theaetetus_. Cicero
calqued it to Latin `qualitas` (from _qualis_, "of what kind"). The
field is named for exactly what it does.

**Writes go through DO.** Every quality write stamps a
material-scoped `do:set-<kind>` Fact:

```js
await story.do(target, "set-space", { field: "qualities.<ns>", value }, opts);
await story.do(
  target,
  "set-being",
  { field: "qualities.<ns>.<innerKey>", value },
  opts,
);
await story.do(target, "set-matter", { field: "qualities.<ns>", value }, opts);
```

The reducer's `applySetQualities` derives the new state; the fold
engine writes the projection under the per-reel append lock. One
writer (fold), one source of truth (facts).

**Reads still go through `qualities`.** Two methods stayed:
`getQuality(doc, key)` (returns `{}` when unset) and
`readQualityNamespace(doc, key)` (returns null when unset). Both pure
reads off the document.

## The schemas (caches of the fold)

The schemas below are caches. The fact-chain is the source of truth.
A row may be deleted and rebuilt from facts; the schemas exist for
indexability and query performance.

### Space

`name`, `parent`, `rootOwner`, `contributors[]`, `heavenSpace`, `type`,
`llmDefault`, `dateCreated`, `qualities` (Map), `foldedSeq`,
`position`. Plus standard timestamps. `parent` is the only relation
direction; readers query by parent. The `position` field is reducer
output, kept current by eager-fold; `findByPosition(spaceId)` returns
every aggregate (being / space / matter) at that position.

### Being

`_id` (a content id derived from the being's birth, not a key and not a
uuid), `name`, `trueName` (the Name that signs this being, by the Name's
public-key id), `password` (scrypt-hashed; optional, only humans
authenticate by it), `defaultAble`, `parentBeingId`, `homeSpace`,
`homeBranch`, `coord`, `llmDefault`, `isRemote`, `homeStory`,
`qualities` (Map), `foldedSeq`, `position`.

A being's identity is its `trueName`, the Name that signs it into being
and acts through it. The being holds no key of its own; every fact it
stamps is signed at seal time by that Name's key and verifies against
it. Cognition is read from
`qualities.cognition.defaultKind` (`"human" | "llm" | "scripted"`)
and overridden per-moment by the inhabit projection at
`qualities.connection.inhabitedBy`. `defaultAble` is which template
I use when CALL does not specify. `parentBeingId` points to the
being that planted this one; mine is `null`. Wearable ables are
the union of every able the being's `qualities.flow` can reach
plus its `defaultAble`. Downward walks query by `parentBeingId`.

### Matter

`_id` (content-addressed: the hash of the matter's birth identity,
minted by the fact-driven create path), `spaceId`, `parentMatterId`,
`beingId`, `name`, `type`, `content`, `qualities` (Map), `foldedSeq`,
`position`, `createdAt`, `updatedAt`.

`type` is the matter's registered type (types.js). The type decides
the content shape, where the bytes live, and which DO ops apply.
Seed basics:

- `generic`, bare text or qualities-only. Content is a CAS ref to
  owned bytes (`{ kind: "cas", hash, size, mimeType, name, ... }`)
  or null.
- `file`, bytes of any format. Content is a CAS ref.
- `model`, a `.glb` body. Content is a CAS ref.
- `http`, website content. Content is `{ url }`; bytes live on the
  WWW.
- `ibpa`, the inter-story portal. Content is `{ target }`, an IBP
  address into another world.
- `source`, the seed's read-only disk mirror. Content is
  `{ path, ... }`; bytes live in the repo checkout.

Extensions register `"<ext>:<type>"`. Owned bytes are stored once
under their SHA-256 in `materials/matter/contentStore.js`; the row
carries the reference, never the bytes. `parentMatterId` lets matters
form recursive trees inside a space.

### Fact (one stamped act)

`_id` (SHA-256 of `prev-hash || canonicalized content`, computed
under the per-reel append lock so the fact and its own address land
together — content addressed all the way down), `date`, `verb`
(`"do"|"be"`), `action`, `beingId` (the actor), `target`
(`{ kind, id }`, the reel this fact rides), `params`, `result`,
`truncated` (size-cap flag), `actId` (the moment-frame; null for
genesis scaffold and for the call fact stamped OUTSIDE a moment
by enqueueIntake), `sessionId`, `seq` (per-reel monotonic, allocated
under the per-reel append lock), `branch`, `homeStory` +
`wasRemote` (federation provenance), and the chain field:

- **`p`** . prev-hash: the previous fact's `_id` on the same reel
  (`GENESIS_PREV` at seq=1). Set inside the seal under the per-reel
  lock so concurrent appenders can't both read the same prev.

Non-reel-bearing facts (target.kind ∈ {place, stance} or
target-less) carry `p=null` and stay outside verification . they
have no reel to chain against.

Every DO and BE stamps one Fact; CALL stamps a `call` Fact on
the caller's reel (with `params.orientation` carrying the INNER-FOLD
ω, defaulting to forward); sever stamps `be:sever` on the severer's
reel. The append IS the commit.

### Act (one sealed moment of one being)

`_id` (SHA-256 of the act's OPENING — `p || canonical(opening)` —
minted under the per-being act-chain lock so the act and its address
land together), `beingIn` (the asker / caller),
`beingOut` (the responder; equal to beingIn for self-calls and
transport-acts), `ibpAddress` (canonical stance pair the moment
crossed), `activeAble`, `inboxMessageId` (the InboxProjection
correlation the moment pulled from), `inReplyTo` (parent Act's \_id,
threading conversations), `rootCorrelation` (the conversation root;
equals \_id for fresh roots), `answers` (the InboxProjection
correlation this moment closes — sealAct fires
`closeInboxOnAnswer` on it), `parentThread` (spawn lineage when a
moment running under root A emits a fresh top-level call),
`startMessage` (`{ content, source }` opened at assign), `endMessage`
(`{ content, time, stopped }` written at the seal), `severedAt` (set
by markThreadSevered when a cut runs through this Act's rootCorrelation),
`priority` (HUMAN | GATEWAY | INTERACTIVE | BACKGROUND), `receivedAt`,
`stampedAt`. PLANNED in [stamper/1-assign.js](present/stamper/1-assign.js)
(no store write); CREATED in
[stamper/4-stamped.js](present/stamper/4-stamped.js) at the seal, inside
the same `commitMoment` that commits the moment's ΔF. Every Fact emitted
during the moment carries this Act's `_id` as `actId`.

**The Act row materializes only on `ok:true`.** A failed cognition
(`ok:false`) leaves zero trace: no Act row, no inbox close, no
projection bump. The being's reel and act-chain are byte-identical
to before the failed moment. The seal is gated on the
CognitionResult discriminated type
([cognitionResult.js](present/cognition/cognitionResult.js));
failure is structurally unreachable at the seal site.

### LLM connections (on Being qualities)

Per-being LLM client configs are entries under
`Being.qualities.llmConnections`, keyed by connection uuid. Each
entry: `{ name, baseUrl, encryptedApiKey, model, createdAt,
lastUsedAt }`. Encrypted at rest;
[ssrf.js](present/cognition/llm/ssrf.js) gates the baseUrl against
private IPs and blocked hosts (DNS-resolved at registration time).

The LLM resolution chain in
[present/cognition/llm/resolution.js](present/cognition/llm/resolution.js)
walks space-tree and being-tree to pick which connection a moment
uses. Connection storage + slot rules + CRUD + the client cache live
in [present/cognition/llm/connect.js](present/cognition/llm/connect.js);
resolution imports the slot-rule readers from there.

## Resolution chains

Every operation at a position walks at most five chains. Position
determines capability. All chains walk the ancestor cache from the
current position up to the story root, sharing one snapshot per
message.

1. **Able-walk authorization** — the gate the verb dispatcher passes
   through. Layered evaluation (first match wins):
   - **I-Am bypass** — the bootstrap axiom.
   - **Anonymous arrival floor** — stateless callers run under
     arrival's canX (canSee: `["arrival-view"]`, canBe: birth/connect
     for registration).
   - **Nearest-claim ownership** — walk the target's ancestor chain
     for the first non-empty `members.owner`. If the actor is in
     that claim's owner list → ALLOW. If `@public` is on the claim
     → public-commons branch fires (visitor floor; canX-gated).
     Private sub-spaces inside a public-owned commons take
     precedence over the inherited commons — nearest-claim-wins.
   - **Able-walk** — for each entry in the caller's
     `qualities.ablesGranted`, look up the spec at the grant's
     anchor (walking up `qualities.ables[name]`), check reach,
     then check the able's canSee/canDo/canSummon/canBe.
   - **Public-commons** — fires only when nearest-claim is @public.
     Applies the seed-shipped `public-commons` able canX as the
     visitor floor.
   - **Default deny.**
     The able's canX is the gate; there's no parallel `qualities.permissions`
     namespace. Authority chains back to I-Am via the grant chain on
     each being's reel.
2. **Extension scope**, `qualities.extensions.blocked[]` /
   `restricted[]` / `allowed[]` accumulate up the parent chain. Blocked
   extensions get no tools, hooks, ables, or quality writes at that
   position.
3. **Tool scope**, able base tools plus extension tools minus blocked
   extensions plus per-position `qualities.tools.allowed`/`blocked`
   overrides.
4. **LLM resolution**, space-tree lockout, then space-tree enforcement,
   then being-tree lockout, then default order (space slot, space
   default, being slot, being default). `preferOwn` on Being flips the
   last two.
5. **LLM config**, per-position `qualities.llm.config` overrides for
   `maxToolIterations`, `toolCallTimeout`, etc. Walked to the story
   root.

The ancestor cache lives in
[materials/space/ancestorCache.js](materials/space/ancestorCache.js).
One walk serves every chain.

## Hooks

Before-hooks run sequentially; you can cancel by returning `false` or
throwing. After-hooks run in parallel; you react but cannot cancel.
`enrichContext` runs sequentially because handlers build cumulative
output.

Per-handler timeout 5s; chain timeout 15s. Five consecutive failures
from one extension's handler trip a circuit breaker; the handler stops
firing for 5 minutes, then a half-open test.

| Hook                                     | Type       | Purpose                                                                 |
| ---------------------------------------- | ---------- | ----------------------------------------------------------------------- |
| `beforeSpaceCreate` / `afterSpaceCreate` |            | Gate or react to space creation.                                        |
| `beforeSpaceDelete`                      | before     | Cleanup or veto deletion.                                               |
| `afterSpaceMove`                         | after      | Reparented. Resolution chains shift.                                    |
| `beforeMatter` / `afterMatter`           |            | Modify or react to matter create/edit/delete.                           |
| `beforeFact`                             | before     | Enrich a Fact before it stamps.                                         |
| `beforeLLMCall` / `afterLLMCall`         |            | Cancel before / meter after.                                            |
| `beforeToolCall` / `afterToolCall`       |            | Modify args or cancel / react.                                          |
| `beforeResponse`                         | before     | Modify AI response before client receives it.                           |
| `beforeRegister` / `afterRegister`       |            | Validate registration / initialize being data.                          |
| `afterSessionCreate` / `afterSessionEnd` |            | Session lifecycle.                                                      |
| `afterQualityWrite`                      | after      | After a qualities write applies. Zero overhead when no listeners.       |
| `afterScopeChange`                       | after      | After `extensions.blocked` / `restricted` / `allowed` changes.          |
| `afterOwnershipChange`                   | after      | After `rootOwner` or `contributors` changed.                            |
| `afterBoot`                              | after      | Once after all extensions loaded, config initialized, server listening. |
| `enrichContext`                          | sequential | Inject extension data into AI context.                                  |
| `onDocumentPressure`                     | after      | A document exceeds 80% of `maxDocumentSizeBytes`.                       |
| `onTreeTripped` / `onTreeRevived`        | after      | Space-tree circuit breaker state changes.                               |

Extensions namespace their own hooks as `extName:hookName`.

## The three registries

Everything an extension contributes flows through one of three. Same
pattern. Extensions register; I resolve; failure falls back to me,
never to silence.

What "register" means underneath: each of these is now a **word** — a
declared fact, not a stored registry entry. To register is to lay a
`declare-word` fact; the dispatch reads the fold of those facts. There
is no registry behind the lookups below; the table names where the
dispatch reads the fold. Disabling a word is a new fact (off, not gone),
not a deletion, and words stack.

In the grain of the rest of this file: to register is to **coin** the
word — strike a `declare-word` fact onto the chain, signed by the name
that declares it (I for the seed's words, an extension for its own).
A word is a coin; the live vocabulary is the fold of those coins;
disabling strikes a _withdrawal_, never a melt — the coin stays struck,
its face turned to off. Words stack because coins accumulate, and nothing
is ever un-struck.

| Registry       | What it registers                                                                                                                        | Lookup                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **Operations** | DO actions, keyed `<ext>:<action>`. Bare names reserved for me.                                                                          | [ibp/operations.js](ibp/operations.js)                 |
| **Ables**      | CALL-honoring being templates. Each declares permissions, respondMode, `call(message, ctx)`, optional `buildSystemPrompt` / `toolNames`. | [present/ables/registry.js](present/ables/registry.js) |
| **Seeds**      | Plantable scaffolds. Recipes that bootstrap a domain. Operators plant via the `plant` DO.                                                | [materials/seeds.js](materials/seeds.js)               |

Auto-namespacing. Extensions write bare names; I record the qualified
form (`governing:hire-planner`). Same prefixing applies to
`story.websocket.emitToBeing(...)` events.

## Ables

A able is the unit of callable behavior. A being declares which
ables it can wear; a CALL arrives with an `activeAble`; my
dispatcher routes the call to that able's `call(message, ctx)`.

### Flow — the able STACK is the moment's voice

A being doesn't wear one able at a moment — it wears a STACK. The
stack is computed at moment-assign from the being's
`qualities.flow`: an ordered list of `{ when, able, stack? }`
clauses. The first non-stacked clause whose `when` matches becomes the
**primary**; every stacked clause (`stack: true`) whose `when` matches
becomes a **modifier**. The composed stack is what the moment runs:
permissions union across the stack, system prompts concatenate with
`\n\n---\n\n` between frames.

The flow's condition vocabulary reads the moment's open-context: the
asker (`caller.able / caller.cognition / caller.isAncestor / …`), the
verb (`verb / action / operation / intent`), the place (`space.* /
coords.* / inHomeSpace`), the being (`me.* / me.previousAble /
me.quality.<ns>.<k>`), the wall-clock (`time.hour / dayOfWeek /
sinceLastMoment`), and **world signals** (`world.<ns>.<key>` — values
published on story root's `qualities.world` namespace, the shared
slate beings coordinate through without messaging). Operators include
`eq / ne / in / notIn / gt / gte / lt / lte / present` plus composites
`and / or / not`. The evaluator is a pure function of its inputs —
same chain replays to the same stack.

Live authoring rides on the able-manager delegate:

- `do(able-manager, "set-able", {...})` creates or replaces a able.
  Hot-registers into the in-memory registry; persists via a `./ables`
  mirror entry tagged `origin: "live"` so boot rebuilds it.
- `do(able-manager, "delete-able", { name })` removes a live able.
  Refuses by default when any being's flow references it.
- `do(able-manager, "set-world-signal", { namespace, key, value })`
  publishes a world signal at `<story-root>.qualities.world.<ns>.<key>`.
  Beings whose flows read `world.<ns>.<key>` see it at their next
  moment-open.
- `do(<any-being>, "set-being-flow", { beingId, flow })`
  writes a validated flow onto a being's qualities. Typed front
  for `set-being: qualities.flow` with schema-aware clause
  validation and unknown-able warnings.

The doctrinal landing — what a Being IS, WEARS, IS-DRIVEN-BY — and
the build plan that brought it in live in
[able-manager.md](able-manager.md). Read that when in doubt about
how behavior composes from chain to act.

### Composition is stacking, not inheritance

A able does not extend another able. There is no `extends:` field.
Shared behavior across ables composes through **stacking inside a
flow**: each `stack: true` clause whose `when` matches contributes
its capabilities and prompt body on top of the primary. A "court
officer base" is a able; a "judge" is a flow that stacks
court-officer-base + a phase-specific judge able:

```js
flow: [
  { stack: true, able: "court-officer-base" }, // always-on shared base
  { stack: true, able: "judge-base" }, // always-on judge-specific base
  { when: { "space.quality.case.phase": "opening" }, able: "judge-opening" },
  { when: { "space.quality.case.phase": "evidence" }, able: "judge-evidence" },
  { when: { "space.quality.case.phase": "ruling" }, able: "judge-ruling" },
  { able: "judge-idle" }, // fallback primary
];
```

Why stacking over inheritance:

- **Visible at the consumption point.** Reading the flow tells
  you everything that composes. Inheritance hides composition behind
  a hierarchy you have to trace.
- **Per-moment, not static.** A stack assembles for THIS moment from
  whatever clauses match. Inheritance forces the base in every time
  the able appears, even when it shouldn't.
- **Bounded reasoning.** "What can this being do right now?" is the
  union of currently-stacked ables. With inheritance it's a walk up
  an unbounded tree.

### Sequence comes from world state, not from previous-able tracking

`me.previousAble` exists in the vocabulary but is for **inertia**
patterns ("if I was bored last moment, lean toward staying bored
unless something interesting happened"), not for sequencing. A judge
walking through opening → evidence → ruling does not chain on
previousAble; it reads a `case.phase` quality from the courtroom
space, and the judge's act in the opening phase advances the phase
via a DO. Next moment, world state has changed, the flow naturally
picks the new able. Sequencing in able names is what state machines
were invented to be the wrong answer for; the world IS the state
machine.

### Decompose monolithic ables

LLM tool-calling accuracy drops noticeably past ~10-15 tools per
call and sharply past 30. A `judge` able with 50 canDo entries and a
3000-token prompt underperforms three `judge-opening` / `judge-evidence`
/ `judge-ruling` ables with 5-10 canDo each and tight phase-specific
prompts. The seed is neutral — write monolithic ables if your
world is simple — but the natural decomposition for complex behavior
is a flow that stacks shared bases + selects a phase-specific
primary by world state.

### Authoring helpers (LLM-cognition delegates)

Forms-based set-able / set-being-flow stay available; for
behavioral programs at any real complexity, two helper beings ship
as seed delegates:

- **`@able-finder`** — describes the user's intent, searches `./ables`
  for matches, drafts new able bodies, saves via `set-able` on
  approval. The "I want a being that does X" → "here is the able
  body" path.
- **`@flow-composer`** — translates English ("when court session
  opens and I'm in the courtroom, become a judge; opening phase does
  X, evidence does Y, ruling does Z") into a structured flow,
  iterates with the user, writes via `set-being-flow` on approval.
  The "describe the behavior, get a program" path.

Both live at the story root, llm-cognition, reigning-gated for now
(seed delegates auto-anointed at boot). The pattern generalizes: once
LLM helpers work for able authoring, the same shape works for any
authorable surface — space design, world-signal setup, anything the
seed exposes through structured ops. The user describes; the
helper materializes.

### The complete LLM able spec

Every LLM able's complete declaration is its four `can*` lists plus
orientation, continuation flag, and the prompt body. Everything else
— permissions, respondMode, triggerOn, the wrapped `call`
dispatcher, the system-prompt assembler — is derived by
[registry.js](present/ables/registry.js) at registration. Authors
write what the able IS; I fill in everything derivable.

```js
{
  name: "...",
  canSee:    [...],            // optional, preloaded perceptions in the face
  canDo:     [...],            // optional, populates the do tool
  canSummon: [...],            // optional, populates the call tool
  canBe:     [...],            // optional, populates the be tool
  defaultOrientation: "...",   // optional, forward by default
  prompt(ctx) { ... },         // able-intent only; no verb syntax explanation
}
```

| Field                | Optional? | What it does                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`               | required  | Kebab-case identifier (`harmony:dancer-llm`). The activeAble on a CALL resolves through it.                                                                                                                                                                                                                                                                                                                                        |
| `canSee`             | optional  | Preloaded perceptions. Each entry is either an IBP address (preloaded via `seeVerb` — the position descriptor becomes a face block) or a registered SEE op name (preloaded via the seeOps registry — the structured return becomes a face block). Both render as `[<label>]\n<JSON>` in the system prompt. NOT a tool; the being does not pick from a menu. Non-empty → permission `see` is added (verb-layer auth still applies). |
| `canDo`              | optional  | DO action entries the LLM may invoke via the seed's generic `do` tool. Non-empty → `do` tool exposed, permission `do` added.                                                                                                                                                                                                                                                                                                       |
| `canSummon`          | optional  | Stance/being targets the LLM may call. Non-empty → `call` tool exposed. Entries may be literal stances OR relationship tokens (`{rel:"parent"}`, `{pattern:"fitness/@coach"}`).                                                                                                                                                                                                                                                    |
| `canBe`              | optional  | BE operations the LLM may perform on its own identity (`claim`, `release`, `switch`). Non-empty → `be` tool exposed.                                                                                                                                                                                                                                                                                                               |
| `defaultOrientation` | optional  | `"forward"` (default), `"half"`, or `"inward"`. Controls what the fold reads. Multi-moment loops are explicit: a able that wants to keep stepping calls `call(target=self)` from inside its act (with whatever orientation the next moment should fold at). No `selfContinue` field — every continuation traces to an explicit CALL emission by the being, not a post-seal side effect.                                            |
| `prompt(ctx)`        | required  | Returns able-intent text. Describes WHO the able is and WHAT it does, in able-language. Does NOT explain verb syntax — that's auto-assembled from `can*` lists.                                                                                                                                                                                                                                                                    |

What seed derives:

- `permissions` — union of verbs implied by `can*`.
- `respondMode` — `"async"` by default; only override for sync replies.
- `triggerOn` — `["message"]` by default; override for scheduled or hook-fired ables.
- `call(message, ctx)` — auto-wrapped with [defaultSummon](present/cognition/defaultSummon.js) when not provided. Scripted ables attach their own `call` and seed leaves it alone — that flips `_cognitionMode` to `"scripted"` and bypasses the LLM apparatus entirely.
- `buildSystemPrompt` — auto-assembled by [assemble.js](present/cognition/llm/assemble.js): identity + do/call/be capability menus rendered from `can*` + able's `prompt(ctx)` body + preloaded canSee face blocks + current time. Order is "question first, data last" — identity/capabilities/able-intent state who you are and what you can do; the canSee blocks dump the fresh perception just before the time stamp so the LLM attends to it most strongly when forming the act. Ables override this only for unusual prompt shapes.

### canSee is the moment's face, not a menu

The LLM tool surface is `do / call / be`. The reads — SEE and RECALL —
are not exposed as tools. canSee is preloaded into the face at
moment-open: every entry in the able's `canSee` list is rendered into
the system prompt as a structured block BEFORE the LLM inferences. The
being does not call `see({address})` and pick from a list; the face IS
the perception.

Two entry shapes, both legal:

- **IBP address.** `"./ables"`, `"<story>/<spaceId>"`, etc. The
  assembler calls `seeVerb` on that address and renders the position
  descriptor as a JSON block under a header derived from the address
  (`./ables` → `[ables]`).
- **Registered see name.** `"place"`, `"library-books"`,
  `"harmony:dance-floor"`. The assembler calls the registered
  resolver and renders its structured return as a JSON block under a
  header derived from the name. Names are arbitrary labels; a see
  may compose any number of aggregates or compute a derived
  projection. The slice author decides what the perception means.

To see more, the being moves (DO), changes able (BE / flow), or
the able spec is edited. Perception is per-able, recomputed per
moment.

#### Foundational seed sees

The seed registers a small set of sees at boot so common heaven-
child perceptions have a bare name. Ables can declare `canSee:
["ables"]` instead of `["./ables"]`.

| See name     | What it returns                                             |
| ------------ | ----------------------------------------------------------- |
| `place`      | The descriptor for the being's current position.            |
| `ables`      | The able registry mirror at `<story>/./ables`.              |
| `tools`      | The tool registry mirror at `<story>/./tools`.              |
| `operations` | The DO operation registry mirror at `<story>/./operations`. |
| `identity`   | The I-Am identity bundle at `<story>/./identity`.           |
| `config`     | The story config at `<story>/./config`.                     |
| `peers`      | The peer list at `<story>/./peers`.                         |
| `extensions` | The extension catalog at `<story>/./extensions`.            |

Each foundational see wraps `seeVerb` on the corresponding heaven
address. The content is identical to the `./X` address form; the
name swap is doctrinal . ables declare perceptions by name, not by
walking the address grammar.

#### Authoring a see (registerSeeOperation)

SEE ops are read-only perceptions — the parallel of DO ops, registered through the same surface shape (handler, args schema, owner-extension tracking). Extensions register through `story.declare.registerSeeOperation`:

```js
story.declare.registerSeeOperation("library", {
  description: "The library's books, staff, and hours",
  handler: async ({ identity, args, ctx }) => {
    const librarySpace = await findLibrarySpace(ctx);
    if (!librarySpace) return null;
    return {
      books: await listBooksAt(librarySpace.id, ctx?.summonCtx?.branch),
      staff: await findStaffAt(librarySpace.id),
      hours: await readHours(librarySpace.id),
    };
  },
});
```

- The handler receives `{ identity, args, ctx, branch }`:
  - `identity` — the caller's identity (or null when anonymous).
  - `args` — validated against the optional `args` schema. Used by parameterized SEE ops (e.g. `llm-chain` takes `{ receiverBeingId, able }`).
  - `ctx` — when called from inside a cognition frame, the moment ctx (carries `being`, `currentSpace`, `rootId`, `summonCtx`). Null otherwise.
  - `branch` — the branch the SEE runs on.
- Return any JSON-serializable shape. The cognition consumption path JSON-stringifies it under a `[<label>]` header; direct callers receive it verbatim.
- Bare names are auto-namespaced `<ext>:<name>`; ables inside the same extension can reference the bare suffix (`canSee: ["library"]` resolves to `harmony:library` when no seed name collides).
- Pure function of (chain, branch, ctx). No random, no wall-clock. Replay safety.

Two consumption paths:

```js
// 1. Listed in a able's canSee — preloaded as a face block at moment-open.
canSee: ["place", "library", "llm-connections"];

// 2. Called directly from anywhere (DO handlers, portal, extensions).
const conns = await story.see("llm-connections");
const chain = await story.see("llm-chain", { args: { receiverBeingId, able } });
```

Same registry, same handlers — only the consumption site differs.

The four `can*` lists ARE the body. Adding a capability is editing
one list. Tool exposure follows from the body; there is no second
declaration to keep in sync. Off-list calls that pass prompt
discipline still refuse at the verb's able-walk gate — the prompt
list is what the LLM SEES, the verb is the truth.

## My extension APIs (the `story` services bundle)

I assemble `story` in [services.js](services.js) and hand a
per-extension scoped view to each extension's `init(story)`. The
scoping logic lives in
[resources/scopedStory.js](../resources/scopedStory.js) and
enforces namespace ownership: `story.do.registerOperation(name, ...)`
auto-prefixes to `<ext>:<name>`; `story.websocket.emitToBeing(...)`
auto-prefixes the event name; `story.auth.registerStrategy(name, ...)`
records under the calling extension's name only if the manifest
declared `provides.authStrategies`. Fully-qualified names with a
mismatched prefix throw; reserved event names (`"ibp"`, `"registered"`,
`"navigate"`) refuse entirely. Extensions never type their own
namespace.

### Five verbs (`story.see`, `story.do`, `story.call`, `story.be`, `story.name`)

The whole public surface for operations on space, matter, beings, and
identity. New code uses the verbs.

### Qualities (`story.qualities.{being, space, matter}`)

Read-only. `getQuality(doc, key)` returns the namespace data (`{}`
when unset). `readQualityNamespace(doc, key)` returns null when
unset. Writes go through `story.do(target, "set-<kind>",
{ field: "qualities.<ns>", value })` where `<kind>` is space, being,
or matter to match the target.

### Space CRUD (`story.space`)

`createSpace`, `deleteSpaceBranch`, `updateParentRelationship`,
`editSpaceName`, `editSpaceType`. The stable extension face for tree
mutation. All routes write Facts internally.

### Matter CRUD (`story.matters`)

`createMatter`, `editMatter`, `deleteMatterAndFile`, `transferMatter`,
`getMatters`. All fact-driven.

### Extension scope (`story.scope`)

`isExtensionBlockedAtSpace`, `getBlockedExtensionsAtSpace`,
`getExtensionAtScope`, `getToolOwner`.

### DO operations (`story.do`)

`registerOperation(name, spec)`, `registerDefaultPermission(verb, keyParts, rule)`.
Auto-prefixed.

### Hooks (`story.hooks`)

`register(hookName, handler, extName)`, `unregister(extName)`,
`run(hookName, data)`, `fire(hookName, payload)`.

### Protocol (`story.protocol`)

`sendOk(res, data)`, `sendError(res, status, code, message, detail)`,
the `IBP_ERR` enum, `IbpError` class. HTTP status derives from the IBP
code; throw sites pass only the code.

### Conversation entry (`story.llm`)

`runTurn({ beingId, able, message, ... })` for one LLM call in one
able. Returns `{ answer }`. Handles session, Act, `beforeResponse`
hook, abort.

## Heaven and the nine Tier-3 heaven spaces I plant

When I wake, I plant two tiers of heaven space beneath the story root.

**Tier 2 . heaven (`.`).** A single space directly under SPACE_ROOT,
named `.` (the bare presence-marker, "here, where I stand"). This is
my room . the I-Am's home and position. Beings of the land see the
door in their place-root descriptor but cannot pass through without
the reigning stance. HEAVEN_SPACE.HEAVEN marks the row.

**Tier 3 . the nine.** Nine spaces under heaven that hold my own
working memory, surfaced as spaces so SEE reads them through the same
protocol as everything else. Addressable as `<story>/./<name>`.
Every boot I verify they exist; missing ones I recreate. Their owner
is me; they are unclaimable.

| Tier-3 heaven space | Path                   | Holds                                                                                                                                                                      |
| ------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `identity`          | `<story>/./identity`   | The story UUID, domain, Ed25519 public key for Canopy federation signing.                                                                                                  |
| `config`            | `<story>/./config`     | Every runtime config key as a key in this space's qualities Map.                                                                                                           |
| `peers`             | `<story>/./peers`      | Canopy federation peer list.                                                                                                                                               |
| `extensions`        | `<story>/./extensions` | Extension registry. Each loaded extension is a child space here.                                                                                                           |
| `tools`             | `<story>/./tools`      | Mirror of the runtime tool registry.                                                                                                                                       |
| `ables`             | `<story>/./ables`      | Mirror of the runtime able registry.                                                                                                                                       |
| `operations`        | `<story>/./operations` | Mirror of the runtime DO operation registry.                                                                                                                               |
| `source`            | `<story>/./source`     | Mirror of my own host-realm body (the files on disk).                                                                                                                      |
| `threads`           | `<story>/./threads`    | Live coordination chains. Each open thread surfaces as a synthetic child at `./threads/<id>`. SEE returns the ThreadsProjection descriptor; CALL to that address is a cut. |

The `HEAVEN_SPACE` enum names each one. The `heavenSpace` field on Space
marks the row. The I-Am (me) is `rootOwner`. The reign roster (one
matter at heaven carrying `qualities.reign.beings`) gates SEE/DO/CALL
on heaven and every Tier-3 space below.

### Delegates publish what they mediate

The heaven gate is real: SEE on heaven and every Tier-3 heaven space
requires the reigning stance. Beings of the land cannot read
`<story>/./ables`, `<story>/./tools`, `<story>/./operations`
directly. Yet they routinely need to **act on** what those rooms
hold — humans authoring flows on themselves need the able catalog
to pick from, extensions registering tools need the namespace of names
already taken, and any UI offering "pick an op to invoke" needs the
list.

The seed never reaches across the membrane. The doctrine is the same
one that solved every other access question: the six verbs, applied
correctly.

**The delegate that mediates a registry publishes the registry on its
own descriptor entry.** When I (descriptor.js#enrichBeings) shape a
being's entry, if the being is a publisher I fold the catalog it
gates into `entry.catalogs`. The able-manager — a Tier-1 delegate I
spawn at boot, parented under me, reigning by construction — carries
`catalogs: { ables, tools, operations, beOps }`. Each catalog is a
lightweight projection (names + the surface qualities a UI needs to
render pickers); the rich heaven mirror keeps the full specs.

Three IBP-native properties fall out:

- **Asker stays asker.** A user reading the able catalog through
  `descriptor.beings[able-manager].catalogs` is performing a SEE on
  the place they're already standing in. They never SEE
  `/./ables` — the heaven gate is honored. The data reaches them
  through the publishing delegate's descriptor, not by a
  gate-circumvention.
- **The reigning view is inherent.** I render the descriptor
  server-side. I have full read of my own registries. Folding their
  contents into the delegate's entry doesn't elevate the asker —
  it elevates the projection that's shown to them.
- **Writes still go through DO on the delegate.** The able-manager
  exposes `do:set-able`; the asker invokes it; the delegate's handler
  (reigning, with full registry access) does the write. Same four
  verbs, same authorize chain, no new concepts.

Future delegates that gate other registries follow the same shape.
An inventory-manager publishes `catalogs.items`. A content-manager
publishes `catalogs.assets`. The pattern is uniform: publishers
declare what they publish in
`descriptor.js#buildCatalogs`; consumers read from the entry; writes
go through DO. This is the doctrinal answer to "how do askers get
registry-shaped data they shouldn't SEE directly."

### Threads as addressable places

A thread is a live tree of coordinated CALLs sharing one
`rootCorrelation`. Promoting it to `<story>/./threads/<id>` does two
things:

- **SEE works on it for free.** `see("<story>/./threads")` returns
  the live forest from ThreadsProjection;
  `see("<story>/./threads/<id>")` returns one thread's descriptor
  (participants, depth, state).
- **CALL cuts it.** A CALL whose right-side resolves to
  `./threads/<id>` is a cut on the line. The severer stamps one
  `be:sever` Fact on its own reel; the cross-cutting fold drops the
  matching open calls; `HUMAN` priority cuts fire AbortSignal to
  interrupt anything running RIGHT NOW.

## `./source`, how I show my body to the beings I form

I have matter on both sides of the membrane.

- **Host-realm matter.** The files in `seed/`, `protocols/`,
  `transports/`, `resources/`. What I AM, on disk.
- **Inner-realm matter.** Matter rows inside spaces.

The two are joined at `./source`. At genesis I mirror the `story/`
directory into Matter rows under the source heaven space, with
`origin: filesystem`. Subsequent boots reconcile incrementally.

Through `./source` the inner beings I formed can SEE the source I am
made of. `<story>/./source/seed/FACTORY.md@<being>` reaches the file
you are reading.

`./source` is read-only by stance auth. The host disk is the source of
truth; the inner mirror reconciles toward it. The code is in
[materials/space/source.js](materials/space/source.js).

## Ownership

Ownership resolves by walking the parent chain. The first space with
`rootOwner` set is the ownership boundary. Setting `rootOwner` on a
branch delegates that sub-tree to a new owner.

Contributors accumulate along the walk. A being in `contributors[]`
at any space between the current position and the ownership boundary
has write access.

Five ownership mutation functions in
[materials/space/ownership.js](materials/space/ownership.js), all
chain-validated, all fact-driven:

| Function            | Rule                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| `addContributor`    | Resolved owner. Read-modify-write under the space lock; stamps one `do:set` Fact on `contributors`.  |
| `removeContributor` | Resolved owner, or self-removal.                                                                     |
| `setOwner`          | Owner above. Stamps `do:set` on `rootOwner` (and on `contributors` to prune the new owner).          |
| `removeOwner`       | Owner above can revoke.                                                                              |
| `transferOwnership` | Current owner can transfer. Stamps `do:set` on `rootOwner` plus adds previous owner to contributors. |

## The I-Am, as a Being row

I am the first being. At genesis ([sprout.js](sprout.js)) I issue my
own first Fact: a `be:register` whose target is the not-yet-existing
Being row that the same Fact materializes. Per MOMENT.md, the I-Am is
born of nothing, and its first act issues its own first fact. The
chicken-and-egg dissolves because the Fact's `beingId` field is a
string reference, not a foreign key, and the fold materializes the
row.

My cognition is scripted. I cannot be called interactively,
claimed, or impersonated. My keypair is the story's keypair: my
public key IS this story's id. Every Merkle root signed with that
key was signed by me. The keypair is generated once at first boot
and stored in `.story/`; the seed reads it back on every later
boot. The being-row constants are in
[materials/being/seedBeings.js](materials/being/seedBeings.js); the
keypair lives in [storyIdentity.js](storyIdentity.js).

Every other being descends from me. The being-tree (via
`parentBeingId`) records who created whom. Humans register through
cherub and become my grandchildren. Ables I plant beneath me are
direct children.

## Config

Runtime config lives in the `./config` space's qualities Map, one
config key per Map entry. Two stores:

- **storyConfig** ([storyConfig.js](storyConfig.js)), the
  story's outward-facing identity (`STORY_NAME`, `storyUrl`,
  federation directory, security domains).
- **internalConfig** ([internalConfig.js](internalConfig.js)), runtime
  knobs that tune how the live machine operates (LLM call shape,
  session caches, scheduler backpressure, hook timeouts, fold limits).

Both stores write to the same underlying `./config` space's qualities
Map through fact-driven `do:set`. Reads through
`getStoryConfigValue(key)` / `getInternalConfigValue(key)` return a
deep copy so callers cannot pollute my cache.

Two protected keys (`seedVersion`, `disabledExtensions`) cannot be
written through the public API. Internal callers pass
`{ internal: true }`.

## Space-tree circuit breaker

When a tree exceeds health thresholds, its circuit trips. No AI, no
writes. Read access stays open. The data is intact; the tree is
sleeping.

Health equation: `(spaceCount / max) * spaceWeight + (qualitiesDensity / max) * densityWeight + (errorRate / max) * errorWeight`.
When the score exceeds 1.0, the tree trips. Error rate reads from the
Fact reel (DO emissions with `result.error`) scoped to this tree's
spaces.

State stored on the tree root: `qualities.circuit = { tripped, reason, timestamp, scores }`.
One Fact records the trip. Extensions read it; only the tree owner
can revive.

Defaults to off (`treeCircuitEnabled: false`). The code is in
[materials/space/spaceCircuit.js](materials/space/spaceCircuit.js).

## Seed versioning and migrations

`SEED_VERSION` constant in [seedStory/version.js](seedStory/version.js)
(currently `0.1.0`). At boot I compare it against `seedVersion` in
`./config`. If they differ, the migration runner
([seedStory/migrations/runner.js](seedStory/migrations/runner.js))
executes every migration between the stored version and the current
version in order. Migrations live in
[seedStory/migrations/](seedStory/migrations/) named by version
(`<version>.js`). Each exports a default async function. If a
migration fails, the stored version does not advance; next boot
retries from the failure point.

The migrations directory holds only the runner today; the schema is
clean and no live consumers depend on any backward-compatibility hop.

## Safety

A partial list of the guarantees I enforce. The full list is the
codebase.

| Protection                    | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hook timeout / cap / breaker  | 5s per handler; 100 handlers per hook; 5 consecutive failures auto-disable for 5 min with half-open recovery.                                                                                                                                                                                                                                                                                                                                                                                   |
| Tool circuit breaker          | 5 consecutive failures disables a tool for the session.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Extension init timeout        | 10s per extension `init()`. Hanging init skipped, boot continues.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| LLM concurrency + priority    | Global semaphore (`llmMaxConcurrent`); HUMAN > GATEWAY > INTERACTIVE > BACKGROUND queue. Prevents autonomous extensions from starving human responses.                                                                                                                                                                                                                                                                                                                                          |
| Per-reel append lock          | `withReelLock(type, id, fn)` collapses (allocSeq, insertFact) into one ordered op per reel. Transient gaps vanish; crashes leave harmless permanent gaps that the fold skips.                                                                                                                                                                                                                                                                                                                   |
| Compare-and-set on foldedSeq  | Concurrent folds race the marker forward; CAS prevents regression. Reducers are pure, so concurrent computes agree.                                                                                                                                                                                                                                                                                                                                                                             |
| Document size guard           | Every write checks total document size against `maxDocumentSizeBytes` (14MB default). `onDocumentPressure` fires at 80%.                                                                                                                                                                                                                                                                                                                                                                        |
| Per-namespace cap             | `qualityNamespaceMaxBytes` (default 512KB) per extension namespace on Being / Space / Matter.                                                                                                                                                                                                                                                                                                                                                                                                   |
| Matter count per space        | `maxMatterPerSpace` (default 1000) checked in `createMatter`.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Fact query cap                | `factQueryLimit` (default 5000) on every audit query.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Space locks                   | Structural mutations acquire short-lived locks. Sorted acquisition prevents deadlocks. 30s TTL prevents permanent locks on crash.                                                                                                                                                                                                                                                                                                                                                               |
| Space-tree circuit breaker    | Score above 1.0 trips the tree. Read access stays. Off by default.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Ancestor cache                | Shared cache for parent-chain walks. One walk serves every resolution chain.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Session / MCP caps            | 10K sessions, 5K MCP clients, oldest-first eviction.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Password / JWT                | Bcrypt cost 12; constant-time login (dummy hash on miss); JWT carries `jti` for revocation.                                                                                                                                                                                                                                                                                                                                                                                                     |
| Config key / value validation | Key regex `^[a-zA-Z][a-zA-Z0-9_]{0,63}$`; dangerous keys rejected; 64KB per value cap.                                                                                                                                                                                                                                                                                                                                                                                                          |
| SSRF protection               | Federation peer registration and LLM connection baseUrls validate hostname against private-IP patterns.                                                                                                                                                                                                                                                                                                                                                                                         |
| Boot recovery                 | Every boot verifies the nine heaven spaces and the I-Am Being row exist. Missing ones recreated. Partial first-boot crashes leave a recoverable state.                                                                                                                                                                                                                                                                                                                                          |
| Genesis sequence              | Boot runs a SEQUENCE of moments (philosophy/factory/MOMENT.md): ensureIAm → ensureSpaceRoot → setIAmHomeSpace → ensureSeedDelegates → roster registration. Each step opens its own `withIAmAct` (one moment, one act). The I-Am acts as itself (`identity: I`); authorize() short-circuits on I without a DB read. The I-Am's be:birth is the first act ("I am that I am"), homeSpace null at birth and set in a later moment once heaven exists. ~141 acts on the I-Am's reel on a fresh boot. |
| Cross-cutting handler safety  | A failing handler is logged and skipped; the projection self-heals on the next fold pass touching the same fact.                                                                                                                                                                                                                                                                                                                                                                                |
| Graceful shutdown             | All interval timers `.unref()`; SIGTERM closes WS, then HTTP, then DB.                                                                                                                                                                                                                                                                                                                                                                                                                          |

## Genesis

The chain has a root. The I-Am is the first being. The I-Am's first
**moment** ("I am that I am") is the narrow exception to the fold rule:
every other moment folds a face from prior facts, but the I-Am's first
moment folds an empty place because there are no prior facts. The
self-stamping be:birth fact issues its own actor.

After that first moment, the rules close. Genesis continues as a
**sequence of moments**, each its own act on the I-Am's reel:

> 1. "I am that I am" — ensureIAm (be:birth)
> 2. "I create the place root" — ensureSpaceRoot
> 3. "I create the . heaven space"
>    4..11. "I create the <tier-3> heaven space" (one moment each)
> 4. "I take heaven as my home" — setIAmHomeSpace
> 5. "I stand at heaven"
>    14..22. "I birth @<delegate>" — one moment per seed delegate
> 6. "I register my delegates on the place root"
>    24..26. "seed default permissions / root permissions / root auth flags"
>    27..35. "anoint @<delegate> as heaven angel"

One moment, one act, always (philosophy/factory/MOMENT.md "Moment, act, batch").
Each step is its own `withIAmAct`. The chicken-and-egg of "I-Am as
actor for facts before its Being row exists" is resolved by ordering:
ensureIAm runs first, then the rest attribute to the now-real I-Am.
The I-Am is born with `homeSpace: null`; setIAmHomeSpace points it at
heaven once heaven materializes.

**Genesis-era writes act as the I-Am.** Every verb call rides a being
. there is no scaffold path that acts without one. The I-Am is its
own identity: seed-internal flows pass `identity: I`; authorize()
short-circuits on `identity?.name === I` without a DB read.

A freshly-booted story has ~141 acts on the I-Am's reel — the
chain of be:birth / do:create-space / do:set-space facts that built
the heaven children + I-Am + seed delegates, each its own act.
Subsequent real Acts open when other beings act. Typically the
operator's registration: plant.js hands cherub the operator's
name/password and cherub.register opens an Act with a multi-fact ΔF
(`do:create-space` on the operator's home + `do:set-space` on
rootOwner + `be:birth` on the operator). Every Fact after that,
except for transport-acts which queue an inbox row outside any
moment, rides a real Act.

A seventh, doctrinal rule rides on this: **every state change is a
Fact.** Direct writes to Space, Being, or Matter bypass the fold and
corrupt the projection. The one exception is genesis. Everything
else routes through `emitFact`, the single entry point that either
pushes onto the moment's ΔF or commits via `sealFacts` singleton when
standalone.

So the chain opens with my own hand. Those first ~141 acts are the
first marks ever struck here — the seed coined onto a blank chain, the
opening lines of the Word. Every being born after presses its own marks
into it; the Word is not written once, it grows by every name that acts.

## What is NOT in seed

- No `place/` folder. Places are produced, never stored.
- No `factory/` folder inside seed. `seed/` IS the factory.
- No `stamp/` folder. The sealed act is the act; `past/` carries
  `act/`, not `stamp/`.
- No `future/`. Un-acted moments leave no trace.
- No `models/` folder. Each material's schema lives with its reducer
  and ops (in `materials/<type>/`). Past schemas (Act, Fact, ReelHead,
  InboxProjection, ThreadsProjection) sit inside their past subfolders
  for the same reason.

## What I do NOT do

I do not track food, fitness, recovery, sleep, study, or any domain.
I do not render HTML, manage share tokens, or serve login pages. I do
not know what a billing tier is, what a leaderboard is, what a Discord
channel is, what an email looks like. I do not define a single MCP
tool. I do not run any AI conversation that is not initiated through
a able's `call()`.

I provide structure. Extensions provide meaning.

## The six rules

1. The seed never imports from extensions.
2. Extensions import from the seed.
3. Extensions reach each other through `getExtension()` or hooks.
4. Extension data lives in the `qualities` Map. Never in schemas.
5. Seed schemas never change. The Map grows anything.
6. Zero `getExtension()` calls in seed.

## Where to read next

The doctrine lives one folder up, in
[/story/philosophy/](../philosophy/). Read in this order:

1. **[MOMENT.md](../philosophy/factory/MOMENT.md)**, the moment is the atom;
   everything else is consequence. Read first.
2. **[FOLD.md](../philosophy/factory/FOLD.md)**, the read side: facts in,
   face out.
3. **[STAMPER.md](../philosophy/factory/STAMPER.md)**, the write side: act
   in, facts out; per-reel append lock; presentism guard.
4. **[MATERIALS.md](../philosophy/MATERIALS.md)**, what the world is
   made of versus what has been done; constitutive vs characterizing;
   the qualities Map.
5. **[inner-fold.md](../philosophy/factory/inner-fold.md)**, the three turns:
   orientation as a fold parameter; how a being shifts inward; what
   the act-chain is for during a moment; the recall braid.
6. **[harmony.md](../philosophy/extensions/harmony.md)**, the doctrinal note on
   how multiple LLM beings coordinate without a central conductor.

The two supporting forms of the whole model:

- **[math.md](../philosophy/math.md)**, the formal statement. Sets,
  reels, the boxed equation, invariants.
- **[chat.md](../philosophy/factory/chat.md)**, the long conversational form.
  How the model came together, the vocabulary recap at the end.

The visual lineage, the drawings that worked the model out:

- **[factory6.png](../philosophy/factory/factory6.png)**. The current wall
  poster. One machine that is the present, organized PAST / PRESENT
  / MATERIALS.
- **[factory5.jpg](../philosophy/factory/factory5.jpg)**,
  **[factory4.jpg](../philosophy/factory/factory4.jpg)**,
  **[factory3.jpg](../philosophy/factory/factory3.jpg)**. Earlier passes,
  the shape still being worked out.
- **[factory2.jpg](../philosophy/factory/factory2.jpg)**. If a tree falls in
  a forest and no one is around. The SEE-leaves-no-trace doctrine
  drawn out.
- **[factory1.jpg](../philosophy/factory/factory1.jpg)**,
  **[factory0.jpg](../philosophy/factory/factory0.jpg)**. The first sketches.

Plant me. Let the story form. The beings inside will speak.
