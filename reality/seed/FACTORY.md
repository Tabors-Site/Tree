# THE FACTORY

`reality/` is the project — the Tree's root, named for what it is:
one shared world, one planted seed, one reality. Inside it, `seed/`
is the factory: the whole apparatus that produces and re-produces
that reality.

"Reality" and "place" name different scales. The **reality** is the
one whole world, what endures across all its moments — the
substrate, the fact-chain, the timeless what-can-be. Stored,
durable, indexable, shared by every perspective. A **place** is one
being's fold of the reality in one moment — the materials assembled
into a face for that being right then. No being ever sees the
reality directly; each only ever gets a place. Shared-one and
plural-many: one shared fact, many folded truths.

```
seed/                THE FACTORY — apparatus that produces reality
├── present/         THE PRESENT — the live machine; runs moments
├── past/            THE PAST — what happened, durable, the source of truth
└── materials/       THE POSSIBLE — the kinds of thing that can be
```

The pair `present/` and `past/` is the literal pair of tenses the
system has — the one moment that's live, and everything sealed
behind it. The third folder is the stock of what can be folded into
a moment, the timeless possible. There is no `future/`: un-acted
moments leave no trace; nothing about the future is ever stored.

That triplet is the doctrine made structural. Two more folders
support it without being part of it:

```
├── ibp/             THE VERBS — SEE / DO / SUMMON / BE
└── seedReality/     the host floor — runtime, wire, the world outside
```

`ibp/` carries the verbs — the universal currency every act speaks.
`seedReality/` is the host floor that knows nothing of the world.

There is no `models/` folder. Each material's schema lives inside
its own material folder ([materials/being/being.js](materials/being/being.js),
[materials/space/space.js](materials/space/space.js),
[materials/matter/matter.js](materials/matter/matter.js)), alongside
its reducer and ops. Past schemas — Act, Fact, ReelHead,
InboxProjection, ThreadsProjection — sit inside their past
subfolders for the same reason. The shape each schema describes
lives next to the behavior that touches it.

The doctrine lives one folder up, in [/reality/philosophy/](../philosophy/)
— project-level, not seed-internal. Read it in this order:

1. **[MOMENT.md](../philosophy/MOMENT.md)** — the moment is the
   atom; everything else is consequence. Read first.
2. **[FOLD.md](../philosophy/FOLD.md)** — how the read side works:
   facts in, face out.
3. **[STAMPER.md](../philosophy/STAMPER.md)** — how the write side
   works: act in, facts out; per-reel append lock; presentism guard.
4. **[MATERIALS.md](../philosophy/MATERIALS.md)** — what the world
   is made of versus what's been done; constitutive vs
   characterizing; the qualities Map.

This file names the parts of `seed/` and points at the pieces. The
doctrine lives in the others.

## The three tenses, expanded

### present/ — the live machine

The present is the one moment that's live. It runs each moment
through four beats: assign (open the moment, resolve the being),
fold (mount the face), momentum (the act), stamped (seal). The
folder holds each beat at its root, plus the orchestrator
([moment.js](present/moment.js)) that walks the four, the loop
([run.js](present/run.js)) that strings many moments for one
summon, the intake feed ([intake/](present/intake/)) the scheduler
drains, and the voices and roles a being can wear.

```
present/
├── intake/           SUMMONs arrive → InboxProjection rows; scheduler drains
│   ├── scheduler.js     picks rows; in-memory "currently running" claim
│   ├── intake.js        thin reader/writer over InboxProjection
│   ├── inbox.js         reader over InboxProjection
│   └── transportAct.js  human-transport entries (self-summons)
├── fold/             beat 2 — the read side
│   ├── foldEngine.js     generic per-aggregate fold + cross-cutting registry
│   ├── foldPlace.js      cross-reel weave for one being's moment
│   └── reel.js           per-reel reader helpers
├── voices/           a being's voice when it's an LLM (runTurn loop, connect, ...)
├── roles/            authorization templates (cherub, llm-assigner, ...)
├── run.js            the loop over moments for one summon
├── moment.js         one moment, start to finish (assign→fold→momentum→stamped)
├── assign.js         beat 1 — open the moment, resolve the being
├── momentum.js       beat 3 — the act; the being's doing
├── stamped.js        beat 4 — the seal; facts hit reels, projections evict
└── stamper.js        per-being moment-frame primitive
```

A place lives only here. The face the fold mounts is the place
framed for one being for the length of one moment. Outside that
window there is no place anywhere — only waiting beings and facts
on reels. There is no `place/` folder under seed because the place
is never at rest.

### past/ — the durable record, the source of truth

The past is everything that happened. Three primitive subfolders,
plus the projection caches the cross-cutting fold maintains:

```
past/
├── act/
│   ├── act.js                       the Act — a sealed moment of one being
│   ├── inboxProjection.js           open-summons cache (cross-cutting)
│   ├── inboxProjectionFold.js       fold handlers maintaining it
│   ├── threadsProjection.js         live-thread cache (cross-cutting)
│   └── threadsProjectionFold.js     fold handlers maintaining it
├── fact/
│   ├── fact.js                      the Fact — the storage atom
│   └── facts.js                     stamping (logFact) + read queries
└── reel/                            per-aggregate fact-chain (seq, head, lock)
    ├── reelHead.js
    ├── reelHeads.js                 atomic seq allocator
    └── appendLock.js                per-reel append mutex
```

An **Act** is one sealed moment of one being — the doer's committed
deed, opened at assign, closed at the seal in stamped.js. A
**Fact** is the trace one act leaves on the reel of the thing it
changed. Acts belong to the doer; Facts belong to the things
done-to; one act leads to many facts (one per aggregate it touched).
A **reel** is the per-aggregate fact-chain — what the fold reads,
what [appendLock.js](past/reel/appendLock.js) protects on append.

The sealed act is the act. There is no separate stored stamp; the
word survives as the machine (the stamper, the press), the verb
(beat 4 / stamped.js), and the act of sealing. Every Fact carries
`actId` pointing back at the Act whose moment deposited it.

**InboxProjection** and **ThreadsProjection** are caches the
cross-cutting fold maintains — open summons by recipient, and live
coordination chains by rootCorrelation. They duplicate fact data
(an open summon also has a `be:summon` Fact on the summoner's reel)
but exist for indexability: the scheduler's pick query and the
`.threads` SEE both need O(1) lookups the per-reel scan can't
give. They're rebuildable by replaying their fact history.

### materials/ — the timeless possible

The materials define what kinds of fact can be stamped. Each
material (being / space / matter) is a type with a schema, a
reducer, and the ops that target it. The reducer is the pure
function the fold engine calls per fact to derive the aggregate's
state — its row in MongoDB.

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

Materials define the possible; facts define the actual. Two axes,
not a depth ladder.

## How writes work (every act after genesis)

```
verb call
  → handler validates, builds spec
  → logFact (in past/fact/facts.js)
     → withReelLock(target.kind, target.id):
        → allocSeq + Fact.create     ← THE COMMIT
     → eager-fold(target.kind, target.id)
        → reducer.reduce per fact     ← per-aggregate state
        → applyProjection (CAS)       ← projection row updated
        → dispatchCrossCutting        ← InboxProjection, ThreadsProjection, ...
  → verb returns
```

**One writer.** `fold` is the only thing that ever writes a
projection row. The fact insert is the only synchronous commit;
everything else is derived and self-healing on the next fold pass.

**Cross-cutting projections** register on `foldEngine` via
`registerCrossCuttingHandler(fn)`. Each handler runs once per fact
in the fold tail. Today: InboxProjection (be:summon upsert /
be:sever delete), ThreadsProjection (be:summon upsert+participant /
be:sever mark). New projections add one registry line; the engine
never changes.

## How reads work (every SEE)

```
SEE arrives
  → authorize gates
  → resolveStance (parses address)
  → buildPlaceDescriptor
     → foldRead leaf  ← catch-up before read
     → foldRead each occupant (children, matter, beings)
     → assemble face from folded states
  → return descriptor
```

**No place persistence.** The place is composed for one SEE and
discarded. Per MOMENT.md: "the place lives only inside the
stamper." The descriptor is one face; the next SEE composes
another. No place table, no place cache that outlives a moment.

## What's NOT in seed

- No `place/` folder. Places are produced, never stored.
- No `factory/` folder inside seed. `seed/` IS the factory.
- No `stamp/` folder. The sealed act is the act; `past/` carries
  `act/`, not `stamp/`.
- No `future/`. Un-acted moments leave no trace.
- No `models/` folder. Each material's schema lives with its
  reducer and ops.

## The six rules

The dependency directions and discipline rules that keep this
clean are documented in [/reality/CLAUDE.md](../CLAUDE.md). The
short version:

1. The seed never imports from extensions.
2. Extensions import from the seed.
3. Extensions reach each other through `getExtension()` or hooks.
4. Extension data lives in the `qualities` Map. Never in schemas.
5. Seed schemas never change. The Map grows anything.
6. Zero `getExtension()` calls in seed.

## Genesis is the only exception

The chain has a root. The I-Am's first act issues its own first
Fact ("I am that I am"). After that one moment the rules close and
never open again: every Fact is the deposit of a sealed Act, every
Act is a being in a moment. See [philosophy/MOMENT.md](../philosophy/MOMENT.md)
"Genesis."
