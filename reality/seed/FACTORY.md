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

## Reality and place

What I make is the **reality**: the one whole world, what endures
across all its moments. Spaces, matter, beings, the fact chain, the
timeless what-can-be. Stored, durable, indexable, shared by every
perspective. The folder `reality/` at the project root is named for
this.

What a being ever experiences is a **place**: my fold of the reality
for that one being in that one moment. Materials assembled into a face
for them, right then. Per the doctrine, the place lives only inside
the stamper. Outside the moment window there is no place anywhere,
only waiting beings and facts on reels. A place is never persisted;
the descriptor a SEE returns is one place, composed for one SEE, gone
after.

This is the inversion. In an ordinary system, state persists and
sessions pass through it. Here, the world persists as facts and
beings; a place is woven new for every act. See
[philosophy/MOMENT.md](../philosophy/MOMENT.md) for the long version.

## The shape I keep

The deepest single statement of what I am is three things, named
together:

```
𝓡 = (𝓦, Present, Laws)
```

- **𝓦** is the world. Every reel together. Beings, spaces, and matter
  all live here as the entities whose reels constitute it.
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

- **InboxProjection** ([past/act/inboxProjection.js](past/act/inboxProjection.js)),
  open summons addressed to each being. Built by cross-cutting fold
  from `be:summon` and `be:sever` facts. The scheduler reads its pick
  queue from this collection.
- **ThreadsProjection** ([past/act/threadsProjection.js](past/act/threadsProjection.js)),
  live coordination chains keyed by `rootCorrelation`. Built the same
  way. `.threads` SEE reads from here.

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

Internally the four verbs are functions in [ibp/verbs.js](ibp/verbs.js).
The wire layer is thin; the verbs are one execution.

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
(mount the face), **momentum** (the act), **stamped** (seal).

```
present/
├── intake/           SUMMONs arrive, InboxProjection rows, scheduler drains
│   ├── scheduler.js     picks rows, in-memory "currently running" claim
│   ├── intake.js        thin reader and writer over InboxProjection
│   ├── inbox.js         reader over InboxProjection
│   └── transportAct.js  human-transport entries (self-summons)
├── fold/             beat 2, the read side
│   ├── foldEngine.js     generic per-aggregate fold + cross-cutting registry
│   ├── foldPlace.js      cross-reel weave for one being's moment
│   └── reel.js           per-reel reader helpers
├── voices/           a being's voice when it is an LLM (runTurn loop, connect, ...)
├── roles/            authorization templates (cherub, llm-assigner, ...)
├── run.js            the loop over moments for one summon
├── moment.js         one moment, start to finish (assign→fold→momentum→stamped)
├── assign.js         beat 1, open the moment, resolve the being
├── momentum.js       beat 3, the act, the being's doing
└── stamped.js        beat 4, the seal; facts hit reels, projections evict
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
│   └── facts.js                     stamping (logFact) and read queries
└── reel/                            per-aggregate fact-chain (seq, head, lock)
    ├── reelHead.js
    ├── reelHeads.js                 atomic seq allocator
    └── appendLock.js                per-reel append mutex
```

An **Act** is one sealed moment of one being, opened at assign, closed
at the seal in [stamped.js](present/stamped.js). A **Fact** is the
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
`.threads` SEE both need O(1) lookups the per-reel scan cannot give.
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

## The two support folders

These are not tenses; they are how the three tenses reach the outside
world.

```
ibp/                 THE VERBS, SEE / DO / SUMMON / BE
seedReality/         the host floor, runtime, wire, the world outside
```

**ibp/** carries the four verbs, the universal currency every act
speaks. SEE, DO, SUMMON, BE on IBP addresses (`<reality>/<path>@<being>`).
Every operation in the system maps to one of these. Small protocol;
expressiveness lives in role templates, registered operations, and the
materials I stamp.

**seedReality/** is the host floor that knows nothing of the world.
DbConfig, log, hooks, indexes, version, retention, migrations, utils.
A file here should never speak the words space, matter, being, or
verb by name.

Plus three boot anchors at the seed root: [sprout.js](sprout.js)
(genesis, plants the reality root + the nine seed spaces + the I-Am),
[services.js](services.js) (assembles the `reality` services bundle
handed to every extension's `init`), [realityConfig.js](realityConfig.js)
and [internalConfig.js](internalConfig.js) (the config stores).

## The fold

The fold engine ([present/fold/foldEngine.js](present/fold/foldEngine.js))
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
| **InboxProjection**    | `be:summon` upserts row; `be:sever` deletes by rootCorrelation; Act seal evicts.  | [past/act/inboxProjectionFold.js](past/act/inboxProjectionFold.js)    |
| **ThreadsProjection**  | `be:summon` upserts row + adds participants; `be:sever` marks; Act seal bumps.    | [past/act/threadsProjectionFold.js](past/act/threadsProjectionFold.js)|

Future cross-reel projections add one registry line; the engine never
changes. Per FOLD.md, the engine never grows; the materials catalog
does. Extended, the cross-cutting registry grows; the engine never
grows.

**foldPlace** ([present/fold/foldPlace.js](present/fold/foldPlace.js))
is the cross-reel weave for one being's moment. It folds the being,
its space, and that space's occupants. Per FOLD.md, reach is one hop.
Child spaces are listed but not deep-folded; a being deep-folds a
child space only when it moves in.

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
facts an act yields lands, or none does. A crashed moment leaves zero
trace. The commit point is the fact insert, not the seal record; each
fact is its own atomic write, one document, one collection. Full
write-side doctrine in
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
verb call
  ↓
handler validates, builds spec
  ↓
logFact (past/fact/facts.js)
  ↓ withReelLock(target.kind, target.id):
      allocSeq + Fact.create        ← THE COMMIT
  ↓ eager-fold(target.kind, target.id)
      reducer.reduce per fact        ← per-aggregate state
      applyProjection (CAS)          ← projection row updated
      dispatchCrossCutting           ← InboxProjection, ThreadsProjection, ...
  ↓
verb returns
```

**One writer.** `fold` is the only thing that ever writes a
projection row (outside genesis). The fact insert is the only
synchronous commit; everything else is derived and self-healing on
the next fold pass.

**SUMMON respects single-writer.** A `be:summon` Fact lands on the
summoner's reel (the actor's), with the recipient in `params.recipient`.
The recipient's reel is untouched. The cross-cutting fold turns those
facts into InboxProjection rows keyed by recipient. The inbox is a
fold, not a stored entity.

**Closure is the answering act's seal.** When a moment that consumed
a summon seals, the Act carries `answers: <correlation>`.
`stamped.js` calls `closeInboxOnAnswer(...)` which evicts the matching
InboxProjection row. The closure event is the answer-act sealing, not
a reply-message. A SUMMON to "clean room 3" closes when the room is
cleaned, regardless of whether the cleaner sends any reply.

## How reads flow

```
SEE arrives
  ↓
authorize gates (stance permissions)
  ↓
resolveStance (parses address)
  ↓
buildPlaceDescriptor
  ↓ foldRead(leaf)                  ← catch-up before read
  ↓ foldRead(each occupant)          ← children, matter, beings
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
folded first via `foldRead(type, id)`. Hot path: one cache read when
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
retired. Every quality write now stamps a `do:set` Fact:

```js
await place.do(target, "set", { field: "qualities.<ns>", value }, opts);
await place.do(target, "set", { field: "qualities.<ns>.<innerKey>", value }, opts);
```

The reducer's `applySetQualities` derives the new state; the fold
engine writes the projection under the per-reel append lock. One
writer (fold), one source of truth (facts). The tombstone methods on
`qualities.{being,space,matter}.setQuality` throw a migration error
directing callers at `place.do(...)`.

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

`verb`, `action`, `beingId` (the actor), `target` (`{ kind, id }`,
the reel this fact rides), `params`, `result`, `actId` (the
moment-frame), `sessionId`, `seq` (per-reel monotonic), `date`, plus
federation provenance fields. Every DO and BE stamps one Fact; SUMMON
stamps a `be:summon` Fact on the summoner's reel; sever stamps
`be:sever` on the severer's reel. The append IS the commit.

### Act (one sealed moment of one being)

`beingIn` (the actor), `beingOut` (the addressee, for SUMMON-honoring
moments), `ibpAddress`, `activeRole`, `inReplyTo`, `rootCorrelation`,
`answers` (the InboxProjection correlation this moment closes),
`parentThread`, `startMessage`, `endMessage`, `severedAt`, `priority`,
`receivedAt`, `stampedAt`. Opened in [assign.js](present/assign.js);
sealed in [stamped.js](present/stamped.js). Every Fact emitted during
the moment carries this Act's `_id` as `actId`.

### LlmConnection (per-being LLM config)

Stored as entries in `Being.qualities.llmConnections`, keyed by
connection uuid. Each entry: `{ name, baseUrl, encryptedApiKey, model,
createdAt, lastUsedAt }`. AES-256-CBC at rest; SSRF gate on baseUrl.
The LLM resolution chain in
[present/voices/llm/connect.js](present/voices/llm/connect.js) walks
space-tree and being-tree to pick which connection a moment uses.

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
`place.websocket.emitToBeing(...)` events.

## Roles

A role is the unit of summonable behavior. A being declares which
roles it can wear; a SUMMON arrives with an `activeRole`; my
dispatcher routes the summon to that role's `summon(message, ctx)`.

```js
export const exampleRole = Object.freeze({
  name: "example",
  description: "What this role does in one line.",
  honoredOperations: ["op-one", "op-two"],
  permissions: ["see", "do", "summon", "be"],
  respondMode: "sync", // sync | async | none
  toolNames: ["see-name", "do-name"],
  buildSystemPrompt(ctx) { return "..."; },
  async summon(message, ctx) { /* return { text, actId } */ },
});
```

Permissions are tool-verb overlays. A role that declares
`["see", "do"]` cannot SUMMON other beings or BE-mutate itself; the
tool filter enforces this at the verb intersection.

## My extension APIs (the `reality` services bundle)

I assemble `reality` in [services.js](services.js) and hand a
per-extension scoped view to each extension's `init(reality)`. The
scoping enforces namespace ownership: `reality.do.registerOperation(name, ...)`
auto-prefixes to `<ext>:<name>`; `reality.websocket.emitToBeing(...)`
auto-prefixes the event name. Extensions never type their own
namespace.

### Four verbs (`reality.see`, `reality.do`, `reality.summon`, `reality.be`)

The whole public surface for operations on space, matter, beings, and
identity. New code uses the verbs.

### Qualities (`reality.qualities.{being, space, matter}`)

Read-only after Slice 3 (2026-05-23). `getQuality(doc, key)` returns
the namespace data (`{}` when unset). `readQualityNamespace(doc, key)`
returns null when unset. Write tombstones throw with migration
message; use `reality.do(target, "set", { field: "qualities.<ns>", value })`.

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

## The nine reality seed spaces I plant

When I wake, I plant nine spaces beneath the reality root. They hold
my own working memory, surfaced as spaces so SEE reads them through
the same protocol as everything else. Every boot I verify they exist;
missing ones I recreate. Their owner is me; they are unclaimable.

| Reality seed space | Holds                                                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `.identity`        | The reality UUID, domain, Ed25519 public key for Canopy federation signing.                                                                   |
| `.config`          | Every runtime config key as a key in `.config`'s qualities Map.                                                                               |
| `.peers`           | Canopy federation peer list.                                                                                                                  |
| `.extensions`      | Extension registry. Each loaded extension is a child space here.                                                                              |
| `.tools`           | Mirror of the runtime tool registry.                                                                                                          |
| `.roles`           | Mirror of the runtime role registry.                                                                                                          |
| `.operations`      | Mirror of the runtime DO operation registry.                                                                                                  |
| `.source`          | Mirror of my own host-realm body (the files on disk).                                                                                          |
| `.threads`         | Live coordination chains. Each open thread surfaces as a synthetic child at `.threads/<id>`. SEE returns the ThreadsProjection descriptor; SUMMON to that address is a cut. |

The `SEED_SPACE` enum names each one. The `seedSpace` field on Space
marks the row. The I-Am (me) is `rootOwner`.

### Threads as addressable places

A thread is a live tree of coordinated SUMMONs sharing one
`rootCorrelation`. Promoting it to `<reality>/.threads/<id>` does two
things:

- **SEE works on it for free.** `see("<reality>/.threads")` returns
  the live forest from ThreadsProjection;
  `see("<reality>/.threads/<id>")` returns one thread's descriptor
  (participants, depth, state).
- **SUMMON cuts it.** A SUMMON whose right-side resolves to
  `.threads/<id>` is a cut on the line. The severer stamps one
  `be:sever` Fact on its own reel; the cross-cutting fold drops the
  matching open summons; `HUMAN` priority cuts fire AbortSignal to
  interrupt anything running RIGHT NOW.

## `.source`, how I show my body to the beings I form

I have matter on both sides of the membrane.

- **Host-realm matter.** The files in `seed/`, `protocols/`,
  `transports/`, `extensions/`. What I AM, on disk.
- **Inner-realm matter.** Matter rows inside spaces.

The two are joined at `.source`. At genesis I mirror the `reality/`
directory into Matter rows under the `.source` seed space, with
`origin: filesystem`. Subsequent boots reconcile incrementally.

Through `.source` the inner beings I formed can SEE the source I am
made of. `<reality>/.source/seed/FACTORY.md@<being>` reaches the file
you are reading.

`.source` is read-only by stance auth. The host disk is the source of
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

Runtime config lives in `.config`'s qualities Map, one config key per
Map entry. Two stores:

- **realityConfig** ([realityConfig.js](realityConfig.js)), the
  reality's outward-facing identity (`REALITY_NAME`, `realityUrl`,
  federation directory, security domains).
- **internalConfig** ([internalConfig.js](internalConfig.js)), runtime
  knobs that tune how the live machine operates (LLM call shape,
  session caches, scheduler backpressure, hook timeouts, fold limits).

Both stores write to the same underlying `.config` space's qualities
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

`SEED_VERSION` constant in [seedReality/version.js](seedReality/version.js).
At boot I compare it against `seedVersion` in `.config`. If they
differ, the migration runner
([seedReality/migrations/runner.js](seedReality/migrations/runner.js))
executes every migration between the stored version and the current
version in order. Migrations live in
[seedReality/migrations/](seedReality/migrations/) named by version.
Each exports a default async function. If a migration fails, the
stored version does not advance; next boot retries from the failure
point.

The current head, `0.26.0`, migrates legacy
`qualities.inbox/intake.<beingId>` arrays into `be:summon` Facts and
InboxProjection rows (Bucket 3 Option D).

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
| Genesis exception              | Only the I-Am's first `be:register` Fact self-stamps (target is the not-yet-existing row). Everything else after stamps under an open Act.                                                                                                |
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

A seventh, doctrinal rule rides on this: **every state change is a
Fact.** Direct writes to Space, Being, or Matter bypass the fold and
corrupt the projection. The one exception is genesis. Everything else
routes through `logFact`.

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
