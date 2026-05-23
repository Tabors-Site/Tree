# THE FACTORY

`reality/` is the project — the Tree's root, named for what it
is: one shared world, one planted seed, one reality. Inside it,
`seed/` is the factory: the whole apparatus that produces and
re-produces that reality. The factory holds three tenses.

"Reality" and "place" name different scales. The **reality** is
the one whole world, what endures across all its moments. A
**place** is one being's fold of it, in one moment — the materials
making the stamp face, the matter / space / beings assembled for
that being right then. No being ever sees the reality directly;
each only ever gets a place. Shared-one and plural-many: the same
structure the doctrine runs on (one shared fact, many truths).

```
seed/                THE FACTORY — apparatus that produces reality
├── present/         THE PRESENT — the live machine; runs moments
├── past/            THE PAST — what happened, durable
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
└── parentPlace/          the host floor — runtime, wire, the world outside
```

`ibp/` carries the verbs — the universal currency every act speaks.
`parentPlace/` is the host floor that knows nothing of the world.

There is no `models/` folder. Each material's schema lives inside
its own material folder ([materials/being/being.js](../materials/being/being.js),
[materials/space/space.js](../materials/space/space.js),
[materials/matter/matter.js](../materials/matter/matter.js)),
alongside its reducer and ops. Past schemas — Act, Fact, ReelHead —
sit inside their past subfolders for the same reason. The shape
each schema describes lives next to the behavior that touches it.

The doctrine lives one folder up, in
[/place/philosophy/](../../philosophy/) — project-level, not
seed-internal. Read it in this order:

1. **[MOMENT.md](../../philosophy/MOMENT.md)** — the moment is the
   atom; everything else is consequence. Read first.
2. **[FOLD.md](../../philosophy/FOLD.md)** — how the read side
   works: facts in, face out.
3. **[STAMPER.md](../../philosophy/STAMPER.md)** — how the write
   side works: act in, facts out; per-reel append lock; presentism
   guard.
4. **[MATERIALS.md](../../philosophy/MATERIALS.md)** — what the
   world is made of versus what's been done; constitutive vs
   characterizing; the qualities Map.

This file is the entry doc for `seed/` — names the parts and
points at the pieces. The doctrine lives in the others.

## The three tenses, expanded

### present/ — the live machine

The present is the one moment that's live.

It used to be called the stamper, or the thing thats stamping. The being of the moment.

It runs each moment
through four beats: assign (open the moment, resolve the being),
fold (mount the face), momentum (the act), stamped (seal). The
folder holds each beat at its root, plus the orchestrator
([moment.js](../present/moment.js)) that walks the four, the loop
([run.js](../present/run.js)) that strings many moments for one
summon, the run-feed ([intake/](../present/intake/)) the scheduler
drains, and the voices and roles a being can wear.

```
present/
├── intake/       SUMMONs arrive here; the scheduler drains the feed
├── run.js        the loop over moments for one summon
├── moment.js     one moment, start to finish (assign→fold→momentum→stamped)
├── assign.js     beat 1 — open the moment, resolve the being
├── fold/         beat 2 — mount the face; the read side
├── momentum.js   beat 3 — the act; the being's doing
├── stamped.js    beat 4 — the seal; facts hit reels
├── voices/       llm connections — a being's voice when it's a model
└── roles/        authorization — what a being may do
```

A place lives only here. The face the fold mounts is the place
framed for one being for the length of one moment. Outside that
window there is no place anywhere — only waiting beings and facts
on reels. There is no `place/` folder under seed because the place
is never at rest.

### past/ — the sealed record

The past is everything that happened. Three subfolders, three
nouns:

```
past/
├── act/    the Act — a committed moment; the act-chain
├── fact/   the Fact — a deed-trace; the storage atom
└── reel/   a fact-chain — seq, head, append lock
```

An **Act** is one sealed moment of one being. A **Fact** is the
trace one act leaves on the reel of the thing it changed. The act
belongs to the doer; facts belong to the things done-to; one act
leads to many facts (one per aggregate it touched). A **reel** is
the per-aggregate fact-chain — what the fold reads, what
[appendLock.js](../past/reel/appendLock.js) protects on append.

The sealed act is the act. There is no separate stored Stamp. The
word "stamp" survives only as the machine (stamper as a verb for
sealing) and the file `stamped.js` (beat 4). Every Fact carries
`actId` pointing back at the Act whose moment deposited it.

### materials/ — the timeless possible

The materials define what kinds of fact can be stamped. Each
material (being / space / matter) is a type with a schema, a
reducer, and the ops that target it.

```
materials/
├── being/        being type — schema, reducer, ops
├── space/        space type — schema, reducer, ops
├── matter/       matter type — schema, reducer, ops
├── qualities.js  the open quality system
├── seeds.js      initial states
└── manifest.js   material registry + reducers
```

Materials define the possible; facts define the actual. Two axes,
not a depth ladder.

## What's NOT in seed

- No `place/` folder. Places are produced, never stored.
- No `factory/` folder inside seed. `seed/` IS the factory.
- No `stamp/` folder. The sealed act is the act; `record/` (now
  `past/`) carries `act/`, not `stamp/`.
- No `future/`. Un-acted moments leave no trace.

## The six rules

The dependency directions and discipline rules that keep this
clean are documented in [/place/CLAUDE.md](../../CLAUDE.md). The
short version:

1. The seed never imports from extensions.
2. Extensions import from the seed.
3. Extensions reach each other through `getExtension()` or hooks.
4. Extension data lives in the `qualities` Map. Never in schemas.
5. Seed schemas never change. The Map grows anything.
6. Zero `getExtension()` calls in seed.
