# FOLD.md — building a place from facts

## Principle

Every being, space, and matter is its own aggregate with its own reel —
its own append-only fact-chain, its own independent "now." Nothing shares
a reel.

A *place* is not stored and is not a reel. It is a transient weave: the
fold reads several reels at once and composes them into one coherent view
— the stamp face — for one being, for one moment. Each reel is a thread of
time; the fold weaves the threads a being needs into the place it sees,
then the place is gone. Next summon, it is re-woven.

The fold is a generic projection engine. It knows aggregates, facts,
reducers, projections — never "being" or "space" or "matter." All
material-specific knowledge lives in pluggable reducers under materials/.
That is the decoupling: the engine never grows; the materials catalog does.

## The pieces

- **Aggregate** — anything with identity and a reel: a being, a space, a
  matter. Generically {type, id}. The engine treats all alike; `type` only
  picks the reducer.
- **Fact** — one atom on a reel: {seq, type, id, kind, data, actId}.
  Targets exactly one aggregate, lives on that aggregate's reel, ordered by
  `seq`. (How verbs route facts to reels is the write side — out of scope
  here. The fold assumes one fact, one target aggregate, one reel.)
- **Reducer** — one pure function per material type: (state, fact) → state,
  plus initial(). The only place material logic lives.
- **Projection** — the materialized current state of one aggregate, cached:
  {type, id, state, foldedSeq}. A cache, not truth — "the state as of
  foldedSeq, parked." Queryable; indexed by `id` and by `position`.
- **Marker** — foldedSeq: the seq of the last fact folded in. Lets a fold
  catch up instead of rebuilding.

**Decision: the position index is one Mongo index on the projections
collection — no separate collection.** Every projection carries `position`
as a top-level field: the space the aggregate is in (the parent space for
a child space; null for the root). It is reducer output, kept current by
eager fold-on-write. `projections.findByPosition(spaceId)` is a query on
that indexed field. The "position index" is a view onto the projection
cache, not a structure maintained apart from it. A separate occupancy
collection is rejected — it would be a cache of a cache, with its own
drift, for no gain. Staleness inherits the existing model: eager fold
keeps it fresh, `foldedSeq` keeps it correct, re-fold self-heals.

## Three layers

1. **Fold engine** — generic. fold, rebuild, the catch-up loop, marker
   advance. Zero material names. Lives in factory/stamper/fold/.
2. **Reducers** — material-specific, pure. One per type in
   materials/<type>/reducer.js; collected in materials/reducers.js →
   {being, space, matter}.
3. **Place assembler** — foldPlace: composes folded aggregates into the
   stamp face, joined by `position`. Lives in fold/, calls the engine; the
   wire-shape assembly is today's buildPlaceDescriptor.

Adding a new material = a new folder under materials/ with a reducer + one
registry line. Layers 1 and 3 never change. That is "simple now, complex
for the children."

## Contracts the write side must satisfy

The write side is designed elsewhere, but the fold cannot catch up without
these guarantees from it:

**Decision: `seq` is a per-reel monotonic counter, allocated atomically at
append — never clock-derived.** Each reel has a head (its highest seq),
owned by the reel module (record layer); appending a fact atomically
increments that head and stamps the result on the fact. A being's own
reel has one writer (the scheduler's one-moment-per-being guarantee —
not a separate mutex), so this is uncontended. A space's or matter's
reel can be written by several beings' moments at once — a per-reel
append lock collapses (allocate seq, insert fact) into one ordered op
per reel, so the moments still run in parallel and only the append
instant is ordered. See [STAMPER.md](../STAMPER.md) for the full
write-side design.

The fold requires only: per-reel, monotonic, total order, no inversions,
unique. Gaps are harmless — a failed write may skip a number; the fold
sorts by `seq` and folds whatever exists. A unique index on
`(type, id, seq)` is the backstop. A wall-clock `date` may also ride on
the fact, but for human/audit use only — never the replay order, because
clock skew can invert order and corrupt the fold.

## Algorithms

    // Layer 1 — generic engine
    fold(type, id):
      proj = projections.get(type, id)            // {state, foldedSeq} | null
      if !proj: return rebuild(type, id)
      tail = reel.after(type, id, proj.foldedSeq) // facts with seq > marker
      if tail.empty: return proj.state            // HOT PATH — cache read
      reduce = reducers.get(type)                 // only material dispatch
      state = proj.state
      for f in tail: state = reduce(state, f)
      // Compare-and-set: only advance the marker if no one else has
      // already advanced it. Reducers are pure, so concurrent folds
      // compute identical state; the guard prevents marker regression
      // (thread A racing thread B to write {foldedSeq:13} after B
      // already wrote {foldedSeq:14}, which would strand fact 14).
      projections.compareAndSet(
        type, id,
        {foldedSeq: proj.foldedSeq},               // expected
        {state, foldedSeq: tail.last.seq}          // new
      )
      return state

    rebuild(type, id):
      snap  = snapshots.latest(type, id)          // {state, seq} | null
      reduce = reducers.get(type)
      state = snap ? snap.state : reduce.initial()
      for f in reel.all(type, id, after: snap?.seq ?? 0):
        state = reduce(state, f)
      projections.put(type, id, {state, foldedSeq: lastSeq})
      return state

    // Layer 3 — the cross-reel weave
    foldPlace(beingId):
      self      = fold("being", beingId)
      space     = fold("space", self.position)            // one hop
      occupants = projections.findByPosition(self.position) // [{type,id}]
      contents  = occupants.map(o => fold(o.type, o.id))
      return assembleFace(self, space, contents)          // the stamp face

foldPlace is the fold beat — run once per moment, and standalone for a SEE.

## Cross-reel consistency

**Decision: no global snapshot.** Each reel folds to its own current,
independently. A place is one being's read at one moment — each part
internally consistent on its own reel, joined by `position`, but not
transactionally consistent with the others. If a space advances between
folding the space and folding a matter in it, that is fine; the next
moment re-folds. This is not a weakness — it is the actor model: no global
now means no global snapshot, which is why moments parallelize with no
locks. A being's place is "the world as this being last folded it."

## Performance

- fold(type,id) hot path: one projection read, zero replay.
- foldPlace: one position-indexed query + K cached folds (K = occupants).
- Replay runs only over facts since the last fold. Eager fold-on-write
  (fold an aggregate forward the moment a fact is appended) keeps that near
  zero and keeps the position index current.
- rebuild is the cold path, rare. **Decision:** snapshots ({state, seq}
  every N facts) bound it; the foundation works without them — they are
  the one scale knob, added later.
- **Decision: reach is one hop.** foldPlace folds the being, its space, and
  that space's occupants; child spaces are *listed*, not deep-folded.
  Deep-fold happens when the being moves in. Bounded reach is the scope
  filter — the fold is never "fold the world."

## The decoupling work

Today the fold carries per-type logic inline. Extract it:
1. Move each type's reduce-logic into materials/<type>/reducer.js as a pure
   (state, fact) → state + initial().
2. Build materials/reducers.js.
3. Strip the branches from the fold; replace with reducers.get(type).
4. Refactor buildPlaceDescriptor to get each aggregate's state from
   fold(type, id) and find occupants via the position query.

## Acceptance

- The fold-engine source contains no being/space/matter — only
  aggregate/type/reducer.
- Each material type's state is produced solely by its reducer.
- fold(type,id) on an up-to-date aggregate does zero replay.
- foldPlace touches only the being, its space, and that space's occupants.
- A place is never persisted; every SEE and every fold beat re-builds it.
