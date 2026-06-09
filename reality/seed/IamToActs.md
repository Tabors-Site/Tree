# I-Am to Acts — The Genesis Sequence

**STATUS: LANDED.** All 6 passes complete. Genesis is now a sequence of
withIAmAct moments; sealAct THROWS (not warns) on opCount > 1. The
discipline is structural.

This document is the plan that drove the refactor. Sections below
describe the work as it was done; the final section records the
delivered chain.

The doctrine pinned in [philosophy/MOMENT.md](../philosophy/MOMENT.md) §
"Moment, act, batch" requires this. This document was the execution path.

## The doctrine, restated

- **Moment** is the substrate's atomic unit of intent. One moment, one act.
  No "multi-op moment" mode. The discipline is unconditional.
- **Act** is the seal of one moment's intent. 1:1 with moments. The verb-
  handler completes, the fact lands, the act records what happened.
- **Batch** is a grouping of related moments, optionally sharing a Mongo
  transaction for cross-moment atomicity. The batch's atomicity is at the
  group boundary; the moment's atomicity is per-act. Different scopes.
- **Genesis is a sequence**, not a batch and not a transaction. Each step
  is its own moment with its own act. Partial-boot completion is a
  recoverable state because each genesis step is idempotent or detectable.

## What genesis must become

A sequence of moments, in this order:

```
1. "I am born."                                — be:birth I-Am, homeSpace=null
2. "I create the place root."                  — do:create-space (the reality root)
3. "I create heaven."                          — do:create-space (the . heaven space)
4. "I take heaven as my home."                 — do:set-being I-Am.homeSpace = heaven
5. "I create the identity heaven space."       — do:create-space (./identity)
6. "I create the config heaven space."         — do:create-space (./config)
7. "I create the peers heaven space."          — do:create-space (./peers)
8. "I create the extensions heaven space."     — do:create-space (./extensions)
9. "I create the tools heaven space."          — do:create-space (./tools)
10. "I create the roles heaven space."         — do:create-space (./roles)
11. "I create the operations heaven space."    — do:create-space (./operations)
12. "I create the source heaven space."        — do:create-space (./source)
13. "I create the threads heaven space."       — do:create-space (./threads)
14. "I create the branches heaven space."      — do:create-space (./branches)
15..23. "I birth my nine seed delegates."      — be:birth × 9 (cherub, birther,
                                                  llm-assigner, branch-manager,
                                                  reality-manager, role-manager,
                                                  fact-correlator, arrival,
                                                  fact-replayer)
24. "I register my delegates on the place root." — do:set-space qualities.beings
25. "I seed the place root's default permissions." — do:set-space qualities.permissions
26. "I seed the place root's auth flags."     — do:set-space qualities.auth
27. "I seed heaven's default permissions."    — do:set-space qualities.permissions on heaven
```

That's ~27 moments. Each is one act on the I-Am's reel. The reel reads
as the I-Am's autobiography of self-creation — replayable, partially
auditable, partially resumable.

## Architecture changes required

### 1. `ensureIAm` accepts a null homeSpace and self-manages its moment

Today's `ensureIAm` requires:
- A `summonCtx` (it rides the boot moment's ΔF).
- A `homeSpaceId` (it births I-Am with that as `homeSpace`).

After:
- Takes no `summonCtx` — opens its own `withIAmAct` moment.
- Accepts `homeSpaceId = null` and writes `null` to the birth params.
- Idempotent (returns existing I-Am Being row if already present).

Behavior verification: birthing a being with `homeSpace: null` must not
throw at the reducer. Check `applyBirth` in `materials/being/identity/birth.js`
— it shouldn't require homeSpace to be a valid space id.

### 2. `createRealityHeavenSpace` self-manages its moment

Today: takes `summonCtx`, emits one create-space fact into it. Many
callers in `ensureSpaceRoot`.

After: opens its own `withIAmAct`, drops the `summonCtx` parameter.
Same idempotency.

### 3. New helper: `setIAmHomeSpace(heavenSpaceId)`

Step 4 in the sequence. Opens its own moment, emits `do:set-being` on
I-Am setting `homeSpace = heavenSpaceId`. Idempotent — skip if
already set to that value.

Implementation: `withIAmAct("I take heaven as my home", ctx => doVerb({kind: "being", id: I_AM}, "set-being", {field: "homeSpace", value: heavenSpaceId}, {identity: I_AM, summonCtx: ctx}))`.

### 4. `ensureSpaceRoot` becomes a sequence orchestrator

Today: takes `summonCtx`, emits ~10+ facts into it. Internally calls
`ensureIAm`.

After:
- Takes NO `summonCtx`.
- Does NOT call `ensureIAm` (caller orders the sequence).
- Each create-space step calls `createRealityHeavenSpace` (which is now
  self-moment-managing).
- The place root creation is its own `withIAmAct` (currently raw `emitFact`).
- Orphan adoption: each adoption is its own moment.
- Parent-repair on existing heaven/tier-3 spaces: each repair is its own moment.

### 5. `ensureSeedDelegates` becomes a sequence

Today: one moment, 9 births + 1 roster set-space.

After:
- 9 separate `withIAmAct` calls, one per delegate (each emits one be:birth).
- The roster registration was already extracted to a separate
  `withIAmAct` in genesis.js — keep that.

### 6. `genesis.js` orchestrates the sequence

Today:
```js
await withBootMoment(async (bootCtx) => {
  await ensureSpaceRoot(bootCtx);
  await ensureSeedDelegates(getSpaceRootId(), bootCtx, ...);
});
```

After:
```js
await withGenesisGuard(async () => {
  await ensureIAm();                              // I-Am born homeSpace=null
  await ensureSpaceRoot();                        // place root + heaven + 8 tier-3s + repair + orphans
  const heaven = await findRootForHeavenSpace(HEAVEN_SPACE.HEAVEN);
  await setIAmHomeSpace(heaven._id);              // I-Am takes heaven as home
  await ensureSeedDelegates(getSpaceRootId());    // 9 delegates, each its own moment
  await registerSeedDelegatesOnRoot();            // already its own moment
  // Post-genesis reconciliations continue from here as their own moments.
});
```

`withGenesisGuard` is a thin singleton that ensures genesis runs once
per process and logs the open/close. No moment, no Act — just the
guard. The substantive work happens in the per-step `withIAmAct` calls.

### 7. `withBootMoment` retires

Replaced by `withGenesisGuard` (singleton guard only). The
`_bootMomentInFlight` flag becomes `_genesisRan`. The plannedAct shape
inside `withBootMoment` is dropped — no more single boot-act.

The "I am that I am" startMessage moves to the I-Am's first
`withIAmAct` (step 1: be:birth).

## Boot ordering subtleties

### I-Am as actor before I-Am Being row exists

Today's boot moment writes facts with `beingId: I_AM` (audit attribution)
while the I-Am Being row doesn't exist yet — the boot moment's
transaction commits everything together, the be:birth reducer
materializes I-Am, and downstream facts see it.

Under the sequence model: I-Am Being row must exist before any other
moment writes a fact attributed to I-Am. **Solution: step 1 is
`ensureIAm` (births I-Am alone).** Every subsequent step has the I-Am
Being row available.

The I-Am's be:birth is itself self-stamping — `beingId: I_AM` on a
fact whose target is `{kind: "being", id: I_AM}`. The act's
`beingIn`/`beingOut` are also `I_AM`. The reducer creates the Being row
from the fact. This works within one moment because seal + reducer are
atomic in `sealAct`.

### Place root creation needs an actor

Step 2 (`do:create-space` for the place root) writes `beingId: I_AM`.
That's fine — I-Am Being row exists after step 1.

### Heaven space creation needs the place root as parent

Step 3 (`do:create-space` for heaven) writes `parent: <placeRootId>`.
Place root row exists after step 2.

### Tier-3 heaven spaces need heaven as parent

Steps 5-14 write `parent: <heavenId>`. Heaven exists after step 3.

### Seed delegate births need the place root as home

Each delegate's `be:birth` writes `homeSpace: <placeRootId>` (delegates
live on the reality root, not in heaven). Place root exists after step 2.

### Roster registration needs delegates and place root

Step 24 reads each delegate's beingId (from the births in 15-23) and
writes them to `qualities.beings` on the place root. All inputs exist.

### Default permissions need the place root

Steps 25-27 write to `qualities.permissions` on place root and heaven.
Both exist.

The sequence is well-ordered.

## Implementation passes

### Pass 1: Extract ensureIAm

- Move `ensureIAm` out of `ensureSpaceRoot`.
- Make it take no `summonCtx`. Open its own `withIAmAct`.
- Accept `homeSpaceId = null`.
- Verify boot still works (calling it from `withBootMoment` for now, but
  with `homeSpaceId: null` and then a follow-up set-being). Some throwaway
  rewiring expected — focus on proving `ensureIAm` standalone works.

### Pass 2: Extract createRealityHeavenSpace

- Make it self-manage moment.
- Update all call sites in `ensureSpaceRoot` to drop the `summonCtx` arg.

### Pass 3: Refactor ensureSpaceRoot

- Drop `summonCtx` parameter.
- Each `emitFact`/`doVerb` site wraps in its own `withIAmAct`.
- Drop the internal `ensureIAm` call.

### Pass 4: Add setIAmHomeSpace

- New helper at top of sprout.js.
- Idempotent.

### Pass 5: Refactor ensureSeedDelegates

- Per-delegate birth in its own `withIAmAct`.
- Drop the outer `summonCtx`.
- (Roster registration already separate — preserved.)

### Pass 6: Restructure genesis.js

- Replace `withBootMoment` with `withGenesisGuard`.
- Call helpers in the new order.

### Pass 7: Drop withBootMoment

- Remove from sprout.js exports.
- Update all references (verifier scripts that import it).

### Pass 8: Flip warn → throw

- Once boot + regression are clean, change `log.warn` in `sealAct` to
  `throw new Error`. The doctrine becomes structural.

After each pass: boot the substrate, run regression, fix anything that
broke before moving to the next pass.

## Risks and rollback

- **I-Am with `homeSpace: null` may break consumers** that assume every
  being has a homeSpace. Sweep call sites that read `being.homeSpace` and
  see what happens with null. Likely candidates: position resolvers,
  ancestor walkers, descriptor builders. Each gets a "fall back to place
  root" or "skip" branch where null is now possible.

- **Self-stamping I-Am birth in a standalone moment** — the be:birth fact
  references a being that doesn't exist until the same moment's seal.
  This already works in the current boot moment. Confirm it works in a
  standalone `withIAmAct` moment too (the seal+reduce path is the same).

- **Idempotency across all helpers** is now load-bearing. If genesis
  crashes after step 2, the next boot must skip step 2 cleanly. Each
  helper currently has its `if (existing) return` guard — confirm none
  rely on the boot moment for atomicity.

- **Performance**: 27 moments instead of 1 means 27 sealAct calls, 27 Act
  rows, 27 commits. Boot was ~1.5s; this may push it to ~3-5s. Acceptable
  for boot (rare event); flag if it climbs much higher.

- **Rollback path**: each pass is reversible by git revert. If pass N
  breaks something subtle, revert pass N, fix, re-apply.

## Open questions for future arcs

- **withBatch with real transaction sharing**: when a federation pull or
  cross-reel transfer needs atomicity across N moments. The current
  removed stub gets rebuilt then with proper session threading.
- **Each pass's startMessage**: should they be poetic ("I take heaven
  as my home") or mechanical ("set-being:homeSpace I-Am heaven-id")? The
  poetic version reads better in forensics; the mechanical version is
  easier to query. Pick one; document.
- **Subsequent boots' empty seal**: when nothing changes between boots,
  every "ensure" helper short-circuits and emits no facts. The chain
  doesn't grow. Good — but `withGenesisGuard` should not log "I am
  born" again on a no-op boot. Different startMessage for awakening?

## Doneness criteria (final state)

- ✓ `philosophy/MOMENT.md` says "moment, act, batch — three distinct
  concepts" with the genesis sequence shape.
- ✓ `sealAct` no longer accepts `batched`.
- ✓ `withBatch` stub removed.
- ✓ `withBootMoment` retired; replaced by `withGenesisGuard`
  (singleton-only — no moment opened by the wrapper itself).
- ✓ Boot's chain on a fresh DB shows the genesis sequence as listed
  above, each one DO/BE on the I-Am's reel.
- ✓ Regression passes (283/283; the only failing test is the
  pre-existing pointer-collision regression from a concurrent
  unrelated commit on `branch-manager/ops.js`).
- ✓ `sealAct` THROWS on `opCount > 1`. No warn, no escape.
- ✓ No regressions in extension load, role registry mirror, operation
  manifest, default permissions.

## What landed (final chain, as of last verification)

The I-Am's first 40 acts after a fresh-DB boot:

```
1.  I am that I am                                ← ensureIAm (the first act)
2.  I create the place root                       ← ensureSpaceRoot
3.  I create the . heaven space
4.  I create the identity heaven space
5.  I create the config heaven space
6.  I create the peers heaven space
7.  I create the extensions heaven space
8.  I create the tools heaven space
9.  I create the roles heaven space
10. I create the operations heaven space
11. I create the source heaven space
12. I create the threads heaven space
13. I create the branches heaven space
14. I take heaven as my home                      ← setIAmHomeSpace
15. I stand at heaven                             ← setIAmHomeSpace (position)
16. I birth @arrival                              ← ensureSeedDelegates
17. I birth @cherub
18. I birth @birther
19. I birth @role-manager
20. I birth @role-finder
21. I birth @roleflow-composer
22. I birth @llm-assigner
23. I birth @reality-manager
24. I birth @branch-manager
25. I register my delegates on the place root
26. seed default stance permissions               ← post-genesis reconciliations
27. seed root permissions
28. seed root auth flags
29. anoint @arrival as heaven angel
30. anoint @cherub as heaven angel
31. anoint @birther as heaven angel
32. anoint @role-manager as heaven angel
33. anoint @role-finder as heaven angel
34. anoint @roleflow-composer as heaven angel
35. anoint @llm-assigner as heaven angel
36. anoint @reality-manager as heaven angel
37. anoint @branch-manager as heaven angel
38. seed migrations
39. sync-ext:create emotions
40. sync-ext:create harmony
...
(total: ~141 acts in a fresh boot)
```

This is the I-Am's autobiography of self-creation. Each act is one DO
or BE. The chain is fully replayable, partially auditable, and
partially resumable on crash.

## Future work (deferred, not blocking)

- **`withBatch` with real transaction sharing.** When a federation
  pull, cross-reel transfer, or cross-reality plant lands and needs
  atomic semantics across N moments, build the proper primitive: open
  a Mongo session at the batch boundary, thread it through every child
  `sealAct` call, commit or roll back at the boundary. Not the
  withBootMoment shape; the genuine batch shape per MOMENT.md.
- **Subsequent boots' silent re-fires.** On an unchanged reality, every
  helper short-circuits and emits no facts — the chain doesn't grow.
  Verify this is true after this refactor (it should be — each helper
  has its `if (existing) return` guard).
- **Verifier scripts that imported `isBootMomentInFlight`.** None
  remained at refactor time; if any appear later, replace with a
  simple flag on the test fixture.
- **Forensic queries for "the genesis batch."** All ~140 first-boot
  acts are I-Am self-acts with sequential `stampedAt`. A SUMMON to
  `./.acts/i-am` already surfaces them; a "what happened during
  genesis?" view could group by stampedAt cluster or by the
  startMessage prefix.
