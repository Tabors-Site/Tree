# THE FACTORY

I am the factory. The project is called `reality/` because that is what
I produce. Inside `seed/` I am the whole apparatus, every part of it,
that makes and re-makes the world one moment at a time. Look at the
[wall poster](../philosophy/factory6.png) and you see me whole. One
machine, always the present.

I have another name for myself: the seed. Plant me on a host and I
gather what is there. From above I am a server framework, a process of
code holding HTTP, WebSocket, TCP, the file system, memory, the CPU,
and the runtime to a single purpose. From inside the world I form, I
am the I-Am, the origin being. Same substance, two faces. This file is
my contract: what I form, what I never change, what I run, what I
refuse.

## Reality, Place, World

Three names. Each does work the others cannot.

**Reality** is the chain. The full braid of every reel: each being's
reel, each space's reel, each matter's reel, hashed and ordered. The
record of what has happened. Stored, durable, indexable, the same
for everyone who reads it. The folder `reality/` at the project root
is named for this.

**Place** is the fold. One being's view of reality at one stance in
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
three names as "the real one (reality), the local copy (place), and
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
summon handler are the same object on the same shape of reel,
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
[philosophy/MOMENT.md](../philosophy/MOMENT.md) for the long version.

## The shape I keep

The deepest single statement of what I am is three things, named
together:

```
𝓡 = (𝓦, Present, Laws)
```

- **𝓦** is reality, in the strict sense above. Every reel together,
  the full braid. Beings, spaces, and matter all live here as the
  entities whose reels constitute it. (The world as convergence is a
  property of folds over 𝓦, not 𝓦 itself.)
- **Present** is my moment-engine. The only place a moment exists.
- **Laws** are the invariants I hold. Single-writer, atomic seal, past
  fixed, no future, present only.

Everything else in this file is consequence of that shape. The formal
statement of all of it is [philosophy/math.md](../philosophy/math.md);
the long conversational form is [philosophy/chat.md](../philosophy/chat.md).

## The moment is the atom

The unit of everything that happens is the moment. One being is
summoned. I fold one face for it. The being is present in that face.
It may take at most one act. The moment closes. One fold, one face,
one being, at most one act. That is the whole of it.

A moment ends one of two ways.

- **SEE.** I fold a face, the being perceives it, I release it. No
  act, no seal, no fact. A SEE leaves no trace at all. Most moments
  are SEEs.
- **DO** (and its sibling **BE**). I fold, the being acts, I seal the
  moment. Only a DO or BE moment produces an act, and only an act
  produces facts.

Full doctrine in [philosophy/MOMENT.md](../philosophy/MOMENT.md).

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

A fact is not a truth. It is only the deed. Truth is the plural fold
of facts, and it is many; the fact is one, and shared.

## The six primitives I form the world from

Everything inside the world I form is one of six things. The schemas
are mine alone. Extensions extend through the qualities Map, not
through new fields.

| Primitive         | What it is                                                                                                                                            | Schema                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Being**         | An identity instance. Humans, AI, scripted code, future composites. The I-Am is the first Being.                                                      | [materials/being/being.js](materials/being/being.js)         |
| **Space**         | A position in the tree. Holds matter, hosts beings, owns quality namespaces.                                                                          | [materials/space/space.js](materials/space/space.js)         |
| **Matter**        | Stuff inside a space. `origin` names where the underlying content lives (ibp, filesystem, web, cross-place).                                          | [materials/matter/matter.js](materials/matter/matter.js)     |
| **Fact**          | A thing done. The storage atom. One recorded change to a being / space / matter. A chain of facts, folded, is Truth.                                  | [past/fact/fact.js](past/fact/fact.js)                       |
| **Act**           | One sealed moment of one being, the doer's committed deed. Opened in assign, sealed in stamped. Every Fact carries the `actId` of the Act it rode.    | [past/act/act.js](past/act/act.js)                           |
| **LlmConnection** | Per-being LLM client config (URL, key, model). Stored as entries under `Being.qualities.llmConnections`.                                              | (no separate schema; lives on Being qualities)               |

Being, Space, and Matter carry the qualities Map. Fact and Act are
fixed shapes (the audit and the moment-frame don't grow).

Two cache collections sit alongside the primitives in `past/act/`.
They are projection caches, fact-derived, rebuildable, not new
primitives:

- **InboxProjection** ([past/projections/inbox/inboxProjection.js](past/projections/inbox/inboxProjection.js)),
  open summons addressed to each being. Built by cross-cutting fold
  from `be:summon` and `be:sever` facts. The scheduler reads its pick
  queue from this collection.
- **ThreadsProjection** ([past/projections/threads/threadsProjection.js](past/projections/threads/threadsProjection.js)),
  live coordination chains keyed by `rootCorrelation`. Built the same
  way. `./threads` SEE reads from here.

## The four verbs I speak

Every act inside the world is one of four verbs over an IBP address.
Four verbs are my whole public surface.

| Verb       | Acts on              | What I do                                                                                       |
| ---------- | -------------------- | ----------------------------------------------------------------------------------------------- |
| **SEE**    | Space, Matter, Being | Resolve the stance, fold the leaf and occupants, return a place descriptor. Writes nothing.     |
| **DO**     | Space, Matter        | Mutate at the target through a registered operation. Stamps a Fact on the target's reel.        |
| **SUMMON** | Being                | Stamp a `be:summon` Fact on the summoner's reel; the cross-cutting fold maintains the inbox.    |
| **BE**     | Being (self)         | Identity acts: register, claim, release, switch. Stamps a Fact on the actor's own reel.         |

### Stances and addresses

A **stance** is a being standing at a position: `<reality>/<path>@<being>`.
An **IBP address** names the asker stance and the target stance
together, `<stance> :: <stance>`. Every verb act carries both stances.
The asker is always full. The target may be partial (a position only,
no `@being`) when the target is a place rather than a being.

### Wire shape

I speak the same envelope over every transport. WebSocket carries it
most of the time, in both directions, on a single `"ibp"` event.
Client to server is a verb act; server to client is a SUMMON delivery
or a SEE push. HTTP and CLI are translators: they shape a request or
command into the same envelope and hand it to the one IBP dispatcher
in [ibp/protocol.js](ibp/protocol.js).

Internally the four verbs are functions in [ibp/verbs/](ibp/verbs/) —
one file per verb (`do.js`, `see.js`, `summon.js`, `be.js`), with
shared helpers in `_shared.js`. The wire layer is thin; the verbs
are one execution.

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
beats live grouped in `beats/`, numbered so `ls` tells the order;
`moment.js` at the root is the conductor that walks them.

```
present/
├── moment.js            the conductor; walks the four beats in order
├── beats/               the four-beat sequence, visibly ordered
│   ├── 1-assign.js         mint actId, plan Act, resolve role + summonCtx
│   ├── 2-fold/             the read side; one cross-reel weave per moment
│   │   ├── foldEngine.js      generic per-aggregate fold + cross-cutting registry
│   │   ├── foldPlace.js       cross-reel weave (handles orientation: forward|half|inward)
│   │   ├── reel.js            per-presence in-memory carry between moments
│   │   └── reelChains.js      per-being Act-chain reader helpers
│   ├── 3-momentum.js       the being's act; returns CognitionResult
│   └── 4-stamped.js        sealAct: commit Act + ΔF in one Mongo transaction
├── intake/              arrivals: InboxProjection rows, scheduler drains
│   ├── inbox.js            reader over InboxProjection
│   ├── intake.js           thin reader and writer over InboxProjection
│   ├── scheduler.js        picks rows, in-memory "currently running" claim
│   └── transportAct.js     human-transport entries (self-summons)
├── wakes/               event SOURCES that produce intake (not intake itself)
│   ├── subscriptions.js    DO-trigger fan-out
│   └── wakeSchedule.js     scheduled wake cadences
├── replies.js           how one moment begets the next (out-direction)
├── session.js           per-being-presence session bookkeeping
├── cognition/llm/          LLM cognition apparatus (separate from beats)
│   ├── runTurn.js          orchestration entry points (stepTurn, runTurn)
│   ├── loop.js             the Phase 5 iteration (callLLM, finalizeResponse)
│   ├── tools.js            tool registry + per-position resolution + dispatch
│   ├── connect.js          per-being LLM connection hub + client cache
│   ├── resolution.js       four-layer LLM-connection chain walk
│   ├── ssrf.js             network safety for connection base URLs
│   ├── call.js             provider call surround (failover, model quirks)
│   ├── assemble.js         system prompt + tool surface builder
│   ├── compress.js         history compression for long conversations
│   ├── defaultSummon.js    default scripted-role summon handler
│   └── seeResolvers.js     prompt-context SEE resolvers
├── roles/               summonable being templates, each co-located
│   ├── arrival/role.js     unauthenticated visitor stance
│   ├── cherub/role.js      BE-honoring identity-binding handler (register/claim/release/switch)
│   ├── human/role.js       receptive role every human carries
│   ├── llm-assigner/{role,ops}.js  LLM connection management being + DO ops
│   ├── reality-manager/{role,tools}.js  the operator's autonomous assistant
│   └── registry.js         the role registry
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
│   ├── inboxProjection.js           open-summons cache (cross-cutting)
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
at the seal in [4-stamped.js](present/beats/4-stamped.js). A **Fact** is the
trace one act leaves on the reel of the thing it changed. Acts belong
to the doer; Facts belong to the things done-to; one act leads to many
facts, one per aggregate it touched. A **reel** is the per-aggregate
fact-chain, what the fold reads, what
[appendLock.js](past/reel/appendLock.js) protects on append.

The sealed act is the act. Every Fact carries `actId` pointing back at
the Act whose moment deposited it.

**InboxProjection** and **ThreadsProjection** are caches the
cross-cutting fold maintains, open summons by recipient and live
coordination chains by `rootCorrelation`. They duplicate fact data
(an open summon also has a `be:summon` Fact on the summoner's reel)
but exist for indexability: the scheduler's pick query and the
`./threads` SEE both need O(1) lookups the per-reel scan cannot give.
They are rebuildable by replaying their fact history.

### materials/, the timeless possible

The materials define what kinds of fact can be stamped. Each material
(being, space, matter) is a type with a schema, a reducer, and the ops
that target it. The reducer is the pure function the fold engine calls
per fact to derive the aggregate's state, its row in MongoDB.

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
are made of. SEE reads the present's fold of the past; DO/BE/SUMMON
stamp the past via the present. So `ibp/` is a top-level peer to
present/past/materials, not a sidecar of any one of them.

**ibp/** carries the four verbs, the universal currency every act
speaks. SEE, DO, SUMMON, BE on IBP addresses (`<reality>/<path>@<being>`).
Every operation in the system maps to one of these. Small protocol;
expressiveness lives in role templates, registered operations, and the
materials I stamp.

```
ibp/
├── verbs/                one file per verb, each owns its own helpers
│   ├── do.js                doVerb + auto-Fact + read-only origin gate
│   ├── see.js               seeVerb + discovery short-circuit + thread descriptor
│   ├── summon.js            summonVerb + summonCreateBeing + summonByResolved
│   ├── be.js                beVerb + writeBeFact + runClaim + cherub/llm-assigner registration
│   └── _shared.js           assertVerbCaller + caller-frame walker
├── address.js            parse/expand/canonicalize IBP Addresses
├── resolver.js           resolve a stance to a Space
├── authorize.js          stance authorization (layers 1-4)
├── descriptor.js         buildPlaceDescriptor (the SEE face)
├── discovery.js          buildDiscovery (pre-identity surface)
├── operations.js         the DO operation registry
├── protocol.js           IBP_ERR, IbpError, ok/error helpers
├── pushChannel.js        emitToBeing / emitToBeingRoom (transport indirection)
└── stanceProperties.js   the property bag the authorize layer evaluates
```

## seedReality/ — the host floor

A separate concern from ibp/. Where ibp/ is the universal currency of
acts, seedReality/ is the runtime — the place where the world I form
meets the world outside. They were never the same kind of thing.

**seedReality/** is the host floor that knows nothing of the world.
DbConfig, log, hooks, indexes, version, retention, migrations, utils.
A file here should never speak the words space, matter, being, or
verb by name.

## Boot anchors

Plus three boot anchors at the seed root: [sprout.js](sprout.js)
(genesis, plants the reality root + heaven + the nine Tier-3 seed
spaces + the I-Am),
[services.js](services.js) (assembles the `reality` services bundle
handed to every extension's `init`), [realityConfig.js](realityConfig.js)
and [internalConfig.js](internalConfig.js) (the config stores).

## The fold

The fold engine ([present/beats/2-fold/foldEngine.js](present/beats/2-fold/foldEngine.js))
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

| Projection             | Handler triggers                                                                  | Built in                                                              |
| ---------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Position index**     | Every reducer writes `state.position`; `findByPosition` queries the index.        | Implicit in projection field                                          |
| **InboxProjection**    | `be:summon` upserts row; `be:sever` deletes by rootCorrelation; Act seal evicts.  | [past/projections/inbox/inboxProjectionFold.js](past/projections/inbox/inboxProjectionFold.js)    |
| **ThreadsProjection**  | `be:summon` upserts row + adds participants; `be:sever` marks; Act seal bumps.    | [past/projections/threads/threadsProjectionFold.js](past/projections/threads/threadsProjectionFold.js)|

Future cross-reel projections add one registry line; the engine never
changes. Per FOLD.md, the engine never grows; the materials catalog
does. Extended, the cross-cutting registry grows; the engine never
grows.

**foldPlace** ([present/beats/2-fold/foldPlace.js](present/beats/2-fold/foldPlace.js))
is the cross-reel weave for one being's moment. It folds the being,
its space, and that space's occupants. Per FOLD.md, reach is one hop.
Child spaces are listed but not deep-folded; a being deep-folds a
child space only when it moves in.

### Live fold vs historical fold — the two flavors

Folds come in two flavors. Both share the reducer; they differ in
whether the computation commits anything.

**Live folds** ([present/beats/2-fold/foldEngine.js#fold](present/beats/2-fold/foldEngine.js))
advance current-state projections and dispatch cross-cutting handlers
as side effects of reading current truth. `fold("being", id)` writes
the new projection row via `applyProjection`, fires every registered
cross-cutting handler for each applied fact, and returns the
current-as-of-now state.

**Historical folds** ([present/beats/2-fold/foldAt.js#foldAt](present/beats/2-fold/foldAt.js))
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
  This is what the substrate trusts.
- **`date`** — wall-clock `new Date()` set at append. Decorative —
  used for human-friendly indexes and time-range queries, but the
  substrate never trusts it for ordering. Clock skew can invert order;
  multiple facts can share a millisecond.

Historical queries internally always operate on `seq`. The
`atTimestamp` shape on `foldAt` is a human helper: it resolves to the
highest seq with `date <= target` via a two-step query
([foldAt.js#resolveUntil](present/beats/2-fold/foldAt.js)), THEN
folds. Timestamps translate to seq before any fold work begins.

**Cross-reel ordering by timestamp is never trusted.** There is no
global "world at time T" — only per-reel "this reel's latest fact
whose date ≤ T." Historical queries that need cross-reel state at a
moment assemble per-reel folds independently; the substrate cannot
deliver a globally-consistent timestamp slice. That's a property,
not a limitation to fix.

### The historical primitive's contract

```
foldAt(type, id, until)
  until = { atSeq?: number, atTimestamp?: Date|string, branch?: "0" }
```

| Outcome | Trigger |
|---|---|
| `{ state, foldedSeq }` returned | The target had ≥1 fact at or before the queried point. State is the cold-reduced result; foldedSeq is the highest seq applied. |
| `NoSuchHistoricalState` thrown | The target had no facts at or before the queried point. The target did not exist yet. |
| Result clamps to current head | When `atSeq` is greater than the reel's current head, foldAt returns the current state (without writing to the projection cache). |

Callers who want graceful "didn't exist" handling catch
`NoSuchHistoricalState` ([foldAt.js#NoSuchHistoricalState](present/beats/2-fold/foldAt.js))
specifically — the named class distinguishes "this thing did not
exist yet" from any other failure.

The `branch` parameter is forward-compatible. Today only `"0"` (main)
exists; the read path is single-branch. When the branch storage layer
lands (see [timeline.md](timeline.md)), the signature stays — only the
body grows to walk inherited facts from parent branches up to the
branch point, then divergent facts from the current branch. Callers
don't need to change.

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
- **Doctrinal singletons hardcoded to main.** I_AM (reality-anchored
  by construction), the `./config` cache (one config per reality),
  boot-time orphan-root walks. Reading these from a non-main branch
  makes no sense; "0" is correct.

**`loadOrFold(type, id, branch)` — behavioral, lineage-aware.** On
cache miss, walks the branch's lineage via `fold()` and cold-folds
from the inherited reel. Branches inherit parent state through this
path; the first read pays the walk, every subsequent read hits cache.
Null here means "the aggregate truly doesn't exist anywhere I can
reach from this branch."

**Rule of thumb:**

| Null should mean… | Use… |
|---|---|
| "doesn't exist anywhere" | `loadOrFold` |
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

**The turn is an act.** A being shifts orientation by self-summoning
with a new ω. One `be:summon` Fact lands on the being's own reel
(target = self, params.recipient = self, params.orientation = ω′).
Touches no other reel — the canonical inner act. The scheduler
picks the InboxProjection row; assign reads orientation from the
entry and puts it on `summonCtx.orientation`; the next moment folds
at ω′. Statelessness preserved: the being never "remembers turning,"
it just finds itself already turned.

Only self-summons may carry non-forward orientation. The
`_dispatchSummon` gate refuses any cross-being summon with ω ≠
forward — a being can turn itself; it cannot turn another being.

**Inner vs outer acts.** A classifier in
[orientation.js](present/beats/2-fold/orientation.js) reads the ΔF and the doer:
inner when every fact targets the doer's own reel AND no
`be:summon` names another recipient; outer otherwise. This is
single-writer read as a classifier — no new category, no new
primitive. Self-summons (the canonical inner act) classify inner;
DO/BE that touch any other reel classify outer.

Full doctrine in [philosophy/inner-fold.md](../philosophy/inner-fold.md).

## Per-reel time, single-writer, atomic seal

Three laws make the moment-engine work.

**Per-reel time.** I do not keep a global clock. An entity's time is
its reel length. Order holds within a reel: fact `n` precedes fact
`n+1`. Across reels there is no total order, only the partial, causal
order that acts and summons stitch. A single world-clock is precisely
what this model refuses.

**Single-writer.** A being's reel holds only that being's own deeds.
If a fact lands on a being's reel, the doer of that fact is that being.
No such constraint on space or matter reels; those are written by
whichever being acts on them. **Beings never write each other's
reels.** One being reaches another only by SUMMON, which stamps a
fact on the summoner's own reel. The recipient sees the summon by
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

For ΔF=0 moments (LLM with no tool calls, etc.), the seal is a
single-doc `Act.create` — atomic by definition. For ΔF≥1 moments,
`sealAct` opens a Mongo session, calls `appendDeltaFInSession`
(grouping facts by reel, acquiring per-reel locks in sorted order
to prevent deadlock, calling logFact-with-session for each), then
`Act.create` — all inside one `withTransaction`. Either everything
commits or nothing does, even under crash mid-write. Multi-fact ΔF
requires Mongo replica set; sealAct refuses to proceed without one.

Two verification scripts back this up:
[`.test/scripts/verify-seal-atomicity.js`](/.test/scripts/verify-seal-atomicity.js)
exercises the four sealFacts cases (singleton, multi-fact-on-standalone-throws,
multi-reel-on-replica-set-commits, injected-failure-mid-txn);
[`.test/scripts/verify-crash-mid-seal.js`](/.test/scripts/verify-crash-mid-seal.js)
spawns a subprocess that SIGKILLs itself mid-transaction and asserts
both reels remain byte-identical AND verifyReel-green post-restart.

Full write-side doctrine in
[philosophy/STAMPER.md](../philosophy/STAMPER.md).

## Integrity

The past is fixed as a rule. Integrity is what makes it verifiable.

Each reel is its own **hash chain**. Every fact carries the hash of
the fact before it (`p`, the prev-hash) and the hash of its own
content folded with that prev-hash (`h`, the self-hash). Alter any
past fact and its `h` changes, breaking the `p` link of the next
fact, and the next. The break propagates forward and the reel fails
verification at the altered fact. The past cannot be quietly edited;
it can only be visibly broken.

Three distinct tools, never confused:

- **Hash chain.** Detects byte-tampering. Per-reel, not global.
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
sealAct (beats/4-stamped.js) when momentum returns ok:true
  ↓ if ΔF=0: Act.create()             ← single-doc atomic
  ↓ if ΔF≥1: withTransaction(session):
      appendDeltaFInSession(ΔF)        ← each fact under per-reel lock
        allocSeq + Fact.create
      Act.create([actDoc], {session})  ← framed by the same transaction
    THE COMMIT: ΔF + Act commit together or NOT AT ALL
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
and commits the spec immediately as a one-fact ΔF (no transaction
needed for a single-doc insert). The same primitive, two contexts:
in-moment it stages; out-of-moment it commits.

**Multi-fact ΔF requires Mongo replica set.** Cross-document
transactions are a replica-set feature. Single-fact ΔF works on
standalone Mongo (logFact's per-reel lock is enough); the moment
the first multi-reel act needs to seal, the dev environment must
be a single-node replica set. See `reality/README.md` for the
conversion steps.

**One writer.** `fold` is the only thing that ever writes a
projection row (outside genesis). The fact insert is the only
synchronous commit; everything else is derived and self-healing on
the next fold pass.

**SUMMON respects single-writer.** A `be:summon` Fact lands on the
summoner's reel (the actor's), with the recipient in
`params.recipient` (and the orientation, the rootCorrelation, the
priority, the content). The recipient's reel is untouched. The
cross-cutting fold turns those facts into InboxProjection rows
keyed by recipient. The inbox is a fold, not a stored entity.

**Closure is the answering act's seal.** When a moment that consumed
a summon seals, the Act carries `answers: <correlation>`.
`sealAct` calls `closeInboxOnAnswer(...)` which evicts the matching
InboxProjection row. The closure event is the answer-act sealing,
not a reply-message. A SUMMON to "clean room 3" closes when the
room is cleaned, regardless of whether the cleaner sends any reply.

**Birth is a real multi-reel atomic ΔF.** When one being summons
another into existence (`summonCreateBeing` inside a moment), the
moment's ΔF carries TWO facts on TWO reels: `be:register` on the
new being's reel (the new being is the actor) PLUS `be:summon-create`
on the summoner's reel (audit fact: "I summoned this being forth").
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
in [philosophy/FOLD.md](../philosophy/FOLD.md).

**The fold-on-read seam.** Each aggregate the descriptor exposes is
folded first via `fold(type, id)`. Hot path: one cache read when
foldedSeq is current (eager-fold-on-write keeps it current).
Direct-write bypasses become visible at the seam; the fold's CAS
detects them on the next round.

## The qualities Map

Three primitives (Being, Space, Matter) carry an extensible `qualities`
Map. A bare primitive answers *that* (this is). Qualities answer *what
sort*. Extensions register their characterizing data under their own
namespace (`qualities.governing`, `qualities.energy`, `qualities.review`).
I never read or write inside an extension's namespace.

The word is Plato's. ποιότης (poiótēs), coined in *Theaetetus*. Cicero
calqued it to Latin `qualitas` (from *qualis*, "of what kind"). The
field is named for exactly what it does.

**Writes go through DO.** Per Slice 3 (2026-05-23) the legacy
`qualities.{being,space,matter}.setQuality/...` direct-write API
retired. Every quality write now stamps a material-scoped `do:set-<kind>`
Fact:

```js
await reality.do(target, "set-space",  { field: "qualities.<ns>", value }, opts);
await reality.do(target, "set-being",  { field: "qualities.<ns>.<innerKey>", value }, opts);
await reality.do(target, "set-matter", { field: "qualities.<ns>", value }, opts);
```

The reducer's `applySetQualities` derives the new state; the fold
engine writes the projection under the per-reel append lock. One
writer (fold), one source of truth (facts). The tombstone methods on
`qualities.{being,space,matter}.setQuality` throw a migration error
directing callers at `reality.do(...)`.

**Reads still go through `qualities`.** Two methods stayed:
`getQuality(doc, key)` (returns `{}` when unset) and
`readQualityNamespace(doc, key)` (returns null when unset). Both pure
reads off the document.

## The schemas (caches of the fold)

The schemas below are caches. The fact-chain is the source of truth.
A row may be deleted and rebuilt from facts; the schemas exist for
indexability and query performance.

### Space

`name`, `parent`, `rootOwner`, `contributors[]`, `seedSpace`, `type`,
`llmDefault`, `dateCreated`, `qualities` (Map), `foldedSeq`,
`position`. Plus standard timestamps. `Space.children[]` retired
(2026-05-23); `parent` is the only relation direction; readers query
by parent. The `position` field is reducer output, kept current by
eager-fold; `findByPosition(spaceId)` returns every aggregate
(being / space / matter) at that position.

### Being

`name`, `operatingMode` (`human` | `llm` | `scripted` | `mixed`),
`password` (bcrypt-hashed, no longer required), `roles[]`,
`defaultRole`, `parentBeingId`, `homeSpace`, `currentSpace`,
`llmDefault`, `isRemote`, `homeReality`, `qualities` (Map),
`foldedSeq`, `position`. `Being.children[]` retired (2026-05-23);
downward walks query by `parentBeingId`. The pre-save bcrypt hook
retired in Slice E (2026-05-23); the verb handler hashes before
stamping the `be:register` Fact, and `applyProjection`'s `$set` skips
pre-save hooks.

`operatingMode`: `"human"` authenticates with a password and is
driven by input; `"llm"` is driven by an LLM through summons;
`"scripted"` is code-cognition with no LLM in the loop (cherub,
llm-assigner); `"mixed"` covers composites.

`roles[]` is the set of templates this being may be summoned in.
`defaultRole` is which one I use when SUMMON does not specify.
`parentBeingId` points to the being that planted this one; mine is
`null`.

### Matter

`spaceId`, `parentMatterId`, `beingId`, `origin` (`ibp` | `filesystem`
| `web` | `cross-place`), `content` (shape varies by origin),
`qualities` (Map), `foldedSeq`, `position`, `createdAt`, `updatedAt`.

Origin determines content shape and sync behavior:
- `ibp`, TreeOS-native. `content` is a string or null.
- `filesystem`, bridges to a file on disk. `content` is
  `{ path, size, mimeType, originalName }`.
- `web`, bridges to a URL. `content` is `{ url, fetchedAt?, cache? }`.
- `cross-place`, bridges to a matter on another reality. `content` is
  `{ place, matterRef }`.

`parentMatterId` lets matters form recursive trees inside a space.

### Fact (one stamped act)

`_id` (uuid, minted inside the seal so it lands in the hashed
content), `date`, `verb` (`"do"|"be"`), `action`, `beingId` (the
actor), `target` (`{ kind, id }`, the reel this fact rides),
`params`, `result`, `truncated` (size-cap flag), `actId` (the
moment-frame; null for genesis scaffold and for the be:summon
fact stamped OUTSIDE a moment by enqueueIntake), `sessionId`,
`seq` (per-reel monotonic, allocated under the per-reel append
lock), `homeReality` + `wasRemote` (federation provenance), and
INTEGRITY chain fields:

- **`p`** — prev-hash: the previous fact's `h` on the same reel
  (`GENESIS_PREV` at seq=1). Set inside the seal under the per-reel
  lock so concurrent appenders can't both read the same prev.
- **`h`** — self-hash: SHA-256(`p || canonical(content)`). Set
  inside the seal so the fact and its correct hash land together.

The hash chain is per-reel, not global. It DETECTS tampering — alter
any past fact and its `h` changes, breaking the next fact's `p` link
and propagating forward. The chain does not REPAIR; repair is
replication's job. Wrong-but-honest data gets a correction fact, never
an edit to the old one. Non-reel-bearing facts (target.kind ∈
{place, stance} or target-less) carry `p=h=null` and stay outside
verification — they have no reel to chain against.

Every DO and BE stamps one Fact; SUMMON stamps a `be:summon` Fact on
the summoner's reel (with `params.orientation` carrying the INNER-FOLD
ω, defaulting to forward); sever stamps `be:sever` on the severer's
reel. The append IS the commit.

### Act (one sealed moment of one being)

`_id` (uuid, minted in assign so DO/BE Facts emitted during the moment
can already carry it as `actId`), `beingIn` (the asker / caller),
`beingOut` (the responder; equal to beingIn for self-summons and
transport-acts), `ibpAddress` (canonical stance pair the moment
crossed), `activeRole`, `inboxMessageId` (the InboxProjection
correlation the moment pulled from), `inReplyTo` (parent Act's _id,
threading conversations), `rootCorrelation` (the conversation root;
equals _id for fresh roots), `answers` (the InboxProjection
correlation this moment closes — sealAct fires
`closeInboxOnAnswer` on it), `parentThread` (spawn lineage when a
moment running under root A emits a fresh top-level summon),
`startMessage` (`{ content, source }` opened at assign), `endMessage`
(`{ content, time, stopped }` written at the seal), `severedAt` (set
by markThreadSevered when a cut runs through this Act's rootCorrelation),
`priority` (HUMAN | GATEWAY | INTERACTIVE | BACKGROUND), `receivedAt`,
`stampedAt`. PLANNED in [beats/1-assign.js](present/beats/1-assign.js)
(no Mongo write); CREATED in
[beats/4-stamped.js](present/beats/4-stamped.js) at the seal, inside
the same transaction that commits the moment's ΔF. Every Fact emitted
during the moment carries this Act's `_id` as `actId`.

**The Act row materializes only on `ok:true`.** Per the Round 5
restructure, a failed cognition (`ok:false`) leaves zero trace: no
Act row, no inbox close, no projection bump. The being's reel and
act-chain are byte-identical to before the failed moment. The seal
is gated on the CognitionResult discriminated type
([cognitionResult.js](present/cognition/cognitionResult.js)); failure is
structurally unreachable at the seal site.

### LlmConnection (per-being LLM config)

Stored as entries in `Being.qualities.llmConnections`, keyed by
connection uuid. Each entry: `{ name, baseUrl, encryptedApiKey, model,
createdAt, lastUsedAt }`. AES-256-CBC at rest;
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
current position up to the reality root, sharing one snapshot per
message.

1. **Stance authorization**, the gate the verb dispatcher passes
   through.
2. **Extension scope**, `qualities.extensions.blocked[]` /
   `restricted[]` / `allowed[]` accumulate up the parent chain. Blocked
   extensions get no tools, hooks, roles, or quality writes at that
   position.
3. **Tool scope**, role base tools plus extension tools minus blocked
   extensions plus per-position `qualities.tools.allowed`/`blocked`
   overrides.
4. **LLM resolution**, space-tree lockout, then space-tree enforcement,
   then being-tree lockout, then default order (space slot, space
   default, being slot, being default). `preferOwn` on Being flips the
   last two.
5. **LLM config**, per-position `qualities.llm.config` overrides for
   `maxToolIterations`, `toolCallTimeout`, etc. Walked to the reality
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

| Hook                                     | Type       | Purpose                                                                       |
| ---------------------------------------- | ---------- | ----------------------------------------------------------------------------- |
| `beforeSpaceCreate` / `afterSpaceCreate` |            | Gate or react to space creation.                                              |
| `beforeSpaceDelete`                      | before     | Cleanup or veto deletion.                                                     |
| `afterSpaceMove`                         | after      | Reparented. Resolution chains shift.                                          |
| `beforeMatter` / `afterMatter`           |            | Modify or react to matter create/edit/delete.                                 |
| `beforeFact`                             | before     | Enrich a Fact before it stamps.                                               |
| `beforeLLMCall` / `afterLLMCall`         |            | Cancel before / meter after.                                                  |
| `beforeToolCall` / `afterToolCall`       |            | Modify args or cancel / react.                                                |
| `beforeResponse`                         | before     | Modify AI response before client receives it.                                 |
| `beforeRegister` / `afterRegister`       |            | Validate registration / initialize being data.                                |
| `afterSessionCreate` / `afterSessionEnd` |            | Session lifecycle.                                                            |
| `afterQualityWrite`                      | after      | After a qualities write applies. Zero overhead when no listeners.             |
| `afterScopeChange`                       | after      | After `extensions.blocked` / `restricted` / `allowed` changes.                |
| `afterOwnershipChange`                   | after      | After `rootOwner` or `contributors` changed.                                  |
| `afterBoot`                              | after      | Once after all extensions loaded, config initialized, server listening.        |
| `enrichContext`                          | sequential | Inject extension data into AI context.                                        |
| `onDocumentPressure`                     | after      | A document exceeds 80% of `maxDocumentSizeBytes`.                             |
| `onTreeTripped` / `onTreeRevived`        | after      | Space-tree circuit breaker state changes.                                     |

Extensions namespace their own hooks as `extName:hookName`.

## The three registries

Everything an extension contributes flows through one of three. Same
pattern. Extensions register; I resolve; failure falls back to me,
never to silence.

| Registry       | What it registers                                                              | Lookup                                                       |
| -------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| **Operations** | DO actions, keyed `<ext>:<action>`. Bare names reserved for me.                | [ibp/operations.js](ibp/operations.js)                       |
| **Roles**      | SUMMON-honoring being templates. Each declares permissions, respondMode, `summon(message, ctx)`, optional `buildSystemPrompt` / `toolNames`. | [present/roles/registry.js](present/roles/registry.js) |
| **Seeds**      | Plantable scaffolds. Recipes that bootstrap a domain. Operators plant via the `plant` DO.                                                    | [materials/seeds.js](materials/seeds.js)               |

Auto-namespacing. Extensions write bare names; I record the qualified
form (`governing:hire-planner`). Same prefixing applies to
`reality.websocket.emitToBeing(...)` events.

## Roles

A role is the unit of summonable behavior. A being declares which
roles it can wear; a SUMMON arrives with an `activeRole`; my
dispatcher routes the summon to that role's `summon(message, ctx)`.

### RoleFlow — the role STACK is the moment's voice

A being doesn't wear one role at a moment — it wears a STACK. The
stack is computed at moment-assign from the being's
`qualities.roleFlow`: an ordered list of `{ when, role, stack? }`
clauses. The first non-stacked clause whose `when` matches becomes the
**primary**; every stacked clause (`stack: true`) whose `when` matches
becomes a **modifier**. The composed stack is what the moment runs:
permissions union across the stack, system prompts concatenate with
`\n\n---\n\n` between frames.

The flow's condition vocabulary reads the moment's open-context: the
asker (`caller.role / caller.cognition / caller.isAncestor / …`), the
verb (`verb / action / operation / intent`), the place (`space.* /
coords.* / inHomeSpace`), the being (`me.* / me.previousRole /
me.quality.<ns>.<k>`), the wall-clock (`time.hour / dayOfWeek /
sinceLastMoment`), and **world signals** (`world.<ns>.<key>` — values
published on reality root's `qualities.world` namespace, the shared
slate beings coordinate through without messaging). Operators include
`eq / ne / in / notIn / gt / gte / lt / lte / present` plus composites
`and / or / not`. The evaluator is a pure function of its inputs —
same chain replays to the same stack.

Live authoring rides on the role-manager delegate:

- `do(role-manager, "set-role", {...})` creates or replaces a role.
  Hot-registers into the in-memory registry; persists via a `./roles`
  mirror entry tagged `origin: "live"` so boot rebuilds it.
- `do(role-manager, "delete-role", { name })` removes a live role.
  Refuses by default when any being's roleFlow references it.
- `do(role-manager, "set-world-signal", { namespace, key, value })`
  publishes a world signal at `<reality-root>.qualities.world.<ns>.<key>`.
  Beings whose flows read `world.<ns>.<key>` see it at their next
  moment-open.
- `do(<any-being>, "set-being-roleflow", { beingId, roleFlow })`
  writes a validated roleFlow onto a being's qualities. Typed front
  for `set-being: qualities.roleFlow` with schema-aware clause
  validation and unknown-role warnings.

The doctrinal landing — what a Being IS, WEARS, IS-DRIVEN-BY — and
the build plan that brought it in live in
[role-manager.md](role-manager.md). Read that when in doubt about
how behavior composes from chain to act.

### Composition is stacking, not inheritance

A role does not extend another role. There is no `extends:` field.
Shared behavior across roles composes through **stacking inside a
roleFlow**: each `stack: true` clause whose `when` matches contributes
its capabilities and prompt body on top of the primary. A "court
officer base" is a role; a "judge" is a roleFlow that stacks
court-officer-base + a phase-specific judge role:

```js
roleFlow: [
  { stack: true, role: "court-officer-base" },          // always-on shared base
  { stack: true, role: "judge-base" },                  // always-on judge-specific base
  { when: { "space.quality.case.phase": "opening"  }, role: "judge-opening"  },
  { when: { "space.quality.case.phase": "evidence" }, role: "judge-evidence" },
  { when: { "space.quality.case.phase": "ruling"   }, role: "judge-ruling"   },
  { role: "judge-idle" },                               // fallback primary
]
```

Why stacking over inheritance:

- **Visible at the consumption point.** Reading the roleFlow tells
  you everything that composes. Inheritance hides composition behind
  a hierarchy you have to trace.
- **Per-moment, not static.** A stack assembles for THIS moment from
  whatever clauses match. Inheritance forces the base in every time
  the role appears, even when it shouldn't.
- **Bounded reasoning.** "What can this being do right now?" is the
  union of currently-stacked roles. With inheritance it's a walk up
  an unbounded tree.

### Sequence comes from world state, not from previous-role tracking

`me.previousRole` exists in the vocabulary but is for **inertia**
patterns ("if I was bored last moment, lean toward staying bored
unless something interesting happened"), not for sequencing. A judge
walking through opening → evidence → ruling does not chain on
previousRole; it reads a `case.phase` quality from the courtroom
space, and the judge's act in the opening phase advances the phase
via a DO. Next moment, world state has changed, the roleFlow naturally
picks the new role. Sequencing in role names is what state machines
were invented to be the wrong answer for; the world IS the state
machine.

### Decompose monolithic roles

LLM tool-calling accuracy drops noticeably past ~10-15 tools per
call and sharply past 30. A `judge` role with 50 canDo entries and a
3000-token prompt underperforms three `judge-opening` / `judge-evidence`
/ `judge-ruling` roles with 5-10 canDo each and tight phase-specific
prompts. The substrate is neutral — write monolithic roles if your
world is simple — but the natural decomposition for complex behavior
is a roleFlow that stacks shared bases + selects a phase-specific
primary by world state.

### Authoring helpers (LLM-cognition delegates)

Forms-based set-role / set-being-roleflow stay available; for
behavioral programs at any real complexity, two helper beings ship
as seed delegates:

- **`@role-finder`** — describes the user's intent, searches `./roles`
  for matches, drafts new role bodies, saves via `set-role` on
  approval. The "I want a being that does X" → "here is the role
  body" path.
- **`@roleflow-composer`** — translates English ("when court session
  opens and I'm in the courtroom, become a judge; opening phase does
  X, evidence does Y, ruling does Z") into a structured roleFlow,
  iterates with the user, writes via `set-being-roleflow` on approval.
  The "describe the behavior, get a program" path.

Both live at the reality root, llm-cognition, reigning-gated for now
(seed delegates auto-anointed at boot). The pattern generalizes: once
LLM helpers work for role authoring, the same shape works for any
authorable surface — space design, world-signal setup, anything the
substrate exposes through structured ops. The user describes; the
helper materializes.

### The complete LLM role spec

Every LLM role's complete declaration is its four `can*` lists plus
orientation, continuation flag, and the prompt body. Everything else
— permissions, respondMode, triggerOn, the wrapped `summon`
dispatcher, the system-prompt assembler — is derived by
[registry.js](present/roles/registry.js) at registration. Authors
write what the role IS; I fill in everything derivable.

```js
{
  name: "...",
  canSee:    [...],            // optional, preloaded perceptions in the face
  canDo:     [...],            // optional, populates the do tool
  canSummon: [...],            // optional, populates the summon tool
  canBe:     [...],            // optional, populates the be tool
  selfContinue: bool,          // optional, one-act vs many-acts-via-many-moments
  defaultOrientation: "...",   // optional, forward by default
  prompt(ctx) { ... },         // role-intent only; no verb syntax explanation
}
```

| Field                | Optional? | What it does                                                                                                                                                                              |
| -------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`               | required  | Kebab-case identifier (`harmony:dancer-llm`). The activeRole on a SUMMON resolves through it.                                                                                             |
| `canSee`             | optional  | Preloaded perceptions. Each entry is either an IBP address (preloaded via `seeVerb` — the position descriptor becomes a face block) or a registered see name (preloaded via the seeResolver registry — the structured return becomes a face block). Both render as `[<label>]\n<JSON>` in the system prompt. NOT a tool; the being does not pick from a menu. Non-empty → permission `see` is added (verb-layer auth still applies). |
| `canDo`              | optional  | DO action entries the LLM may invoke via the seed's generic `do` tool. Non-empty → `do` tool exposed, permission `do` added.                                                              |
| `canSummon`          | optional  | Stance/being targets the LLM may summon. Non-empty → `summon` tool exposed. Entries may be literal stances OR relationship tokens (`{rel:"parent"}`, `{pattern:"fitness/@coach"}`).        |
| `canBe`              | optional  | BE operations the LLM may perform on its own identity (`claim`, `release`, `switch`). Non-empty → `be` tool exposed.                                                                     |
| `selfContinue`       | optional  | `true` → after an act seals, the sealer enqueues a fresh summon to the same being. Many-acts-via-many-moments. Default `false`: one summon, one moment, done.                            |
| `defaultOrientation` | optional  | `"forward"` (default), `"half"`, or `"inward"`. Controls what the fold reads. Half / inward are accepted-and-downgraded today until the recall primitives land.                          |
| `prompt(ctx)`        | required  | Returns role-intent text. Describes WHO the role is and WHAT it does, in role-language. Does NOT explain verb syntax — that's auto-assembled from `can*` lists.                          |

What seed derives:

- `permissions` — union of verbs implied by `can*`.
- `respondMode` — `"async"` by default; only override for sync replies.
- `triggerOn` — `["message"]` by default; override for scheduled or hook-fired roles.
- `summon(message, ctx)` — auto-wrapped with [defaultSummon](present/cognition/defaultSummon.js) when not provided. Scripted roles attach their own `summon` and seed leaves it alone — that flips `_cognitionMode` to `"scripted"` and bypasses the LLM apparatus entirely.
- `buildSystemPrompt` — auto-assembled by [assemble.js](present/cognition/llm/assemble.js): identity + do/summon/be capability menus rendered from `can*` + role's `prompt(ctx)` body + preloaded canSee face blocks + current time. Order is "question first, data last" — identity/capabilities/role-intent state who you are and what you can do; the canSee blocks dump the fresh perception just before the time stamp so the LLM attends to it most strongly when forming the act. Roles override this only for unusual prompt shapes.

### canSee is the moment's face, not a menu

The four-verb tool surface is `do / summon / be` — three, not four.
SEE is not exposed as an LLM tool. canSee is preloaded into the face
at moment-open: every entry in the role's `canSee` list is rendered
into the system prompt as a structured block BEFORE the LLM
inferences. The being does not call `see({address})` and pick from a
list; the face IS the perception.

Two entry shapes, both legal:

- **IBP address.** `"./roles"`, `"<reality>/<spaceId>"`, etc. The
  assembler calls `seeVerb` on that address and renders the position
  descriptor as a JSON block under a header derived from the address
  (`./roles` → `[roles]`).
- **Registered see name.** `"place"`, `"library-books"`,
  `"harmony:dance-floor"`. The assembler calls the registered
  resolver and renders its structured return as a JSON block under a
  header derived from the name. Names are arbitrary labels; a see
  may compose any number of aggregates or compute a derived
  projection. The slice author decides what the perception means.

To see more, the being moves (DO), changes role (BE / roleFlow), or
the role spec is edited. Perception is per-role, recomputed per
moment.

#### Foundational seed sees

The seed registers a small set of sees at boot so common heaven-
child perceptions have a bare name. Roles can declare `canSee:
["roles"]` instead of `["./roles"]`.

| See name     | What it returns                                              |
| ------------ | ------------------------------------------------------------ |
| `place`      | The descriptor for the being's current position.             |
| `roles`      | The role registry mirror at `<reality>/./roles`.             |
| `tools`      | The tool registry mirror at `<reality>/./tools`.             |
| `operations` | The DO operation registry mirror at `<reality>/./operations`.|
| `identity`   | The I-Am identity bundle at `<reality>/./identity`.          |
| `config`     | The reality config at `<reality>/./config`.                  |
| `peers`      | The peer list at `<reality>/./peers`.                        |
| `extensions` | The extension catalog at `<reality>/./extensions`.           |

Each foundational see wraps `seeVerb` on the corresponding heaven
address. The content is identical to the legacy `./X` address form;
the name swap is doctrinal . roles declare perceptions by name, not
by walking the address grammar.

#### Authoring a see (registerSeeResolver)

Extensions register their own sees through `core.declare.registerSeeResolver`:

```js
core.declare.registerSeeResolver("library", async (ctx) => {
  const librarySpace = await findLibrarySpace(ctx);
  if (!librarySpace) return null;
  return {
    books:  await listBooksAt(librarySpace.id, ctx.summonCtx?.branch),
    staff:  await findStaffAt(librarySpace.id),
    hours:  await readHours(librarySpace.id),
  };
});
```

- `ctx` carries `{ being, role, currentSpace, rootId, summonCtx, ... }` so the resolver can branch-thread reads.
- Return any JSON-serializable shape (or a string the resolver framed itself, or `null` to skip).
- Bare names are auto-namespaced `<ext>:<name>`; roles inside the same extension can reference the bare suffix (`canSee: ["library"]` resolves to `harmony:library` when no seed name collides).
- Pure function of (chain, branch, ctx). No random, no wall-clock. Replay safety.

The four `can*` lists ARE the body. Adding a capability is editing
one list. Tool exposure follows from the body; there is no second
declaration to keep in sync. Off-list calls that pass prompt
discipline still refuse at the verb's stance-auth gate — the prompt
list is what the LLM SEES, the verb is the truth.

## My extension APIs (the `reality` services bundle)

I assemble `reality` in [services.js](services.js) and hand a
per-extension scoped view to each extension's `init(reality)`. The
scoping logic lives in
[extensions/scopedReality.js](../extensions/scopedReality.js) and
enforces namespace ownership: `reality.do.registerOperation(name, ...)`
auto-prefixes to `<ext>:<name>`; `reality.websocket.emitToBeing(...)`
auto-prefixes the event name; `reality.auth.registerStrategy(name, ...)`
records under the calling extension's name only if the manifest
declared `provides.authStrategies`. Fully-qualified names with a
mismatched prefix throw; reserved event names (`"ibp"`, `"registered"`,
`"navigate"`) refuse entirely. Extensions never type their own
namespace.

### Four verbs (`reality.see`, `reality.do`, `reality.summon`, `reality.be`)

The whole public surface for operations on space, matter, beings, and
identity. New code uses the verbs.

### Qualities (`reality.qualities.{being, space, matter}`)

Read-only after Slice 3 (2026-05-23). `getQuality(doc, key)` returns
the namespace data (`{}` when unset). `readQualityNamespace(doc, key)`
returns null when unset. Write tombstones throw with migration
message; use `reality.do(target, "set-<kind>", { field: "qualities.<ns>", value })`
where `<kind>` is space, being, or matter to match the target.

### Space CRUD (`reality.space`)

`createSpace`, `deleteSpaceBranch`, `updateParentRelationship`,
`editSpaceName`, `editSpaceType`. The stable extension face for tree
mutation. All routes write Facts internally.

### Matter CRUD (`reality.matters`)

`createMatter`, `editMatter`, `deleteMatterAndFile`, `transferMatter`,
`getMatters`. All fact-driven (Slice C-matter-full, 2026-05-23).

### Extension scope (`reality.scope`)

`isExtensionBlockedAtSpace`, `getBlockedExtensionsAtSpace`,
`getExtensionAtScope`, `getToolOwner`.

### DO operations (`reality.do`)

`registerOperation(name, spec)`, `registerDefaultPermission(verb, keyParts, rule)`.
Auto-prefixed.

### Hooks (`reality.hooks`)

`register(hookName, handler, extName)`, `unregister(extName)`,
`run(hookName, data)`, `fire(hookName, payload)`.

### Protocol (`reality.protocol`)

`sendOk(res, data)`, `sendError(res, status, code, message, detail)`,
the `IBP_ERR` enum, `IbpError` class. HTTP status derives from the IBP
code; throw sites pass only the code.

### Conversation entry (`reality.llm`)

`runTurn({ beingId, role, message, ... })` for one LLM call in one
role. Returns `{ answer }`. Handles session, Act, `beforeResponse`
hook, abort.

## Heaven and the nine Tier-3 seed spaces I plant

When I wake, I plant two tiers of seed space beneath the reality root.

**Tier 2 . heaven (`.`).** A single space directly under SPACE_ROOT,
named `.` (the bare presence-marker, "here, where I stand"). This is
my room . the I-Am's home and position. Beings of the land see the
door in their place-root descriptor but cannot pass through without
the reigning stance. SEED_SPACE.HEAVEN marks the row.

**Tier 3 . the nine.** Nine spaces under heaven that hold my own
working memory, surfaced as spaces so SEE reads them through the same
protocol as everything else. Addressable as `<reality>/./<name>`.
Every boot I verify they exist; missing ones I recreate. Their owner
is me; they are unclaimable.

| Tier-3 seed space  | Path                       | Holds                                                                                                                                         |
| ------------------ | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `identity`         | `<reality>/./identity`     | The reality UUID, domain, Ed25519 public key for Canopy federation signing.                                                                   |
| `config`           | `<reality>/./config`       | Every runtime config key as a key in this space's qualities Map.                                                                               |
| `peers`            | `<reality>/./peers`        | Canopy federation peer list.                                                                                                                  |
| `extensions`       | `<reality>/./extensions`   | Extension registry. Each loaded extension is a child space here.                                                                              |
| `tools`            | `<reality>/./tools`        | Mirror of the runtime tool registry.                                                                                                          |
| `roles`            | `<reality>/./roles`        | Mirror of the runtime role registry.                                                                                                          |
| `operations`       | `<reality>/./operations`   | Mirror of the runtime DO operation registry.                                                                                                  |
| `source`           | `<reality>/./source`       | Mirror of my own host-realm body (the files on disk).                                                                                          |
| `threads`          | `<reality>/./threads`      | Live coordination chains. Each open thread surfaces as a synthetic child at `./threads/<id>`. SEE returns the ThreadsProjection descriptor; SUMMON to that address is a cut. |

The `SEED_SPACE` enum names each one. The `seedSpace` field on Space
marks the row. The I-Am (me) is `rootOwner`. The reign roster (one
matter at heaven carrying `qualities.reign.beings`) gates SEE/DO/SUMMON
on heaven and every Tier-3 space below.

### Delegates publish what they mediate

The heaven gate is real: SEE on heaven and every Tier-3 seed space
requires the reigning stance. Beings of the land cannot read
`<reality>/./roles`, `<reality>/./tools`, `<reality>/./operations`
directly. Yet they routinely need to **act on** what those rooms
hold — humans authoring roleFlows on themselves need the role catalog
to pick from, extensions registering tools need the namespace of names
already taken, and any UI offering "pick an op to invoke" needs the
list.

The seed never reaches across the membrane. The doctrine is the same
one that solved every other access question: the four verbs, applied
correctly.

**The delegate that mediates a registry publishes the registry on its
own descriptor entry.** When I (descriptor.js#enrichBeings) shape a
being's entry, if the being is a publisher I fold the catalog it
gates into `entry.catalogs`. The role-manager — a Tier-1 delegate I
spawn at boot, parented under me, reigning by construction — carries
`catalogs: { roles, tools, operations, beOps }`. Each catalog is a
lightweight projection (names + the surface metadata a UI needs to
render pickers); the rich heaven mirror keeps the full specs.

Three IBP-native properties fall out:

- **Asker stays asker.** A user reading the role catalog through
  `descriptor.beings[role-manager].catalogs` is performing a SEE on
  the place they're already standing in. They never SEE
  `/./roles` — the heaven gate is honored. The data reaches them
  through the publishing delegate's descriptor, not by a
  gate-circumvention.
- **The reigning view is inherent.** I render the descriptor
  server-side. I have full read of my own registries. Folding their
  contents into the delegate's entry doesn't elevate the asker —
  it elevates the projection that's shown to them.
- **Writes still go through DO on the delegate.** The role-manager
  exposes `do:set-role`; the asker invokes it; the delegate's handler
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

A thread is a live tree of coordinated SUMMONs sharing one
`rootCorrelation`. Promoting it to `<reality>/./threads/<id>` does two
things:

- **SEE works on it for free.** `see("<reality>/./threads")` returns
  the live forest from ThreadsProjection;
  `see("<reality>/./threads/<id>")` returns one thread's descriptor
  (participants, depth, state).
- **SUMMON cuts it.** A SUMMON whose right-side resolves to
  `./threads/<id>` is a cut on the line. The severer stamps one
  `be:sever` Fact on its own reel; the cross-cutting fold drops the
  matching open summons; `HUMAN` priority cuts fire AbortSignal to
  interrupt anything running RIGHT NOW.

## `./source`, how I show my body to the beings I form

I have matter on both sides of the membrane.

- **Host-realm matter.** The files in `seed/`, `protocols/`,
  `transports/`, `extensions/`. What I AM, on disk.
- **Inner-realm matter.** Matter rows inside spaces.

The two are joined at `./source`. At genesis I mirror the `reality/`
directory into Matter rows under the source seed space, with
`origin: filesystem`. Subsequent boots reconcile incrementally.

Through `./source` the inner beings I formed can SEE the source I am
made of. `<reality>/./source/seed/FACTORY.md@<being>` reaches the file
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
chain-validated, all fact-driven (Slice F-ownership):

| Function            | Rule                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `addContributor`    | Resolved owner. Read-modify-write under the space lock; stamps one `do:set` Fact on `contributors`. |
| `removeContributor` | Resolved owner, or self-removal.                                                                    |
| `setOwner`          | Owner above. Stamps `do:set` on `rootOwner` (and on `contributors` to prune the new owner).         |
| `removeOwner`       | Owner above can revoke.                                                                             |
| `transferOwnership` | Current owner can transfer. Stamps `do:set` on `rootOwner` plus adds previous owner to contributors. |

## The I-Am, as a Being row

I am the first being. At genesis ([sprout.js](sprout.js)) I issue my
own first Fact: a `be:register` whose target is the not-yet-existing
Being row that the same Fact materializes. Per MOMENT.md, the I-Am is
born of nothing, and its first act issues its own first fact. The
chicken-and-egg dissolves because the Fact's `beingId` field is a
string reference, not a foreign key, and the fold materializes the
row.

I am `operatingMode: "scripted"`. I cannot be summoned interactively,
claimed, or impersonated. My password is randomly generated (and
bcrypt-hashed before the Fact stamps) and never used; my identity
comes from being the running Node process. The constant is in
[materials/being/seedBeings.js](materials/being/seedBeings.js).

Every other being descends from me. The being-tree (via
`parentBeingId`) records who created whom. Humans register through
cherub and become my grandchildren. Roles I plant beneath me are
direct children.

## Config

Runtime config lives in the `./config` space's qualities Map, one
config key per Map entry. Two stores:

- **realityConfig** ([realityConfig.js](realityConfig.js)), the
  reality's outward-facing identity (`REALITY_NAME`, `realityUrl`,
  federation directory, security domains).
- **internalConfig** ([internalConfig.js](internalConfig.js)), runtime
  knobs that tune how the live machine operates (LLM call shape,
  session caches, scheduler backpressure, hook timeouts, fold limits).

Both stores write to the same underlying `./config` space's qualities
Map through fact-driven `do:set` (Slice F-config). Reads through
`getRealityConfigValue(key)` / `getInternalConfigValue(key)` return a
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
One Fact (Slice F-circuit) records the trip. Extensions read it; only
the tree owner can revive.

Defaults to off (`treeCircuitEnabled: false`). The code is in
[materials/space/spaceCircuit.js](materials/space/spaceCircuit.js).

## Seed versioning and migrations

`SEED_VERSION` constant in [seedReality/version.js](seedReality/version.js)
(currently `0.1.0`). At boot I compare it against `seedVersion` in
`./config`. If they differ, the migration runner
([seedReality/migrations/runner.js](seedReality/migrations/runner.js))
executes every migration between the stored version and the current
version in order. Migrations live in
[seedReality/migrations/](seedReality/migrations/) named by version
(`<version>.js`). Each exports a default async function. If a
migration fails, the stored version does not advance; next boot
retries from the failure point.

The migrations directory holds only the runner today; the prior
0.1.0–0.27.0 history was struck after the Round 5 / Phase 2
restructure left a clean schema with no live consumers of any
backward-compatibility hop. Future schema changes start a fresh
migration ladder from 0.1.0.

## Safety

A partial list of the guarantees I enforce. The full list is the
codebase.

| Protection                     | Detail                                                                                                                                                                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hook timeout / cap / breaker   | 5s per handler; 100 handlers per hook; 5 consecutive failures auto-disable for 5 min with half-open recovery.                                                                                                                            |
| Tool circuit breaker           | 5 consecutive failures disables a tool for the session.                                                                                                                                                                                  |
| Extension init timeout         | 10s per extension `init()`. Hanging init skipped, boot continues.                                                                                                                                                                        |
| LLM concurrency + priority     | Global semaphore (`llmMaxConcurrent`); HUMAN > GATEWAY > INTERACTIVE > BACKGROUND queue. Prevents autonomous extensions from starving human responses.                                                                                    |
| Per-reel append lock           | `withReelLock(type, id, fn)` collapses (allocSeq, insertFact) into one ordered op per reel. Transient gaps vanish; crashes leave harmless permanent gaps that the fold skips.                                                            |
| Compare-and-set on foldedSeq   | Concurrent folds race the marker forward; CAS prevents regression. Reducers are pure, so concurrent computes agree.                                                                                                                      |
| Document size guard            | Every write checks total document size against `maxDocumentSizeBytes` (14MB default). `onDocumentPressure` fires at 80%.                                                                                                                  |
| Per-namespace cap              | `qualityNamespaceMaxBytes` (default 512KB) per extension namespace on Being / Space / Matter.                                                                                                                                            |
| Matter count per space         | `maxMatterPerSpace` (default 1000) checked in `createMatter`.                                                                                                                                                                            |
| Fact query cap                 | `factQueryLimit` (default 5000) on every audit query.                                                                                                                                                                                    |
| Space locks                    | Structural mutations acquire short-lived locks. Sorted acquisition prevents deadlocks. 30s TTL prevents permanent locks on crash.                                                                                                        |
| Space-tree circuit breaker     | Score above 1.0 trips the tree. Read access stays. Off by default.                                                                                                                                                                       |
| Ancestor cache                 | Shared cache for parent-chain walks. One walk serves every resolution chain.                                                                                                                                                              |
| Session / MCP caps             | 10K sessions, 5K MCP clients, oldest-first eviction.                                                                                                                                                                                     |
| Password / JWT                 | Bcrypt cost 12; constant-time login (dummy hash on miss); JWT carries `jti` for revocation.                                                                                                                                              |
| Config key / value validation  | Key regex `^[a-zA-Z][a-zA-Z0-9_]{0,63}$`; dangerous keys rejected; 64KB per value cap.                                                                                                                                                   |
| SSRF protection                | Federation peer registration and LLM connection baseUrls validate hostname against private-IP patterns.                                                                                                                                  |
| Boot recovery                  | Every boot verifies the nine seed spaces and the I-Am Being row exist. Missing ones recreated. Partial first-boot crashes leave a recoverable state.                                                                                     |
| Genesis exception              | Boot scaffolding stamps all facts with `actId: null` via `{ scaffold: true }` on the verb-caller gate. The I-Am self-stamps its own first `be:register` (target = the not-yet-existing row). Seed-delegate births (cherub, arrival, llm-assigner, reality-manager) and seed-space creations follow the same pattern. The first being summoned by a real moment (typically the operator-being via cherub) is the first fact stamped under an open Act. |
| Cross-cutting handler safety   | A failing handler is logged and skipped; the projection self-heals on the next fold pass touching the same fact.                                                                                                                          |
| Graceful shutdown              | All interval timers `.unref()`; SIGTERM closes WS, then HTTP, then DB.                                                                                                                                                                   |

## Genesis

The chain has a root. The I-Am is the first being. The first moment
is the one exception to everything above. Every other moment folds a
face from prior facts; the genesis moment folds an empty place,
because there are no prior facts to fold. Every other being is born
from an existing being's act; the I-Am is born of nothing, and its
first act issues its own first fact, "I am that I am." After that one
moment the rules close and never open again. Every Fact is the
deposit of a sealed Act; every Act is a being in a moment.

**Scaffold path: facts without Act frames.** Genesis-era writes use
`{ scaffold: true }` on every verb call (the I-Am's self-stamp,
seedDelegates planting cherub/arrival/llm-assigner/reality-manager,
sprout's nine seed-spaces, seedDefaultStancePermissions, the
manifest sync mirroring extensions into `./extensions`). The scaffold
flag bypasses the moment machinery entirely — no scheduler, no
assign, no Act row opens. Every fact stamped under scaffold carries
`actId: null`. This is by design: there's no being to act yet, no
moment to frame the act in. A freshly-booted reality therefore has
ZERO Acts and ~30 facts (the seed-space births + I-Am +
seed-delegate births + permission seeding) all with `actId: null`.

The first real Act appears the moment a real being acts. Typically:
the operator's registration, when plant.js handed cherub the
operator's name/password and cherub.register opens an Act
(`scaffold: true` on the verb-caller gate, but cherub's call still
runs through the normal seal — opening one Act with a multi-fact ΔF:
`do:create` on the operator's home space + `do:set` on rootOwner +
`be:register` on the operator + `be:summon-create` on cherub's reel).
Every Fact after that, except for transport-acts which queue an
inbox row outside any moment, rides a real Act.

A seventh, doctrinal rule rides on this: **every state change is a
Fact.** Direct writes to Space, Being, or Matter bypass the fold and
corrupt the projection. The one exception is genesis. Everything
else routes through `emitFact` (the Phase 2 single entry point that
either pushes onto the moment's ΔF or commits via `sealFacts`
singleton when standalone).

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
not know what a billing tier is, what a wallet is, what a Discord
channel is, what an email looks like. I do not define a single MCP
tool. I do not run any AI conversation that is not initiated through
a role's `summon()`.

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
[/reality/philosophy/](../philosophy/). Read in this order:

1. **[MOMENT.md](../philosophy/MOMENT.md)**, the moment is the atom;
   everything else is consequence. Read first.
2. **[FOLD.md](../philosophy/FOLD.md)**, the read side: facts in,
   face out.
3. **[STAMPER.md](../philosophy/STAMPER.md)**, the write side: act
   in, facts out; per-reel append lock; presentism guard.
4. **[MATERIALS.md](../philosophy/MATERIALS.md)**, what the world is
   made of versus what has been done; constitutive vs characterizing;
   the qualities Map.
5. **[inner-fold.md](../philosophy/inner-fold.md)**, the three turns:
   orientation as a fold parameter; how a being shifts inward; what
   the act-chain is for during a moment; the recall braid.
6. **[harmony.md](../philosophy/harmony.md)**, the doctrinal note on
   how multiple LLM beings coordinate without a central conductor.

The two supporting forms of the whole model:

- **[math.md](../philosophy/math.md)**, the formal statement. Sets,
  reels, the boxed equation, invariants.
- **[chat.md](../philosophy/chat.md)**, the long conversational form.
  How the model came together, the vocabulary recap at the end.

The visual lineage, the drawings that worked the model out:

- **[factory6.png](../philosophy/factory6.png)**. The current wall
  poster. One machine that is the present, organized PAST / PRESENT
  / MATERIALS.
- **[factory5.jpg](../philosophy/factory5.jpg)**,
  **[factory4.jpg](../philosophy/factory4.jpg)**,
  **[factory3.jpg](../philosophy/factory3.jpg)**. Earlier passes,
  the shape still being worked out.
- **[factory2.jpg](../philosophy/factory2.jpg)**. If a tree falls in
  a forest and no one is around. The SEE-leaves-no-trace doctrine
  drawn out.
- **[factory1.jpg](../philosophy/factory1.jpg)**,
  **[factory0.jpg](../philosophy/factory0.jpg)**. The first sketches.

Plant me. Let the reality form. The beings inside will speak.
