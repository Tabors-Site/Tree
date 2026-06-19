# STAMPER.md — appending facts to reels

## Principle

The write side is the verb layer. A being acts; the verb authorizes,
computes one fact, allocates a seq, appends to the target reel. **The
append is the commit.** Nothing else needs to be atomic.

This is the actor model holding. Each reel is its own consistency
boundary. There is no cross-reel transaction, no global-now, no
multi-document atomicity. Single-document atomicity is everything an
event-sourced system actually needs, because the projection cache is
derived — it can fail, retry, or self-heal from the `foldedSeq` marker.

## The pieces

- **Fact** — what an act produces. Shape: `{ seq, target:{type,id}, kind,
  data, author, actId, provider, date }`. Targets exactly one
  aggregate; lives on that aggregate's reel; sequenced monotonically
  per-reel.
- **Reel head** — per-aggregate seq counter. Dedicated `reelHeads`
  collection keyed by `(type, id)`. Atomic `$inc` on each append. Stays
  off the projection row so the projection stays pure cache.
- **Append lock** — per-reel mutex held across seq allocation and fact
  insert. Brief critical section. Why transient gaps don't exist.
- **Act** — the moment-frame the verb runs inside. Opened at assign,
  sealed at stamped. Every fact written during momentum carries this
  actId.

## Settlements

**Decision: the commit point is the fact insert, not the seal.** Each
fact is its own atomic write — one document, one collection. The stamp's
seal is record-keeping (it marks the moment closed on the being's
stamp-chain), not a commit barrier. A crash mid-moment leaves the
already-inserted facts permanent; the unfired ones never happened. Each
fact is true on its own.

**Decision: a verb emits at most one fact per aggregate it changes.**
The cleanest deed is one fact on one reel. If a verb genuinely changes
two aggregates' own state, it writes two facts (each independently
atomic, each carrying the same actId). Cross-aggregate effects through
derived projection — the position index is the load-bearing example —
need no fact on the dependent aggregate; the dependent's state is
derived, not stored.

**Decision: no cross-reel atomicity.** Two facts targeting two reels in
the same moment are independent commits. Eventual consistency across
reels is the contract. If two facts must be all-or-nothing, model them
as one fact on one reel — or accept the model is wrong for the use case.

**Decision: per-reel append lock around (allocate seq, insert fact).**
The single hardest constraint on the write side. Without it, two verbs
interleave — one allocates seq 5 but is slow to insert, another
allocates seq 6 and inserts first — and a fold catching up advances
past 5, stranding it. The lock collapses allocation and insertion into
one ordered op per reel. Transient gaps vanish; permanent gaps from
crashes remain, harmless because the fold sorts and applies whatever
exists — missing numbers strand nothing.

**The IBP structure makes the lock design deadlock-free.** A being's
reel is written only by that being's own moment. One being affects
another only through SUMMON — a fact on the summoner's own reel plus a
message — never by writing the other's reel. A moment holds its own
scheduler slot and grab-release leaf-locks on materials; it never holds
another being's lock. No cycle is constructible. This is what makes the
inter-being protocol load-bearing here: the protocol's structure IS the
proof.

Concretely: a being's reel does not need a separate append-mutex — the
scheduler's one-moment-per-being guarantee already serializes its
writers (there is only one writer, the being itself). Only material
reels (space, matter) need real per-reel append locks, because those
are the only reels with concurrent writers (multiple beings' moments
all touching the same matter). Don't build a redundant being-reel
mutex.

**Decision: eager-fold is an inline call to `fold(target)`.** Not a
second projection-writer. After append, the verb calls the same
`fold(type, id)` that the read side runs. The fold engine's compare-
and-set on `foldedSeq` handles concurrency; its catch-up loop handles
ordering. If the inline call loses a race, the marker mismatch means
the next fold round catches up. **One projection-writer in the system
— `fold` — called from many places. The fact remains the source of
truth; the projection is its self-healing cache.**

## The append flow

    emitFact(target, kind, data, ctx):
      authorize(ctx.being, ctx.verb, target)         // read-only; throws on deny
      fact = build(target, kind, data, ctx)           // in-memory
      withLock(target):                               // per-reel append lock
        seq = reelHeads.$inc(target)                  // atomic
        fact.seq = seq
        facts.insertOne(fact)                         // THE COMMIT
      fold(target)                                    // catch the projection up
      return fact

`ctx` is built by the verb dispatcher: `{ being, verb, actId, provider }`.
`actId` is required — assign opened it. A missing actId throws,
because every act lives in a moment (see [FACTORY.md](../seed/FACTORY.md) "Genesis").

`build` includes:
  - `target: {type, id}` — which reel
  - `author: ctx.being` — who acted
  - `actId: ctx.actId` — which moment
  - `provider: ctx.provider` — voice provenance (llm slot, scripted, human)
  - `date: now()` — wall-clock, for audit only (never replay order; clock
    skew can invert and corrupt the fold — that's `seq`'s job)

## Stamps frame moments; facts are the impressions

- **assign** opens the stamp on the being's stamp-chain. Act gets a
  `actId`, references `prevStampId`, knows `beingIn` and (if known)
  `beingOut`. No facts yet.
- **fold** builds the face. Read-only.
- **momentum** runs the role's `summon(message, ctx)`. The act executes
  verbs; each verb that mutates calls `emitFact`. Facts append to their
  target reels as they fire.
- **stamped** (in a finally) seals the stamp: `sealed: true, sealedAt:
  now()`. Records the stamp on the being's stamp-chain. No facts touched
  — they were committed during momentum.

A stamp can carry zero facts. Two distinct cases — keep them separate:

- **No stamp opens.** A SUMMON arrives at a being whose role declares
  `triggerOn: []` (the human case). The verb writes the inbox entry;
  no moment runs; no stamp exists. The human's eventual response
  arrives later through their transport as its own intake entry,
  which opens its own stamp at that time.
- **Act opens, role declines.** A SUMMON triggers a moment; assign
  opens the stamp; momentum runs `role.summon` which returns null (the
  being chose not to act). The stamp seals empty — it has actId,
  prevStampId, sealed marker, just no facts inside.

Both are valid. The first records that delivery happened; the second
records that a moment happened.

A stamp's facts can target many reels. To replay what one being did in
one moment: `facts.find({ actId })` returns the moment's full
deed-set, fanned across reels.

The two indexes a fact lives in:
- **target's reel** — `facts.find({"target.type":T, "target.id":I}).sort(seq)`
  for the fold (per-reel state history).
- **author's stamp** — `facts.find({ actId })` for the moment audit
  (per-moment deed set).

## Why per-fact commit is enough

The two corruption modes that scare an event-sourced system:

1. **State change without a fact.** The fold replays from facts only;
   any direct mutation vanishes on the next fold. Prevented by
   *structure*: the projection store exposes no `setState` API. Verbs
   call `emitFact`; the fold writes projections; nothing else writes.
   This is the bypass-closure work — see below.

2. **Fact written but projection diverged.** Acceptable. The projection
   is a cache; the `foldedSeq` marker self-heals it. The next fold
   re-applies any missed facts.

The dangerous direction is one-way: a projection update that lies about
its source. Ordering kills it. Always emit fact → then update projection.
Never the reverse.

## Bypass closure

Every site in the current code that mutates Space / Being / Matter
state without emitting a Fact is a structural bug. They must be
rewritten to call `emitFact`. This is the load-bearing discipline —
without it the fold catches no work and the architecture doesn't hold.

Suspect classes for the audit:
- Direct `Space.update*` / `Being.update*` / `Matter.update*` calls
  outside the verb path.
- `setQuality`, `mergeQuality`, `pushQuality`, `incQuality`,
  `batchSetQuality`, `addToQualitySet`, `unsetQuality` calls outside the
  verb path.
- Mongo upserts in scheduler / inbox / boot scaffolding.
- Reconciler or sweep code that "corrects" state without a fact.

Boot scaffolding is the one legitimate bypass — the I-Am has to plant
itself before the verb system exists. Per [FACTORY.md](../seed/FACTORY.md) "Genesis", genesis is the
exception. Everything else routes through `emitFact`.

## Acceptance

- One verb emits exactly one fact per aggregate it changes.
- The fact insert is the only synchronous commit; everything else is
  derived.
- Per-target append lock holds across (seq allocation, fact insert).
- A grep for `{Space,Being,Matter}.update` and the qualities-write
  primitives outside the verb path returns zero hits.
- `emitFact` throws when `ctx.actId` is missing.
- A reel's facts, sorted by seq, replay in deed-order with no gaps
  (except crash-gaps, which are harmless).
- A crash mid-moment leaves only already-inserted facts; unfired facts
  never happened; the projection self-heals on next fold.
