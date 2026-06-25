# Conversion board — state + the remaining-op blockers (2026-06-24)

The board (ibp/operations.js `tallyConversion`, printed at boot via begin.js): an op is
**word-SOLE** (no JS handler — its `.word` is the only path, routed by do.js `runOpWord`) or
**pure-JS** (a handler exists). The ONLY move that converts one is DELETING the handler and
registering it word-sourced. A handler that merely delegates to a `.word` (a `_xViaWord`
adapter) is *decorated*, still counts pure-JS.

Current: **17 word-SOLE · 53 pure-JS · 70 ops** (was 15; set-pointer + delete-pointer landed).

## The word-sourced registration shape (the target)

```
registerAbleWord(<ableKey>, <opName>, new URL("./x.word", import.meta.url));
registerOperation("x", {
  targets: [...], ownerExtension: "seed", factAction: "x", args: {...},
  word: { noun, able?, idFrom?, ranAsMoments? },   // NO handler
  hostEnv: xHostEnv,                                // factory, called as hostEnv() (no args)
});
```
do.js `runOpWord` resolves the word by `word.able || word.noun` + opName, runs it through
runAbleWord with the STANDARD trigger `{ ...null-filled args, ...params, target, targetId,
targetKind, params, caller, branch }`, then promotes the fact: `idFrom` → stampsWordFact
(reads result.factParams + result[idFrom] as the target id, kind = word.noun); no idFrom →
returns result straight (auto-Fact uses ctx.params + resolveAuditTarget on the call target);
`ranAsMoments` → stamp nothing. The fold preserves word + hostEnv (hostEnv via a registered
`<name>:hostEnv` host ref), so resolveDoOpFromFold dispatch works.

## What runOpWord CANNOT do (why the remaining decorated ops are blocked)

The generic path is deliberately minimal. A decorated op converts cleanly ONLY if its `.word`:
reads only standard trigger keys, its hostEnv takes no args, it's single-moment (runAbleWord),
and it needs no `through`/identity threading. The blocked decorated ops each break one of these:

- **ask-able** — passes `through: caller` to runAbleWord (host-facilitated: runs THROUGH the
  asker so the queue-summon reaches the owner from i-am). Also reads `$space` (generic gives
  `targetId`). Needs runOpWord to support a `through` from the word descriptor.
- **take-able** — threads `moment.identity = {beingId: caller}` (self-act, the .word's internal
  grant needs the identity). Also reads `$space`. Needs identity threading.
- **set-model** — hostEnv CLOSES OVER params (`modelHostEnv(params)`) to enrich field/value/merge
  in place; generic calls `hostEnv()` with no args. Also still carries a full JS mirror body
  (old recipe step 6). Needs the .word to RETURN factParams instead of mutating params.
- **move** — dynamic fact-target kind (space OR matter, so a fixed `word.noun`/idFrom won't fit);
  reads `$subject` with explicit-param-wins (params.target ?? target); writes fromSpaceId back
  into params. Needs the .word to author its own factTarget {kind,id} + factParams.
- **add-llm-connection / assign-llm-slot** — MULTI-MOMENT composites (runWordToStore, each deed
  its own moment); runOpWord uses runAbleWord (one shared moment), can't drive them. Plus a
  post-fact clearBeingClientCache side-effect. Stay handler-based until the engine supports
  word-sourced multi-moment dispatch.

Conclusion: no remaining decorated op is a pure handler-deletion under today's runOpWord. The
next conversions need EITHER an opt-in engine extension to runOpWord (a `through` key + identity
threading + a params-aware hostEnv, all driven off the word descriptor) OR per-op .word reworks
(set-model, move authoring their own factParams/factTarget). The materials ops (set-being,
set-space, set-matter, set-owner, end-*, etc.) have no `.word` yet at all.

## Side bug fixed en route

`HEAVEN_SPACE.HISTORIES` was undefined — an abandoned HISTORIES→BRANCHES enum rename (commit
16f18bb) changed only the enum key; zero consumers adopted BRANCHES, while sprout's planting,
historyRegistry.findHeavenSpace, and the ./histories child-plant address all still reference
HEAVEN_SPACE.HISTORIES. The `.histories` heaven space planted with heavenSpace:undefined →
pointer lookups returned "the .histories heaven space was not found." Restored `HISTORIES:
"histories"` (removed unused BRANCHES). History pointers (#main, #prod) work again.
