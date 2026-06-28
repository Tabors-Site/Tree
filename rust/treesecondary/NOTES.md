# treesecondary - the secondary cross-cutting projections (the PURE FOLD)

The three SECONDARY projections (the views that span reels) FOLD from the same
facts the primary reel reducers do, so their FOLD belongs in the engine, not as
present/stamper JS-only handlers. This crate ports the PURE FOLD of each, byte-
compatible with the JS projStore row shapes. **The fold moves here; the I/O
wiring (WHEN they fire, the live cross-reel reads) stays in JS for now.**

Ported from:
- `seed/past/projections/inbox/inboxProjectionFold.js`
- `seed/past/projections/threads/threadsProjectionFold.js`
- `seed/past/projections/position/positionProjectionFold.js`
- the cross-cutting fold contract in
  `seed/present/stamper/2-fold/foldEngine.js` (`dispatchCrossCutting` fires every
  applied fact through each registered handler; the fold's hot core is already
  the Rust `treefold` crate via `native.foldFrom`, cross-cutting dispatch stayed
  JS - this crate is the next slice of that dispatch to go native).

Row shape parity: a projStore row is written `JSON.stringify(row) + "\n"`, and
`treehash::stringify` is **insertion-order** (no key sort, like `JSON.stringify`).
So each fold builder pushes keys in the EXACT JS order. That order was traced
from `projStore.js` `applyUpdate` / `_insertUpsert`: `_id` first (the upsert
seed), then the `$set` keys in literal order, then the `$setOnInsert` extras,
then `$addToSet`. A `$set` value the JS leaves `undefined` (e.g.
`params.attachments || undefined`) is **dropped** by `JSON.stringify`, so the
builder simply never pushes it (`RowBuilder::put_opt`). The tests assert the
Rust row's byte image == the live JS image (generated from the same
`applyUpdate`).

## The JS map: which facts drive each projection, what it stores

### inbox (one row per OPEN summon, keyed by `params.correlation`)
- **opens on** a `call` fact (the fat call): `verb === "call"`, `params.correlation`
  present, `of = {kind:"being", id}` (the recipient's reel, right stance), `through`
  = the summoner. Stores `{_id:correlation, recipient, summoner, sender, content,
  activeAble, attachments?, intent, priority, priorityRank, orientation,
  rootCorrelation, inReplyTo, inboxSpaceId, ord, sentAt, history}`. `priorityRank`
  folds from the `PRIORITY_RANK` enum (HUMAN 1, GATEWAY 2, INTERACTIVE 3,
  BACKGROUND 4; default 3). `ord` = `fact.ord ?? params.ord ?? null` (the clock-
  free order key the scheduler sorts on). `sentAt` = `fact.date ?? null` (inert
  display witness, never sorted).
- **evicts on** the answering Act's seal (`closeInboxOnAnswer(answers)`): delete
  the row where `_id === act.answers`. (An Act seal is NOT a Fact append, so the
  seal path calls this directly, not through `dispatchCrossCutting`.)

### threads (one row per LIVE coordination root, keyed by `rootCorrelation`)
- **bumps on** a `call` fact: root = `params.rootCorrelation || params.correlation`.
  `$set` the order key `ord` (`fact.ord ?? params.ord`) + the inert
  `lastAct`/`updatedAt` (`fact.date`); `$addToSet` the summoner (`through`) and the
  recipient (`of.id`) into `participants`; `$set parentThread` when present;
  `$setOnInsert startedAt`/`createdAt` on first insert.
- **bumps on** an Act seal (`noteActSealOnThread(root, {ord, at})`): bump `ord` to
  the answering act's ord (only when the seal carried one - no synthetic
  fallback); set `lastAct`/`updatedAt` to the act's inert seal-time `at`. A
  missing row is a no-op (no upsert); an empty seal (no ord, no at) is a no-op.

### position (one row per `(beingId, spaceId)`: the being's COORD in that space)
- **upserts on** `do:set-being` with `params.field === "coord"`: `of = {kind:"being",
  id}` (the being's reel), value `{x,y,z?}` -> the row at `_id = "<beingId>:<spaceId>"`
  with `{beingId, spaceId, x, y, lastMoveSeq, updatedAt, z?}`. `lastMoveSeq =
  fact.seq` is the clock-free truth-order; `updatedAt = fact.date` is an inert
  witness. **Seq-guarded**: a re-folded stale fact (`seq <= prior.lastMoveSeq`) is
  a no-op (replay-safe). value `null`/`undefined` = "unset coord" -> delete EVERY
  row for that being.

**`position` is NOT treeproj's `position` FACET.** `treeproj/src/index.rs`'s
`position` facet keys `spaceId -> [occupant ids]` off the folded `state.position`
(which space a being is IN). THIS projection keys `(beingId,spaceId) -> the {x,y,z}
COORDINATE` within that space. Distinct shapes, distinct purposes; not covered by
treeproj, so it is ported here (not a duplicate).

## The Rust fold port (functions + where)

| projection | function (`src/`) | signature |
| --- | --- | --- |
| inbox open | `inbox::inbox_open` | `fn(&Json) -> Option<Json>` (the row, or None) |
| inbox evict | `inbox::inbox_evict` | `fn(&str) -> Option<String>` (the `_id` to delete) |
| inbox quoted-word | `inbox::inbox_open_quoted_word` | resolved inputs `-> Json` (the row) |
| threads call | `threads::threads_fold_call` | `fn(Option<&Json> prior, &Json fact) -> Option<Json>` |
| threads seal | `threads::threads_note_act_seal` | `fn(Option<&Json> prior, &Json ord, &Json at) -> Option<Json>` |
| position coord | `position::position_fold_coord` | `fn(Option<&Json> prior, &Json fact, &str space_id) -> PositionOp` |

`PositionOp` = `Upsert(row) | DeleteForBeing(beingId) | NoOp` (the three writes a
coord fact resolves to; the seq-guard is applied purely against `prior`).

`value.rs` holds the shared insertion-order `RowBuilder` + the `$addToSet` /
`obj_set` helpers + the JS `||` / `??` / finite-number semantics.

## What is NOT a pure fact-fold (stays in JS, flagged precisely)

These are LIVE cross-reel reads, not `fact -> row`. The pure fold cannot see
them; the JS caller resolves the input and then applies the row op.

1. **inbox ANSWERED-GUARD.** `handleCall` skips the upsert when an Act already
   answers this correlation (`getActsByField("answers", corr).length > 0`). That
   reads the live act-chain index. The caller must clear the guard BEFORE calling
   `inbox_open`.
2. **inbox QUOTED-WORD CLOSE delivery.** `handleQuotedWordClose` assembles the
   utterance from the CALLER's whole reel (`readReel`), resolves the recipient by
   NAME (`findByName`) + the inboxSpace off the recipient's slot, then WAKES the
   scheduler. Reel I/O + name resolution + a live slot read + a side-effecting
   wake. The caller does that work and hands the resolved inputs to the pure
   `inbox_open_quoted_word`.
3. **position SPACE RESOLUTION.** The coord fact carries only the being's reel
   (`of.id`); the JS resolves WHICH space by reading the being's CURRENT
   `position` (`loadOrFold("being", beingId, history) -> slot.position`). The
   caller resolves `space_id` (treeproj exposes it as the folded `state.position`)
   and passes it to `position_fold_coord` (an empty `""` means "unresolved" -> the
   coord-set path NoOps, mirroring the JS `if (!spaceId) return`; the unset path
   still deletes - it never needs a space).
4. **the `afterPositionUpdate` HOOK fan** (notify subscribers on a real change) is
   I/O; stays JS.

threads is the ONE wholly-pure projection of the three: no live cross-reel guard,
both events port cleanly (`prior_row, fact -> new_row`).

## Tests

`tests/secondary_folds.rs` (17 tests, all green). Each fold is driven with the
right fact and the row asserted BYTE-COMPATIBLE with the live JS image:
- inbox opens on a `call` fact (+ priority/rank fold, attachments drop-when-absent
  / keep-in-position, ord fallback to `params.ord`, the skip cases, evict).
- threads opens + bumps lastAct/ord + participants on a `call`, falls back to
  `correlation`, second-touch extends participants, records `parentThread`, and
  `noteActSealOnThread` bumps ord.
- position folds a coord move (z appended after `updatedAt`), omits z when absent,
  the seq-guard rejects a stale fact, unset deletes the being's rows, and the
  wrong-verb / wrong-field / unresolved-space / bad-coord NoOps.

## Status / handoff

The FOLD is native. The remaining work (a follow-up, like the rest of the port's
dispatch slice) is to call these folds from the JS cross-cutting handlers through
the napi addon (the same `native.*` seam the reel fold uses), passing the resolved
cross-reel inputs (the answered-guard result, the quoted-word assembly, the
resolved spaceId) and writing the returned row / applying the `PositionOp` via
`projStore`. The I/O orchestration (when they fire, the wake, the hook fan) stays
in JS; only the fold logic crossed into Rust.
